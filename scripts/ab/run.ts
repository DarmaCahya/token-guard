// Real A/B: baseline Claude vs Claude + token-guard MCP, same tasks, same model/effort.
// Usage: bun scripts/ab/run.ts <corpusA> <corpusB(indexed)> [runs=3] [out=scratch/ab]
import { TASKS } from "./tasks.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [dirA, dirB, runsArg, outArg] = process.argv.slice(2);
if (!dirA || !dirB) throw new Error("usage: run.ts <corpusA> <corpusB> [runs] [out]");
const RUNS = Number(runsArg ?? 3);
const OUT = resolve(outArg ?? "scratch/ab");
const MODEL = "claude-sonnet-5-5";
const MCP = resolve(import.meta.dir, "../../src/mcp.ts");
mkdirSync(OUT, { recursive: true });

const mcpCfg = resolve(OUT, "mcp.json");
writeFileSync(mcpCfg, JSON.stringify({ mcpServers: { "token-guard": { command: "bun", args: [MCP] } } }));

const GUARD_PROMPT =
  "Token-Guard MCP tools are available (graph_query, graph_trace, graph_blast, graph_slice). " +
  "Prefer them to locate symbols and read only the needed lines instead of reading whole files.";

type Arm = "baseline" | "guard";
interface Row {
  arm: Arm; task: string; run: number; pass: boolean; tokens: number; input: number;
  cacheRead: number; cacheCreate: number; output: number; cost: number; turns: number;
  ms: number; answer: string; error?: string;
}

async function once(arm: Arm, task: (typeof TASKS)[number], run: number): Promise<Row> {
  const args = [
    "-p", task.prompt, "--model", MODEL, "--effort", "medium", "--output-format", "json",
    "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence",
    "--permission-mode", "dontAsk", "--max-turns", "30", "--max-budget-usd", "2",
    "--tools", "Read,Grep,Glob",
  ];
  // Both arms are read-only (questions only). The guard arm additionally gets the token-guard MCP tools.
  args.push("--allowedTools", arm === "guard" ? "Read Grep Glob mcp__token-guard" : "Read Grep Glob");
  if (arm === "guard") args.push("--mcp-config", mcpCfg, "--append-system-prompt", GUARD_PROMPT);
  const t0 = Date.now();
  const p = Bun.spawn(["claude", ...args], { cwd: arm === "guard" ? dirB : dirA, stdout: "pipe", stderr: "pipe" });
  const [txt] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  const base = { arm, task: task.id, run, ms: Date.now() - t0 };
  try {
    const j = JSON.parse(txt);
    const u = j.usage ?? {};
    const answer: string = j.result ?? "";
    const lower = answer.toLowerCase();
    const input = u.input_tokens ?? 0;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheCreate = u.cache_creation_input_tokens ?? 0;
    const output = u.output_tokens ?? 0;
    return {
      ...base, pass: !j.is_error && task.expect.every((e) => lower.includes(e)),
      input, cacheRead, cacheCreate, output, tokens: input + cacheRead + cacheCreate + output,
      cost: j.total_cost_usd ?? 0, turns: j.num_turns ?? 0, answer,
    };
  } catch (e) {
    return { ...base, pass: false, tokens: 0, input: 0, cacheRead: 0, cacheCreate: 0, output: 0, cost: 0, turns: 0, answer: "", error: String(e) + txt.slice(0, 200) };
  }
}

// Interleave arms per task/run so drift (load, cache) hits both equally.
const jobs: (() => Promise<Row>)[] = [];
for (let r = 1; r <= RUNS; r++)
  for (const t of TASKS)
    for (const arm of (r % 2 ? ["baseline", "guard"] : ["guard", "baseline"]) as Arm[]) jobs.push(() => once(arm, t, r));

const rows: Row[] = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < jobs.length) {
    const row = await jobs[next++]!();
    rows.push(row);
    writeFileSync(resolve(OUT, "results.json"), JSON.stringify(rows, null, 2));
    console.log(`${row.arm.padEnd(8)} ${row.task} r${row.run} pass=${row.pass} tok=${row.tokens} $${row.cost.toFixed(3)} turns=${row.turns}`);
  }
}));
console.log("done ->", resolve(OUT, "results.json"));
