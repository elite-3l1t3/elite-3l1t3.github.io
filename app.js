// PolyFind front-end. No framework, no dependencies.
const API = String(window.POLYSFX_API || "").replace(/\/+$/, "");
const API_READY = /^https?:\/\//.test(API) && !API.includes("YOUR-SUBDOMAIN");
const $ = (s, el = document) => el.querySelector(s);
const grid = $("#results");
const statusEl = $("#status");
const moreBtn = $("#more");
const input = $("#q");
const tpl = $("#card-tpl");
const tileTpl = $("#tile-tpl");

const CATS = ["Model", "Audio", "Decal", "MeshPart", "Plugin", "Video", "FontFamily"];
const LABEL = { Model: "models", Audio: "sounds", Decal: "decals", MeshPart: "meshes", Plugin: "plugins", Video: "videos", FontFamily: "fonts" };
const QUICK = {
  Model: ["tree", "car", "house", "sword", "low poly", "npc", "gun", "furniture", "lamp", "obby"],
  Audio: ["punch", "kill", "whoosh", "sword slash", "explosion", "coin", "jump", "ui click", "countdown", "win"],
  Decal: ["grass texture", "wood", "logo", "sky", "brick", "smile", "arrow", "fire", "neon", "anime"],
  MeshPart: ["rock", "tree", "crate", "sword", "barrel", "chair", "low poly", "crystal", "fence", "bush"],
  Plugin: ["building", "animation", "terrain", "ui", "lighting", "f3x", "tween", "align", "admin", "texture"],
  Video: ["fire", "rain", "space", "ocean", "loading", "intro", "smoke", "clouds", "neon", "city"],
  FontFamily: ["pixel", "bold", "handwriting", "serif", "retro", "comic", "horror", "rounded", "mono", "anime"],
};
const ICON = { punch: "👊", kill: "💀", whoosh: "💨", "sword slash": "⚔️", explosion: "💥", coin: "🪙", jump: "⬆️", "ui click": "🖱️", countdown: "⏱️", win: "🏆", tree: "🌳", car: "🚗", house: "🏠", sword: "⚔️", gun: "🔫", rock: "🪨", fire: "🔥", sky: "🌌", space: "🪐" };

const state = {
  cat: "Model",
  free: true,
  q: "",
  type: "",
  max: "",
  sort: "Relevance",
  token: null,
  loading: false,
  reqId: 0,
  count: 0,
  preview: false,
};

