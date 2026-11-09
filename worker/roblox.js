// Roblox Creator Store (toolbox-service v2) search for every asset type, normalised for the site and MCP.

export const ASSET_TYPES = ["Audio", "Model", "Decal", "MeshPart", "Plugin", "Video", "FontFamily"];
const SORTS = new Set(["Relevance", "Trending", "Top", "AudioDuration", "CreateTime", "UpdatedTime", "Ratings"]);
const AUDIO_TYPES = new Set(["SoundEffect", "Music"]);
const TYPE_ALIASES = {
  audio: "Audio", sound: "Audio", sounds: "Audio", music: "Audio", sfx: "Audio",
  model: "Model", models: "Model",
  decal: "Decal", decals: "Decal", image: "Decal", images: "Decal",
  mesh: "MeshPart", meshes: "MeshPart", meshpart: "MeshPart",
  plugin: "Plugin", plugins: "Plugin",
  video: "Video", videos: "Video",
  font: "FontFamily", fonts: "FontFamily", fontfamily: "FontFamily",
};

export function apiBase(env) {
  return (env && env.ROBLOX_API_BASE) || "https://apis.roblox.com";
}
export function thumbBase(env) {
  return (env && env.ROBLOX_THUMB_BASE) || "https://thumbnails.roblox.com";
}

export function normaliseType(t) {
  if (typeof t !== "string") return "Audio";
  if (ASSET_TYPES.includes(t)) return t;
  return TYPE_ALIASES[t.toLowerCase()] || "Audio";
}

/** Validate and clamp user input into a clean options object. */
export function parseSearchOptions(input = {}) {
  const str = (v, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const num = (v) => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };
  const bool = (v) => v === true || v === "1" || v === "true";

  const assetType = normaliseType(input.assetType ?? input.category ?? input.cat);
  const audioType = str(input.type ?? input.audioType, 20);
  const sort = str(input.sort, 20);
  let limit = num(input.limit) ?? 30;
  limit = Math.min(Math.max(limit, 1), 60);

  return {
    assetType,
    query: str(input.query ?? input.q),
    audioType: assetType === "Audio" && AUDIO_TYPES.has(audioType) ? audioType : "",
    minDuration: assetType === "Audio" ? num(input.minDuration ?? input.min) : undefined,
    maxDuration: assetType === "Audio" ? num(input.maxDuration ?? input.max) : undefined,
    verifiedOnly: bool(input.verifiedOnly ?? input.verified),
    freeOnly: input.freeOnly === undefined && input.free === undefined ? true : bool(input.freeOnly ?? input.free),
    sort: SORTS.has(sort) && (sort !== "AudioDuration" || assetType === "Audio") ? sort : "Relevance",
    limit,
    pageToken: str(input.pageToken ?? input.cursor, 500),
  };
}

export function buildSearchUrl(env, o) {
  const u = new URL("/toolbox-service/v2/assets:search", apiBase(env));
  const p = u.searchParams;
  p.set("searchCategoryType", o.assetType);
  p.set("maxPageSize", String(o.limit));
  p.set("searchView", "Full");
  if (o.query) p.set("query", o.query);
  if (o.audioType) p.set("audioTypes", o.audioType);
  if (o.minDuration !== undefined) p.set("audioMinDurationSeconds", String(o.minDuration));
  if (o.maxDuration !== undefined) p.set("audioMaxDurationSeconds", String(o.maxDuration));
  if (o.verifiedOnly) p.set("includeOnlyVerifiedCreators", "true");
  if (o.freeOnly) p.set("maxPriceCents", "0");
  if (o.sort && o.sort !== "Relevance") {
    p.set("sortCategory", o.sort);
    p.set("sortDirection", o.sort === "AudioDuration" ? "Ascending" : "Descending");
  }
  if (o.pageToken) p.set("pageToken", o.pageToken);
  return u.toString();
}

function moneyToUsd(m) {
  const q = m && m.quantity;
  if (!q || typeof q.significand !== "number") return null;
  return q.significand * Math.pow(10, q.exponent || 0);
}

