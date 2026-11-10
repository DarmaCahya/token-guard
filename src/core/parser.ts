import type { GraphNode, GraphEdge } from "./types.ts";

export interface FileParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function parseSourceFile(filePath: string, content: string): FileParseResult {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const lines = content.split("\n");
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const fileNodeId = `file:${filePath}`;
  nodes.push({
    id: fileNodeId,
    name: filePath,
    type: "file",
    file: filePath,
    lineStart: 1,
    lineEnd: lines.length,
    metadata: { ext, lineCount: lines.length },
  });

  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
    parseTypeScriptOrJavaScript(filePath, lines, fileNodeId, nodes, edges);
  } else if (ext === "py") {
    parsePython(filePath, lines, fileNodeId, nodes, edges);
  } else if (ext === "go") {
    parseGo(filePath, lines, fileNodeId, nodes, edges);
  } else if (ext === "rs") {
    parseRust(filePath, lines, fileNodeId, nodes, edges);
  } else if (ext === "php") {
    parsePhp(filePath, lines, fileNodeId, nodes, edges);
  }

  disambiguateDuplicateIds(nodes, edges);
  return { nodes, edges };
}

/**
 * Several symbols can share `file#name` (e.g. Go methods `Provision` on different receiver types).
 * Keep the first id as-is and suffix later ones with their line so none overwrite each other.
 */
function disambiguateDuplicateIds(nodes: GraphNode[], edges: GraphEdge[]) {
  const seen = new Map<string, number>();
  const renames = new Map<string, string[]>(); // old id -> new ids for 2nd, 3rd... occurrence
  for (const n of nodes) {
    const count = seen.get(n.id) ?? 0;
    seen.set(n.id, count + 1);
    if (count === 0) continue;
    const newId = `${n.id}@L${n.lineStart}`;
    (renames.get(n.id) ?? renames.set(n.id, []).get(n.id)!).push(newId);
    n.id = newId;
  }
  if (renames.size === 0) return;
  const used = new Map<string, number>();
  for (const e of edges) {
    if (e.type !== "defines") continue;
    const list = renames.get(e.target);
    if (!list) continue;
    // The first `defines` edge for an id belongs to the first node; later ones map to the renamed nodes.
    const k = used.get(e.target) ?? 0;
    used.set(e.target, k + 1);
    if (k > 0 && list[k - 1]) e.target = list[k - 1]!;
  }
}

function pushSymbol(
  filePath: string,
  fileNodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  name: string,
  type: GraphNode["type"],
  lineStart: number,
  lineEnd: number,
  signature: string
) {
  const nodeId = `symbol:${filePath}#${name}`;
  nodes.push({ id: nodeId, name, type, file: filePath, lineStart, lineEnd, signature: signature.trim() });
  edges.push({ source: fileNodeId, target: nodeId, type: "defines" });
}

