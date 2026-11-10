// Multi-hop "who calls X / what must change if X changes" tasks on caddy @ 9ea3108377d2abec102866808133c40ac9582162
// (~77k LOC non-test Go). Ground truth = files containing a real call site, verified by grep with
// comments and definitions excluded. t08/t09 are negative controls (single-symbol lookups grep handles well).
import type { AbTask } from "./tasks.ts";

export const TASKS: AbTask[] = [
  { id: "m01-registerdirective", prompt: "I want to change the signature of RegisterDirective in caddyconfig/httpcaddyfile. List every non-test .go file that calls it (file paths only).", expect: ["httpcaddyfile/directives.go", "httpcaddyfile/builtins.go", "rewrite/caddyfile.go", "fileserver/caddyfile.go", "forwardauth/caddyfile.go", "fastcgi/caddyfile.go", "headers/caddyfile.go", "acmeserver/caddyfile.go"] },
  { id: "m02-extractmatcherset", prompt: "Which non-test .go files call the Helper method ExtractMatcherSet? List file paths only.", expect: ["httpcaddyfile/builtins.go", "httpcaddyfile/directives.go", "rewrite/caddyfile.go", "forwardauth/caddyfile.go", "fastcgi/caddyfile.go", "headers/caddyfile.go", "acmeserver/caddyfile.go"] },
  { id: "m03-newusagepool", prompt: "Which non-test .go files call NewUsagePool? List file paths only.", expect: ["logging.go", "listeners.go", "caddytls/connpolicy.go", "reverseproxy/hosts.go", "acmeserver/acmeserver.go"] },
  { id: "m04-appifconfigured", prompt: "If I rename the Context method AppIfConfigured, which non-test .go files need updating? List file paths only.", expect: ["caddytls/tls.go", "caddytls/connpolicy.go", "caddytls/acmeissuer.go", "caddytls/capools.go", "caddypki/adminapi.go"] },
  { id: "m05-sanitizedpathjoin", prompt: "Which non-test .go files call caddyhttp.SanitizedPathJoin (or SanitizedPathJoin)? List file paths only.", expect: ["fileserver/matcher.go", "fileserver/staticfiles.go", "fileserver/browsetplcontext.go", "fastcgi/fastcgi.go"] },
  { id: "m06-newresponserecorder", prompt: "Which non-test .go files call NewResponseRecorder? List file paths only.", expect: ["caddyhttp/server.go", "templates/templates.go", "caddyhttp/metrics.go", "logging/logappend.go", "intercept/intercept.go"] },
  { id: "m07-wrapcobra", prompt: "Which non-test .go files call WrapCommandFuncForCobra? List file paths only.", expect: ["cmd/commands.go", "cmd/cobra.go", "caddyauth/command.go", "reverseproxy/command.go", "caddyhttp/staticresp.go", "caddypki/command.go", "fileserver/command.go"] },
  { id: "c08-control-define", prompt: "In which file is AppDataDir defined and what type does it return? Answer briefly.", expect: ["storage.go", "string"] },
  { id: "c09-control-define", prompt: "In which file is NewUsagePool defined and what does it return? Answer briefly.", expect: ["usagepool.go", "*usagepool"] },
];
