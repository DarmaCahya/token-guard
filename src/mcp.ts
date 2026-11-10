import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GraphIndexer } from "./core/indexer.ts";
import { GraphQueryEngine } from "./core/query.ts";
import { SurgicalSlicer } from "./core/slicer.ts";
import { AmbiguityGuard } from "./guards/ambiguity.ts";
import { ScopeGuard } from "./guards/scope.ts";

const server = new McpServer({
  name: "token-guard",
  version: "1.0.0",
});

const rootDir = process.cwd();
const indexer = new GraphIndexer(rootDir);
const slicer = new SurgicalSlicer(rootDir);
const ambiguityGuard = new AmbiguityGuard();
const scopeGuard = new ScopeGuard(rootDir);

const reply = (v: unknown, isError = false) => ({
  content: [
    {
      type: "text" as const,
      text: typeof v === "string" ? v : JSON.stringify(v, null, 2),
    },
  ],
  isError,
});

// Tool 1: Query Graph
server.registerTool(
  "graph_query",
  {
    description: "Find a symbol (function, method, class, type, const) by name. Returns file:lines, signature, what it uses and what uses it (callers) in one call.",
    inputSchema: {
      query: z.string().describe("Symbol name or part of it"),
      limit: z.number().int().min(1).max(30).optional().describe("Max matches (default 8)"),
      offset: z.number().int().min(0).optional().describe("Skip this many matches (pagination)"),
      max_tokens: z.number().int().min(100).max(4000).optional().describe("Output budget (default 700)"),
    },
  },
  async ({ query, limit, offset, max_tokens }) => {
    try {
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      const res = engine.query(query, limit, offset, max_tokens);
      return reply(res.summary);
    } catch (err: any) {
      return reply(err.message, true);
    }
  }
);

// Tool 2: Trace Dependency Path
server.registerTool(
  "graph_trace",
  {
    description: "Shortest call/reference/import path between two symbols or files.",
    inputSchema: {
      from: z.string().describe("Source symbol or file path"),
      to: z.string().describe("Destination symbol or file path"),
    },
  },
  async ({ from, to }) => {
    try {
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      const res = engine.trace(from, to);
      return reply(res.summary);
    } catch (err: any) {
      return reply(err.message, true);
    }
  }
);

// Tool 3: Blast Radius Analysis
server.registerTool(
  "graph_blast",
  {
    description: "Impact of changing a symbol/file: callers and callers-of-callers by level, with file:line.",
    inputSchema: {
      target: z.string().describe("Symbol or file to analyze"),
      depth: z.number().int().min(1).max(4).optional().describe("Caller levels to follow (default 2)"),
    },
  },
  async ({ target, depth }) => {
    try {
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      const report = engine.calculateBlastRadius(target, depth);
      return reply(report.summary);
    } catch (err: any) {
      return reply(err.message, true);
    }
  }
);

// Tool 3: Surgical Slice
server.registerTool(
  "graph_slice",
  {
    description: "Read only the lines of one symbol (by name) instead of the whole file.",
    inputSchema: {
      symbol: z.string().describe("Symbol name"),
      file: z.string().optional().describe("Path suffix to disambiguate same-named symbols"),
      max_lines: z.number().int().min(5).max(400).optional().describe("Line cap (default 80)"),
    },
  },
  async ({ symbol, file, max_lines }) => {
    try {
      const graph = indexer.load();
      const s = new SurgicalSlicer(rootDir, graph);
      const res = s.sliceSymbol(symbol, 0, max_lines, file);
      if (!res) return reply(new GraphQueryEngine(graph).query(symbol, 1).summary, true);
      return reply(`=== Sliced ${res.symbolName} (${res.file}:${res.lineStart}-${res.lineEnd}) ===\n${res.code}`);
    } catch (err: any) {
      return reply(err.message, true);
    }
  }
);

// Tool 4: Ambiguity Gatekeeper
server.registerTool(
  "check_intent",
  {
    description: "Evaluates whether user prompt has enough clarity to avoid token-wasting guesses.",
    inputSchema: {
      prompt: z.string().describe("The user prompt to evaluate"),
    },
  },
  async ({ prompt }) => {
    try {
      const res = ambiguityGuard.evaluate(prompt);
      return reply(res);
    } catch (err: any) {
      return reply(err.message, true);
    }
  }
);

// Tool 5: Scope Boundary Check
server.registerTool(
  "check_scope",
  {
    description: "Validates that target files do not exceed authorized boundaries.",
    inputSchema: {
      allowed: z.array(z.string()).describe("List of allowed files or patterns"),
      attempted: z.array(z.string()).describe("List of files intended to modify"),
    },
  },
  async ({ allowed, attempted }) => {
    try {
      const res = scopeGuard.validate(allowed, attempted);
      return reply(res);
    } catch (err: any) {
      return reply(err.message, true);
    }
  }
);

// Tool 6: Dead Code Detection
server.registerTool(
  "graph_dead_code",
  {
    description: "Detect orphan functions and unused symbols with 0 references to eliminate token bloat.",
    inputSchema: {},
  },
  async () => {
    try {
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      const res = engine.findDeadCode();
      return reply(res.summary);
    } catch (err: any) {
      return reply(err.message, true);
    }
  }
);

// Tool 7: Git Diff Impact & Blast Analysis
server.registerTool(
  "graph_diff_blast",
  {
    description: "Analyze git diff text to compute impacted symbols, blast radius, and targeted test files.",
    inputSchema: {
      diff: z.string().describe("Git diff unified text output"),
    },
  },
  async ({ diff }) => {
    try {
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      const res = engine.analyzeDiff(diff);
      return reply(res.summary);
    } catch (err: any) {
      return reply(err.message, true);
    }
  }
);

await server.connect(new StdioServerTransport());
