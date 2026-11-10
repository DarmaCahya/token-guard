// Held-out two-level impact question on gin @ 0f09c3a9b4626d9fe9979cf4d0521d6ae32ab646 (a different repo from the
// one the tool was tuned on). Key verified by grep with each call site mapped to its enclosing declaration.
import type { AbTask } from "./tasks.ts";

const SUFFIX =
  " Answer with two lists: level 1 = functions that directly call it, level 2 = functions that call those level-1 functions (call sites only, non-test code). Function names only.";

export const TASKS: AbTask[] = [
  {
    id: "g1-istrustedproxy",
    prompt: "In gin's gin.go, if I change isTrustedProxy, what is affected?" + SUFFIX,
    expect: ["isunsafetrustedproxies", "validateheader", "clientip", "loggerwithconfig", "runtls", "rununix", "runfd", "runquic", "runlistener"],
  },
];
