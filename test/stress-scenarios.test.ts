import { describe, it, expect, beforeAll } from "bun:test";
import { GraphIndexer } from "../src/core/indexer.ts";
import { GraphQueryEngine } from "../src/core/query.ts";
import { SurgicalSlicer } from "../src/core/slicer.ts";
import { AmbiguityGuard } from "../src/guards/ambiguity.ts";
import { ScopeGuard } from "../src/guards/scope.ts";
import { parseSourceFile } from "../src/core/parser.ts";
import type { CodeGraph } from "../src/core/types.ts";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

describe("🔥 Comprehensive User Workflow Stress Testing Suite", () => {
  let projectGraph: CodeGraph;
  let queryEngine: GraphQueryEngine;
  let slicer: SurgicalSlicer;
  let ambiguityGuard: AmbiguityGuard;
  let scopeGuard: ScopeGuard;
  const projectRoot = resolve(import.meta.dir, "..");

  beforeAll(() => {
    const indexer = new GraphIndexer(projectRoot);
    projectGraph = indexer.index();
    queryEngine = new GraphQueryEngine(projectGraph);
    slicer = new SurgicalSlicer(projectRoot, projectGraph);
    ambiguityGuard = new AmbiguityGuard();
    scopeGuard = new ScopeGuard(projectRoot);
  });

  // SCENARIO 1: Blast Radius / Refactoring Impact Analysis
  describe("Scenario 1: Refactoring Impact & Blast Radius", () => {
    it("should accurately compute blast radius when modifying a core function", () => {
      const blast = queryEngine.calculateBlastRadius("parseSourceFile");
      expect(blast).toBeDefined();
      expect(blast.directDependents.length).toBeGreaterThan(0);
      expect(blast.impactedFiles.length).toBeGreaterThan(0);
      expect(blast.blastScore).toBeGreaterThan(0);
      expect(blast.summary).toContain("Blast Radius for `parseSourceFile`");
    });

    it("should return zero blast radius for non-existent or leaf node", () => {
      const blast = queryEngine.calculateBlastRadius("nonExistentSymbolXYZ");
      expect(blast.directDependents.length).toBe(0);
      expect(blast.blastScore).toBe(0);
    });
  });

  // SCENARIO 2: Stack Trace Bug Localization (Crash Diagnosis)
  describe("Scenario 2: Stack Trace Crash Localization", () => {
    it("should pinpoint exact AST node and line numbers from runtime stacktrace", () => {
      const sampleStacktrace = `
        TypeError: Cannot read properties of undefined
            at parseSourceFile (src/core/parser.ts:8:25)
            at GraphIndexer.index (src/core/indexer.ts:45:12)
            at main (src/cli.ts:43:20)
      `;

      // Extract file & function from stacktrace
      const matches = sampleStacktrace.match(/at\s+(\w+)\s+\(([^:]+):(\d+):(\d+)\)/);
      expect(matches).not.toBeNull();
      if (!matches) return;

      const [, fnName, file, lineStr] = matches;
      const line = parseInt(lineStr, 10);

      const queryRes = queryEngine.query(fnName);
      expect(queryRes.matches.length).toBeGreaterThan(0);

      const targetNode = queryRes.matches.find((m) => m.name === fnName);
      expect(targetNode).toBeDefined();
      if (targetNode) {
        expect(line).toBeGreaterThanOrEqual(targetNode.lineStart);
        expect(line).toBeLessThanOrEqual(targetNode.lineEnd);
      }
    });
  });

  // SCENARIO 3: Cross-Module Architectural Trace
  describe("Scenario 3: Cross-Module Architectural Trace", () => {
    it("should trace connection from CLI entrypoint to Core Engine", () => {
      const trace = queryEngine.trace("src/cli.ts", "src/core/query.ts");
      expect(trace.pathFound).toBe(true);
      expect(trace.steps.length).toBeGreaterThanOrEqual(2);
      expect(trace.summary).toContain("Connection Path");
    });
  });

  // SCENARIO 4: Ambiguity Defense Stress Matrix (10 Personas)
  describe("Scenario 4: Ambiguity Defense Matrix Across 10 User Personas", () => {
    const testMatrix = [
      { prompt: "benerin dong bg error gbs run", expectedClear: false, expectedIntent: "bugfix" },
      { prompt: "eh knp kok gini ya pas gw test", expectedClear: false, expectedIntent: "test" },
      { prompt: "fix this bug plz", expectedClear: false, expectedIntent: "bugfix" },
      { prompt: "buatkan backend ecommerce lengkap ada payment", expectedClear: false, expectedIntent: "feature" },
      { prompt: "tolong fix error compile di src/core/parser.ts", expectedClear: true, expectedIntent: "bugfix" },
      { prompt: "inspect caller dari `calculateBlastRadius`", expectedClear: true, expectedIntent: "research" },
      { prompt: "gimana cara kerjanya?", expectedClear: false, expectedIntent: "question" },
      { prompt: "audit security dan cari vulnerability di src/core/parser.ts", expectedClear: true, expectedIntent: "security" },
      { prompt: "buatkan unit test untuk `calculateBlastRadius` di src/core/query.ts", expectedClear: true, expectedIntent: "test" },
      { prompt: "refactor nama fungsi di src/core/parser.ts dan perbaiki imports", expectedClear: true, expectedIntent: "refactor" },
    ];

    for (let i = 0; i < testMatrix.length; i++) {
      const item = testMatrix[i];
      it(`Persona ${i + 1}: "${item.prompt.slice(0, 30)}..." should classify intent=${item.expectedIntent} and isClear=${item.expectedClear}`, () => {
        const report = ambiguityGuard.evaluate(item.prompt);
        expect(report.intent).toBe(item.expectedIntent as any);
        expect(report.isClear).toBe(item.expectedClear);
        if (!report.isClear) {
          expect(report.suggestedClarifications.length).toBeGreaterThan(0);
        }
      });
    }
  });

  // SCENARIO 5: Surgical Slicing vs Full File Ingestion
  describe("Scenario 5: Surgical Slicing Precision", () => {
    it("should extract only the target function without surrounding file bloat", () => {
      const slice = slicer.sliceSymbol("parseSourceFile");
      expect(slice).not.toBeNull();
      if (!slice) return;

      expect(slice.symbolName).toBe("parseSourceFile");
      expect(slice.lineEnd - slice.lineStart).toBeLessThan(40);
      expect(slice.code).toContain("export function parseSourceFile");
      // Must not contain unrelated helper functions
      expect(slice.code).not.toContain("findPythonBlockEnd");
    });
  });

  // SCENARIO 6: Scope Boundary Enforcement
  describe("Scenario 6: Scope Boundary Security Enforcement", () => {
    it("should allow changes strictly within authorized files", () => {
      const check = scopeGuard.validate(
        ["src/core/parser.ts", "src/core/query.ts"],
        ["src/core/parser.ts"]
      );
      expect(check.isCompliant).toBe(true);
      expect(check.violations.length).toBe(0);
    });

    it("should block and flag attempts to modify outside authorized files", () => {
      const check = scopeGuard.validate(
        ["src/core/parser.ts"],
        ["src/core/parser.ts", "package.json", "/etc/passwd"]
      );
      expect(check.isCompliant).toBe(false);
      expect(check.violations.length).toBe(2);
      expect(check.warningMessage).toContain("[SCOPE VIOLATION]");
    });
  });

  // SCENARIO 7: Monorepo Multi-Language AST Parsing
  describe("Scenario 7: Multi-Language AST Verification", () => {
    it("should parse Python functions, classes, and imports deterministically", () => {
      const pyCode = `
import os
from math import sqrt

class Calculator(BaseCalc):
    def calculate(self, x, y):
        return x + y

def standalone_helper():
    pass
      `;
      const res = parseSourceFile("calc.py", pyCode);
      expect(res.nodes.some((n) => n.name === "Calculator" && n.type === "class")).toBe(true);
      expect(res.nodes.some((n) => n.name === "calculate" && (n.type === "function" || n.type === "method"))).toBe(true);
      expect(res.nodes.some((n) => n.name === "standalone_helper")).toBe(true);
      expect(res.edges.some((e) => e.type === "imports")).toBe(true);
    });

    it("should parse Go functions, structs, and methods deterministically", () => {
      const goCode = `
package main

import "fmt"

type Server struct {
    port int
}

func (s *Server) Start() error {
    return nil
}

func Helper() {
}
      `;
      const res = parseSourceFile("server.go", goCode);
      expect(res.nodes.some((n) => n.name === "Start" && n.type === "method")).toBe(true);
      expect(res.nodes.some((n) => n.name === "Helper" && n.type === "function")).toBe(true);
    });
  });

  // SCENARIO 9: Real agent-toolkit monorepo test
  describe("Scenario 9: Real-World Rust Workspace AST Indexing", () => {
    it("should index agent-toolkit if present without crash", () => {
      const agentToolkitPath = "/opt/ai-workspace/projects/agent-toolkit";
      if (existsSync(agentToolkitPath)) {
        const indexer = new GraphIndexer(agentToolkitPath);
        const graph = indexer.index();
        expect(graph.stats.totalFiles).toBeGreaterThan(50);
        expect(graph.stats.totalNodes).toBeGreaterThan(500);
        expect(graph.stats.languages["rs"]).toBeGreaterThan(50);
      }
    });
  });

  // SCENARIO 10: Real omp-adapter service test
  describe("Scenario 10: Real-World TypeScript Service AST Indexing", () => {
    it("should index omp-adapter if present without crash", () => {
      const ompPath = "/opt/ai-workspace/services/omp-adapter";
      if (existsSync(ompPath)) {
        const indexer = new GraphIndexer(ompPath);
        const graph = indexer.index();
        expect(graph.stats.totalFiles).toBeGreaterThan(0);
        expect(graph.stats.languages["ts"]).toBeGreaterThan(0);
      }
    });
  });

  // SCENARIO 11: Dead Code / Orphan Symbol Detection
  describe("Scenario 11: Dead Code & Orphan Symbol Detection", () => {
    it("should identify unused functions and estimate token savings", () => {
      const indexer = new GraphIndexer(resolve(__dirname, ".."));
      const graph = indexer.index();
      const engine = new GraphQueryEngine(graph);
      const report = engine.findDeadCode();

      expect(report).toBeDefined();
      expect(Array.isArray(report.orphanSymbols)).toBe(true);
      expect(report.potentialTokenWastagePerPrompt).toBeGreaterThanOrEqual(0);
      expect(report.summary).toContain("Dead Code");
    });
  });

  // SCENARIO 12: Git Diff Blast Radius Analysis
  describe("Scenario 12: Git Diff Blast Radius & Impact Analysis", () => {
    it("should parse unified diff and compute impacted symbols and targeted tests", () => {
      const indexer = new GraphIndexer(resolve(__dirname, ".."));
      const graph = indexer.index();
      const engine = new GraphQueryEngine(graph);

      const fakeDiff = `
diff --git a/src/core/query.ts b/src/core/query.ts
index 1234567..89abcdef 100644
--- a/src/core/query.ts
+++ b/src/core/query.ts
@@ -25,3 +25,7 @@ export class GraphQueryEngine {
+  // Added new method
+  public newFeature() {}
      `;

      const report = engine.analyzeDiff(fakeDiff);
      expect(report.changedFiles).toContain("src/core/query.ts");
      expect(report.blastRadius).toBeDefined();
      expect(report.summary).toContain("Git Diff Impact");
    });
  });

  // SCENARIO 13: Offline Interactive HTML Visualizer Export
  describe("Scenario 13: Interactive HTML Visualizer Export", () => {
    it("should generate self-contained HTML architecture graph", () => {
      const indexer = new GraphIndexer(resolve(__dirname, ".."));
      const graph = indexer.index();
      const engine = new GraphQueryEngine(graph);

      const testHtmlPath = resolve(__dirname, "../scratch/test-vis.html");
      const savedPath = engine.exportInteractiveHtml(testHtmlPath);

      expect(existsSync(savedPath)).toBe(true);
      const content = readFileSync(savedPath, "utf-8");
      expect(content).toContain("Token-Guard Interactive Architecture Visualizer");
      expect(content).toContain("<canvas id=\"canvas\">");
      expect(content).toContain("const nodes =");
    });
  });
});
