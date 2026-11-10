import type { GraphEdge, GraphNode } from "./types.ts";
import { isTestFile } from "./rank.ts";

/** Names shared by more than this many symbols are too ambiguous to link by name alone. */
const MAX_AMBIGUOUS_TARGETS = 3;

const STRING_LITERAL = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`/g;
const IDENT = /[A-Za-z_$][\w$]*/g;

function bodyOf(node: GraphNode, lines: string[]): string {
  const slice = lines.slice(node.lineStart - 1, node.lineEnd);
  if (slice.length === 0) return "";
  // Drop the signature part of the first line so a function does not "call" itself via its own header.
  const brace = slice[0]!.indexOf("{");
  slice[0] = brace >= 0 ? slice[0]!.slice(brace + 1) : "";
  const out: string[] = [];
  for (const raw of slice) {
    const t = raw.trim();
    if (t.startsWith("//") || t.startsWith("#") || t.startsWith("*") || t.startsWith("/*")) continue;
    out.push(raw.replace(STRING_LITERAL, '""').replace(/\/\/.*$/, ""));
  }
  return out.join("\n");
}

/** Parameter / receiver names from a signature, so locals that shadow globals are not linked. */
function paramNames(signature: string | undefined): Set<string> {
  const names = new Set<string>();
  if (!signature) return names;
  for (const group of signature.matchAll(/\(([^()]*)\)/g)) {
    for (const seg of group[1]!.split(",")) {
      const t = seg.trim().replace(/^\.\.\./, "").replace(/^(?:mut|readonly|public|private|protected)\s+/, "");
      if (!t) continue;
      const colon = t.indexOf(":");
      const head = (colon >= 0 ? t.slice(0, colon) : t.split(/\s+/)[0]!).replace(/[?*&=].*$/, "").replace(/^\$/, "");
      if (/^[A-Za-z_]\w*$/.test(head)) names.add(head);
    }
  }
  return names;
}

/** Names declared inside a body (`x :=`, `var x`, `let x`, `x = ...` for Python/PHP-less langs, `for x in`). */
function localNames(body: string): Set<string> {
  const names = new Set<string>();
  for (const m of body.matchAll(/\b([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*:=/g)) for (const n of m[1]!.split(",")) names.add(n.trim());
  for (const m of body.matchAll(/\b(?:var|let|const|mut)\s+([A-Za-z_]\w*)/g)) names.add(m[1]!);
  for (const m of body.matchAll(/^\s+([a-z_]\w*)\s*=[^=]/gm)) names.add(m[1]!);
  for (const m of body.matchAll(/\bfor\s+([A-Za-z_]\w*)(?:\s*,\s*([A-Za-z_]\w*))?\s+(?:in|:=)/g)) { names.add(m[1]!); if (m[2]) names.add(m[2]); }
  return names;
}

/**
 * Adds language-agnostic `calls` / `references` edges by resolving identifiers inside each
 * function/method body against known symbol names. Heuristic (no type resolution): ambiguous names
 * prefer same-file symbols, then production over test code, and are skipped when still too ambiguous.
 */
export function linkRelations(
  nodes: Record<string, GraphNode>,
  contents: Map<string, string[]>,
  edges: GraphEdge[]
): void {
  const byName = new Map<string, GraphNode[]>();
  for (const n of Object.values(nodes)) {
    if (n.type === "file") continue;
    const list = byName.get(n.name);
    if (list) list.push(n);
    else byName.set(n.name, [n]);
  }

  const seen = new Set<string>();
  for (const caller of Object.values(nodes)) {
    const isVar = caller.type === "variable";
    if (caller.type !== "function" && caller.type !== "method" && !isVar) continue;
    const lines = contents.get(caller.file);
    if (!lines) continue;
    // Package-level initializers (`var x = pkg.New()`, `const y = f()`) call things too.
    const eq = isVar ? (caller.signature ?? "").indexOf("=") : -1;
    if (isVar && eq < 0) continue;
    const body = isVar ? (caller.signature ?? "").slice(eq + 1).replace(STRING_LITERAL, '""') : bodyOf(caller, lines);
    const callerIsTest = isTestFile(caller.file);
    const locals = isVar ? new Set<string>() : new Set([...paramNames(caller.signature), ...localNames(body)]);

    IDENT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IDENT.exec(body)) !== null) {
      const cands = byName.get(m[0]);
      if (!cands) continue;
      const isCall = /^\s*\(/.test(body.slice(IDENT.lastIndex, IDENT.lastIndex + 8));
      const isMember = m.index > 0 && body[m.index - 1] === ".";
      // A bare identifier that is a parameter/local shadows any global of the same name.
      if (!isCall && !isMember && locals.has(m[0])) continue;

      let pool = cands.filter((c) => c.id !== caller.id);
      const sameFile = pool.filter((c) => c.file === caller.file);
      if (sameFile.length > 0) pool = sameFile;
      else if (!callerIsTest) {
        const prod = pool.filter((c) => !isTestFile(c.file));
        if (prod.length > 0) pool = prod;
      }
      if (pool.length === 0 || pool.length > MAX_AMBIGUOUS_TARGETS) continue;

      for (const target of pool) {
        const callable = target.type === "function" || target.type === "method";
        if (callable && !isCall) continue;
        const type = callable ? "calls" : "references";
        const key = `${caller.id}>${target.id}>${type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source: caller.id, target: target.id, type });
      }
    }
  }
}
