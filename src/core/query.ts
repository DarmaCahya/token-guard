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
   * Calculate full blast radius (impact analysis) of modifying or removing a target symbol/file.
   */
  public calculateBlastRadius(targetQuery: string): BlastRadiusReport {
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
      if (!incomingAdj[edge.target]) incomingAdj[edge.target] = [];
      incomingAdj[edge.target].push(edge.source);
    }

    const direct = (incomingAdj[target.id] || []).slice().sort((a, b) => Number(isTestFile(this.graph.nodes[a]?.file ?? a)) - Number(isTestFile(this.graph.nodes[b]?.file ?? b)));
    const directSet = new Set(direct);

    // BFS transitive dependents
    const visited = new Set<string>([target.id]);
    const queue = [...direct];
    const transitive: string[] = [];

    for (const d of direct) {
      visited.add(d);
    }

    while (queue.length > 0) {
      const curr = queue.shift()!;
      transitive.push(curr);
      for (const parent of incomingAdj[curr] || []) {
        if (!visited.has(parent)) {
          visited.add(parent);
          queue.push(parent);
        }
      }
    }

    // Extract impacted files
    const impactedFilesSet = new Set<string>();
    for (const id of [target.id, ...transitive]) {
      const n = this.graph.nodes[id];
      if (n && n.file) {
        impactedFilesSet.add(n.file);
      } else if (id.startsWith("file:")) {
        impactedFilesSet.add(id.replace("file:", ""));
      }
    }

    const impactedFiles = Array.from(impactedFilesSet);
    const totalNodesCount = Math.max(1, Object.keys(this.graph.nodes).length);
    const blastScore = Number(Math.min(1.0, (transitive.length + impactedFiles.length) / (totalNodesCount * 0.2 + 5)).toFixed(2));

    let summary = `### 💥 Blast Radius for \`${target.name}\` (${target.file})\n`;
    summary += `- Direct Dependents: **${direct.length}**\n`;
    summary += `- Transitive Dependents (Ripple Effect): **${transitive.length}**\n`;
    summary += `- Impacted Files: **${impactedFiles.length}**\n`;
    summary += `- Criticality Blast Score: **${blastScore}** / 1.0\n\n`;
    if (direct.length > 0) {
      summary += `**Direct dependents:** ` + direct.slice(0, 8).map((id) => {
        const n = this.graph.nodes[id];
        return n ? `${n.name} (${n.file}:${n.lineStart})` : id;
      }).join(", ") + (direct.length > 8 ? `, ...+${direct.length - 8}` : "") + `\n\n`;
    }
    summary += `**Impacted Files List:**\n`;
    for (const f of impactedFiles.slice(0, 10)) {
      summary += `  - \`${f}\`\n`;
    }
    if (impactedFiles.length > 10) {
      summary += `  - ...and ${impactedFiles.length - 10} more files.\n`;
    }

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
    #canvas { width: 100%; height: 100%; }
    #detail-panel { position: absolute; right: 20px; top: 20px; width: 360px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); padding: 16px; display: none; }
    #detail-panel h2 { font-size: 1rem; color: var(--accent); margin-bottom: 8px; word-break: break-all; }
    #detail-panel .meta { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px; }
    #detail-panel pre { background: var(--bg); padding: 8px; border-radius: 4px; font-size: 0.75rem; overflow-x: auto; margin-top: 8px; border: 1px solid var(--border); }
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
    const nodes = ${JSON.stringify(nodesList)};
    const edges = ${JSON.stringify(edgesList)};
    const nodeListEl = document.getElementById("node-list");
    const searchInput = document.getElementById("search-input");
    const detailPanel = document.getElementById("detail-panel");
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");

    let filteredNodes = [...nodes];
    let selectedNode = null;
    let width = 0;
    let height = 0;

    function resize() {
      width = canvas.parentElement.clientWidth;
      height = canvas.parentElement.clientHeight;
      canvas.width = width;
      canvas.height = height;
      draw();
    }
    window.addEventListener("resize", resize);

    // Initial node positioning
    nodes.forEach((n, idx) => {
      const angle = (idx / nodes.length) * 2 * Math.PI;
      const radius = Math.min(width, height) * 0.35 + (idx % 3) * 60;
      n.x = width / 2 + Math.cos(angle) * (radius || 200);
      n.y = height / 2 + Math.sin(angle) * (radius || 200);
    });

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

    function draw() {
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);

      // Draw edges
      ctx.lineWidth = 1;
      edges.forEach(e => {
        const src = nodes.find(n => n.id === e.from);
        const dst = nodes.find(n => n.id === e.to);
        if (src && dst) {
          ctx.beginPath();
          ctx.moveTo(src.x, src.y);
          ctx.lineTo(dst.x, dst.y);
          if (selectedNode && (src.id === selectedNode.id || dst.id === selectedNode.id)) {
            ctx.strokeStyle = "#58a6ff";
            ctx.lineWidth = 2;
          } else {
            ctx.strokeStyle = "rgba(48, 54, 61, 0.4)";
            ctx.lineWidth = 1;
          }
          ctx.stroke();
        }
      });

      // Draw nodes
      nodes.forEach(n => {
        ctx.beginPath();
        const isSelected = selectedNode && selectedNode.id === n.id;
        const radius = isSelected ? 8 : (n.group === "file" ? 6 : 4);
        ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
        if (isSelected) {
          ctx.fillStyle = "#58a6ff";
          ctx.shadowBlur = 12;
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

        if (isSelected || nodes.length < 50) {
          ctx.font = "10px monospace";
          ctx.fillStyle = isSelected ? "#ffffff" : "rgba(201, 209, 217, 0.7)";
          ctx.fillText(n.label, n.x + 8, n.y + 3);
        }
      });
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
    const inc = new Map<string, string[]>();
    const ids = new Set(nodes.slice(0, 3).map((n) => n.id));
    for (const e of this.graph.edges) {
      if (e.type === "defines") continue;
      if (ids.has(e.source)) (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(`${e.type}:${this.label(e.target)}`);
      if (ids.has(e.target)) (inc.get(e.target) ?? inc.set(e.target, []).get(e.target)!).push(this.label(e.source));
    }
    const list = (xs: string[] | undefined) => {
      if (!xs?.length) return "-";
      const uniq = [...new Set(xs)];
      return uniq.slice(0, 6).join(", ") + (uniq.length > 6 ? `, ...+${uniq.length - 6}` : "");
    };

    const blocks = nodes.map((node, idx) => {
      const sig = node.signature ? ` | ${node.signature.length > 110 ? node.signature.slice(0, 110) + "…" : node.signature}` : "";
      let md = `[${node.type}] ${node.name} ${node.file}:${node.lineStart}-${node.lineEnd}${sig}`;
      if (node.type !== "file" && idx < 3) {
        md += `\n  uses: ${list(out.get(node.id))}\n  used by: ${list(inc.get(node.id))}`;
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
