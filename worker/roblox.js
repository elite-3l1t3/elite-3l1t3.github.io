// Roblox Creator Store (toolbox-service v2) search, normalised for the site and MCP.
// Docs: https://create.roblox.com/docs/cloud/reference (Toolbox service)

const SORTS = new Set(["Relevance", "Trending", "Top", "AudioDuration", "CreateTime", "UpdatedTime", "Ratings"]);
const TYPES = new Set(["SoundEffect", "Music"]);

export function apiBase(env) {
  return (env && env.ROBLOX_API_BASE) || "https://apis.roblox.com";
}

/** Validate and clamp user input into a clean options object. */
export function parseSearchOptions(input = {}) {
  const str = (v, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };
  const bool = (v) => v === true || v === "1" || v === "true";

  const type = str(input.type, 20);
  const sort = str(input.sort, 20);
  let limit = num(input.limit) ?? 30;
  limit = Math.min(Math.max(limit, 1), 60);

  return {
    query: str(input.query ?? input.q),
    type: TYPES.has(type) ? type : "",
    minDuration: num(input.minDuration ?? input.min),
    maxDuration: num(input.maxDuration ?? input.max),
    verifiedOnly: bool(input.verifiedOnly ?? input.verified),
    sort: SORTS.has(sort) ? sort : "Relevance",
    limit,
    pageToken: str(input.pageToken ?? input.cursor, 500),
  };
}

export function buildSearchUrl(env, o) {
  const u = new URL("/toolbox-service/v2/assets:search", apiBase(env));
  const p = u.searchParams;
  p.set("searchCategoryType", "Audio");
  p.set("maxPageSize", String(o.limit));
  p.set("searchView", "Full");
  if (o.query) p.set("query", o.query);
  if (o.type) p.set("audioTypes", o.type);
  if (o.minDuration !== undefined) p.set("audioMinDurationSeconds", String(o.minDuration));
  if (o.maxDuration !== undefined) p.set("audioMaxDurationSeconds", String(o.maxDuration));
  if (o.verifiedOnly) p.set("includeOnlyVerifiedCreators", "true");
  if (o.sort && o.sort !== "Relevance") {
    p.set("sortCategory", o.sort);
    p.set("sortDirection", o.sort === "AudioDuration" ? "Ascending" : "Descending");
  }
  if (o.pageToken) p.set("pageToken", o.pageToken);
  return u.toString();
}

/** Map one raw creatorStoreAssets entry to a small, stable shape. */
export function normaliseAsset(raw) {
  const a = raw?.asset || {};
  const c = raw?.creator || {};
  const v = raw?.voting || {};
  const id = a.id ?? a.assetId;
  if (!id) return null;
  return {
    id: String(id),
    name: a.name || a.title || "Untitled",
    description: (a.description || "").slice(0, 200),
    duration: typeof a.durationSeconds === "number" ? a.durationSeconds : null,
    audioType: a.audioType || null,
    category: a.category || a.genre || null,
    artist: a.artist || null,
    creator: {
      name: c.name || "Unknown",
      id: c.userId ?? c.groupId ?? null,
      type: c.groupId ? "Group" : "User",
      verified: !!c.verified,
      isRoblox: c.userId === 1,
    },
    upVotePercent: typeof v.upVotePercent === "number" ? v.upVotePercent : null,
    voteCount: typeof v.voteCount === "number" ? v.voteCount : null,
    url: `https://create.roblox.com/store/asset/${id}`,
  };
}

export async function searchSounds(env, options, ctx) {
  const o = parseSearchOptions(options);
  const upstream = buildSearchUrl(env, o);

  // Edge cache: identical searches within the TTL never hit Roblox.
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(upstream, { method: "GET" });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return { ...(await hit.json()), cached: true };
  }

  // Search works without auth. If Roblox rate-limits/refuses the anonymous call and a key
  // with creator-store-product:read is configured, retry once with it.
  const headers = { accept: "application/json", "user-agent": "rbx-sound-finder/1.0" };
  let res = await fetch(upstream, { headers });
  if ([401, 403, 429].includes(res.status) && env && env.ROBLOX_API_KEY) {
    res = await fetch(upstream, { headers: { ...headers, "x-api-key": env.ROBLOX_API_KEY } });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Roblox API ${res.status}`);
    err.status = res.status === 429 ? 429 : 502;
    err.detail = text.slice(0, 300);
    throw err;
  }
  const data = await res.json();
  const result = {
    query: o.query,
    total: data.totalResults ?? null,
    nextPageToken: data.nextPageToken || null,
    items: (data.creatorStoreAssets || []).map(normaliseAsset).filter(Boolean),
  };

  if (cache) {
    const ttl = Number(env?.CACHE_TTL_SECONDS) || 3600;
    const toStore = new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` },
    });
    const put = cache.put(cacheKey, toStore);
    if (ctx && ctx.waitUntil) ctx.waitUntil(put);
    else await put;
  }
  return result;
}

/** Resolve a short-lived CDN URL for audio preview. Needs ROBLOX_API_KEY with legacy-asset:manage. */
export async function previewLocation(env, id) {
  if (!env || !env.ROBLOX_API_KEY) return null;
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`${apiBase(env)}/__preview-cache/${id}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return (await hit.text()) || null;
  }
  const res = await fetch(`${apiBase(env)}/asset-delivery-api/v1/assetId/${id}`, {
    headers: { "x-api-key": env.ROBLOX_API_KEY, accept: "application/json", AssetType: "Audio" },
  });
  let loc = null;
  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    const okScheme = env.ROBLOX_API_BASE ? /^https?:\/\// : /^https:\/\//; // http only for local testing
    if (typeof data.location === "string" && okScheme.test(data.location)) loc = data.location;
  }
  if (cache) {
    // Cache misses briefly too, so a bad ID can't be used to hammer Roblox.
    await cache.put(key, new Response(loc || "", { headers: { "cache-control": `public, max-age=${loc ? 1800 : 300}` } }));
  }
  return loc;
}

export function formatForText(result) {
  if (!result.items.length) return `No sounds found for "${result.query}".`;
  const lines = result.items.map((s, i) => {
    const dur = s.duration != null ? `${s.duration}s` : "?s";
    const by = `${s.creator.name}${s.creator.verified ? " ✓" : ""}`;
    return `${i + 1}. ${s.name} — ID ${s.id} (${dur}, by ${by})\n   SoundId = "rbxassetid://${s.id}"`;
  });
  let out = `Roblox sounds for "${result.query}"${result.total ? ` (${result.total} total)` : ""}:\n\n${lines.join("\n")}`;
  if (result.nextPageToken) out += `\n\nMore results: call again with pageToken "${result.nextPageToken}".`;
  return out;
}