/* ---------------- low-poly background ---------------- */
(function polyBackground() {
  const canvas = $("#poly-bg");
  const ctx = canvas.getContext("2d", { alpha: false });
  // Palette stops from top-left to bottom-right.
  const stops = [
    [22, 25, 62],
    [42, 30, 98],
    [24, 58, 102],
    [16, 26, 54],
  ];
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const colorAt = (t) => {
    const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
    return mix(stops[seg], stops[seg + 1], t * (stops.length - 1) - seg);
  };
  // Seeded RNG so the mesh is stable across resizes.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed = 7;

    const cell = w < 640 ? 70 : 95;
    const cols = Math.ceil(w / cell) + 2, rows = Math.ceil(h / cell) + 2;
    const pts = [];
    for (let y = 0; y < rows; y++) {
      const row = [];
      for (let x = 0; x < cols; x++) {
        const jx = (rnd() - 0.5) * cell * 0.75, jy = (rnd() - 0.5) * cell * 0.75;
        row.push([(x - 1) * cell + jx, (y - 1) * cell + jy]);
      }
      pts.push(row);
    }
    const light = [-0.5, -0.8]; // light from top-left
    const tri = (a, b, c) => {
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
      const t = Math.max(0, Math.min(1, (cx / w) * 0.55 + (cy / h) * 0.45));
      // Fake facet normal from the triangle's slope for shading.
      const nx = (b[1] - a[1]) * (c[0] - a[0]) - (c[1] - a[1]) * (b[0] - a[0]);
      const shade = 0.82 + 0.28 * Math.sin(nx * 0.00003 + cx * light[0] * 0.01 + cy * light[1] * 0.01) + rnd() * 0.08;
      const [r, g, bl] = colorAt(t).map((v) => Math.min(255, v * shade));
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${bl | 0})`;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle; // hide seams
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const p = pts[y][x], q = pts[y][x + 1], r = pts[y + 1][x], s = pts[y + 1][x + 1];
        if ((x + y) % 2) { tri(p, q, r); tri(q, s, r); } else { tri(p, q, s); tri(p, s, r); }
      }
    }
  }
  let t;
  let lastW = 0;
  const onResize = () => {
    // Ignore height-only changes (mobile URL bar) to avoid redraw jank.
    if (Math.abs(window.innerWidth - lastW) < 2 && canvas.width) return;
    lastW = window.innerWidth;
    clearTimeout(t);
    t = setTimeout(draw, 120);
  };
  lastW = window.innerWidth;
  draw();
  window.addEventListener("resize", onResize, { passive: true });
})();

/* ---------------- helpers ---------------- */
let toastTimer;
function toast(msg, err = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("err", err);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0;top:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

const fmtDur = (s) => (s == null ? null : s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const fmtNum = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

/* ---------------- rendering ---------------- */
function renderCard(s, i) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.style.setProperty("--i", Math.min(i, 12));
  node.dataset.id = s.id;
  $(".name", node).textContent = s.name;
  $(".name", node).title = s.name;

  const by = $(".by", node);
  by.textContent = `by ${s.creator.name}`;
  if (s.creator.isRoblox) {
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = "ROBLOX";
    by.appendChild(b);
  }

  const tags = $(".tags", node);
  const addPill = (txt, cls) => {
    if (!txt) return;
    const p = document.createElement("span");
    p.className = `pill ${cls || ""}`;
    p.textContent = txt;
    tags.appendChild(p);
  };
  addPill(fmtDur(s.duration) && `⏱ ${fmtDur(s.duration)}`, "dur");
  if (s.upVotePercent != null && s.voteCount) addPill(`▲ ${s.upVotePercent}% · ${fmtNum(s.voteCount)}`, "up");
  addPill(s.audioType === "Music" ? "Music" : s.category || (s.audioType === "SoundEffect" ? "SFX" : null));

  $(".id-num", node).textContent = s.id;
  $(".open", node).href = s.url;
  if (!state.preview) $(".play", node).setAttribute("aria-label", "Preview needs API key");
  return node;
}

function usableId(s) {
  if (s.assetType === "Decal" && s.textureId) return s.textureId;
  if (s.assetType === "MeshPart" && s.meshId) return s.meshId;
  return s.id;
}

function renderTile(s, i) {
  const node = tileTpl.content.firstElementChild.cloneNode(true);
  node.style.setProperty("--i", Math.min(i, 12));
  node.dataset.id = s.id;
  const th = $(".thumb", node);
  th.href = s.url;
  th.title = "Open in Creator Store";
  if (s.assetType === "FontFamily") {
    th.classList.add("done");
    const f = document.createElement("span");
    f.className = "font-ph";
    f.textContent = "Aa";
    th.appendChild(f);
  }
  $(".name", node).textContent = s.name;
  $(".name", node).title = s.name;
  const by = $(".by", node);
  by.textContent = `by ${s.creator.name}`;
  if (s.creator.isRoblox) {
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = "ROBLOX";
    by.appendChild(b);
  }
  const tags = $(".tags", node);
  const pill = (txt, cls) => {
    const p = document.createElement("span");
    p.className = `pill ${cls || ""}`;
    p.textContent = txt;
    tags.appendChild(p);
  };
  if (!s.free) pill(s.priceUsd != null ? `$${s.priceUsd}` : "Paid", "price");
  if (s.hasScripts === true) pill(s.scriptCount ? `⚠ ${s.scriptCount} script${s.scriptCount === 1 ? "" : "s"}` : "⚠ scripts", "warn");
  else if (s.hasScripts === false && s.assetType === "Model") pill("No scripts", "safe");
  if (s.triangles) pill(`${fmtNum(s.triangles)} tris`);
  if (s.upVotePercent != null && s.voteCount) pill(`▲ ${s.upVotePercent}%`, "up");

  const idv = usableId(s);
  $(".id-num", node).textContent = idv;
  $(".id", node).dataset.copy = idv;
  $(".id", node).title = s.assetType === "Decal" ? "Copy image ID" : s.assetType === "MeshPart" ? "Copy mesh ID" : "Copy ID";
  const asset = $(".asset", node);
  if (s.contentId) asset.dataset.copy = s.contentId;
  else asset.remove();
  return node;
}

const thumbQueue = new Set();
let thumbTimer;
function queueThumbs(ids) {
  ids.forEach((id) => thumbQueue.add(id));
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(flushThumbs, 30);
}
async function flushThumbs() {
  const ids = [...thumbQueue].slice(0, 60);
  ids.forEach((id) => thumbQueue.delete(id));
  if (!ids.length) return;
  let map = {};
  try {
    map = await fetch(`${API}/api/thumbs?ids=${ids.join(",")}`).then((r) => (r.ok ? r.json() : {}));
  } catch {}
  for (const id of ids) {
    const tile = grid.querySelector(`.tile[data-id="${id}"]`);
    if (!tile) continue;
    const th = $(".thumb", tile);
    const img = $("img", th);
    if (!map[id]) { th.classList.add("done", "none"); continue; }
    img.onload = () => { img.classList.add("on"); th.classList.add("done"); };
    img.onerror = () => th.classList.add("done", "none");
    img.hidden = false;
    img.src = map[id];
  }
  if (thumbQueue.size) flushThumbs();
}

function setStatus(msg) { statusEl.textContent = msg; }

function showSkeleton(n = 6) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const d = document.createElement("div");
    d.className = "skel";
    frag.appendChild(d);
  }
  grid.appendChild(frag);
}
const clearSkeleton = () => grid.querySelectorAll(".skel").forEach((el) => el.remove());

function showEmpty(title, sub, retry) {
  grid.innerHTML = `
    <div class="empty">
      <svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,6 92,30 92,70 50,94 8,70 8,30" fill="#2a3170"/><polygon points="50,6 92,30 50,50" fill="#343d8a"/><polygon points="8,30 8,70 50,50" fill="#232a63"/><text x="50" y="62" text-anchor="middle" font-size="34" fill="#9aa0d0" font-weight="900">?</text></svg>
      <div><b></b></div><div class="s"></div>
    </div>`;
  $(".empty b", grid).textContent = title;
  $(".empty .s", grid).textContent = sub || "";
  if (retry) {
    const b = document.createElement("button");
    b.className = "btn-ghost";
    b.textContent = "Try again";
    b.onclick = () => search(false);
    $(".empty", grid).appendChild(b);
  }
}

/* ---------------- search ---------------- */
function buildQuery() {
  const p = new URLSearchParams();
  p.set("q", state.q);
  p.set("cat", state.cat);
  if (state.cat === "Audio") {
    if (state.type) p.set("type", state.type);
    if (state.max) p.set("max", state.max);
  }
  if (state.sort !== "Relevance") p.set("sort", state.sort);
  if (!state.free) p.set("free", "0");
  return p;
}

function syncUrl() {
  const p = buildQuery();
  const url = state.q ? `?${p}` : location.pathname;
  history.replaceState(null, "", url);
}

async function search(append) {
  if (!state.q) {
    grid.innerHTML = "";
    setStatus("Type something or tap a quick search ↑");
    moreBtn.hidden = true;
    return;
  }
  if (append && (!state.token || state.loading)) return;

  const myId = ++state.reqId;
  state.loading = true;
  if (!append) {
    state.token = null;
    state.count = 0;
    grid.innerHTML = "";
    setStatus("Searching…");
    stopAudio();
  }
  grid.classList.toggle("tiles", state.cat !== "Audio");
  showSkeleton(append ? 3 : 6);
  moreBtn.hidden = true;

  const p = buildQuery();
  p.set("limit", "30");
  if (append) p.set("cursor", state.token);

  try {
    const res = await fetch(`${API}/api/search?${p}`);
    const data = await res.json().catch(() => ({}));
    if (myId !== state.reqId) return; // a newer search replaced this one
    clearSkeleton();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const frag = document.createDocumentFragment();
    const isAudio = state.cat === "Audio";
    data.items.forEach((s, i) => frag.appendChild(isAudio ? renderCard(s, i) : renderTile(s, i)));
    grid.appendChild(frag);
    if (!isAudio && state.cat !== "FontFamily") queueThumbs(data.items.map((s) => s.id));
    state.count += data.items.length;
    state.token = data.nextPageToken;

    if (!state.count) {
      showEmpty(`No ${LABEL[state.cat]} for “${state.q}”`, "Try a simpler word, or turn off “Free only”.");
      setStatus("");
    } else {
      const total = data.total ? ` of ${fmtNum(data.total)}` : "";
      setStatus(`${state.count}${total} ${LABEL[state.cat]} · tap an ID to copy`);
    }
    moreBtn.hidden = !state.token;
  } catch (e) {
    if (myId !== state.reqId) return;
    clearSkeleton();
    if (!append) showEmpty("Couldn't reach Roblox", e.message, true);
    else toast("Couldn't load more", true);
    setStatus("");
  } finally {
    if (myId === state.reqId) {
      state.loading = false;
      // The observer only fires on changes; if the sentinel is still on screen, keep filling.
      requestAnimationFrame(() => {
        if (state.token && $("#sentinel").getBoundingClientRect().top < innerHeight + 600) search(true);
      });
    }
  }
}

let debounce;
function queueSearch(delay = 380) {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    syncUrl();
    search(false);
  }, delay);
}

/* ---------------- audio preview ---------------- */
const audio = new Audio();
audio.preload = "none";
let playingCard = null;
let raf = 0;

function tick() {
  if (!playingCard) return;
  const d = audio.duration || 1;
  $(".play", playingCard).style.setProperty("--p", Math.min(audio.currentTime / d, 1).toFixed(3));
  raf = requestAnimationFrame(tick);
}
function stopAudio() {
  audio.pause();
  cancelAnimationFrame(raf);
  if (playingCard) {
    playingCard.classList.remove("playing", "loading");
    $(".play", playingCard).style.removeProperty("--p");
  }
  playingCard = null;
}
audio.addEventListener("playing", () => {
  if (!playingCard) return;
  playingCard.classList.remove("loading");
  playingCard.classList.add("playing");
  raf = requestAnimationFrame(tick);
});
audio.addEventListener("ended", stopAudio);
audio.addEventListener("error", () => {
  if (playingCard) toast("Preview unavailable for this sound", true);
  stopAudio();
});

function togglePlay(card) {
  if (!state.preview) {
    toast("Preview is off — open the sound in the Creator Store");
    return;
  }
  if (playingCard === card) return stopAudio();
  stopAudio();
  playingCard = card;
  card.classList.add("loading");
  audio.src = `${API}/api/preview/${card.dataset.id}`;
  audio.play().catch(() => {});
}

/* ---------------- events ---------------- */
grid.addEventListener("click", async (e) => {
  const card = e.target.closest(".card, .tile");
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.closest(".play")) return togglePlay(card);

  const idBtn = e.target.closest(".id");
  const assetBtn = e.target.closest(".asset");
  const btn = idBtn || assetBtn;
  if (!btn) return;
  const text = btn.dataset.copy || (idBtn ? id : `rbxassetid://${id}`);
  if (await copy(text)) {
    btn.classList.add("ok");
    setTimeout(() => btn.classList.remove("ok"), 900);
    toast(`Copied ${text}`);
    if (navigator.vibrate) navigator.vibrate(12);
  } else toast("Copy failed", true);
});

