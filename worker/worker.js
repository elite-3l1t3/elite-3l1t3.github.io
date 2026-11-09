import { searchSounds, previewLocation } from "./roblox.js";
import { handleMcp } from "./mcp.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version, authorization",
  "access-control-expose-headers": "mcp-session-id",
};

const json = (data, status = 200, extra = {}) =>
  Response.json(data, { status, headers: { ...CORS, ...extra } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    try {
      if (path === "/mcp" || path === "/mcp/") return await handleMcp(request, env, ctx, CORS);

      if (path === "/api/search" && request.method === "GET") {
        const result = await searchSounds(env, Object.fromEntries(url.searchParams), ctx);
        return json(result, 200, { "cache-control": "public, max-age=300" });
      }

      if (path === "/api/config") return json({ preview: !!env.ROBLOX_API_KEY });

      const m = path.match(/^\/api\/preview\/(\d{1,20})$/);
      if (m) {
        const loc = await previewLocation(env, m[1]);
        if (!loc) return json({ error: "Preview unavailable" }, 404);
        return new Response(null, { status: 302, headers: { ...CORS, location: loc, "cache-control": "private, max-age=600" } });
      }
    } catch (e) {
      return json({ error: e.message || "Server error" }, e.status || 500);
    }

    if (path === "/") return Response.redirect(env.SITE_URL || "https://elite-3l1t3.github.io/", 302);
    return json({ error: "Not found" }, 404);
  },
};
