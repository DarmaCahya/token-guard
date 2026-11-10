import { describe, it, expect } from "bun:test";
import { parseSourceFile } from "../src/core/parser.ts";
import { GraphQueryEngine } from "../src/core/query.ts";
import { AmbiguityGuard } from "../src/guards/ambiguity.ts";
import { ScopeGuard } from "../src/guards/scope.ts";
import type { CodeGraph } from "../src/core/types.ts";

describe("Token-Guard Core Tests", () => {
  it("should parse TypeScript source file into AST nodes and edges deterministically", () => {
    const tsCode = `
      import { Pool } from "pg";
      
      export class AuthService {
        verifyToken(token: string): boolean {
          return token.length > 10;
        }
      }

      export async function loginHandler(req: any) {
        return true;
      }
    `;

    const parsed = parseSourceFile("src/auth.ts", tsCode);
    expect(parsed.nodes.length).toBeGreaterThanOrEqual(3); // file + class + function
    expect(parsed.edges.some((e) => e.type === "imports")).toBe(true);
    expect(parsed.nodes.some((n) => n.name === "AuthService")).toBe(true);
    expect(parsed.nodes.some((n) => n.name === "loginHandler")).toBe(true);
  });

  it("should parse PHP source file into classes, methods, functions and imports", () => {
    const phpCode = `<?php
namespace App\\Services;

use App\\Models\\User;
use App\\Contracts\\Finder as F;

abstract class UserService extends BaseService implements Finder, Countable
{
    public function findUser(int $id): ?User
    {
        return $this->repo->get($id);
    }

    private static function secret(): void {}
}

function helper($x) { return $x; }
`;
    const parsed = parseSourceFile("src/UserService.php", phpCode);
    const byName = (n: string) => parsed.nodes.find((x) => x.name === n);
    expect(byName("UserService")?.type).toBe("class");
    expect(byName("findUser")?.type).toBe("method");
    expect(byName("secret")?.type).toBe("method");
    expect(byName("helper")?.type).toBe("function");
    expect(byName("findUser")?.lineEnd).toBeGreaterThan(byName("findUser")!.lineStart);
    expect(parsed.edges.filter((e) => e.type === "imports").length).toBe(2);
    expect(parsed.edges.some((e) => e.type === "extends" && e.target === "symbol:BaseService")).toBe(true);
    expect(parsed.edges.filter((e) => e.type === "implements").length).toBe(2);
  });

  it("should parse Rust source file into AST nodes and edges deterministically", () => {
    const rsCode = `
      use hayro::RenderDoc;
      use crate::error::Result;

      pub struct PdfReader {
        pub max_chars: usize,
      }

      impl PdfReader {
        pub fn new(max_chars: usize) -> Self {
          Self { max_chars }
        }

        pub async fn extract_markdown(&self) -> Result<String> {
          Ok("markdown".into())
        }
      }
    `;

    const parsed = parseSourceFile("crates/pdf-agent/src/reader.rs", rsCode);
    expect(parsed.nodes.length).toBeGreaterThanOrEqual(4); // file + struct + impl + functions
    expect(parsed.edges.some((e) => e.type === "imports")).toBe(true);
    expect(parsed.nodes.some((n) => n.name === "PdfReader")).toBe(true);
    expect(parsed.nodes.some((n) => n.name === "extract_markdown")).toBe(true);
  });

  it("should detect ambiguous user prompt and flag isClear: false", () => {
    const guard = new AmbiguityGuard();
    const result = guard.evaluate("tolong benerin error pas jalan");

    expect(result.isClear).toBe(false);
    expect(result.clarityScore).toBeLessThan(0.6);
    expect(result.suggestedClarifications.length).toBeGreaterThan(0);
  });

  it("should pass high-clarity user prompt with specific file target", () => {
    const guard = new AmbiguityGuard();
    const result = guard.evaluate("Tolong fix null pointer exception di `verifyToken` pada src/auth.ts");

    expect(result.isClear).toBe(true);
    expect(result.clarityScore).toBeGreaterThanOrEqual(0.6);
    expect(result.detectedEntities.targetFiles).toContain("src/auth.ts");
  });

  it("should enforce scope and detect unauthorized file edits", () => {
    const scopeGuard = new ScopeGuard();
    const res = scopeGuard.validate(["src/auth.ts"], ["src/auth.ts", "src/db/migrations.ts"]);

    expect(res.isCompliant).toBe(false);
    expect(res.violations).toContain("src/db/migrations.ts");
    expect(res.warningMessage).toBeDefined();
  });

  it("should trace path between connected nodes", () => {
    const mockGraph: CodeGraph = {
      version: "1.0.0",
      indexedAt: new Date().toISOString(),
      rootPath: "/mock",
      stats: { totalFiles: 2, totalNodes: 2, totalEdges: 1, languages: { ts: 2 } },
      nodes: {
        "file:src/controller.ts": { id: "file:src/controller.ts", name: "controller.ts", type: "file", file: "src/controller.ts", lineStart: 1, lineEnd: 50 },
        "file:src/database.ts": { id: "file:src/database.ts", name: "database.ts", type: "file", file: "src/database.ts", lineStart: 1, lineEnd: 50 },
      },
      edges: [
        { source: "file:src/controller.ts", target: "file:src/database.ts", type: "imports" }
      ],
    };

    const engine = new GraphQueryEngine(mockGraph);
    const trace = engine.trace("controller.ts", "database.ts");
    expect(trace.pathFound).toBe(true);
    expect(trace.steps.length).toBe(2);
  });
});