function parseTypeScriptOrJavaScript(
  filePath: string,
  lines: string[],
  fileNodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
) {
  // 1. Imports
  const importRegex = /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)?\s*(?:from\s+)?['"]([^'"]+)['"]/g;
  const fullContent = lines.join("\n");
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(fullContent)) !== null) {
    const importTarget = match[1];
    edges.push({
      source: fileNodeId,
      target: `file:${importTarget}`,
      type: "imports",
      metadata: { raw: match[0] },
    });
  }

  // 2. Classes & Interfaces
  let classEnd = -1;
  const NOT_METHODS = new Set(["if", "for", "while", "switch", "catch", "function", "return", "else", "do", "with", "await", "typeof"]);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i < classEnd) {
      const methodMatch = line!.match(/^\s+(?:(?:public|private|protected|static|async|override|readonly|get|set)\s+)*(\w+)\s*(?:<[^>]*>)?\(([^)]*)\)\s*(?::\s*[^{=]+)?\{/);
      if (methodMatch && !NOT_METHODS.has(methodMatch[1]!)) {
        pushSymbol(filePath, fileNodeId, nodes, edges, methodMatch[1]!, "method", i + 1, findBlockEnd(lines, i) + 1, `${methodMatch[1]}(${methodMatch[2]})`);
      }
    }
    const classMatch = line.match(/(?:export\s+)?(?:default\s+)?(class|interface)\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (classMatch) {
      const kind = classMatch[1] === "class" ? "class" : "interface";
      const name = classMatch[2];
      const extendsTarget = classMatch[3];
      const nodeId = `symbol:${filePath}#${name}`;

      const endLine = findBlockEnd(lines, i);
      if (kind === "class") classEnd = endLine;
      nodes.push({
        id: nodeId,
        name,
        type: kind,
        file: filePath,
        lineStart: i + 1,
        lineEnd: endLine + 1,
        signature: line.trim(),
      });
      edges.push({
        source: fileNodeId,
        target: nodeId,
        type: "defines",
      });

      if (extendsTarget) {
        edges.push({
          source: nodeId,
          target: `symbol:${extendsTarget}`,
          type: "extends",
        });
      }
    }

    // 3. Functions
    const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)/);
    const arrowFnMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*[^=]+)?\s*=>/);

    const detectedFn = fnMatch || arrowFnMatch;
    if (detectedFn) {
      const name = detectedFn[1];
      const params = detectedFn[2];
      const nodeId = `symbol:${filePath}#${name}`;
      const endLine = findBlockEnd(lines, i);

      nodes.push({
        id: nodeId,
        name,
        type: "function",
        file: filePath,
        lineStart: i + 1,
        lineEnd: endLine + 1,
        signature: `${name}(${params})`,
      });
      edges.push({
        source: fileNodeId,
        target: nodeId,
        type: "defines",
      });
    }

    if (!detectedFn && !classMatch) {
      const typeMatch = line!.match(/^(?:export\s+)?(?:declare\s+)?type\s+(\w+)\b/);
      const enumMatch = line!.match(/^(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+(\w+)/);
      const constMatch = line!.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\b/);
      if (typeMatch) {
        pushSymbol(filePath, fileNodeId, nodes, edges, typeMatch[1]!, "type", i + 1, line!.includes("{") ? findBlockEnd(lines, i) + 1 : i + 1, line!);
      } else if (enumMatch) {
        pushSymbol(filePath, fileNodeId, nodes, edges, enumMatch[1]!, "type", i + 1, findBlockEnd(lines, i) + 1, line!);
      } else if (constMatch && !/=\s*(?:async\s*)?(?:\(|function\b|\w+\s*=>)/.test(line)) {
        pushSymbol(filePath, fileNodeId, nodes, edges, constMatch[1]!, "variable", i + 1, i + 1, line!);
      }
    }
  }
}

function parsePython(
  filePath: string,
  lines: string[],
  fileNodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const importMatch = line.match(/^(?:from\s+([.\w]+)\s+import\s+([\w,\s*]+)|import\s+([\w,\s.]+))/);
    if (importMatch) {
      const target = importMatch[1] || importMatch[3];
      edges.push({
        source: fileNodeId,
        target: `module:${target}`,
        type: "imports",
        metadata: { raw: line.trim() },
      });
      continue;
    }

    const classMatch = line.match(/^\s*class\s+(\w+)(?:\(([^)]*)\))?:/);
    if (classMatch) {
      const name = classMatch[1];
      const parent = classMatch[2];
      const nodeId = `symbol:${filePath}#${name}`;
      const endLine = findPythonBlockEnd(lines, i);

      nodes.push({
        id: nodeId,
        name,
        type: "class",
        file: filePath,
        lineStart: i + 1,
        lineEnd: endLine + 1,
        signature: line.trim(),
      });
      edges.push({ source: fileNodeId, target: nodeId, type: "defines" });

      if (parent) {
        edges.push({ source: nodeId, target: `symbol:${parent}`, type: "extends" });
      }
    }

    const fnMatch = line.match(/^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)/);
    if (fnMatch) {
      const name = fnMatch[1];
      const params = fnMatch[2];
      const isIndented = line.search(/\S/) > 0;
      const nodeId = `symbol:${filePath}#${name}`;
      const endLine = findPythonBlockEnd(lines, i);

      nodes.push({
        id: nodeId,
        name,
        type: isIndented ? "method" : "function",
        file: filePath,
        lineStart: i + 1,
        lineEnd: endLine + 1,
        signature: `def ${name}(${params})`,
      });
      edges.push({ source: fileNodeId, target: nodeId, type: "defines" });
    }

    const constMatch = line!.match(/^([A-Z_][A-Z0-9_]*)\s*(?::[^=]+)?=[^=]/);
    if (constMatch) {
      pushSymbol(filePath, fileNodeId, nodes, edges, constMatch[1]!, "variable", i + 1, i + 1, line!);
    }
  }
}

