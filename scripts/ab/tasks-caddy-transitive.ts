// Two-level ("callers of callers") impact questions on caddy @ 9ea3108377d2abec102866808133c40ac9582162.
// Ground truth verified by grep (call sites only; comments, definitions and tests excluded) and by mapping each
// call site to its enclosing func. Function-value references (e.g. RegisterDirective("route", parseRoute)) are
// not calls and are not expected. x04 was corrected after the first run: its original key wrongly listed
// AppDataDir/InstanceID/openDatabase (a line->function mapping error); both arms failed it for that reason. Pass = every expected name appears in the answer (case-insensitive).
import type { AbTask } from "./tasks.ts";

const SUFFIX =
  " Answer with two lists: level 1 = functions that directly call it, level 2 = functions that call those level-1 functions (call sites only, non-test code). Function names only.";

export const TASKS: AbTask[] = [
  {
    id: "x01-homedirunsafe",
    prompt: "In caddy's storage.go, if I change homeDirUnsafe, what is affected?" + SUFFIX,
    expect: ["homedir", "appdatadir", "printenvironment", "instanceid", "loadenvfromfile", "opendatabase", "provision"],
  },
  {
    id: "x02-stopadminserver",
    prompt: "In caddy's admin.go, if I change stopAdminServer, what is affected?" + SUFFIX,
    expect: ["exitprocess", "replacelocaladminserver", "replaceremoteadminserver", "exitprocessfromsignal", "handlestop", "provisioncontext", "finishsettingup"],
  },
  {
    id: "x03-buildsubroute",
    prompt: "In caddy's caddyconfig/httpcaddyfile/httptype.go, if I change buildSubroute, what is affected?" + SUFFIX,
    expect: ["parsesegmentassubroute", "serversfrompairings", "parsehandle", "parsehandleerrors", "extractnamedroutes", "finalizeunmarshalcaddyfile", "parsecaddyfilehandlepath"],
  },
  {
    id: "x04-appconfigdir",
    prompt: "In caddy's storage.go, if I change AppConfigDir, what is affected?" + SUFFIX,
    expect: ["configautosavepath", "loadenvfromfile", "printenvironment", "handleenvfileflag", "cmdrun", "cmdenviron"],
  },
];
