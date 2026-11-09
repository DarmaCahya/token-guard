#!/usr/bin/env bun
/**
 * Agent-Toolkit Lite (Synthesized via Token-Guard Surgical Context)
 *
 * Implements:
 * 1. Windowed Document Extraction (inspired by `pdf-agent`)
 * 2. Vector SVG Sparkline Generation (inspired by `agent-canvas`)
 */

export interface WindowingOptions {
  pageStart?: number;
  pageLimit?: number;
  maxChars?: number;
}

export class DocumentWindowExtractor {
  public static extract(rawContent: string, options: WindowingOptions = {}): string {
    const pages = rawContent.split("\f"); // form-feed as page separator
    const start = options.pageStart ? Math.max(1, options.pageStart) - 1 : 0;
    const limit = options.pageLimit || pages.length;
    const selected = pages.slice(start, start + limit).join("\n\n---\n\n");

    if (options.maxChars && selected.length > options.maxChars) {
      return selected.slice(0, options.maxChars) + `\n\n[TRUNCATED: Exceeded max_chars ${options.maxChars}]`;
    }
    return selected;
  }
}

export interface SparklineOptions {
  values: number[];
  width?: number;
  height?: number;
  strokeColor?: string;
  fill?: boolean;
}

export class SparklineGenerator {
  public static toSvg(options: SparklineOptions): string {
    const { values, width = 120, height = 32, strokeColor = "#3b82f6", fill = true } = options;
    if (values.length === 0) return `<svg width="${width}" height="${height}"></svg>`;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const padding = 2;

    const points = values.map((val, idx) => {
      const x = padding + (idx / Math.max(1, values.length - 1)) * (width - padding * 2);
      const normalizedY = (val - min) / range;
      const y = height - padding - normalizedY * (height - padding * 2);
      return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
    });

    const pathData = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

    let areaSvg = "";
    if (fill && points.length > 1) {
      const firstX = points[0].x;
      const lastX = points[points.length - 1].x;
      const bottomY = height - padding;
      const areaPath = `${pathData} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
      areaSvg = `<path d="${areaPath}" fill="${strokeColor}" fill-opacity="0.15" />`;
    }

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${areaSvg}
  <path d="${pathData}" fill="none" stroke="${strokeColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="${points[points.length - 1].x}" cy="${points[points.length - 1].y}" r="2.5" fill="${strokeColor}" />
</svg>`.trim();
  }
}

// CLI Testing Runner
if (import.meta.main) {
  console.log("=== Agent-Toolkit Lite (Generated via Token-Guard) ===");
  const testData = [12, 18, 14, 25, 22, 38, 30, 45, 52, 48, 65];
  const svg = SparklineGenerator.toSvg({ values: testData, width: 140, height: 36, strokeColor: "#10b981", fill: true });
  console.log("Generated SVG Sparkline:\n", svg);
}
