// Ground truth verified against gin @ 0f09c3a9b4626d9fe9979cf4d0521d6ae32ab646 by grep.
// A run passes only if every `expect` substring (case-insensitive) appears in the final answer.
export interface AbTask { id: string; prompt: string; expect: string[] }

export const TASKS: AbTask[] = [
  { id: "t01-lookup", prompt: "In this Go repo, in which file is handleHTTPRequest defined, and which method on the tree node does it call to look up the handlers for the request path? Answer briefly.", expect: ["gin.go", "getvalue"] },
  { id: "t02-const", prompt: "In which file is the constant abortIndex defined and what is its numeric value? Answer briefly.", expect: ["context.go", "63"] },
  { id: "t03-refs", prompt: "List every non-test .go file in the repo ROOT package that references abortIndex. Answer briefly with file names only.", expect: ["context.go", "routergroup.go"] },
  { id: "t04-callers", prompt: "Which RouterGroup methods call calculateAbsolutePath (non-test code)? List the method names.", expect: ["group", "handle", "createstatichandler"] },
  { id: "t05-delegate", prompt: "What does Recovery() delegate to, and which argument does it pass? Answer briefly.", expect: ["recoverywithwriter", "defaulterrorwriter"] },
  { id: "t06-chain", prompt: "Trace the call chain from Context.ShouldBindJSON down to the function that actually runs the JSON decoder. Give function names and files.", expect: ["shouldbindwith", "decodejson", "binding/json.go"] },
  { id: "t07-run", prompt: "Which Engine method does Run call to obtain the http.Server Handler, and what does it wrap the engine with when UseH2C is true?", expect: ["handler", "h2c"] },
  { id: "t08-clientip", prompt: "Inside Context.ClientIP, which Engine method decides whether the remote IP is a trusted proxy, and which validates a forwarded header value?", expect: ["istrustedproxy", "validateheader"] },
  { id: "t09-assert", prompt: "Which function emits the 'too many handlers' assertion, and in which file?", expect: ["combinehandlers", "routergroup.go"] },
  { id: "t10-insert", prompt: "Engine.addRoute inserts a route into a tree. Which method does it call on the root node, and in which file is that method defined?", expect: ["addroute", "tree.go"] },
];
