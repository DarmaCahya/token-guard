#!/usr/bin/env bun
import { GraphIndexer } from "./core/indexer.ts";
import { GraphQueryEngine } from "./core/query.ts";
import { SurgicalSlicer } from "./core/slicer.ts";
import { AmbiguityGuard } from "./guards/ambiguity.ts";
import { ScopeGuard } from "./guards/scope.ts";

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
🛡️  TOKEN-GUARD (Universal Token Guard & Code Graph Engine)

Usage:
  token-guard index [dir]                     Index codebase to .tokenguard/graph.json (0 tokens)
  token-guard query <query>                   Query symbols or dependencies
  token-guard trace --from <src> --to <dst>   Trace dependency path between symbols/files
  token-guard inspect <symbol|file>           Inspect incoming/outgoing dependencies
  token-guard blast <symbol|file>             Calculate blast radius (impact analysis of changes)
  token-guard dead-code                       Detect orphan/unused symbols wasting prompt tokens
  token-guard diff-blast [diff_file]          Analyze git diff for impacted symbols and test scope
  token-guard visualize [output.html]         Generate offline interactive architecture HTML
  token-guard slice <file> --symbol <name>    Surgically extract only the requested symbol
  token-guard check-intent "<user_prompt>"    Evaluate ambiguity and get clarification options
  token-guard check-scope --allowed <paths>   Validate whether modified files are in-scope
  token-guard benchmark                       Show how to run the real A/B benchmark (measured, not simulated)
  token-guard mcp                             Start MCP Server via Stdio for AI clients
  `);
}

async function main() {
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const dirIdx = args.indexOf("--dir");
  const rootDir = dirIdx !== -1 ? args[dirIdx + 1] : process.cwd();

  switch (command) {
    case "index": {
      const targetDir = (dirIdx !== -1 ? args[dirIdx + 1] : args[1]) || rootDir;
      console.log(`[token-guard] Indexing codebase at: ${targetDir}`);
      const indexer = new GraphIndexer(targetDir);
      const graph = indexer.index();
      console.log(`✓ Index complete!`);
      console.log(`  - Files indexed: ${graph.stats.totalFiles}`);
      console.log(`  - Nodes extracted: ${graph.stats.totalNodes}`);
      console.log(`  - Edges resolved: ${graph.stats.totalEdges}`);
      console.log(`  - Cache written to: ${indexer.getCacheDir()}/graph.json`);
      break;
    }

    case "query": {
      const term = args[1];
      if (!term) {
        console.error("Error: Missing search term. Usage: token-guard query <term>");
        process.exit(1);
      }
      const indexer = new GraphIndexer(rootDir);
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      const res = engine.query(term);
      console.log(res.summary);
      break;
    }

    case "trace": {
      const fromIdx = args.indexOf("--from");
      const toIdx = args.indexOf("--to");
      if (fromIdx === -1 || toIdx === -1) {
        console.error("Error: Usage: token-guard trace --from <source> --to <target>");
        process.exit(1);
      }
      const fromQuery = args[fromIdx + 1];
      const toQuery = args[toIdx + 1];

      const indexer = new GraphIndexer(rootDir);
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      const res = engine.trace(fromQuery, toQuery);
      console.log(res.summary);
      break;
    }

    case "inspect": {
      const target = args[1];
      if (!target) {
        console.error("Error: Missing target to inspect. Usage: token-guard inspect <symbol|file>");
        process.exit(1);
      }
      const indexer = new GraphIndexer(rootDir);
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      console.log(engine.inspect(target));
      break;
    }

    case "blast": {
      const target = args[1];
      if (!target) {
        console.error("Error: Missing target for blast analysis. Usage: token-guard blast <symbol|file>");
        process.exit(1);
      }
      const indexer = new GraphIndexer(rootDir);
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      const report = engine.calculateBlastRadius(target);
      console.log(report.summary);
      break;
    }

    case "dead-code": {
      const indexer = new GraphIndexer(rootDir);
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      const report = engine.findDeadCode();
      console.log(report.summary);
      break;
    }

    case "diff-blast": {
      const diffFile = args[1];
      let diffText = "";
      if (diffFile && require("node:fs").existsSync(diffFile)) {
        diffText = require("node:fs").readFileSync(diffFile, "utf-8");
      } else {
        // Try reading from git diff directly in rootDir
        try {
          diffText = require("node:child_process").execSync("git diff HEAD~1 HEAD", { cwd: rootDir, encoding: "utf-8" });
        } catch {
          diffText = "";
        }
      }

      if (!diffText) {
        console.log("No git diff detected or diff is empty. Everything clean!");
        break;
      }

      const indexer = new GraphIndexer(rootDir);
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      const report = engine.analyzeDiff(diffText);
      console.log(report.summary);
      break;
    }

    case "visualize": {
      const outFile = args[1] || `${rootDir}/architecture-graph.html`;
      const indexer = new GraphIndexer(rootDir);
      const graph = indexer.load();
      const engine = new GraphQueryEngine(graph);
      const savedPath = engine.exportInteractiveHtml(outFile);
      console.log(`✓ Interactive architecture visualizer exported to: ${savedPath}`);
      console.log(`  Open it in your browser to explore nodes, blast radius, and dependencies offline (0 tokens).`);
      break;
    }

    case "slice": {
      const file = args[1];
      const symbolIdx = args.indexOf("--symbol");
      const symbolName = symbolIdx !== -1 ? args[symbolIdx + 1] : undefined;

      const indexer = new GraphIndexer(rootDir);
      const graph = indexer.load();
      const slicer = new SurgicalSlicer(rootDir, graph);

      if (symbolName) {
        const res = slicer.sliceSymbol(symbolName);
        if (!res) {
          console.error(`Symbol '${symbolName}' not found in code graph.`);
          process.exit(1);
        }
        console.log(`=== Surgical Slice: ${res.symbolName} (${res.file}:${res.lineStart}-${res.lineEnd}) ===`);
        console.log(res.code);
      } else {
        console.error("Error: Please provide --symbol <name>");
        process.exit(1);
      }
      break;
    }

    case "check-intent": {
      const prompt = args.slice(1).join(" ");
      if (!prompt) {
        console.error('Error: Missing prompt. Usage: token-guard check-intent "<prompt>"');
        process.exit(1);
      }
      const guard = new AmbiguityGuard();
      const report = guard.evaluate(prompt);
      console.log(JSON.stringify(report, null, 2));
      break;
    }

    case "check-scope": {
      const allowedIdx = args.indexOf("--allowed");
      const attemptedIdx = args.indexOf("--attempted");
      if (allowedIdx === -1 || attemptedIdx === -1) {
        console.error("Error: Usage: token-guard check-scope --allowed <files> --attempted <files>");
        process.exit(1);
      }
      const allowed = args[allowedIdx + 1].split(",").map((s) => s.trim());
      const attempted = args[attemptedIdx + 1].split(",").map((s) => s.trim());

      const guard = new ScopeGuard(rootDir);
      const res = guard.validate(allowed, attempted);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case "benchmark": {
      console.log(
        [
          "token-guard no longer ships simulated numbers. Measure it against your own agent:",
          "",
          "  bun scripts/ab/run.ts <repoCopyA> <repoCopyB-indexed> [runs=3] [outDir]   # Claude Code (claude -p)",
          "  bun scripts/ab/run-agy.ts <repoCopyA> <repoCopyB-indexed> [runs=3] [outDir] # agy / Gemini",
          "  bun scripts/ab/report.ts <outDir>/results.json",
          "",
          "Arm A = agent alone, arm B = agent + token-guard MCP. Compare dollar cost, not just tokens.",
        ].join("\n")
      );
      break;
    }

    case "mcp": {
      // Start MCP Server
      await import("./mcp.ts");
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
