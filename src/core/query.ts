import type { CodeGraph, GraphNode, GraphEdge, BlastRadiusReport, DeadCodeReport, DiffBlastReport } from "./types.ts";
import * as fs from "node:fs";
import { rankNodes, isTestFile } from "./rank.ts";
import { fitBlocks } from "./budget.ts";

export interface QueryResult {
  matches: GraphNode[];
  total: number;
  relatedEdges: GraphEdge[];
  summary: string;
}

export interface TraceResult {
  pathFound: boolean;
  steps: string[];
  nodesInvolved: GraphNode[];
  summary: string;
}

export class GraphQueryEngine {
  private graph: CodeGraph;

  constructor(graph: CodeGraph) {
    this.graph = graph;
  }

  /**
   * Search for symbols or files by name or query string
   */
  public query(term: string, limit: number = 8, offset: number = 0, maxTokens: number = 700): QueryResult {
    const ranked = rankNodes(Object.values(this.graph.nodes), term);
    const matches = ranked.slice(offset, offset + limit);

    const matchIds = new Set(matches.map((m) => m.id));
    const relatedEdges = this.graph.edges.filter(
      (e) => e.type !== "defines" && (matchIds.has(e.source) || matchIds.has(e.target))
    );

    const summary = ranked.length === 0
      ? this.notFound("symbol", term)
      : this.formatLeanSummary(matches, ranked.length, offset, maxTokens);
    return { matches, total: ranked.length, relatedEdges, summary };
  }

  /** Self-explaining miss: says what was searched and what to try, so the agent does not retry blindly. */
  private notFound(what: string, term: string): string {
    const near = rankNodes(Object.values(this.graph.nodes).filter((n) => n.type !== "file"), term.slice(0, Math.max(3, Math.ceil(term.length / 2)))).slice(0, 3).map((n) => n.name);
    const files = this.graph.stats?.totalFiles ?? 0;
    return `No ${what} matching '${term}' (searched ${Object.keys(this.graph.nodes).length} indexed nodes in ${files} files; ` +
      `only function/method/class/type/const names are indexed, not strings, comments or fields).` +
      (near.length ? ` Similar: ${near.join(", ")}.` : "") + ` Use grep for text search.`;
  }

  /**
   * Find connection path between two nodes (e.g. from Controller to Database)
   */
  public trace(fromQuery: string, toQuery: string): TraceResult {
    const fromNodes = this.findNodes(fromQuery).slice(0, 5);
    const toNodes = this.findNodes(toQuery).slice(0, 5);

    if (fromNodes.length === 0 || toNodes.length === 0) {
      return {
        pathFound: false,
        steps: [],
        nodesInvolved: [],
        summary: fromNodes.length === 0 ? this.notFound("symbol", fromQuery) : this.notFound("symbol", toQuery),
      };
    }

    const forward = this.shortestPath(fromNodes.map((n) => n.id), new Set(toNodes.map((n) => n.id)));
    const path = forward ?? this.shortestPath(toNodes.map((n) => n.id), new Set(fromNodes.map((n) => n.id)));
    if (!path) {
      return {
        pathFound: false,
        steps: [],
        nodesInvolved: [],
        summary: `No dependency path found between '${fromNodes[0].name}' and '${toNodes[0].name}' in either direction.`,
      };
    }

    const nodesInvolved = path.map((id) => this.graph.nodes[id] || { id, name: id, type: "file" as const, file: id, lineStart: 0, lineEnd: 0 });
    const edgeType = (a: string, b: string) => this.graph.edges.find((e) => e.source === a && e.target === b)?.type ?? "->";
    const lines = path.map((id, idx) => {
      const n = nodesInvolved[idx]!;
      const where = n.lineStart ? `${n.file}:${n.lineStart}` : n.file;
      const via = idx > 0 ? ` (${edgeType(path[idx - 1]!, id)})` : "";
      return `  ${idx + 1}. ${n.name} @ ${where}${via}`;
    });
    const dir = forward ? "" : " [reverse direction: the 'to' symbol depends on the 'from' symbol]";
    return {
      pathFound: true,
      steps: path,
      nodesInvolved,
      summary: `Connection Path (${path.length} hops)${dir}:\n${lines.join("\n")}`,
    };
  }

