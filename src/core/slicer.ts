import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CodeGraph, GraphNode } from "./types.ts";
import { rankNodes } from "./rank.ts";

export interface SliceResult {
  file: string;
  symbolName?: string;
  lineStart: number;
  lineEnd: number;
  totalLinesExtracted: number;
  code: string;
}

export class SurgicalSlicer {
  private rootDir: string;
  private graph?: CodeGraph;

  constructor(rootDir: string = process.cwd(), graph?: CodeGraph) {
    this.rootDir = resolve(rootDir);
    this.graph = graph;
  }

  /**
   * Slice a specific symbol directly by name
   */
  public sliceSymbol(symbolName: string, padding: number = 0, maxLines: number = 80, file?: string): SliceResult | null {
    if (!this.graph) return null;

    const candidates = rankNodes(
      Object.values(this.graph.nodes).filter(
        (n) => n.name.toLowerCase() === symbolName.toLowerCase() && n.type !== "file" && (!file || n.file.endsWith(file))
      ),
      symbolName
    );
    const node = candidates[0];
    if (!node) return null;

    const span = node.lineEnd - node.lineStart + 1;
    const end = span > maxLines ? node.lineStart + maxLines - 1 : node.lineEnd;
    const res = this.sliceRange(node.file, node.lineStart, end, padding, node.name);
    if (!res) return null;

    const notes: string[] = [];
    if (span > maxLines) notes.push(`… ${span - maxLines} more lines (${end + 1}-${node.lineEnd}); pass max_lines to see them`);
    const others = candidates.slice(1, 4).map((n) => `${n.file}:${n.lineStart}`);
    if (others.length) notes.push(`also defined in: ${others.join(", ")} (pass file to choose)`);
    if (notes.length) res.code += `\n${notes.join("\n")}`;
    return res;
  }

  /**
   * Slice specific line range from a file with padding
   */
  public sliceRange(
    relFilePath: string,
    startLine: number,
    endLine: number,
    padding: number = 2,
    symbolName?: string
  ): SliceResult | null {
    const absPath = resolve(this.rootDir, relFilePath);
    if (!existsSync(absPath)) {
      return null;
    }

    const lines = readFileSync(absPath, "utf-8").split("\n");
    const safeStart = Math.max(1, startLine - padding);
    const safeEnd = Math.min(lines.length, endLine + padding);

    const extracted = lines.slice(safeStart - 1, safeEnd);
    const formatted = extracted
      .map((line, idx) => {
        const lineNo = safeStart + idx;
        const pointer = lineNo >= startLine && lineNo <= endLine ? ">" : " ";
        return `${pointer} ${lineNo.toString().padStart(4, " ")} | ${line}`;
      })
      .join("\n");

    return {
      file: relFilePath,
      symbolName,
      lineStart: safeStart,
      lineEnd: safeEnd,
      totalLinesExtracted: extracted.length,
      code: formatted,
    };
  }
}
