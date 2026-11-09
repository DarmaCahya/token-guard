import type { AmbiguityReport } from "../core/types.ts";

export class AmbiguityGuard {
  /**
   * Evaluates prompt clarity and extracts actionable targets.
   * Runs 100% locally with zero LLM tokens.
   */
  public evaluate(prompt: string): AmbiguityReport {
    const trimmed = prompt.trim();
    const words = trimmed.split(/\s+/).filter((w) => w.length > 0);

    // Heuristics:
    // 1. Extreme brevity without specific symbols/files
    // 2. High vagueness words (e.g., "benerin dong", "ada error", "help", "fix it", "make it better")
    // 3. Presence of file paths or function names
    const fileMatches = trimmed.match(/[a-zA-Z0-9_\-\.\/]+\.(?:ts|tsx|js|jsx|py|go|rs|toml|yaml|yml|json|md|html|css|sql|sh|php|c|cpp|proto)/g) || [];
    const symbolMatches = trimmed.match(/`([a-zA-Z0-9_:]+)`/g)?.map((s) => s.replace(/`/g, "")) || [];

    const vagueKeywordsIndo = [
      "benerin", "tolong", "error", "rusak", "gak bisa", "gbs", "perbaiki", "kok gini", 
      "gimana nih", "gmn", "buatkan fitur", "bikinin", "knp", "udh", "bg", "dong", "lah"
    ];
    const vagueKeywordsEng = [
      "fix", "broken", "help", "error", "doesn't work", "make better", "check this", "do something", "plz", "wip"
    ];

    const hasVagueKeyword = [...vagueKeywordsIndo, ...vagueKeywordsEng].some((k) =>
      trimmed.toLowerCase().includes(k)
    );

    let clarityScore = 1.0;
    const missingContext: string[] = [];
    const suggestedClarifications: string[] = [];

    if (fileMatches.length === 0 && symbolMatches.length === 0) {
      clarityScore -= 0.35;
      missingContext.push("Target file or symbol is unspecified");
    }

    if (hasVagueKeyword) {
      clarityScore -= 0.25;
      missingContext.push("Specific error message, stacktrace, or reproduction steps are missing");
    }

    if (words.length <= 6) {
      clarityScore -= 0.15;
    }

    if (trimmed.length < 20) {
      clarityScore -= 0.1;
    }

    clarityScore = Math.max(0.1, Math.min(1.0, clarityScore));
    const isClear = clarityScore >= 0.6;

    // Detect general intent - Priority: Domain-specific first, then generic actions
    let intent: AmbiguityReport["intent"] = "unknown";
    const lower = trimmed.toLowerCase();
    if (lower.includes("security") || lower.includes("keamanan") || lower.includes("vulnerability") || lower.includes("audit") || lower.includes("leak") || lower.includes("sanitize")) {
      intent = "security";
    } else if (lower.includes("test") || lower.includes("uji") || /\bspec\b/.test(lower) || lower.includes("benchmark")) {
      intent = "test";
    } else if (lower.includes("doc") || lower.includes("dokumentasi") || lower.includes("readme") || lower.includes("openapi") || lower.includes("swagger")) {
      intent = "doc";
    } else if (lower.includes("inspect") || lower.includes("cari") || lower.includes("research") || lower.includes("cek") || lower.includes("investigate") || lower.includes("analisis") || lower.includes("trace")) {
      intent = "research";
    } else if (lower.includes("fix") || lower.includes("benerin") || lower.includes("error") || lower.includes("bug") || lower.includes("panic")) {
      intent = "bugfix";
    } else if (lower.includes("add") || lower.includes("tambah") || lower.includes("fitur") || lower.includes("create") || lower.includes("buat")) {
      intent = "feature";
    } else if (lower.includes("refactor") || lower.includes("rapikan") || lower.includes("clean") || lower.includes("rename") || lower.includes("ganti nama")) {
      intent = "refactor";
    } else if (lower.includes("?") || lower.includes("apa") || lower.includes("bagaimana") || lower.includes("how")) {
      intent = "question";
    }

    if (!isClear) {
      suggestedClarifications.push(
        "Sebutkan nama file atau modul spesifik yang menjadi target.",
        "Sertakan log error atau perintah pemicu error (jika sedang memperbaiki bug).",
        "Pilih salah satu dari 2-3 opsi terarah sebelum agen melakukan eksekusi."
      );
    }

    return {
      clarityScore: Number(clarityScore.toFixed(2)),
      isClear,
      intent,
      detectedEntities: {
        targetFiles: fileMatches,
        targetSymbols: symbolMatches,
      },
      missingContext,
      suggestedClarifications,
    };
  }
}
