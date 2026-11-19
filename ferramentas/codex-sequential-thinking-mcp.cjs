#!/usr/bin/env node
/**
 * Codex Native Sequential Thinking MCP Server v6.1 (Ultra Intelligence)
 * Zero-latency local implementation of @modelcontextprotocol/server-sequential-thinking.
 */
const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const TOOLS = [
  {
    name: "sequentialthinking",
    description: "A detailed tool for dynamic and reflective problem-solving through thoughts. Helps analyze complex problems through a flexible thinking process that can adapt and evolve, revise previous thoughts, or branch into alternative hypotheses.",
    inputSchema: {
      type: "object",
      properties: {
        thought: { type: "string", description: "Your current thinking step." },
        nextThoughtNeeded: { type: "boolean", description: "Whether another thought step is needed." },
        thoughtNumber: { type: "integer", description: "Current thought number (1-based)." },
        totalThoughts: { type: "integer", description: "Estimated total thoughts needed." },
        isRevision: { type: "boolean", description: "Whether this revises previous thinking." },
        revisesThought: { type: "integer", description: "Which thought is being reconsidered." },
        branchFromThought: { type: "integer", description: "Branching point thought number." },
        branchId: { type: "string", description: "Branch identifier." },
        needsMoreThoughts: { type: "boolean", description: "If more thoughts are needed." }
      },
      required: ["thought", "nextThoughtNeeded", "thoughtNumber", "totalThoughts"]
    },
    annotations: ANNOTATIONS
  }
];

const thoughtHistory = [];
const branches = {};

function handleSequentialThinking(rawArgs) {
  let args = rawArgs || {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = { thought: args }; }
  }
  const thought = String(args.thought || "");
  const thoughtNumber = Number(args.thoughtNumber || thoughtHistory.length + 1);
  const totalThoughts = Math.max(thoughtNumber, Number(args.totalThoughts || 5));
  const nextThoughtNeeded = Boolean(args.nextThoughtNeeded ?? false);
  const entry = {
    thought,
    thoughtNumber,
    totalThoughts,
    nextThoughtNeeded,
    isRevision: Boolean(args.isRevision),
    revisesThought: args.revisesThought || null,
    branchFromThought: args.branchFromThought || null,
    branchId: args.branchId || null,
    timestamp: new Date().toISOString()
  };
  thoughtHistory.push(entry);
  if (entry.branchFromThought && entry.branchId) {
    if (!branches[entry.branchId]) branches[entry.branchId] = [];
    branches[entry.branchId].push(entry);
  }
  return JSON.stringify({
    thoughtNumber,
    totalThoughts,
    nextThoughtNeeded,
    branches: Object.keys(branches),
    thoughtHistoryLength: thoughtHistory.length
  }, null, 2);
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
        serverInfo: { name: "sequential_thinking", version: "6.1.0" }
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
      const out = handleSequentialThinking(p.arguments);
      sendResponse({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: out }], isError: false } });
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