/** Map one raw creatorStoreAssets entry to a small, stable shape. */
export function normaliseAsset(raw, assetType = "Audio") {
  const a = raw?.asset || {};
  const c = raw?.creator || {};
  const v = raw?.voting || {};
  const p = raw?.creatorStoreProduct || {};
  const id = a.id ?? a.assetId;
  if (!id) return null;
  const clean = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

  const price = moneyToUsd(p.purchasePrice);
  const out = {
    id: String(id),
    assetType,
    name: clean(a.name || a.title) || "Untitled",
    description: clean(a.description).slice(0, 200),
    creator: {
      name: c.name || "Unknown",
      id: c.userId ?? c.groupId ?? null,
      type: c.groupId ? "Group" : "User",
      verified: !!c.verified,
      isRoblox: c.userId === 1,
    },
    upVotePercent: typeof v.upVotePercent === "number" ? v.upVotePercent : null,
    voteCount: typeof v.voteCount === "number" ? v.voteCount : null,
    priceUsd: price,
    free: price === null ? p.purchasable !== false : price === 0,
    url: `https://create.roblox.com/store/asset/${id}`,
  };

  if (assetType === "Audio") {
    out.duration = typeof a.durationSeconds === "number" ? a.durationSeconds : null;
    out.audioType = a.audioType || null;
    out.category = clean(a.category || a.genre) || null;
    out.artist = clean(a.artist) || null;
  }
  if (assetType === "Model" || assetType === "Plugin") {
    out.hasScripts = typeof a.hasScripts === "boolean" ? a.hasScripts : null;
    out.scriptCount = typeof a.scriptCount === "number" ? a.scriptCount : null;
    out.triangles = a.objectMeshSummary?.triangles ?? null;
    out.subTypes = Array.isArray(a.subTypes) ? a.subTypes : [];
  }
  if (a.textureId) out.textureId = String(a.textureId);
  if (a.meshId) out.meshId = String(a.meshId);

  // The ID you actually paste into Studio properties.
  const useId = assetType === "Decal" ? out.textureId : assetType === "MeshPart" ? out.meshId : null;
  out.contentId = ["Audio", "Decal", "MeshPart", "Video"].includes(assetType) ? `rbxassetid://${useId || out.id}` : null;
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchUpstream(url, env) {
  const base = { accept: "application/json", "user-agent": "polyfind/2.0" };
  const key = env && env.ROBLOX_API_KEY;
  const keyed = key ? { ...base, "x-api-key": key } : null;

  // Prefer the API key: its rate limit (1000/min) belongs to us, not to a shared Cloudflare IP.
  let res = await fetch(url, { headers: keyed || base });
  if (keyed && (res.status === 401 || res.status === 403)) {
    // Key lacks creator-store-product:read — fall back to anonymous.
    res = await fetch(url, { headers: base });
  }
  for (let attempt = 0; res.status === 429 && attempt < 2; attempt++) {
    const wait = Math.min(Number(res.headers.get("retry-after")) * 1000 || 350 * (attempt + 1), 1500);
    await sleep(wait);
    res = await fetch(url, { headers: attempt === 0 && keyed ? base : keyed || base });
  }
  return res;
}

export async function searchAssets(env, options, ctx) {
  const o = parseSearchOptions(options);
  const upstream = buildSearchUrl(env, o);

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(upstream, { method: "GET" });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return { ...(await hit.json()), cached: true };
  }

  const res = await fetchUpstream(upstream, env);
  if (!res.ok) {
    const err = new Error(res.status === 429 ? "Roblox is rate limiting, try again in a few seconds" : `Roblox API ${res.status}`);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  const data = await res.json();
  const result = {
    assetType: o.assetType,
    query: o.query,
    total: data.totalResults ?? null,
    nextPageToken: data.nextPageToken || null,
    items: (data.creatorStoreAssets || []).map((x) => normaliseAsset(x, o.assetType)).filter(Boolean),
  };

  if (cache) {
    const ttl = Number(env?.CACHE_TTL_SECONDS) || 3600;
    const put = cache.put(
      cacheKey,
      new Response(JSON.stringify(result), {
        headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` },
      })
    );
    if (ctx && ctx.waitUntil) ctx.waitUntil(put);
    else await put;
  }
  return result;
}

// Back-compat for the original sound-only API.
export const searchSounds = (env, options, ctx) => searchAssets(env, { ...options, assetType: "Audio" }, ctx);

/** Batch thumbnail lookup: returns { id: imageUrl }. */
export async function thumbnails(env, ids, ctx) {
  const clean = [...new Set(ids.filter((x) => /^\d{1,20}$/.test(x)))].slice(0, 60);
  if (!clean.length) return {};
  clean.sort();
  const url = `${thumbBase(env)}/v1/assets?assetIds=${clean.join(",")}&returnPolicy=PlaceHolder&size=150x150&format=Webp&isCircular=false`;

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(url);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit.json();
  }
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return {};
  const data = await res.json().catch(() => ({}));
  const map = {};
  let pending = false;
  for (const t of data.data || []) {
    if (t.imageUrl && t.state === "Completed") map[String(t.targetId)] = t.imageUrl;
    else if (t.state === "Pending") pending = true;
  }
  if (cache) {
    const put = cache.put(key, new Response(JSON.stringify(map), {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${pending ? 60 : 86400}` },
    }));
    if (ctx && ctx.waitUntil) ctx.waitUntil(put);
  }
  return map;
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
    await cache.put(key, new Response(loc || "", { headers: { "cache-control": `public, max-age=${loc ? 1800 : 300}` } }));
  }
  return loc;
}

const LABEL = { Audio: "sounds", Model: "models", Decal: "decals", MeshPart: "meshes", Plugin: "plugins", Video: "videos", FontFamily: "fonts" };

export function formatForText(result) {
  const what = LABEL[result.assetType] || "assets";
  if (!result.items.length) return `No Roblox ${what} found for "${result.query}".`;
  const lines = result.items.map((s, i) => {
    const bits = [];
    if (s.duration != null) bits.push(`${s.duration}s`);
    if (s.hasScripts) bits.push(`${s.scriptCount || "has"} scripts`);
    if (s.hasScripts === false) bits.push("no scripts");
    if (s.triangles) bits.push(`${s.triangles} tris`);
    bits.push(s.free ? "free" : s.priceUsd != null ? `$${s.priceUsd}` : "paid");
    bits.push(`by ${s.creator.name}`);
    let line = `${i + 1}. ${s.name} — ID ${s.id} (${bits.join(", ")})`;
    if (s.contentId) line += `\n   ${s.contentId}`;
    return line;
  });
  let out = `Roblox ${what} for "${result.query}"${result.total ? ` (${result.total} total)` : ""}:\n\n${lines.join("\n")}`;
  if (result.nextPageToken) out += `\n\nMore results: call again with pageToken "${result.nextPageToken}".`;
  return out;
}
