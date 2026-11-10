// Usage: bun scripts/ab/report.ts <results.json>
const rows: any[] = JSON.parse(await Bun.file(process.argv[2]!).text());
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const med = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2 : 0;
};
const arms = ["baseline", "guard"] as const;
const g = (arm: string) => rows.filter((r) => r.arm === arm);

console.log("| Metric | Baseline | + Token-Guard | Delta |\n|---|---:|---:|---:|");
const line = (name: string, f: (r: any[]) => number, fmt = (n: number) => n.toFixed(0)) => {
  const [a, b] = arms.map((x) => f(g(x)));
  console.log(`| ${name} | ${fmt(a!)} | ${fmt(b!)} | ${a ? (((b! - a) / a) * 100).toFixed(1) + "%" : "-"} |`);
};
line("Accuracy (pass %)", (r) => (sum(r.map((x) => +x.pass)) / r.length) * 100, (n) => n.toFixed(1));
line("Runs", (r) => r.length);
line("Median total tokens/run", (r) => med(r.map((x) => x.tokens)));
line("Median output tokens/run", (r) => med(r.map((x) => x.output)));
if (rows.some((r) => r.cost)) line("Mean cost USD/run", (r) => sum(r.map((x) => x.cost ?? 0)) / r.length, (n) => n.toFixed(4));
line("Median turns", (r) => med(r.map((x) => x.turns)));
line("Median latency s", (r) => med(r.map((x) => x.ms)) / 1000, (n) => n.toFixed(1));

console.log("\nPer task (median total tokens, pass count):\n| Task | Baseline | Guard |\n|---|---:|---:|");
for (const id of [...new Set(rows.map((r) => r.task))].sort()) {
  const c = (arm: string) => {
    const x = g(arm).filter((r) => r.task === id);
    return `${med(x.map((r) => r.tokens)).toFixed(0)} (${sum(x.map((r) => +r.pass))}/${x.length})`;
  };
  console.log(`| ${id} | ${c("baseline")} | ${c("guard")} |`);
}
