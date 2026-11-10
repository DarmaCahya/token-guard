/** Rough token estimate (~4 chars/token); good enough to enforce output budgets, not to bill. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Join `blocks` until the estimated token budget is reached. Always keeps the first block so a
 * result is never empty, and reports how many blocks were left out so the caller can paginate.
 */
export function fitBlocks(blocks: string[], maxTokens: number): { text: string; shown: number } {
  let used = 0;
  const kept: string[] = [];
  for (const block of blocks) {
    const cost = approxTokens(block);
    if (kept.length > 0 && used + cost > maxTokens) break;
    kept.push(block);
    used += cost;
  }
  return { text: kept.join("\n"), shown: kept.length };
}
