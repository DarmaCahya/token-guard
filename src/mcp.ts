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
    description: "Search symbols, functions, classes, and relations in the codebase with 0-token AST indexing.",
    inputSchema: { query: z.string().describe("Search term or symbol name") },
  },
  async ({ query }) => {
    try {
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      const res = engine.query(query);
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
    description: "Trace dependency path between two symbols/files without reading whole files.",
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
    description: "Calculate blast radius (impact analysis) of modifying or removing a symbol/file before making changes.",
    inputSchema: {
      target: z.string().describe("Name of the symbol, class, or file to analyze"),
    },
  },
  async ({ target }) => {
    try {
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      const report = engine.calculateBlastRadius(target);
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
    description: "Extract only the exact lines of a function or class definition instead of reading the whole file.",
    inputSchema: {
      symbol: z.string().describe("Name of the symbol/function/class to slice"),
    },
  },
  async ({ symbol }) => {
    try {
      const graph = indexer.load();
      const s = new SurgicalSlicer(rootDir, graph);
      const res = s.sliceSymbol(symbol);
      if (!res) return reply(`Symbol '${symbol}' not found in code graph.`, true);
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
