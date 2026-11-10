import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { CodeGraph, GraphNode, GraphEdge } from "./types.ts";
import { parseSourceFile } from "./parser.ts";
import { linkRelations } from "./relations.ts";

const GRAPH_VERSION = "1.3.0";

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".cache",
  ".tokenguard",
  "tmp",
  "vendor",
  "target",
  ".cargo",
]);

const SUPPORTED_EXTS = new Set(["ts", "tsx", "js", "jsx", "py", "go", "rs", "php"]);

export class GraphIndexer {
  private rootDir: string;
  private cacheDir: string;

  constructor(rootDir: string = process.cwd(), customCacheDir?: string) {
    this.rootDir = resolve(rootDir);
    if (customCacheDir) {
      this.cacheDir = resolve(customCacheDir);
    } else {
      const defaultCache = join(this.rootDir, ".tokenguard");
      try {
        if (!existsSync(defaultCache)) {
          mkdirSync(defaultCache, { recursive: true });
        }
        this.cacheDir = defaultCache;
      } catch {
        // Fallback to user home cache if target dir is read-only / owned by root
        const home = process.env.HOME || "/tmp";
        const safeHash = Buffer.from(this.rootDir).toString("hex").slice(0, 16);
        const fallback = join(home, ".cache", "tokenguard", safeHash);
        mkdirSync(fallback, { recursive: true });
        this.cacheDir = fallback;
      }
    }
  }

  public getCacheDir(): string {
    return this.cacheDir;
  }

  public index(): CodeGraph {
    const nodes: Record<string, GraphNode> = {};
    const edges: GraphEdge[] = [];
    const languages: Record<string, number> = {};
    const files = this.collectFiles(this.rootDir);
    const contents = new Map<string, string[]>();

    for (const absPath of files) {
      const relPath = relative(this.rootDir, absPath);
      const ext = relPath.split(".").pop()?.toLowerCase() || "unknown";
      languages[ext] = (languages[ext] || 0) + 1;

      try {
        const content = readFileSync(absPath, "utf-8");
        const parsed = parseSourceFile(relPath, content);
        contents.set(relPath, content.split("\n"));

        for (const node of parsed.nodes) {
          nodes[node.id] = node;
        }
        edges.push(...parsed.edges);
      } catch (err) {
        // Skip unreadable / binary files gracefully
      }
    }

    // Resolve cross-file import edges
    this.resolveEdges(nodes, edges);
    linkRelations(nodes, contents, edges);

    const graph: CodeGraph = {
      version: GRAPH_VERSION,
      indexedAt: new Date().toISOString(),
      rootPath: this.rootDir,
      stats: {
        totalFiles: files.length,
        totalNodes: Object.keys(nodes).length,
        totalEdges: edges.length,
        languages,
      },
      nodes,
      edges,
    };

    this.saveCache(graph);
    return graph;
  }

  public load(): CodeGraph {
    const cacheFile = join(this.cacheDir, "graph.json");
    if (existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(readFileSync(cacheFile, "utf-8")) as CodeGraph;
        // Caches written by older versions lack call/reference edges; rebuild them.
        return cached.version === GRAPH_VERSION ? cached : this.index();
      } catch {
        return this.index();
      }
    }
    return this.index();
  }

  private resolveEdges(nodes: Record<string, GraphNode>, edges: GraphEdge[]) {
    // Normalise relative imports like ./auth or ../services/db to actual node ids
    for (const edge of edges) {
      if (edge.type === "imports" && edge.target.startsWith("file:")) {
        const rawTarget = edge.target.replace("file:", "");
        if (rawTarget.startsWith(".")) {
          const sourceNode = nodes[edge.source];
          if (sourceNode) {
            const sourceDir = sourceNode.file.split("/").slice(0, -1).join("/");
            const normalized = join(sourceDir, rawTarget).replace(/\\/g, "/");

            // Look for matching node with extension (.ts, .js, .rs, etc.)
            for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", ".rs", ".py", ".go", ".php"]) {
              const candidate = `file:${normalized}${ext}`;
              if (nodes[candidate]) {
                edge.target = candidate;
                break;
              }
            }
          }
        }
      }
    }
  }

  private collectFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
            results.push(...this.collectFiles(join(dir, entry.name)));
          }
        } else if (entry.isFile()) {
          const ext = entry.name.split(".").pop()?.toLowerCase();
          if (ext && SUPPORTED_EXTS.has(ext)) {
            results.push(join(dir, entry.name));
          }
        }
      }
    } catch {
      // Permission or missing directory
    }
    return results;
  }

  private saveCache(graph: CodeGraph) {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
    writeFileSync(join(this.cacheDir, "graph.json"), JSON.stringify(graph, null, 2), "utf-8");
  }
}