function parseGo(
  filePath: string,
  lines: string[],
  fileNodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fnMatch = line.match(/^func\s+(?:\(([^)]+)\)\s+)?(\w+)\s*(?:\[[^\]]*\])?\s*\(([^)]*)/);
    if (fnMatch) {
      const receiver = fnMatch[1];
      const name = fnMatch[2];
      const params = fnMatch[3];
      const nodeId = `symbol:${filePath}#${name}`;
      const endLine = findBlockEnd(lines, i);

      nodes.push({
        id: nodeId,
        name,
        type: receiver ? "method" : "function",
        file: filePath,
        lineStart: i + 1,
        lineEnd: endLine + 1,
        signature: line.trim(),
      });
      edges.push({ source: fileNodeId, target: nodeId, type: "defines" });
      continue;
    }

    const typeMatch = line!.match(/^type\s+(\w+)(?:\[[^\]]*\])?\s+(struct|interface)?/);
    if (typeMatch) {
      const kind = typeMatch[2];
      const end = kind ? findBlockEnd(lines, i) + 1 : i + 1;
      pushSymbol(filePath, fileNodeId, nodes, edges, typeMatch[1]!, kind === "struct" ? "class" : kind === "interface" ? "interface" : "type", i + 1, end, line!);
      continue;
    }

    const varMatch = line!.match(/^(?:const|var)\s+(\w+)\b/);
    if (varMatch) {
      pushSymbol(filePath, fileNodeId, nodes, edges, varMatch[1]!, "variable", i + 1, i + 1, line!);
      continue;
    }

    if (/^(?:const|var)\s*\(\s*$/.test(line)) {
      let j = i + 1;
      for (; j < lines.length && !/^\)/.test(lines[j]!); j++) {
        const entry = lines[j]!.match(/^\t([A-Za-z_]\w*)\b(?!\s*\()/);
        if (entry && entry[1] !== "_") {
          pushSymbol(filePath, fileNodeId, nodes, edges, entry[1]!, "variable", j + 1, j + 1, lines[j]!);
        }
      }
      i = j;
    }
  }
}

