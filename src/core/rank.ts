import type { GraphNode } from "./types.ts";

const TEST_FILE = /(^|\/)(tests?|__tests__|spec|testdata)\/|_test\.(go|py|rs|php)$|\.(test|spec)\.[jt]sx?$|(^|\/)test_[^/]+\.py$|Test\.php$/i;

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

/** Lower is better. Exact name < prefix < substring < signature/id match; production code before tests. */
export function scoreNode(node: GraphNode, term: string): number {
  const q = term.toLowerCase();
  const name = node.name.toLowerCase();
  let s: number;
  if (name === q || node.id.toLowerCase() === q || node.file.toLowerCase().endsWith(q)) s = 0;
  else if (name.startsWith(q)) s = 1;
  else if (name.includes(q)) s = 2;
  else if (node.id.toLowerCase().includes(q) || node.signature?.toLowerCase().includes(q)) s = 3;
  else return Infinity;
  if (isTestFile(node.file)) s += 10;
  // A file node only wins when the term looks like a path.
  if (node.type === "file" && !/[/.]/.test(term)) s += 5;
  return s;
}

export function rankNodes(nodes: Iterable<GraphNode>, term: string): GraphNode[] {
  return [...nodes]
    .map((n) => ({ n, s: scoreNode(n, term) }))
    .filter((x) => x.s !== Infinity)
    .sort((a, b) => a.s - b.s || a.n.name.length - b.n.name.length || a.n.file.localeCompare(b.n.file))
    .map((x) => x.n);
}