  private shortestPath(starts: string[], goals: Set<string>): string[] | null {
    const adj: Record<string, string[]> = {};
    for (const edge of this.graph.edges) {
      (adj[edge.source] ??= []).push(edge.target);
    }
    const queue: string[][] = starts.map((s) => [s]);
    const visited = new Set<string>(starts);
    for (let head = 0; head < queue.length; head++) {
      const path = queue[head]!;
      const current = path[path.length - 1]!;
      if (goals.has(current)) return path;
      for (const next of adj[current] || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push([...path, next]);
        }
      }
    }
    return null;
  }

  /**
   * Get callers and dependencies of a specific node
   */
  public inspect(targetQuery: string): string {
    const nodes = this.findNodes(targetQuery);
    if (nodes.length === 0) {
      return this.notFound("target", targetQuery);
    }

    const target = nodes[0];
    const incoming = this.graph.edges.filter((e) => e.target === target.id);
    const outgoing = this.graph.edges.filter((e) => e.source === target.id);

    let output = `### [${target.type.toUpperCase()}] ${target.name}\n`;
    output += `File: \`${target.file}\` (Lines ${target.lineStart}-${target.lineEnd})\n`;
    if (target.signature) output += `Signature: \`${target.signature}\`\n`;

    output += `\n**Dependencies (${outgoing.length}):**\n`;
    if (outgoing.length === 0) output += `  (None)\n`;
    for (const edge of outgoing.slice(0, 8)) {
      output += `  - ${edge.type} -> \`${edge.target}\`\n`;
    }

    output += `\n**Referenced By (${incoming.length}):**\n`;
    if (incoming.length === 0) output += `  (None)\n`;
    for (const edge of incoming.slice(0, 8)) {
      output += `  - <- ${edge.type} from \`${edge.source}\`\n`;
    }

    return output.trim();
  }

  /**
   * Impact analysis of changing a symbol/file, bounded to `depth` caller levels (default 2).
   * An unbounded closure over name-matched edges explodes (hundreds of nodes), so it is never used.
   */
  public calculateBlastRadius(targetQuery: string, depth: number = 2): BlastRadiusReport {
    const nodes = this.findNodes(targetQuery);
    if (nodes.length === 0) {
      return {
        target: targetQuery,
        directDependents: [],
        transitiveDependents: [],
        impactedFiles: [],
        blastScore: 0,
        summary: this.notFound("target", targetQuery),
      };
    }

    const target = nodes[0];
    const incomingAdj: Record<string, string[]> = {};
    for (const edge of this.graph.edges) {
      if (edge.type === "defines") continue; // containment is not a dependency
      (incomingAdj[edge.target] ??= []).push(edge.source);
    }

    // Level-by-level BFS up to `depth`.
    const levels: string[][] = [];
    const visited = new Set<string>([target.id]);
    let frontier = [target.id];
    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const parent of incomingAdj[id] || []) {
          if (!visited.has(parent)) {
            visited.add(parent);
            next.push(parent);
          }
        }
      }
      levels.push(next);
      frontier = next;
    }
    const direct = levels[0] ?? [];
    const transitive = levels.flat();

    const fileOf = (id: string) => this.graph.nodes[id]?.file ?? id.replace(/^file:/, "");
    const impactedFiles = Array.from(new Set([target.id, ...transitive].map(fileOf)));
    const totalNodesCount = Math.max(1, Object.keys(this.graph.nodes).length);
    const blastScore = Number(Math.min(1.0, (transitive.length + impactedFiles.length) / (totalNodesCount * 0.2 + 5)).toFixed(2));

    const describe = (ids: string[], cap: number) => {
      const prod = ids.filter((id) => !isTestFile(fileOf(id)));
      const tests = ids.length - prod.length;
      const items = prod.slice(0, cap).map((id) => {
        const n = this.graph.nodes[id];
        return n ? `${n.name} (${n.file}:${n.lineStart})` : id;
      });
      let txt = items.join(", ");
      if (prod.length > cap) txt += `, …+${prod.length - cap}`;
      if (tests) txt += `${txt ? "; " : ""}+${tests} in tests`;
      return txt || "-";
    };

    let summary = `### Blast Radius for \`${target.name}\` (${target.file}:${target.lineStart}), depth ${depth}\n`;
    levels.forEach((ids, i) => {
      summary += `Level ${i + 1} (${ids.length} ${i === 0 ? "direct callers/users" : "callers of level " + i}): ${describe(ids, 14)}\n`;
    });
    if (levels.length === 0 || transitive.length === 0) summary += `No callers or users found in the graph (dynamic dispatch, reflection or function-value references are not tracked).\n`;
    summary += `Files touched: ${impactedFiles.filter((f) => !isTestFile(f)).slice(0, 12).join(", ")}${impactedFiles.length > 12 ? ", …" : ""}\n`;
    summary += `Edges are matched by name, not types: verify surprising entries. Pass depth=3 for one more level.`;

    return {
      target: target.id,
      directDependents: direct,
      transitiveDependents: transitive,
      impactedFiles,
      blastScore,
      summary: summary.trim(),
    };
  }

  /**
   * Detect dead code and orphan symbols (functions/classes with 0 incoming references)
   */
  public findDeadCode(): DeadCodeReport {
    const incomingCount: Record<string, number> = {};
    for (const edge of this.graph.edges) {
      incomingCount[edge.target] = (incomingCount[edge.target] || 0) + 1;
    }

    const orphanSymbols: GraphNode[] = [];
    for (const node of Object.values(this.graph.nodes)) {
      if (node.type === "file") continue;
      // Skip test files, entrypoints, and main entry files
      if (
        node.file.includes("test") ||
        node.file.includes("spec") ||
        node.file.endsWith("index.ts") ||
        node.file.endsWith("main.rs") ||
        node.file.endsWith("cli.ts") ||
        node.file.endsWith("main.go")
      ) {
        continue;
      }

      const refs = incomingCount[node.id] || 0;
      if (refs === 0) {
        orphanSymbols.push(node);
      }
    }

    const potentialTokenWastage = orphanSymbols.length * 35; // ~35 tokens per dead symbol signature
    let summary = `### 🧹 Dead Code & Orphan Symbols Report\n`;
    summary += `- Detected Orphan Symbols: **${orphanSymbols.length}**\n`;
    summary += `- Estimated Token Wastage Per Prompt: **~${potentialTokenWastage} tokens**\n\n`;

    if (orphanSymbols.length === 0) {
      summary += `No obvious orphan symbols detected! Codebase is lean.\n`;
    } else {
      summary += `**Orphan Candidates:**\n`;
      for (const s of orphanSymbols.slice(0, 15)) {
        summary += `  - [${s.type}] \`${s.name}\` in \`${s.file}:${s.lineStart}\` (0 incoming refs)\n`;
      }
      if (orphanSymbols.length > 15) {
        summary += `  - ...and ${orphanSymbols.length - 15} more orphan symbols.\n`;
      }
    }

    return {
      orphanSymbols,
      potentialTokenWastagePerPrompt: potentialTokenWastage,
      summary: summary.trim(),
    };
  }

  /**
   * Analyze Git Diff output to determine affected symbols and blast radius before commit/merge
   */
  public analyzeDiff(diffText: string): DiffBlastReport {
    const lines = diffText.split("\n");
    const changedFiles = new Set<string>();
    const fileChangedLines: Record<string, Set<number>> = {};
    let currentFile = "";

    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        currentFile = line.replace("+++ b/", "").trim();
        changedFiles.add(currentFile);
        if (!fileChangedLines[currentFile]) fileChangedLines[currentFile] = new Set<number>();
      } else if (line.startsWith("@@ ") && currentFile) {
        const match = line.match(/\+([0-9]+)(?:,([0-9]+))?/);
        if (match) {
          const startLine = parseInt(match[1], 10);
          const count = match[2] ? parseInt(match[2], 10) : 1;
          for (let i = 0; i < count; i++) {
            fileChangedLines[currentFile].add(startLine + i);
          }
        }
      }
    }

    const affectedSymbols: GraphNode[] = [];
    for (const file of changedFiles) {
      const changedLineSet = fileChangedLines[file] || new Set<number>();
      for (const node of Object.values(this.graph.nodes)) {
        if (node.type === "file") continue;
        if (node.file === file || node.file.endsWith(file) || file.endsWith(node.file)) {
          // Check line intersection
          let intersects = false;
          for (let l = node.lineStart; l <= node.lineEnd; l++) {
            if (changedLineSet.has(l)) {
              intersects = true;
              break;
            }
          }
          if (intersects) {
            affectedSymbols.push(node);
          }
        }
      }
    }

    // Cumulative blast radius
    const allDirect: string[] = [];
    const allTransitive: string[] = [];
    const allImpactedFiles = new Set<string>(changedFiles);

    for (const sym of affectedSymbols) {
      const blast = this.calculateBlastRadius(sym.id);
      allDirect.push(...blast.directDependents);
      allTransitive.push(...blast.transitiveDependents);
      for (const f of blast.impactedFiles) allImpactedFiles.add(f);
    }

    const recommendedTestFiles: string[] = [];
    for (const f of allImpactedFiles) {
      if (f.includes("test") || f.includes("spec")) {
        recommendedTestFiles.push(f);
      }
    }

    const cumulativeBlast: BlastRadiusReport = {
      target: Array.from(changedFiles).join(", "),
      directDependents: Array.from(new Set(allDirect)),
      transitiveDependents: Array.from(new Set(allTransitive)),
      impactedFiles: Array.from(allImpactedFiles),
      blastScore: Number(Math.min(1.0, (allTransitive.length + allImpactedFiles.size) / 20).toFixed(2)),
      summary: "",
    };

    let summary = `### 🔍 Git Diff Impact & Blast Radius Analysis\n`;
    summary += `- Changed Files: **${changedFiles.size}**\n`;
    summary += `- Directly Affected Symbols: **${affectedSymbols.length}**\n`;
    summary += `- Ripple Effect Transitive Dependents: **${cumulativeBlast.transitiveDependents.length}**\n`;
    summary += `- Total Impacted Files: **${cumulativeBlast.impactedFiles.length}**\n`;
    summary += `- Recommended Tests to Run: **${recommendedTestFiles.length}**\n\n`;

    if (affectedSymbols.length > 0) {
      summary += `**Directly Touched Symbols:**\n`;
      for (const sym of affectedSymbols.slice(0, 10)) {
        summary += `  - [${sym.type}] \`${sym.name}\` (${sym.file}:${sym.lineStart}-${sym.lineEnd})\n`;
      }
    }

    if (recommendedTestFiles.length > 0) {
      summary += `\n**Targeted Tests to Execute (Save Token/Compute):**\n`;
      for (const t of recommendedTestFiles) {
        summary += `  - \`${t}\`\n`;
      }
    }

    cumulativeBlast.summary = summary.trim();

    return {
      changedFiles: Array.from(changedFiles),
      affectedSymbols,
      blastRadius: cumulativeBlast,
      recommendedTestFiles,
      summary: summary.trim(),
    };
  }

  /**
   * Export interactive HTML graph visualizer (0 LLM tokens, offline interactive canvas)
   */
  public exportInteractiveHtml(outputPath: string): string {
    const nodesList = Object.values(this.graph.nodes).map((n) => ({
      id: n.id,
      label: n.name,
      group: n.type,
      file: n.file,
      lines: `${n.lineStart}-${n.lineEnd}`,
      signature: n.signature || "",
    }));

    const edgesList = this.graph.edges.map((e) => ({
      from: e.source,
      to: e.target,
      label: e.type,
    }));
    // Prevent source text such as PHP/HTML "</script>" from terminating the
    // inline data script before the visualizer code runs.
    const jsonForScript = (value: unknown) =>
      JSON.stringify(value).replace(/</g, "\\u003c");

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Token-Guard Interactive Architecture Visualizer</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --success: #3fb950;
      --warning: #d29922;
      --danger: #f85149;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; }
    body { background: var(--bg); color: var(--text); display: flex; height: 100vh; overflow: hidden; }
    #sidebar { width: 340px; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
    #header { padding: 16px; border-bottom: 1px solid var(--border); }
    #header h1 { font-size: 1.1rem; color: #fff; display: flex; align-items: center; gap: 8px; }
    #header p { font-size: 0.8rem; color: var(--text-muted); margin-top: 4px; }
    #search-box { padding: 12px 16px; border-bottom: 1px solid var(--border); }
    #search-input { width: 100%; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: #fff; font-size: 0.85rem; outline: none; }
    #node-list { flex: 1; overflow-y: auto; padding: 8px; }
    .node-item { padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.82rem; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; transition: background 0.15s; }
    .node-item:hover, .node-item.active { background: #21262d; border-left: 3px solid var(--accent); }
    .badge { font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; font-weight: bold; }
    .badge.function { background: #238636; color: #fff; }
    .badge.class { background: #1f6feb; color: #fff; }
    .badge.file { background: #8957e5; color: #fff; }
    .badge.type, .badge.interface { background: #da3633; color: #fff; }
    #viewport { flex: 1; position: relative; background: radial-gradient(#1f242c 1px, transparent 1px); background-size: 24px 24px; }
    #canvas { width: 100%; height: 100%; cursor: grab; }
    #canvas:active { cursor: grabbing; }
    #detail-panel { position: absolute; right: 20px; top: 20px; width: 360px; max-width: calc(100% - 40px); max-height: calc(100% - 40px); overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); padding: 16px; display: none; }
    #detail-panel h2 { font-size: 1rem; color: var(--accent); margin-bottom: 8px; overflow-wrap: anywhere; }
    #detail-panel .meta, #detail-panel #detail-body { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px; overflow-wrap: anywhere; word-break: break-word; }
    #detail-panel code { overflow-wrap: anywhere; word-break: break-word; }
    #detail-panel pre { background: var(--bg); padding: 8px; border-radius: 4px; font-size: 0.75rem; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; margin-top: 8px; border: 1px solid var(--border); }
    .close-btn { float: right; cursor: pointer; color: var(--text-muted); font-size: 1.2rem; }
  </style>
</head>
<body>
  <div id="sidebar">
    <div id="header">
      <h1>🛡️ Token-Guard Architecture</h1>
      <p>Total Nodes: ${nodesList.length} | Edges: ${edgesList.length}</p>
    </div>
    <div id="search-box">
      <input type="text" id="search-input" placeholder="Search symbols, functions, files...">
    </div>
    <div id="node-list"></div>
  </div>

  <div id="viewport">
    <canvas id="canvas"></canvas>
    <div id="detail-panel">
      <span class="close-btn" onclick="closeDetail()">&times;</span>
      <h2 id="detail-title">Symbol Detail</h2>
      <div class="meta" id="detail-meta"></div>
      <div id="detail-body"></div>
    </div>
  </div>

  <script>
    const nodes = ${jsonForScript(nodesList)};
    const edges = ${jsonForScript(edgesList)};
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const renderEdges = edges
      .map(e => ({ ...e, src: nodeById.get(e.from), dst: nodeById.get(e.to) }))
      .filter(e => e.src && e.dst);
    const nodeListEl = document.getElementById("node-list");
    const searchInput = document.getElementById("search-input");
    const detailPanel = document.getElementById("detail-panel");
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");

    let filteredNodes = [...nodes];
    let selectedNode = null;
    let width = 0;
    let height = 0;
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let draggedNode = null;
    let pointerStart = null;
    let didDrag = false;
    let drawQueued = false;

    function requestDraw() {
      if (drawQueued) return;
      drawQueued = true;
      requestAnimationFrame(() => {
        drawQueued = false;
        draw();
      });
    }

    // Deterministic force layout: connected nodes attract, unrelated nodes repel.
    // Runs after resize so width/height are real (positions computed at load were all 0,0).
    // Force sim is O(n^2) per iteration - fine for hundreds of nodes, hangs the
    // tab for thousands. Above FORCE_LIMIT, fall back to a cheap O(n) file-grid
    // cluster layout instead (still edge-correlated: nodes from the same file
    // sit together, so dependency lines read as structure, not noise).
    const FORCE_LIMIT = 800;

    function clusterLayout() {
      const groups = new Map();
      nodes.forEach(n => {
        if (!groups.has(n.file)) groups.set(n.file, []);
        groups.get(n.file).push(n);
      });
      const files = [...groups.values()];
      // Radial file placement gives the overview a snowflake shape instead of
      // compressing 1,273 files into a dense rectangular grid.
      const radius = Math.max(500, Math.sqrt(files.length) * 95);
      files.forEach((g, i) => {
        const angle = i * 2.399963229728653; // golden angle; even distribution
        const distance = radius * Math.sqrt((i + 1) / files.length);
        const cx = Math.cos(angle) * distance;
        const cy = Math.sin(angle) * distance;
        g.forEach((n, j) => {
          if (j === 0) { n.x = cx; n.y = cy; return; }
          const a = (j / (g.length - 1)) * 2 * Math.PI;
          const r = 28 + Math.min(90, g.length * 2);
          n.x = cx + Math.cos(a) * r;
          n.y = cy + Math.sin(a) * r;
        });
      });
    }

    function forceLayout() {
      const indexOf = new Map(nodes.map((n, i) => [n.id, i]));
      const links = edges
        .map(e => [indexOf.get(e.from), indexOf.get(e.to)])
        .filter(([a, b]) => a !== undefined && b !== undefined);
      const cols = Math.ceil(Math.sqrt(nodes.length));
      const gapX = width / (cols + 1);
      const gapY = height / (Math.ceil(nodes.length / cols) + 1);
      nodes.forEach((n, i) => {
        n.x = gapX * ((i % cols) + 1);
        n.y = gapY * (Math.floor(i / cols) + 1);
      });

      // Snowflake, not compact: strong repulsion + long ideal edge length so
      // branches splay outward instead of collapsing into a ball. Nodes are
      // left unclamped (open space) - fitView() frames the result afterward.
      for (let iteration = 0; iteration < 160; iteration++) {
        const forces = nodes.map(() => ({ x: 0, y: 0 }));
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const distance = Math.max(20, Math.hypot(dx, dy));
            const force = 9000 / (distance * distance);
            forces[i].x -= dx / distance * force;
            forces[i].y -= dy / distance * force;
            forces[j].x += dx / distance * force;
            forces[j].y += dy / distance * force;
          }
        }
        links.forEach(([i, j]) => {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const force = (distance - 220) * 0.01;
          const fx = dx / distance * force, fy = dy / distance * force;
          forces[i].x += fx;
          forces[i].y += fy;
          forces[j].x -= fx;
          forces[j].y -= fy;
        });
        nodes.forEach((n, i) => {
          n.x += forces[i].x;
          n.y += forces[i].y;
        });
      }
    }

    // Frame the camera (pan/zoom) around whatever bounding box the layout
    // produced, since forceLayout no longer clamps nodes to canvas size.
    function fitView() {
      if (nodes.length === 0) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(n => {
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
      });
      const pad = 60;
      const spanX = Math.max(1, maxX - minX + pad * 2);
      const spanY = Math.max(1, maxY - minY + pad * 2);
      zoom = Math.max(0.05, Math.min(2, Math.min(width / spanX, height / spanY)));
      panX = width / 2 - ((minX + maxX) / 2) * zoom;
      panY = height / 2 - ((minY + maxY) / 2) * zoom;
    }

    function layout() {
      if (nodes.length > FORCE_LIMIT) clusterLayout();
      else forceLayout();
      fitView();
    }

    function resize() {
      width = canvas.parentElement.clientWidth;
      height = canvas.parentElement.clientHeight;
      canvas.width = width;
      canvas.height = height;
      if (width && height) layout();
      draw();
    }
    window.addEventListener("resize", resize);

    function renderList() {
      nodeListEl.innerHTML = "";
      filteredNodes.slice(0, 100).forEach(n => {
        const item = document.createElement("div");
        item.className = "node-item " + (selectedNode && selectedNode.id === n.id ? "active" : "");
        item.innerHTML = "<span>" + n.label + "</span><span class='badge " + n.group + "'>" + n.group + "</span>";
        item.onclick = () => selectNode(n);
        nodeListEl.appendChild(item);
      });
    }

    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      filteredNodes = nodes.filter(n => n.label.toLowerCase().includes(q) || n.file.toLowerCase().includes(q));
      renderList();
    });

    function selectNode(n) {
      selectedNode = n;
      detailPanel.style.display = "block";
      document.getElementById("detail-title").innerText = n.label;
      document.getElementById("detail-meta").innerHTML = "Type: <b>" + n.group + "</b> | File: <code>" + n.file + ":" + n.lines + "</code>";
      
      const outgoing = edges.filter(e => e.from === n.id);
      const incoming = edges.filter(e => e.to === n.id);

      let body = "<b>Outgoing Dependencies (" + outgoing.length + "):</b><br>";
      outgoing.slice(0, 8).forEach(e => body += "<div style='font-size:0.75rem;margin:2px 0;'>&rarr; " + e.label + " <code>" + e.to + "</code></div>");
      body += "<br><b>Referenced By (" + incoming.length + "):</b><br>";
      incoming.slice(0, 8).forEach(e => body += "<div style='font-size:0.75rem;margin:2px 0;'>&larr; " + e.label + " <code>" + e.from + "</code></div>");

      if (n.signature) {
        body += "<pre><code>" + n.signature + "</code></pre>";
      }
      document.getElementById("detail-body").innerHTML = body;
      renderList();
      draw();
    }

    function closeDetail() {
      detailPanel.style.display = "none";
      selectedNode = null;
      renderList();
      draw();
    }

    function nodeAt(x, y) {
      const graphX = (x - panX) / zoom;
      const graphY = (y - panY) / zoom;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const radius = Math.max(10, n.group === "file" ? 12 : 10) / zoom;
        if (Math.hypot(n.x - graphX, n.y - graphY) <= radius) return n;
      }
      return null;
    }

    canvas.addEventListener("pointerdown", (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      draggedNode = nodeAt(x, y);
      pointerStart = { x: event.clientX, y: event.clientY, panX, panY };
      didDrag = false;
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!pointerStart) return;
      const dx = event.clientX - pointerStart.x, dy = event.clientY - pointerStart.y;
      if (Math.hypot(dx, dy) > 3) didDrag = true;
      if (draggedNode) {
        draggedNode.x += dx / zoom;
        draggedNode.y += dy / zoom;
        pointerStart.x = event.clientX;
        pointerStart.y = event.clientY;
      } else {
        panX = pointerStart.panX + dx;
        panY = pointerStart.panY + dy;
      }
      requestDraw();
    });

    canvas.addEventListener("pointerup", (event) => {
      if (pointerStart && !didDrag && draggedNode) selectNode(draggedNode);
      pointerStart = null;
      draggedNode = null;
      canvas.releasePointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointercancel", () => {
      pointerStart = null;
      draggedNode = null;
    });

    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const oldZoom = zoom;
      zoom = Math.max(0.05, Math.min(8, zoom * Math.exp(-event.deltaY * 0.001)));
      panX = x - (x - panX) * (zoom / oldZoom);
      panY = y - (y - panY) * (zoom / oldZoom);
      requestDraw();
    }, { passive: false });

    function draw() {
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(zoom, zoom);

      // Viewport culling: skip anything outside the visible graph-space rect.
      // Big graphs (thousands of nodes) spend most of draw() off-screen otherwise.
      const pad = 40 / zoom;
      const left = -panX / zoom - pad, top = -panY / zoom - pad;
      const right = left + width / zoom + pad * 2, bottom = top + height / zoom + pad * 2;
      const inView = (n) => n.x >= left && n.x <= right && n.y >= top && n.y <= bottom;

      // Draw edges
      renderEdges.forEach(e => {
        const { src, dst } = e;
        if (!inView(src) && !inView(dst)) return;
        const isSelectedEdge = selectedNode && (src.id === selectedNode.id || dst.id === selectedNode.id);
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(dst.x, dst.y);
        ctx.strokeStyle = isSelectedEdge ? "#58a6ff" : "rgba(48, 54, 61, 0.4)";
        ctx.lineWidth = isSelectedEdge ? 2 / zoom : 1 / zoom;
        ctx.stroke();
      });

      // Draw nodes
      const showAllLabels = nodes.length < 50;
      nodes.forEach(n => {
        if (!inView(n)) return;
        ctx.beginPath();
        const isSelected = selectedNode && selectedNode.id === n.id;
        const radius = isSelected ? 8 : (n.group === "file" ? 6 : 4);
        ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
        if (isSelected) {
          ctx.fillStyle = "#58a6ff";
          ctx.shadowBlur = 12 / zoom;
          ctx.shadowColor = "#58a6ff";
        } else if (n.group === "function") {
          ctx.fillStyle = "#3fb950";
          ctx.shadowBlur = 0;
        } else if (n.group === "class") {
          ctx.fillStyle = "#1f6feb";
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = "#8b949e";
          ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        if (isSelected || showAllLabels) {
          ctx.font = "10px monospace";
          ctx.fillStyle = isSelected ? "#ffffff" : "rgba(201, 209, 217, 0.7)";
          ctx.fillText(n.label, n.x + 8, n.y + 3);
        }
      });
      ctx.restore();
    }

    setTimeout(() => {
      resize();
      renderList();
    }, 100);
  </script>
</body>
</html>`;

    const dir = require("node:path").dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, htmlContent, "utf-8");
    return outputPath;
  }

  private findNodes(query: string): GraphNode[] {
    // Exact matches only, ranked: production before tests, symbols before files.
    const q = query.toLowerCase();
    const pathLike = /[/\\]/.test(q);
    return rankNodes(
      Object.values(this.graph.nodes).filter((n) =>
        pathLike
          ? n.type === "file" && n.file.toLowerCase().endsWith(q)
          : n.name.toLowerCase() === q || n.id.toLowerCase() === q || (n.type === "file" && n.file.toLowerCase().endsWith(q))
      ),
      query
    );
  }

  private formatLeanSummary(nodes: GraphNode[], total: number, offset: number, maxTokens: number): string {
    const out = new Map<string, string[]>();
    const inc = new Map<string, GraphNode[]>();
    const ids = new Set(nodes.slice(0, 3).map((n) => n.id));
    for (const e of this.graph.edges) {
      if (e.type === "defines") continue;
      if (ids.has(e.source)) (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(`${e.type}:${this.label(e.target)}`);
      const src = this.graph.nodes[e.source];
      if (ids.has(e.target) && src && src.type !== "file") (inc.get(e.target) ?? inc.set(e.target, []).get(e.target)!).push(src);
    }
    const list = (xs: string[] | undefined) => {
      if (!xs?.length) return "-";
      const uniq = [...new Set(xs)];
      return uniq.slice(0, 6).join(", ") + (uniq.length > 6 ? `, ...+${uniq.length - 6}` : "");
    };
    // Callers grouped by file (production first) so "which files use X" is answerable from one call.
    const callers = (xs: GraphNode[] | undefined) => {
      if (!xs?.length) return "-";
      const prod = new Map<string, string[]>();
      let testCallers = 0;
      const testFiles = new Set<string>();
      for (const n of xs) {
        if (isTestFile(n.file)) { testCallers++; testFiles.add(n.file); continue; }
        const names = prod.get(n.file) ?? prod.set(n.file, []).get(n.file)!;
        if (!names.includes(n.name)) names.push(n.name);
      }
      const files = [...prod.entries()];
      let txt = files.slice(0, 12).map(([f, names]) => `${f}[${names.slice(0, 3).join(",")}${names.length > 3 ? ",…" : ""}]`).join("; ");
      if (files.length > 12) txt += `; …+${files.length - 12} files`;
      if (testCallers) txt += `${txt ? "; " : ""}+${testCallers} in ${testFiles.size} test file(s)`;
      return txt || "-";
    };

    const blocks = nodes.map((node, idx) => {
      const sig = node.signature ? ` | ${node.signature.length > 110 ? node.signature.slice(0, 110) + "…" : node.signature}` : "";
      let md = `[${node.type}] ${node.name} ${node.file}:${node.lineStart}-${node.lineEnd}${sig}`;
      if (node.type !== "file" && idx < 3) {
        md += `\n  uses: ${list(out.get(node.id))}\n  used by: ${callers(inc.get(node.id))}`;
      }
      return md;
    });

    const { text, shown } = fitBlocks(blocks, maxTokens);
    const remaining = total - offset - shown;
    return remaining > 0 ? `${text}\n… ${remaining} more match(es); narrow the name or pass offset=${offset + shown}.` : text;
  }

  private label(id: string): string {
    const n = this.graph.nodes[id];
    return n ? n.name : id.replace(/^(symbol|file|module|use|mod):/, "");
  }
}
