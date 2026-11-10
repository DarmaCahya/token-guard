// A/B for the `agy` CLI (Gemini). agy only supports persistent global MCP config, so arms run in
// phases: baseline first (no MCP), then the token-guard MCP is added, guard arm runs, MCP is removed.
// Usage: bun scripts/ab/run-agy.ts <corpusA> <corpusB(indexed)> [runs=3] [out=scratch/ab-agy] [model]
import { TASKS } from "./tasks.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [dirA, dirB, runsArg, outArg, modelArg] = process.argv.slice(2);
if (!dirA || !dirB) throw new Error("usage: run-agy.ts <corpusA> <corpusB> [runs] [out] [model]");
const RUNS = Number(runsArg ?? 3);
const OUT = resolve(outArg ?? "scratch/ab-agy");
const MODEL = modelArg ?? "gemini-3.8-flash-medium";
const MCP = resolve(import.meta.dir, "../../src/mcp.ts");
const NAME = "token-guard-ab";
mkdirSync(OUT, { recursive: true });

const GUARD_HINT =
  " (Token-Guard MCP tools such as graph_query, graph_trace, graph_slice are available; prefer them to locate symbols and read only the needed lines.)";

type Arm = "baseline" | "guard";
interface Row {
  arm: Arm; task: string; run: number; pass: boolean; tokens: number; input: number;
  cacheRead: number; output: number; thinking: number; turns: number; ms: number; answer: string; error?: string;
}

async function once(arm: Arm, task: (typeof TASKS)[number], run: number): Promise<Row> {
  const prompt = task.prompt + (arm === "guard" ? GUARD_HINT : "");
  const t0 = Date.now();
  // Per-session, read-only allow rules (not saved). Guard arm additionally may call its MCP tools.
  const allow = ["command(grep)", "command(cat)", "command(ls)", "command(find)", "command(head)", "command(sed)"];
  if (arm === "guard") allow.push("mcp(*)");
  const p = Bun.spawn(["agy", "-p", prompt, "--model", MODEL, "--output-format", "json", "--print-timeout", "240s",
    "--settings", JSON.stringify({ permissions: { allow } })],
    { cwd: arm === "guard" ? dirB : dirA, stdout: "pipe", stderr: "pipe" });
  const [txt] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  const base = { arm, task: task.id, run, ms: Date.now() - t0 };
  try {
    const j = JSON.parse(txt);
    const u = j.usage ?? {};
    const answer: string = j.response ?? "";
    const lower = answer.toLowerCase();
    return {
      ...base, pass: j.status === "SUCCESS" && !j.denied_actions?.length && task.expect.every((e) => lower.includes(e)),
      input: u.input_tokens ?? 0, cacheRead: u.cache_read_tokens ?? 0, output: u.output_tokens ?? 0,
      thinking: u.thinking_tokens ?? 0, tokens: u.total_tokens ?? 0, turns: j.num_turns ?? 0, answer,
    };
  } catch (e) {
    return { ...base, pass: false, tokens: 0, input: 0, cacheRead: 0, output: 0, thinking: 0, turns: 0, answer: "", error: String(e) + txt.slice(0, 200) };
  }
}

const rows: Row[] = [];
async function phase(arm: Arm) {
  const jobs: (() => Promise<Row>)[] = [];
  for (let r = 1; r <= RUNS; r++) for (const t of TASKS) jobs.push(() => once(arm, t, r));
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < jobs.length) {
      const row = await jobs[next++]!();
      rows.push(row);
      writeFileSync(resolve(OUT, "results.json"), JSON.stringify(rows, null, 2));
      console.log(`${row.arm.padEnd(8)} ${row.task} r${row.run} pass=${row.pass} tok=${row.tokens} turns=${row.turns}`);
    }
  }));
}

await phase("baseline");
try {
  await Bun.spawn(["agy", "mcp", "add", NAME, "bun", MCP], { stdout: "inherit", stderr: "inherit" }).exited;
  await phase("guard");
} finally {
  await Bun.spawn(["agy", "mcp", "remove", NAME], { stdout: "inherit", stderr: "inherit" }).exited;
}
console.log("done ->", resolve(OUT, "results.json"));
