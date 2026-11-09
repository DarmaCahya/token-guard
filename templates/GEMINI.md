# GEMINI.md - Token-Guard Protocol for Gemini Models

When operating on codebases with Gemini 1.5/2.0/3.x:

1. **Efficiency First:**
   - Use `token-guard` CLI or MCP tools rather than broad file reads.
   - Query symbols via `token-guard query "<target>"` to minimize input context token overhead.

2. **Surgical Precision:**
   - Use `token-guard slice <file> --symbol <name>` to view only target function bodies.
   - Never output re-written versions of entire source files. Return unified diffs or pinpoint snippets only.

3. **Ambiguity Handling:**
   - If user request lacks specific files, methods, or reproduction steps, output 2-3 concise multiple-choice questions instead of guessing.
