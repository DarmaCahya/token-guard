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
  }

  return { nodes, edges };
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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const classMatch = line.match(/(?:export\s+)?(?:default\s+)?(class|interface)\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (classMatch) {
      const kind = classMatch[1] === "class" ? "class" : "interface";
      const name = classMatch[2];
      const extendsTarget = classMatch[3];
      const nodeId = `symbol:${filePath}#${name}`;

      const endLine = findBlockEnd(lines, i);
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
    const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
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

    const fnMatch = line.match(/^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
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
    const fnMatch = line.match(/^func\s+(?:\(([^)]+)\)\s+)?(\w+)\s*\(([^)]*)\)/);
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
    const fnMatch = line.match(/^(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+([a-zA-Z0-9_]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/);
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

function findBlockEnd(lines: string[], startIndex: number): number {
  let depth = 0;
  let started = false;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === "{") {
        depth++;
        started = true;
      } else if (ch === "}") {
        depth--;
        if (started && depth <= 0) {
          return i;
        }
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
