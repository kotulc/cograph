/** Shared type definitions for the cograph graph model. */

// ── Node kinds ────────────────────────────────────────────────────────────────

export type NodeKind = 'folder' | 'file' | 'element' | 'block' | 'cluster';

/** User-visible edge kinds rendered in the graph. */
export type EdgeKind = 'contains' | 'similar' | 'reference';

/**
 * Internal edge kinds used by the clustering algorithm.
 * `merges` edges exist in the GraphModel but are never rendered in the UI.
 */
export type InternalEdgeKind = 'merges';

export type AnyEdgeKind = EdgeKind | InternalEdgeKind;

export interface FolderMeta {
  depth: number;
}

export interface FileMeta {
  language: string;
  expandable?: boolean;           // false for binary/unsupported files; default true
  representative?: number[];      // mean embedding of all blocks; stored for global clustering
}

/** Metadata for an element node (atomic content unit within a file). */
export interface ElementMeta {
  position: number;               // ordinal index within the parent file
  tokens?: string[];              // representative raw text fragments for the token panel
}

/**
 * Metadata for a block node (intra-file semantic group).
 * Produced by Pass 1 local HAC clustering of element embeddings.
 */
export interface BlockMeta {
  mergeScore: number;             // cosine similarity at which members were joined (higher = more similar)
  level: number;                  // merge order (1 = first merge, n-1 = root)
}

/**
 * Metadata for a global cluster node (cross-file semantic group).
 * Produced by Pass 2 HAC on file representatives. Internal only — not rendered as nodes.
 */
export interface ClusterMeta {
  mergeScore: number;
  level: number;
}

export type NodeMeta = FolderMeta | FileMeta | ElementMeta | BlockMeta | ClusterMeta;

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  vector?: number[];              // present on element nodes only
  meta: NodeMeta;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: AnyEdgeKind;
  weight: number;
}

// ── Platform abstractions ─────────────────────────────────────────────────────

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface IFileReader {
  readDir(path: string): Promise<DirEntry[]>;
  readText(path: string): Promise<string>;
}

export interface IConfigStore {
  load(): Promise<CoGraphConfig | null>;
  save(config: CoGraphConfig): Promise<void>;
}

export interface IChunker {
  chunk(text: string, windowSize: number, overlap: number): string[];
}

// ── Config schema ─────────────────────────────────────────────────────────────

export interface VectorCache {
  updatedAt: string;
  elements: Record<string, number[]>;   // elementId → embedding vector
  representatives: Record<string, number[]>;
}

export interface CoGraphConfig {
  version: number;
  metric: string;
  maxElements: number;            // max element nodes per file (default 50)
  labelOverrides: Record<string, string>;
  dismissedSuggestions: string[];
  acceptedEdges: string[];
  vectorCache: VectorCache;
}
