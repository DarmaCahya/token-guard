# AGENTS.md - Token-Guard Protocol

All AI agents operating in this repository MUST comply with the following 3 rules to maintain token efficiency and code integrity.

---

## 🛡️ Rule 1: Use the Graph for Multi-File Questions
**Avoid reading entire files into context when a symbol-level answer is enough.**
For a single exact name, plain `grep` is cheaper and fine (measured: the graph tools did not beat grep on single-symbol lookups). Use the graph for "who calls X", "what breaks if I change X", and tracing across modules.
Before inspecting or modifying code:
1. Run `token-guard query <symbol>` to pinpoint where a function or interface lives.
2. Run `token-guard trace --from <A> --to <B>` to understand dependency relationships.
3. Run `token-guard slice <file> --symbol <name>` to read ONLY the relevant 10-25 lines.

---

## ⚡ Rule 2: Ambiguity Gatekeeper
If user input is ambiguous (e.g. *"tolong benerin error"*, *"ada bug"* without file/stacktrace):
1. **DO NOT guess or write speculative essays.**
2. Run `token-guard check-intent "<input>"`.
3. If `isClear: false`, halt immediately and ask 2-3 structured clarification questions.

---

## 🎯 Rule 3: Surgical Scope Enforcement
**Zero Collateral Damage Policy:**
1. AI is strictly prohibited from touching files outside the user's explicit request.
2. Run `token-guard check-scope --allowed <files> --attempted <files>` before applying any edit.
3. No unsolicited refactoring, cleanups, or formatting of unrelated code.
