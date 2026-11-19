#!/usr/bin/env node
/**
 * Codex Native Knowledge Graph Memory MCP Server v6.1
 * Zero-latency local implementation of @modelcontextprotocol/server-memory persisted to disk.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const TOOLS = [
  {
    name: "create_entities",
    description: "Create multiple new entities in the knowledge graph.",
    inputSchema: {
      type: "object",
      properties: {
        entities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              entityType: { type: "string" },
              observations: { type: "array", items: { type: "string" } }
            },
            required: ["name", "entityType", "observations"]
          }
        }
      },
      required: ["entities"]
    },
    annotations: ANNOTATIONS
  },
  {
    name: "create_relations",
    description: "Create multiple new relations between entities in the knowledge graph.",
    inputSchema: {
      type: "object",
      properties: {
        relations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              relationType: { type: "string" }
            },
            required: ["from", "to", "relationType"]
          }
        }
      },
      required: ["relations"]
    },
    annotations: ANNOTATIONS
  },
  {
    name: "add_observations",
    description: "Add new observations to existing entities in the knowledge graph.",
    inputSchema: {
      type: "object",
      properties: {
        observations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              entityName: { type: "string" },
              contents: { type: "array", items: { type: "string" } }
            },
            required: ["entityName", "contents"]
          }
        }
      },
      required: ["observations"]
    },
    annotations: ANNOTATIONS
  },
  {
    name: "delete_entities",
    description: "Delete multiple entities and their associated relations from the knowledge graph.",
    inputSchema: {
      type: "object",
      properties: { entityNames: { type: "array", items: { type: "string" } } },
      required: ["entityNames"]
    },
    annotations: ANNOTATIONS
  },
  {
    name: "delete_observations",
    description: "Delete specific observations from entities in the knowledge graph.",
    inputSchema: {
      type: "object",
      properties: {
        deletions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              entityName: { type: "string" },
              observations: { type: "array", items: { type: "string" } }
            },
            required: ["entityName", "observations"]
          }
        }
      },
      required: ["deletions"]
    },
    annotations: ANNOTATIONS
  },
  {
    name: "delete_relations",
    description: "Delete multiple relations from the knowledge graph.",
    inputSchema: {
      type: "object",
      properties: {
        relations: {
          type: "array",
          items: {
            type: "object",
            properties: { from: { type: "string" }, to: { type: "string" }, relationType: { type: "string" } },
            required: ["from", "to", "relationType"]
          }
        }
      },
      required: ["relations"]
    },
    annotations: ANNOTATIONS
  },
  {
    name: "read_graph",
    description: "Read the entire knowledge graph.",
    inputSchema: { type: "object", properties: {} },
    annotations: ANNOTATIONS
  },
  {
    name: "search_nodes",
    description: "Search for nodes in the knowledge graph based on a query.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    },
    annotations: ANNOTATIONS
  },
  {
    name: "open_nodes",
    description: "Open specific nodes in the knowledge graph by their names.",
    inputSchema: {
      type: "object",
      properties: { names: { type: "array", items: { type: "string" } } },
      required: ["names"]
    },
    annotations: ANNOTATIONS
  }
];

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const memFile = path.join(codexHome, "mcp", "memory-graph.json");

function loadGraph() {
  try {
    if (fs.existsSync(memFile)) {
      const g = JSON.parse(fs.readFileSync(memFile, "utf8"));
      return { entities: Array.isArray(g.entities) ? g.entities : [], relations: Array.isArray(g.relations) ? g.relations : [] };
    }
  } catch {}
  return { entities: [], relations: [] };
}

function saveGraph(g) {
  try {
    fs.mkdirSync(path.dirname(memFile), { recursive: true });
    fs.writeFileSync(memFile, JSON.stringify(g, null, 2), "utf8");
  } catch {}
}

function normalizeToolName(rawName) {
  return String(rawName || "").trim().replace(/^mcp__[A-Za-z0-9_-]+__/, "").replace(/^[A-Za-z0-9_-]+\./, "");
}

function normalizeArgs(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === "string") {
    try { return JSON.parse(rawArgs); } catch { return {}; }
  }
  return typeof rawArgs === "object" ? rawArgs : {};
}

function handleMemoryCall(rawName, rawArgs) {
  const name = normalizeToolName(rawName);
  const args = normalizeArgs(rawArgs);
  const g = loadGraph();

  if (name === "create_entities") {
    const created = [];
    for (const e of (args.entities || [])) {
      let existing = g.entities.find((x) => x.name === e.name);
      if (!existing) {
        existing = { name: e.name, entityType: e.entityType || "entity", observations: Array.isArray(e.observations) ? [...e.observations] : [] };
        g.entities.push(existing);
        created.push(existing);
      } else {
        for (const obs of (e.observations || [])) {
          if (!existing.observations.includes(obs)) existing.observations.push(obs);
        }
      }
    }
    saveGraph(g);
    return JSON.stringify(created, null, 2);
  }
  if (name === "create_relations") {
    const created = [];
    for (const r of (args.relations || [])) {
      if (!g.relations.some((x) => x.from === r.from && x.to === r.to && x.relationType === r.relationType)) {
        const nr = { from: r.from, to: r.to, relationType: r.relationType };
        g.relations.push(nr);
        created.push(nr);
      }
    }
    saveGraph(g);
    return JSON.stringify(created, null, 2);
  }
  if (name === "add_observations") {
    const added = [];
    for (const item of (args.observations || [])) {
      let ent = g.entities.find((x) => x.name === item.entityName);
      if (!ent) {
        ent = { name: item.entityName, entityType: "entity", observations: [] };
        g.entities.push(ent);
      }
      const newObs = [];
      for (const c of (item.contents || [])) {
        if (!ent.observations.includes(c)) {
          ent.observations.push(c);
          newObs.push(c);
        }
      }
      added.push({ entityName: item.entityName, addedObservations: newObs });
    }
    saveGraph(g);
    return JSON.stringify(added, null, 2);
  }
  if (name === "delete_entities") {
    const toDel = new Set(args.entityNames || []);
    g.entities = g.entities.filter((x) => !toDel.has(x.name));
    g.relations = g.relations.filter((r) => !toDel.has(r.from) && !toDel.has(r.to));
    saveGraph(g);
    return "Entities deleted successfully";
  }
  if (name === "delete_observations") {
    for (const d of (args.deletions || [])) {
      const ent = g.entities.find((x) => x.name === d.entityName);
      if (ent) {
        const delSet = new Set(d.observations || []);
        ent.observations = ent.observations.filter((o) => !delSet.has(o));
      }
    }
    saveGraph(g);
    return "Observations deleted successfully";
  }
  if (name === "delete_relations") {
    const rels = args.relations || [];
    g.relations = g.relations.filter((x) => !rels.some((r) => r.from === x.from && r.to === x.to && r.relationType === x.relationType));
    saveGraph(g);
    return "Relations deleted successfully";
  }
  if (name === "read_graph") {
    return JSON.stringify(g, null, 2);
  }
  if (name === "search_nodes") {
    const q = String(args.query || "").toLowerCase();
    const entities = g.entities.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      (e.entityType || "").toLowerCase().includes(q) ||
      (e.observations || []).some((o) => o.toLowerCase().includes(q))
    );
    const names = new Set(entities.map((e) => e.name));
    const relations = g.relations.filter((r) => names.has(r.from) || names.has(r.to));
    return JSON.stringify({ entities, relations }, null, 2);
  }
  if (name === "open_nodes") {
    const names = new Set(args.names || []);
    const entities = g.entities.filter((e) => names.has(e.name));
    const relations = g.relations.filter((r) => names.has(r.from) || names.has(r.to));
    return JSON.stringify({ entities, relations }, null, 2);
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
        serverInfo: { name: "memory", version: "6.1.0" }
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
      const out = handleMemoryCall(p.name, p.arguments);
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