function parseRust(
  filePath: string,
  lines: string[],
  fileNodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
) {
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (line.startsWith("//") || line.startsWith("/*") || line.length === 0) continue;

    // 1. use / mod declarations
    const useMatch = line.match(/^(?:pub\s+)?use\s+([^;]+);/);
    if (useMatch) {
      const target = useMatch[1].trim();
      edges.push({
        source: fileNodeId,
        target: `use:${target}`,
        type: "imports",
        metadata: { raw: line },
      });
      continue;
    }

    const modMatch = line.match(/^(?:pub\s+)?mod\s+([a-zA-Z0-9_]+);/);
    if (modMatch) {
      const modName = modMatch[1];
      edges.push({
        source: fileNodeId,
        target: `mod:${modName}`,
        type: "imports",
      });
      continue;
    }

    const constMatch = line.match(/^(?:pub(?:\([^)]+\))?\s+)?(?:const|static)\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (constMatch) {
      pushSymbol(filePath, fileNodeId, nodes, edges, constMatch[1]!, "variable", i + 1, i + 1, line!);
      continue;
    }

    // 2. Struct, Enum, Trait, Type
    const typeMatch = line.match(/^(?:pub(?:\([^)]+\))?\s+)?(struct|enum|trait|type)\s+([a-zA-Z0-9_]+)/);
    if (typeMatch) {
      const kind = typeMatch[1];
      const name = typeMatch[2];
      const nodeId = `symbol:${filePath}#${name}`;
      const endLine = findBlockEnd(lines, i);

      nodes.push({
        id: nodeId,
        name,
        type: kind === "struct" ? "class" : kind === "trait" ? "interface" : kind,
        file: filePath,
        lineStart: i + 1,
        lineEnd: endLine + 1,
        signature: line,
      });
      edges.push({
        source: fileNodeId,
        target: nodeId,
        type: "defines",
      });
      continue;
    }

    // 3. Impl blocks
    const implMatch = line.match(/^impl(?:\s*<[^>]*>)?\s+(?:([a-zA-Z0-9_:]+)\s+for\s+)?([a-zA-Z0-9_:]+)/);
    if (implMatch) {
      const traitName = implMatch[1];
      const targetType = implMatch[2];
      const nodeId = `impl:${filePath}#${traitName ? `${traitName}_for_${targetType}` : targetType}#L${i + 1}`;
      const endLine = findBlockEnd(lines, i);

      nodes.push({
        id: nodeId,
        name: traitName ? `impl ${traitName} for ${targetType}` : `impl ${targetType}`,
        type: "impl",
        file: filePath,
        lineStart: i + 1,
        lineEnd: endLine + 1,
        signature: line,
      });
      edges.push({
        source: fileNodeId,
        target: nodeId,
        type: "defines",
      });
      if (traitName) {
        edges.push({
          source: nodeId,
          target: `symbol:${traitName}`,
          type: "extends",
        });
      }
      continue;
    }

    // 4. Functions & Methods
    const fnMatch = line.match(/^(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+([a-zA-Z0-9_]+)\s*(?:<[^>]*>)?\s*\(([^)]*)/);
    if (fnMatch) {
      const name = fnMatch[1];
      const params = fnMatch[2];
      const nodeId = `symbol:${filePath}#${name}#L${i + 1}`;
      const endLine = findBlockEnd(lines, i);

      nodes.push({
        id: nodeId,
        name,
        type: "function",
        file: filePath,
        lineStart: i + 1,
        lineEnd: endLine + 1,
        signature: `fn ${name}(${params})`,
      });
      edges.push({
        source: fileNodeId,
        target: nodeId,
        type: "defines",
      });
    }
  }
}

