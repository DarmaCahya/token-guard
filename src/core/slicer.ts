import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CodeGraph, GraphNode } from "./types.ts";

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
  public sliceSymbol(symbolName: string, padding: number = 2): SliceResult | null {
    if (!this.graph) return null;

    const node = Object.values(this.graph.nodes).find(
      (n) => n.name.toLowerCase() === symbolName.toLowerCase() && n.type !== "file"
    );

    if (!node) return null;

    return this.sliceRange(node.file, node.lineStart, node.lineEnd, padding, node.name);
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
