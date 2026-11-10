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

  it("should parse PHP source file into AST nodes and edges deterministically", () => {
    const phpCode = `<?php
use App\\Services\\TokenService;

class AuthController extends BaseController {
    public function login(string $token): bool {
        return true;
    }
}
`;

    const parsed = parseSourceFile("app/AuthController.php", phpCode);
    expect(parsed.nodes.length).toBeGreaterThanOrEqual(3);
    expect(parsed.edges.some((e) => e.type === "imports" && e.target === "use:App\\Services\\TokenService")).toBe(true);
    expect(parsed.nodes.some((n) => n.name === "AuthController")).toBe(true);
    expect(parsed.nodes.some((n) => n.name === "login" && n.type === "method")).toBe(true);
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
