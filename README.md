# 🛡️ Token-Guard

> **Local code-graph MCP server and guardrails for AI coding agents**  
> *Answer "where is X / who calls X / what breaks if I change X" from a local index instead of reading files. Cost impact is measured, not assumed: see [Measured results](#-measured-results).*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Runtime-Bun%201.4+-black.svg)](https://bun.sh)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)

---

## 💥 The Problem: Why AI Agents Waste Millions of Tokens

Coding agents (Cursor, Claude Code, Windsurf, Aider, Hermes) commonly run into three problems:
1. **Broad file reads:** understanding a cross-file question can mean reading many large files into context, which is then re-billed on every later turn.
2. **Ambiguous Prompts:** When given vague instructions (*"tolong benerin error"*, *"help fix bug"*), LLMs panic, speculate wildly, and hallucinate massive irrelevant code essays.
3. **Collateral Damage (Scope Creep):** Agents frequently edit unrelated files, breaking configs or database schemas that were never meant to be touched.

---

## ⚡ The Solution: Token-Guard Architecture

Token-Guard provides a deterministic, zero-token local layer between your codebase and any LLM:

```
                            ┌────────────────────────────────────────┐
                            │            Developer / User            │
                            └───────────────────┬────────────────────┘
                                                │
                                                ▼
                                    [Ambiguity Gatekeeper]
                                    - Heuristic Intent Scorer
                                    - Zero-Token Prompt Triage
                                                │
                     ┌──────────────────────────┴──────────────────────────┐
                     │ (If prompt clear)                                   │ (If ambiguous)
                     ▼                                                     ▼
           ┌─────────────────────┐                               [Instant Clarification]
           │   AI Agent / LLM    │                               - Asks 2-3 focused options
           │ (Gemini, DeepSeek,  │                               - Halts 100% token burn
           │  Claude, Ollama)    │
           └─────────┬───────────┘
                     │
                     ▼
           ┌────────────────────────────────────────┐
           │          TOKEN-GUARD ENGINE            │
           │                                        │
           │  1. 0-Token AST Code Graph Indexer     │
           │  2. Sub-graph Traversal & Tracer       │
           │  3. Surgical Function Slicer           │
           │  4. Strict Scope Boundary Enforcer     │
           └────────────────────────────────────────┘
```

---

## 📊 Measured results

**Short version: on single-symbol lookups and one-hop "who calls X" questions, token-guard does not save money (plain `grep` is already as cheap). On two-level impact questions ("what is affected if I change X", callers of callers) in a ~77k LOC Go repo it cut cost by ~86% with equal accuracy, but that result is from 4 questions on one repo and has not been validated on held-out tasks.** Earlier versions of this README showed a 97% saving table; those numbers were constants in the benchmark code, never measured, and have been removed.

What was actually measured (A/B with the real agent, 10 read-only questions about the [gin](https://github.com/gin-gonic/gin) Go repo, ~8k LOC, commit `0f09c3a`; 3 runs per task per arm; arm A = agent alone with Read/Grep/Glob, arm B = same + token-guard MCP; Claude Sonnet 5.5, medium effort; answers graded by checking required facts):

| Version of token-guard | Accuracy A / B | Cost B vs A (mean, `total_cost_usd`) | Total tokens B vs A | B cheaper on |
| :--- | :---: | :---: | :---: | :---: |
| Original (defines-only graph) | 100% / 100% | +23% | +30% | 3 of 10 tasks |
| + call/reference edges, const/type indexing, ranking | 100% / 100% | +4% | +18% | 4 of 10 tasks |
| + output budgets, pagination, slice caps (current) | 100% / 100% | +38% | +21% | 1 of 10 tasks |

How to read this:
- **Never cheaper overall**, in any version. Accuracy is unchanged.
- **Version-to-version differences are not meaningful.** Per-run cost varies by roughly 50-70% (coefficient of variation) even within one arm, so 3 runs per task cannot separate +4% from +38%. Treat the cost penalty as "somewhere between roughly 0 and +40%".
- The `agy` CLI (Gemini 3.8 Flash) was measured only on the original version: about +115% tokens, accuracy 86.7% in both arms (4 of 30 runs per arm returned empty answers). Not re-measured on the current version.
- Why narrow lookups don't benefit: a plain `grep` already answers them in ~2-3 turns, and every tool result stays in the prompt cache and is re-read on later turns. An independent test of a similar tool (CodeGraph on Hono) found the same shape: fewer tool calls, lower token count, higher dollar cost.
- **Larger repo, "who calls X / what must change" questions** ([caddy](https://github.com/caddyserver/caddy) `9ea3107`, ~77k LOC Go; 7 impact questions + 2 single-symbol controls; 3 runs per task per arm; same setup): accuracy 100% / 100%, mean cost -3.7% (geometric-mean ratio 0.93, 95% bootstrap CI 0.71-1.14, so **no detectable difference**), total tokens +25%, turns unchanged (~3), cheaper on 4 of 9 tasks. Plain `grep` already answers "which files call X" in one call, so these questions were not hard enough to show an advantage.
- **Two-level impact questions on caddy** (`graph_blast`, depth 2; 4 questions such as "if I change `buildSubroute`, which functions are affected, directly and through their callers?"; 4 runs per task per arm; answer must name every function verified by grep): accuracy **100% / 100%**, mean cost **-86%** ($0.0374 to $0.0051 per run; geometric-mean ratio 0.14, bootstrap 95% CI 0.11-0.19), turns **~7 to 2**, output tokens -77%. `grep` needs 6-10 turns to chain callers of callers; one `graph_blast` call returns both levels with `file:line`.
  - *Read with care (first set):* only 4 questions, one repo, one model. The parser and `graph_blast` were fixed while diagnosing these same questions (multi-line signatures, string/rune braces, id collisions, package-level initializers), so the result is not held-out. A first run before those fixes scored 100% for grep but 50% for token-guard (it missed functions the parser had not indexed), and one answer key I wrote was wrong and was corrected afterwards; both are in the commit history. The guard arm also wrote almost nothing to the prompt cache in this run (715 vs 75,354 cache-write tokens), so part of the gap is cache behaviour, not only fewer turns.
- **Held-out check** (4 new two-level questions chosen after the tool was frozen: 3 on caddy with different functions, 1 on gin, a different repo; 4 runs per task per arm):
  - *Tool as frozen:* mean cost **-83%** (geometric-mean ratio 0.19, 95% CI 0.10-0.29), turns ~8 to ~2, but accuracy **100% (grep) vs 75% (token-guard)**: it failed one question 4/4 times, missing two callers. Cause: a Go signature containing `struct{}` made the parser end the function body early, so calls inside it were never recorded. That was a genuine recall bug.
  - *After fixing that bug* (separate commit; the question is no longer held-out for that bug): accuracy **93.8% (grep, one run missed a function) vs 100%**, mean cost **-85%** (ratio 0.16, 95% CI 0.11-0.23), turns ~8.8 to 2.0.
  - Failure mode to expect: when the parser misses a symbol, token-guard returns a confident but incomplete answer in 2 turns, while `grep` keeps searching. Edges are matched by name, not types, and the output says so.
- Still untested: questions the graph cannot resolve (interface implementers, dynamic dispatch), 100k+ LOC repos, languages other than Go, other models, and larger question sets (so far 8 distinct two-level questions across 2 repos).

Run it yourself (cost is real: roughly $0.3-0.4 per full Claude run):

```bash
# two copies of the repo; index only copy B
bun src/cli.ts index /path/to/repoB
bun scripts/ab/run.ts /path/to/repoA /path/to/repoB 3 scratch/ab
bun scripts/ab/report.ts scratch/ab/results.json
# Gemini via agy: bun scripts/ab/run-agy.ts ...
```

Known limits: regex parsers with no type resolution (e.g. Go interface dispatch breaks `graph_trace`); string-match grading; one repo; one model per CLI.

---

## 🚀 Quickstart

### 1. Installation

Run directly with [Bun](https://bun.sh):

```bash
# Clone the repository
git clone https://github.com/DarmaCahya/token-guard.git
cd token-guard

# Install dependencies
bun install

# Link CLI globally (optional)
bun link
```

---

### 2. CLI Usage (Universal for Any Terminal AI / Aider / Gemini CLI)

#### Index Codebase (0 API Tokens)
```bash
token-guard index
```
*Parses TypeScript, JavaScript, Python, Go, Rust and PHP files (regex-based, no type resolution) into `.tokenguard/graph.json`: symbols (functions, methods, classes, types, constants) plus `calls` / `references` / `imports` edges.*

#### Query Symbols & Dependencies
```bash
token-guard query "AuthService"
```
*Returns ranked matches (production code before tests) with `file:lines`, signature, what each symbol uses and what uses it. Output is budgeted: `limit`, `offset`, `max_tokens`.*

#### Trace Dependency Paths
```bash
token-guard trace --from "AuthController" --to "DatabasePool"
```
*Finds the shortest dependency chain without reading intermediate files.*

#### Blast Radius & Refactoring Impact Analysis
```bash
token-guard blast "AuthService"
```
*Computes direct dependents, ripple effects, impacted files, and criticality score before editing.*

#### Dead Code & Orphan Symbol Detection
```bash
token-guard dead-code
```
*Finds unused symbols with 0 incoming references across the workspace to eliminate dead token bloat.*

#### Git Diff & PR Impact Analysis
```bash
token-guard diff-blast [optional_diff_file]
```
*Maps modified lines from git diff to AST symbols and suggests targeted unit tests to run.*

#### Interactive Offline HTML Architecture Visualizer
```bash
token-guard visualize [output.html]
```
*Generates an interactive, dark-mode SVG/canvas network explorer of your codebase (0 tokens, offline).*

#### Surgical Code Slicing
```bash
token-guard slice src/auth.ts --symbol "verifyToken"
```
*Outputs only the target function body (15–20 lines) instead of loading the entire file.*

#### Ambiguity Gatekeeper
```bash
token-guard check-intent "tolong benerin error pas login"
```
*Outputs JSON report with clarity score and structured clarification options.*

#### Scope Boundary Enforcement
```bash
token-guard check-scope --allowed "src/auth.ts" --attempted "src/auth.ts,src/db/schema.ts"
```
*Fails immediately with `[SCOPE VIOLATION]` if the agent attempts edits outside authorized boundaries.*

#### Run Benchmark Suite
```bash
token-guard benchmark
```

---

### 3. Model Context Protocol (MCP) Integration

Token-Guard natively implements MCP for **Claude Code, Cursor, Windsurf, Zed, and Hermes Agent**.

Add this to your MCP configuration (`mcp_config.json` / `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "token-guard": {
      "command": "bun",
      "args": ["run", "/path/to/token-guard/src/mcp.ts"]
    }
  }
}
```

Exposed MCP Tools:
- `graph_query`: Search symbols and relationships.
- `graph_trace`: Trace connection between two files or symbols.
- `graph_blast`: Calculate blast radius and ripple effect before code changes.
- `graph_slice`: Extract pinpoint function/class body.
- `graph_dead_code`: Detect orphan functions/classes wasting tokens.
- `graph_diff_blast`: Analyze git diff impact and suggested tests.
- `check_intent`: Pre-flight ambiguity triage.
- `check_scope`: Validate file modification boundaries.

---

### 4. Agent Rules Templates

Copy-paste ready rules for your favorite AI environments:
- [`templates/AGENTS.md`](templates/AGENTS.md) — Universal protocol for coding agents.
- [`templates/GEMINI.md`](templates/GEMINI.md) — Optimization rules for Gemini models.
- [`templates/.cursorrules`](templates/.cursorrules) — Configuration for Cursor & Windsurf.

---

## 🧪 Testing

```bash
bun test
```

---

## 📄 License

MIT License © 2026 [Darma Cahya](https://github.com/DarmaCahya). Built with precision for the autonomous AI developer community.
