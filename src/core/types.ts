export type NodeType = "file" | "class" | "function" | "method" | "interface" | "type" | "variable";

export interface GraphNode {
  id: string; // e.g. "file:src/auth.ts" or "symbol:src/auth.ts#verifyToken"
  name: string;
  type: NodeType;
  file: string;
  lineStart: number;
  lineEnd: number;
  signature?: string;
  docstring?: string;
  metadata?: Record<string, any>;
}

export type EdgeType = "imports" | "calls" | "defines" | "implements" | "extends" | "references";

export interface GraphEdge {
  source: string; // node id
  target: string; // node id
  type: EdgeType;
  metadata?: Record<string, any>;
}

export interface CodeGraph {
  version: string;
  indexedAt: string;
  rootPath: string;
  stats: {
    totalFiles: number;
    totalNodes: number;
    totalEdges: number;
    languages: Record<string, number>;
  };
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
}

export interface AmbiguityReport {
  clarityScore: number; // 0.0 - 1.0
  isClear: boolean;
  intent: "bugfix" | "feature" | "refactor" | "research" | "question" | "test" | "security" | "doc" | "unknown";
  detectedEntities: {
    targetFiles: string[];
    targetSymbols: string[];
    actionVerb?: string;
  };
  missingContext: string[];
  suggestedClarifications: string[];
}

export interface BlastRadiusReport {
  target: string;
  directDependents: string[];
  transitiveDependents: string[];
  impactedFiles: string[];
  blastScore: number; // 0.0 - 1.0
  summary: string;
}

export interface ScopeCheckReport {
  isCompliant: boolean;
  allowedTargets: string[];
  attemptedEdits: string[];
  violations: string[];
  warningMessage?: string;
}

export interface DeadCodeReport {
  orphanSymbols: GraphNode[];
  potentialTokenWastagePerPrompt: number;
  summary: string;
}

export interface DiffBlastReport {
  changedFiles: string[];
  affectedSymbols: GraphNode[];
  blastRadius: BlastRadiusReport;
  recommendedTestFiles: string[];
  summary: string;
}
