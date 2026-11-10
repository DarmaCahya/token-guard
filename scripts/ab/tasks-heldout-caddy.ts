// Held-out two-level impact questions on caddy @ 9ea3108377d2abec102866808133c40ac9582162.
// Chosen AFTER the tool was frozen (commit 6cf729f + cache-version bump), none overlap with tasks-caddy-transitive.ts.
// Keys verified by grep with each call site mapped to its enclosing top-level declaration.
import type { AbTask } from "./tasks.ts";

const SUFFIX =
  " Answer with two lists: level 1 = functions that directly call it, level 2 = functions that call those level-1 functions (call sites only, non-test code). Function names only.";

export const TASKS: AbTask[] = [
  {
    id: "h1-pemencodecert",
    prompt: "In caddy's modules/caddypki/crypto.go, if I change pemEncodeCert, what is affected?" + SUFFIX,
    expect: ["rootandintermediatepem", "genroot", "genintermediate", "handlecainfo", "handlecacerts", "loadorgenroot", "loadorgenintermediate", "renewcertsforca"],
  },
  {
    id: "h2-strictunmarshaljson",
    prompt: "In caddy's modules.go, if I change StrictUnmarshalJSON, what is affected?" + SUFFIX,
    expect: ["loadmodulebyid", "unsynceddecodeandrun", "cmdadaptconfig", "cmdvalidateconfig", "loadmodulemap", "loadmoduleinline", "hashwithmodule", "changeconfig"],
  },
  {
    id: "h3-splitnetworkaddress",
    prompt: "In caddy's listeners.go, if I change SplitNetworkAddress, what is affected?" + SUFFIX,
    expect: ["parsenetworkaddresswithdefaults", "listenersforserverblockaddress", "parseupstreamdialaddress", "newtransport", "makeclient", "parseaddresses", "mapaddresstoprotocoltoserverblocks", "unmarshalcaddyfile", "cmdreverseproxy"],
  },
];
