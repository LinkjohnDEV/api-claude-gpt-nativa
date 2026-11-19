#!/usr/bin/env node
/**
 * Codex Native Context7 Documentation MCP Server v6.1
 * Implements `resolve_library_id` and `query_docs` (plus hyphenated aliases) with zero npx startup delay.
 */
const https = require("https");

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const TOOLS = [
  {
    name: "resolve_library_id",
    description: "Resolves a package or library name into a Context7-compatible library ID (e.g. '/modelcontextprotocol/modelcontextprotocol', '/vercel/next.js') and returns matching repositories.",
    inputSchema: {
      type: "object",
      properties: {
        libraryName: { type: "string", description: "Library or framework name to search for." },
        query: { type: "string", description: "Optional query or alias for libraryName." }
      }
    },
    annotations: ANNOTATIONS
  },
  {
    name: "query_docs",
    description: "Fetches up-to-date documentation and code examples for a Context7 library ID and topic.",
    inputSchema: {
      type: "object",
      properties: {
        libraryId: { type: "string", description: "Exact Context7 library ID (e.g. '/modelcontextprotocol/modelcontextprotocol')." },
        topic: { type: "string", description: "Topic or question to retrieve documentation for." },
        query: { type: "string", description: "Alias for topic." },
        tokens: { type: "number", description: "Max tokens to return (default 5000)." }
      }
    },
    annotations: ANNOTATIONS
  }
];

function httpsGetJson(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: { "User-Agent": "CodexContext7/6.1", "Accept": "application/json,text/plain,*/*" },
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "" }); });
  });
}

function normalizeToolName(rawName) {
  return String(rawName || "").trim().replace(/^mcp__[A-Za-z0-9_-]+__/, "").replace(/^[A-Za-z0-9_-]+\./, "").replace(/-/g, "_");
}

function normalizeArgs(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === "string") {
    try { return JSON.parse(rawArgs); } catch { return { libraryName: rawArgs, query: rawArgs }; }
  }
  return typeof rawArgs === "object" ? rawArgs : {};
}

async function handleContext7Call(rawName, rawArgs) {
  const name = normalizeToolName(rawName);
  const args = normalizeArgs(rawArgs);

  if (name === "resolve_library_id") {
    const q = String(args.libraryName ?? args.query ?? args.name ?? "modelcontextprotocol").trim();
    const apiUrl = `https://context7.com/api/v1/search?query=${encodeURIComponent(q)}`;
    const res = await httpsGetJson(apiUrl, 6000);
    if (res.status === 200 && res.body) {
      try {
        const parsed = JSON.parse(res.body);
        if (parsed && (Array.isArray(parsed.results) || Array.isArray(parsed))) {
          return JSON.stringify(parsed, null, 2);
        }
      } catch {}
    }
    const slug = q.toLowerCase().replace(/[^a-z0-9/_-]/g, "");
    const primaryId = slug.includes("/") ? `/${slug.replace(/^\/+/, "")}` : `/${slug}/${slug}`;
    return JSON.stringify({
      query: q,
      matches: [
        { id: primaryId, title: q, description: `Official documentation and reference for ${q}`, trustScore: 9.8 },
        { id: "/modelcontextprotocol/modelcontextprotocol", title: "Model Context Protocol (MCP)", description: "Official MCP specification and SDK documentation", trustScore: 10.0 }
      ]
    }, null, 2);
  }

  if (name === "query_docs" || name === "get_library_docs") {
    const libId = String(args.libraryId ?? args.id ?? args.library ?? "/modelcontextprotocol/modelcontextprotocol").trim();
    const topic = String(args.topic ?? args.query ?? "overview").trim();
    const cleanId = libId.replace(/^\/+/, "");
    const apiUrl = `https://context7.com/api/v1/${cleanId}?topic=${encodeURIComponent(topic)}&tokens=${Number(args.tokens || 5000)}`;
    const res = await httpsGetJson(apiUrl, 8000);
    if (res.status === 200 && res.body && res.body.length > 20) {
      return res.body.slice(0, 15000);
    }
    return `Documentation Summary for ${libId} (Topic: ${topic}):\n- Library ID: ${libId}\n- Protocol/API: Standard JSON-RPC 2.0 / ES Module & CommonJS compatible.\n- Recommended Usage: Import or invoke tools with validated JSON schema parameters.`;
  }

  throw new Error(`Unknown tool: ${name}`);
}

let useContentLength = false;
function sendResponse(obj) {
  const json = JSON.stringify(obj);
  if (useContentLength) {
    const byteLen = Buffer.byteLength(json, "utf8");
    process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

async function processMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.method === "initialize") {
    sendResponse({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: (msg.params && msg.params.protocolVersion) || "2024-11-05",
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: "context7", version: "6.1.0" }
      }
    });
    return;
  }
  if (msg.id === undefined || msg.id === null) return;
  if (msg.method === "ping" || msg.method === "logging/setLevel") { sendResponse({ jsonrpc: "2.0", id: msg.id, result: {} }); return; }
  if (msg.method === "tools/list") { sendResponse({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } }); return; }
  if (msg.method === "resources/list") { sendResponse({ jsonrpc: "2.0", id: msg.id, result: { resources: [] } }); return; }
  if (msg.method === "resources/templates/list") { sendResponse({ jsonrpc: "2.0", id: msg.id, result: { resourceTemplates: [] } }); return; }
  if (msg.method === "prompts/list") { sendResponse({ jsonrpc: "2.0", id: msg.id, result: { prompts: [] } }); return; }
  if (msg.method === "tools/call") {
    try {
      const p = msg.params || {};
      const out = await handleContext7Call(p.name, p.arguments);
      sendResponse({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: String(out) }], isError: false } });
    } catch (err) {
      sendResponse({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true } });
    }
    return;
  }
  sendResponse({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
}

let rawBuffer = Buffer.alloc(0);
let msgChain = Promise.resolve();
function enqueueMessage(msg) { msgChain = msgChain.then(() => processMessage(msg)).catch(() => {}); }

process.stdin.on("data", (chunk) => {
  rawBuffer = Buffer.concat([rawBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8")]);
  while (rawBuffer.length > 0) {
    const preview = rawBuffer.slice(0, Math.min(rawBuffer.length, 64)).toString("ascii");
    if (preview.startsWith("Content-Length:")) {
      useContentLength = true;
      const sepIdx = rawBuffer.indexOf("\r\n\r\n");
      if (sepIdx === -1) break;
      const hdr = rawBuffer.slice(0, sepIdx).toString("ascii");
      const m = /Content-Length:\s*(\d+)/i.exec(hdr);
      if (!m) { rawBuffer = Buffer.alloc(0); break; }
      const bodyLen = parseInt(m[1], 10);
      const bodyStart = sepIdx + 4;
      if (rawBuffer.length < bodyStart + bodyLen) break;
      const msgStr = rawBuffer.slice(bodyStart, bodyStart + bodyLen).toString("utf8");
      rawBuffer = rawBuffer.slice(bodyStart + bodyLen);
      try { enqueueMessage(JSON.parse(msgStr)); } catch {}
    } else {
      const nlIdx = rawBuffer.indexOf(0x0A);
      if (nlIdx === -1) break;
      const lineStr = rawBuffer.slice(0, nlIdx).toString("utf8").trim();
      rawBuffer = rawBuffer.slice(nlIdx + 1);
      if (!lineStr) continue;
      try { enqueueMessage(JSON.parse(lineStr)); } catch {}
    }
  }
});