$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  state.q = input.value.trim();
  input.blur();
  queueSearch(0);
});
input.addEventListener("input", () => {
  state.q = input.value.trim();
  queueSearch();
});

$("#quick").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  input.value = state.q = b.dataset.q;
  queueSearch(0);
  grid.scrollIntoView({ behavior: "smooth", block: "start" });
});

function bindSeg(id, key) {
  const seg = $(id);
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    state[key] = b.dataset.v;
    queueSearch(0);
  });
}
bindSeg("#f-type", "type");
bindSeg("#f-len", "max");
$("#f-sort").addEventListener("change", (e) => { state.sort = e.target.value; queueSearch(0); });
$("#f-free").addEventListener("change", (e) => { state.free = e.target.checked; queueSearch(0); });

function renderQuick() {
  const box = $("#quick");
  box.innerHTML = "";
  for (const q of QUICK[state.cat] || []) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.q = q;
    b.textContent = ICON[q] ? `${ICON[q]} ${q}` : q;
    box.appendChild(b);
  }
}
const PLACEHOLDER = { Model: "tree, car, sword…", Audio: "punch, whoosh, coin…", Decal: "grass texture, logo…", MeshPart: "rock, crate, barrel…", Plugin: "building tools, tween…", Video: "fire, rain, space…", FontFamily: "pixel, retro, bold…" };
function setCat(cat, search = true) {
  state.cat = CATS.includes(cat) ? cat : "Model";
  document.querySelectorAll("#cats button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.cat === state.cat)));
  document.body.classList.toggle("cat-audio", state.cat === "Audio");
  input.placeholder = PLACEHOLDER[state.cat];
  if (state.cat !== "Audio" && state.sort === "AudioDuration") { state.sort = "Relevance"; $("#f-sort").value = "Relevance"; }
  renderQuick();
  if (search) queueSearch(0);
}
$("#cats").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && b.dataset.cat !== state.cat) setCat(b.dataset.cat);
});
moreBtn.addEventListener("click", () => search(true));

