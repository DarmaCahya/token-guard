import { resolve, relative } from "node:path";
import type { ScopeCheckReport } from "../core/types.ts";

export class ScopeGuard {
  private rootDir: string;

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = resolve(rootDir);
  }

  /**
   * Validates whether modified or accessed files are within the authorized scope.
   */
  public validate(allowedPatterns: string[], attemptedFiles: string[]): ScopeCheckReport {
    const violations: string[] = [];
    const normalizedAllowed = allowedPatterns.map((p) => this.normalizePath(p));

    for (const file of attemptedFiles) {
      const normalizedAttempt = this.normalizePath(file);
      const isAllowed = normalizedAllowed.some((pattern) => {
        if (pattern.endsWith("/*") || pattern.endsWith("/**")) {
          const dir = pattern.replace(/\/\*+$/, "");
          return normalizedAttempt.startsWith(dir);
        }
        return normalizedAttempt === pattern;
      });

      if (!isAllowed) {
        violations.push(normalizedAttempt);
      }
    }

    const isCompliant = violations.length === 0;
    const warningMessage = isCompliant
      ? undefined
      : `[SCOPE VIOLATION] Attempted modifications to unauthorized files: ${violations.join(", ")}. Only ${allowedPatterns.join(", ")} are authorized.`;

    return {
      isCompliant,
      allowedTargets: allowedPatterns,
      attemptedEdits: attemptedFiles,
      violations,
      warningMessage,
    };
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  }
}
