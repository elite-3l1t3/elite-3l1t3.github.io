// Minimal stateless MCP server over Streamable HTTP (JSON responses).
// Spec: https://modelcontextprotocol.io/specification
import { searchAssets, formatForText, ASSET_TYPES } from "./roblox.js";

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "polyfind", title: "PolyFind — Roblox Asset Finder", version: "2.0.0" };
const SORT_ENUM = ["Relevance", "Trending", "Top", "AudioDuration", "CreateTime", "UpdatedTime", "Ratings"];

const TOOLS = [
  {
    name: "search_roblox_assets",
    title: "Search Roblox Creator Store",
    description:
      "Search the Roblox Creator Store for models, decals/images, meshes, plugins, audio, videos or fonts. Returns asset IDs (and the rbxassetid:// content ID where one applies). Use short English keywords, e.g. 'low poly tree', 'sword', 'grass texture'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords" },
        assetType: { type: "string", enum: ASSET_TYPES, description: "What to search. Default Model." },
        freeOnly: { type: "boolean", description: "Only free assets (default true)" },
        verifiedOnly: { type: "boolean", description: "Only verified creators" },
        sort: { type: "string", enum: SORT_ENUM },
        limit: { type: "integer", minimum: 1, maximum: 30, description: "Results to return (default 10)" },
        pageToken: { type: "string", description: "Token from a previous call for the next page" },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "search_roblox_sounds",
    title: "Search Roblox sounds",
    description:
      "Search the Roblox Creator Store for audio (sound effects and music) and return IDs ready to use as SoundId = \"rbxassetid://<id>\". Use short English keywords like 'punch', 'whoosh', 'coin pickup'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords, e.g. 'punch impact'" },
        type: { type: "string", enum: ["SoundEffect", "Music", "Any"], description: "Audio type filter. Default Any." },
        maxDuration: { type: "integer", minimum: 0, description: "Maximum length in seconds" },
        minDuration: { type: "integer", minimum: 0, description: "Minimum length in seconds" },
        sort: { type: "string", enum: SORT_ENUM },
        limit: { type: "integer", minimum: 1, maximum: 30, description: "Results to return (default 10)" },
        pageToken: { type: "string", description: "Token from a previous call for the next page" },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const toolError = (id, text) => rpcResult(id, { content: [{ type: "text", text }], isError: true });

async function callTool(msg, env, ctx) {
  const name = msg.params?.name;
  const args = msg.params?.arguments || {};
  if (!TOOLS.some((t) => t.name === name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
  if (!args.query || typeof args.query !== "string") return toolError(msg.id, "query is required");

  const opts = { ...args, limit: Math.min(Number(args.limit) || 10, 30) };
  if (name === "search_roblox_sounds") {
    opts.assetType = "Audio";
    opts.type = args.type === "Any" ? "" : args.type;
  } else {
    opts.assetType = args.assetType || "Model";
  }
  try {
    const result = await searchAssets(env, opts, ctx);
    return rpcResult(msg.id, {
      content: [{ type: "text", text: formatForText(result) }],
      structuredContent: { assetType: result.assetType, total: result.total, nextPageToken: result.nextPageToken, items: result.items },
    });
  } catch (e) {
    return toolError(msg.id, `Search failed: ${e.message}.`);
  }
}

async function handleMessage(msg, env, ctx) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg?.id, -32600, "Invalid Request");
  }
  if (msg.id === undefined || msg.id === null) return null; // notifications

  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Use search_roblox_assets to find Roblox models, decals, meshes, plugins, audio, videos and fonts, or search_roblox_sounds for audio. Always give the user the numeric ID, plus the rbxassetid:// form when one is returned.",
      });
    }
    case "ping":
      return rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, { tools: TOOLS });
    case "tools/call":
      return callTool(msg, env, ctx);
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcp(request, env, ctx, cors) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { ...cors, allow: "POST, OPTIONS" } });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400, headers: cors });
  }
  const batch = Array.isArray(body);
  const msgs = batch ? body : [body];
  const replies = (await Promise.all(msgs.map((m) => handleMessage(m, env, ctx)))).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202, headers: cors });
  return Response.json(batch ? replies : replies[0], { headers: cors });
}