new IntersectionObserver(
  (entries) => { if (entries[0].isIntersecting && state.token && !state.loading) search(true); },
  { rootMargin: "600px 0px" }
).observe($("#sentinel"));

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== input && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
    e.preventDefault();
    input.focus();
    input.select();
  } else if (e.key === "Escape") stopAudio();
});

/* ---------------- MCP section ---------------- */
const mcpUrl = `${API}/mcp`;
$("#mcp-url").textContent = mcpUrl;
$("#cursor-cfg").textContent = JSON.stringify({ mcpServers: { "roblox-sounds": { url: mcpUrl } } }, null, 2);
document.querySelectorAll("[data-copy-el]").forEach((b) =>
  b.addEventListener("click", async () => {
    if (await copy($("#" + b.dataset.copyEl).textContent)) toast("Copied");
  })
);
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => {
      x.setAttribute("aria-selected", String(x === b));
      $("#" + x.dataset.tab).hidden = x !== b;
    });
  })
);

/* ---------------- boot ---------------- */
(async function init() {
  const p = new URLSearchParams(location.search);
  state.q = (p.get("q") || "").trim();
  state.type = p.get("type") || "";
  state.max = p.get("max") || "";
  state.sort = p.get("sort") || "Relevance";
  state.free = p.get("free") !== "0";
  input.value = state.q;
  $("#f-sort").value = state.sort;
  $("#f-free").checked = state.free;
  setCat(p.get("cat") || "Model", false);
  for (const [id, key] of [["#f-type", "type"], ["#f-len", "max"]]) {
    $(id).querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === state[key])));
  }

  if (!API_READY) {
    setStatus("⚠ config.js дотор Cloudflare Worker-ийн хаягаа оруулна уу.");
    return;
  }
  try {
    const cfg = await fetch(`${API}/api/config`).then((r) => r.json());
    state.preview = !!cfg.preview;
  } catch {}
  document.body.classList.toggle("no-preview", !state.preview);

  if (state.q) search(false);
  else setStatus("Type something or tap a quick search ↑");
})();
