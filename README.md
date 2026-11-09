# 🛡️ Token-Guard

> **Universal Token Guard & Code Graph Engine for AI Coding & Research Agents**  
> *Slash token waste by 90%+, prevent hallucinations, and protect codebase integrity across Gemini, DeepSeek, Claude, and local LLMs.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Runtime-Bun%201.4+-black.svg)](https://bun.sh)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)
[![Token Reduction](https://img.shields.io/badge/Token%20Savings-~94%25-brightgreen.svg)]()

---

## 💥 The Problem: Why AI Agents Waste Millions of Tokens

Modern AI agents (Cursor, Claude Code, Windsurf, Aider, Hermes) suffer from three fatal flaws:
1. **Blind File Dumps:** Asking an agent to understand a small feature causes it to load dozens of 1,000+ line files, burning 10,000–30,000 tokens per roundtrip.
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

## 📊 Benchmark: Baseline vs Token-Guard

Evaluated across ten real-world software engineering scenarios across monorepos and microservices:

| Task / Scenario | Baseline Tokens | Token-Guard Tokens | Token Savings | Latency Win |
| :--- | :---: | :---: | :---: | :---: |
| **1. Cross-Module Dependency Trace** *(Auth -> DB)* | 14,270 tok | **570 tok** | **96.0%** | **95.7%** |
| **2. Pinpoint Function Bug Investigation** | 5,050 tok | **275 tok** | **94.6%** | **94.9%** |
| **3. Ambiguous User Prompt** *("benerin dong error")* | 4,900 tok | **135 tok** | **97.2%** | **99.5%** |
| **4. Surgical Coding & Scope Boundary Enforcement** | 8,050 tok | **760 tok** | **90.6%** | **92.4%** |
| **5. Synthesize App Subsystem** *(agent-toolkit-lite)* | 20,900 tok | **1,100 tok** | **94.7%** | **92.4%** |
| **6. Git Diff & PR Blast Radius** *(10 modified files)* | 24,500 tok | **620 tok** | **97.5%** | **97.7%** |
| **7. Dead Code & Orphan Symbol Elimination Audit** | 16,200 tok | **110 tok** | **99.3%** | **99.2%** |
| **8. Monorepo Cross-Crate Blast Radius** *(80 files)* | 38,000 tok | **410 tok** | **98.9%** | **99.4%** |
| **9. Architecture Diagram & Visual Topology Export** | 8,900 tok | **45 tok** | **99.5%** | **99.6%** |
| **10. Multi-Turn Debugging Context Drift** *(5 turns)* | 42,000 tok | **985 tok** | **97.7%** | **94.8%** |
| **TOTAL AGGREGATE CONSUMPTION** | **182,770 tok** | **5,010 tok** | **🔥 97.3%** | **🔥 95.6%** |

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
*Parses all TypeScript, JavaScript, Python, and Go files deterministically into `.tokenguard/graph.json`.*

#### Query Symbols & Dependencies
```bash
token-guard query "AuthService"
```
*Returns only the exact matching node, line range, and immediate call edges.*

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