describe("Relation edges, symbol coverage and ranking", () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  const { GraphIndexer } = require("../src/core/indexer.ts") as typeof import("../src/core/indexer.ts");

  function indexFiles(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), "tg-"));
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(join(root, name, ".."), { recursive: true });
      writeFileSync(join(root, name), body);
    }
    const graph = new GraphIndexer(root, join(root, ".cache")).index();
    return { graph, engine: new GraphQueryEngine(graph) };
  }

  const goSrc = `package gin

const abortIndex int8 = 63

const (
	modeA = 1
	modeB = 2
)

type HandlerFunc func(c *Context)

type Engine struct {
	trees int
}

func (engine *Engine) Run() {
	engine.addRoute("GET")
	_ = abortIndex
}

func (engine *Engine) addRoute(method string) {
	engine := 1
	_ = engine
}
`;

  it("indexes Go constants, const blocks, struct and func types", () => {
    const { graph } = indexFiles({ "gin.go": goSrc });
    const byName = (n: string) => Object.values(graph.nodes).find((x) => x.name === n);
    expect(byName("abortIndex")?.type).toBe("variable");
    expect(byName("modeB")?.type).toBe("variable");
    expect(byName("Engine")?.type).toBe("class");
    expect(byName("HandlerFunc")?.type).toBe("type");
  });

  it("links calls and references between symbols (and answers 'who uses X')", () => {
    const { graph, engine } = indexFiles({ "gin.go": goSrc });
    const has = (s: string, t: string, type: string) =>
      graph.edges.some((e) => e.type === type && e.source.endsWith("#" + s) && e.target.endsWith("#" + t));
    expect(has("Run", "addRoute", "calls")).toBe(true);
    expect(has("Run", "abortIndex", "references")).toBe(true);
    expect(engine.query("addRoute").summary).toContain("used by: Run");
    expect(engine.calculateBlastRadius("abortIndex").directDependents.length).toBe(1);
  });

  it("does not link a local variable that shadows a global symbol", () => {
    const { graph } = indexFiles({
      "a.go": "package a\n\nvar root = 1\n\nfunc use() {\n\troot := 2\n\t_ = root\n}\n",
    });
    expect(graph.edges.some((e) => e.type === "references" && e.target.endsWith("#root"))).toBe(false);
  });

  it("indexes TypeScript class methods and constants", () => {
    const { graph } = indexFiles({
      "svc.ts": "export const LIMIT = 5;\nexport type Id = string;\nexport class Svc {\n  run(x: number): number {\n    return helper(x);\n  }\n}\nexport function helper(x: number) {\n  return x + LIMIT;\n}\n",
    });
    const byName = (n: string) => Object.values(graph.nodes).find((x) => x.name === n);
    expect(byName("run")?.type).toBe("method");
    expect(byName("LIMIT")?.type).toBe("variable");
    expect(byName("Id")?.type).toBe("type");
    expect(graph.edges.some((e) => e.type === "calls" && e.source.endsWith("#run") && e.target.endsWith("#helper"))).toBe(true);
    expect(graph.edges.some((e) => e.type === "references" && e.source.endsWith("#helper") && e.target.endsWith("#LIMIT"))).toBe(true);
  });

  it("ranks production code above tests and exact names above substrings", () => {
    const { engine } = indexFiles({
      "recovery.go": "package a\n\nfunc Recovery() {}\n",
      "recovery_test.go": "package a\n\nfunc TestRecovery() {}\nfunc Recovery2() {}\n",
    });
    const names = engine.query("Recovery").matches.map((m) => m.name);
    expect(names[0]).toBe("Recovery");
    expect(names.indexOf("Recovery")).toBeLessThan(names.indexOf("TestRecovery"));
  });
  it("paginates and respects the output budget in query()", () => {
    const fns = Array.from({ length: 12 }, (_, k) => `func Handler${k}() {}\n`).join("");
    const { engine } = indexFiles({ "h.go": "package a\n\n" + fns });
    const first = engine.query("Handler", 5);
    expect(first.matches.length).toBe(5);
    expect(first.total).toBe(12);
    expect(first.summary).toContain("7 more match(es)");
    expect(first.summary).toContain("offset=5");
    const next = engine.query("Handler", 5, 5);
    expect(next.matches[0]!.name).not.toBe(first.matches[0]!.name);
    const tiny = engine.query("Handler", 12, 0, 100);
    expect(tiny.summary.length / 4).toBeLessThan(260);
    expect(tiny.summary).toContain("more match(es)");
  });

  it("explains a miss instead of returning a bare 'not found'", () => {
    const { engine } = indexFiles({ "h.go": "package a\n\nfunc ServeHTTP() {}\n" });
    const res = engine.query("ServeHTP");
    expect(res.matches.length).toBe(0);
    expect(res.summary).toContain("Use grep");
    expect(engine.calculateBlastRadius("nopeXYZ").summary).toContain("indexed nodes");
  });

  it("caps slice length and mentions same-named symbols elsewhere", () => {
    const body = Array.from({ length: 120 }, (_, k) => `\tx${k} := ${k}\n`).join("");
    const { graph } = indexFiles({
      "big.go": `package a\n\nfunc Big() {\n${body}}\n`,
      "other.go": "package a\n\nfunc Big() {}\n",
    });
    const { SurgicalSlicer } = require("../src/core/slicer.ts") as typeof import("../src/core/slicer.ts");
    const root = (graph as any).rootPath as string;
    const res = new SurgicalSlicer(root, graph).sliceSymbol("Big", 0, 20)!;
    expect(res.code.split("\n").filter((l) => l.startsWith(">")).length).toBe(20);
    expect(res.code).toContain("more lines");
    const picked = new SurgicalSlicer(root, graph).sliceSymbol("Big", 0, 80, "other.go")!;
    expect(picked.file).toBe("other.go");
  });
});