function parsePhp(
  filePath: string,
  lines: string[],
  fileNodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
) {
  let insideType = false;
  let typeEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line!.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    const useMatch = trimmed.match(/^use\s+(?:function\s+|const\s+)?([\w\\]+)(?:\s+as\s+\w+)?\s*;/);
    if (useMatch) {
      edges.push({ source: fileNodeId, target: `file:${useMatch[1]}`, type: "imports", metadata: { raw: trimmed } });
      continue;
    }

    const typeMatch = trimmed.match(/^(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+(\w+)(?:\s+extends\s+([\w\\]+))?(?:\s+implements\s+([\w\\,\s]+?))?\s*(?:\{|$)/);
    if (typeMatch) {
      const name = typeMatch[2];
      const nodeId = `symbol:${filePath}#${name}`;
      const endLine = findBlockEnd(lines, i);
      nodes.push({
        id: nodeId,
        name,
        type: typeMatch[1] === "class" ? "class" : "interface",
        file: filePath,
        lineStart: i + 1,
        lineEnd: endLine + 1,
        signature: trimmed.replace(/\s*\{$/, ""),
      });
      edges.push({ source: fileNodeId, target: nodeId, type: "defines" });
      if (typeMatch[3]) {
        edges.push({ source: nodeId, target: `symbol:${typeMatch[3].split("\\").pop()}`, type: "extends" });
      }
      if (typeMatch[4]) {
        for (const impl of typeMatch[4].split(",")) {
          const target = impl.trim().split("\\").pop();
          if (target) edges.push({ source: nodeId, target: `symbol:${target}`, type: "implements" });
        }
      }
      insideType = true;
      typeEnd = endLine;
      continue;
    }

    const constMatch = trimmed.match(/^(?:(?:public|protected|private|final)\s+)*const\s+(\w+)\s*=/) || trimmed.match(/^define\(\s*['"](\w+)['"]/);
    if (constMatch) {
      pushSymbol(filePath, fileNodeId, nodes, edges, constMatch[1]!, "variable", i + 1, i + 1, trimmed);
      continue;
    }

    const fnMatch = trimmed.match(/^(?:(?:public|protected|private|static|abstract|final)\s+)*function\s+&?(\w+)\s*\(([^)]*)/);
    if (fnMatch) {
      const name = fnMatch[1];
      const nodeId = `symbol:${filePath}#${name}`;
      const endLine = findBlockEnd(lines, i);
      nodes.push({
        id: nodeId,
        name,
        type: insideType && i <= typeEnd ? "method" : "function",
        file: filePath,
        lineStart: i + 1,
        lineEnd: endLine + 1,
        signature: trimmed.replace(/\s*\{$/, ""),
      });
      edges.push({ source: fileNodeId, target: nodeId, type: "defines" });
    }
  }
}

/**
 * Line index where the `{ ... }` block opened at/after `startIndex` closes. Braces inside strings,
 * raw strings, rune/char literals and comments are ignored so a literal like "{http.vars.fs}" or '{'
 * cannot end a function early.
 */
function findBlockEnd(lines: string[], startIndex: number): number {
  let depth = 0;
  let started = false;
  let inBlockComment = false;
  let inRaw = false; // Go/JS backtick string, may span lines

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i]!;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c]!;
      if (inBlockComment) {
        if (ch === "*" && line[c + 1] === "/") { inBlockComment = false; c++; }
        continue;
      }
      if (inRaw) {
        if (ch === "`") inRaw = false;
        continue;
      }
      if (ch === "/" && line[c + 1] === "/") break;
      if (ch === "/" && line[c + 1] === "*") { inBlockComment = true; c++; continue; }
      if (ch === "`") { inRaw = true; continue; }
      if (ch === '"') {
        for (c++; c < line.length && line[c] !== '"'; c++) if (line[c] === "\\") c++;
        continue;
      }
      if (ch === "'") {
        // char/rune literal ('{', '\\n'); a lone ' (Rust lifetime) is left alone.
        const m = /^'(?:\\.[^']*|[^'\\])'/.exec(line.slice(c));
        if (m) c += m[0].length - 1;
        continue;
      }
      if (ch === "{") {
        depth++;
        started = true;
      } else if (ch === "}") {
        depth--;
        if (started && depth <= 0) return i;
      }
    }
  }
  return Math.min(startIndex + 15, lines.length - 1);
}

function findPythonBlockEnd(lines: string[], startIndex: number): number {
  const baseIndentMatch = lines[startIndex].match(/^(\s*)/);
  const baseIndent = baseIndentMatch ? baseIndentMatch[1].length : 0;

  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    const currentIndentMatch = line.match(/^(\s*)/);
    const currentIndent = currentIndentMatch ? currentIndentMatch[1].length : 0;
    if (currentIndent <= baseIndent) {
      return i - 1;
    }
  }
  return lines.length - 1;
}
