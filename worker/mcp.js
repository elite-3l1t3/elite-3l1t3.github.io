// Minimal stateless MCP server over Streamable HTTP (JSON responses).
// Spec: https://modelcontextprotocol.io/specification
import { searchSounds, formatForText } from "./roblox.js";

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "roblox-sound-finder", title: "Roblox Sound Finder", version: "1.0.0" };

const TOOLS = [
  {
    name: "search_roblox_sounds",
    title: "Search Roblox sounds",
    description:
      "Search the Roblox Creator Store for free audio (sound effects and music) and return asset IDs ready to use as SoundId = \"rbxassetid://<id>\". Use short English keywords like 'punch', 'sword slash', 'whoosh', 'coin pickup'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords, e.g. 'punch impact'" },
        type: { type: "string", enum: ["SoundEffect", "Music", "Any"], description: "Audio type filter. Default Any." },
        maxDuration: { type: "integer", minimum: 0, description: "Maximum length in seconds" },
        minDuration: { type: "integer", minimum: 0, description: "Minimum length in seconds" },
        verifiedOnly: { type: "boolean", description: "Only verified creators" },
        sort: {
          type: "string",
          enum: ["Relevance", "Trending", "Top", "AudioDuration", "CreateTime", "UpdatedTime", "Ratings"],
        },
        limit: { type: "integer", minimum: 1, maximum: 30, description: "Results to return (default 10)" },
        pageToken: { type: "string", description: "Token from a previous call to get the next page" },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handleMessage(msg, env, ctx) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg?.id, -32600, "Invalid Request");
  }
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null; // notifications/initialized etc.

  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Use search_roblox_sounds to find Roblox audio asset IDs. Always give the user the numeric ID and the rbxassetid:// form.",
      });
    }
    case "ping":
      return rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, { tools: TOOLS });
    case "tools/call": {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};
      if (name !== "search_roblox_sounds") return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      if (!args.query || typeof args.query !== "string") {
        return rpcResult(msg.id, { content: [{ type: "text", text: "query is required" }], isError: true });
      }
      try {
        const result = await searchSounds(
          env,
          { ...args, type: args.type === "Any" ? "" : args.type, limit: Math.min(Number(args.limit) || 10, 30) },
          ctx
        );
        return rpcResult(msg.id, {
          content: [{ type: "text", text: formatForText(result) }],
          structuredContent: { total: result.total, nextPageToken: result.nextPageToken, items: result.items },
        });
      } catch (e) {
        return rpcResult(msg.id, {
          content: [{ type: "text", text: `Search failed: ${e.message}. Try again in a moment.` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcp(request, env, ctx, cors) {
  if (request.method === "GET") {
    // No server-initiated stream in this stateless server.
    return new Response("Method Not Allowed", { status: 405, headers: { ...cors, allow: "POST, OPTIONS" } });
  }
  if (request.method === "DELETE") return new Response(null, { status: 405, headers: cors });
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

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
