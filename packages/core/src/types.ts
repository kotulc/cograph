/** Shared type definitions for the cograph graph model. */

// ── Node kinds ────────────────────────────────────────────────────────────────

export type NodeKind = 'folder' | 'file' | 'chunk' | 'cluster';

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
  representative?: number[]; // serializable form of Float32Array
}

export interface ChunkMeta {
  position: number; // ordinal index within the parent file
}

export interface ClusterMeta {
  scope: 'local' | 'global';
  mergeScore: number;
  level: number;
}

export type NodeMeta = FolderMeta | FileMeta | ChunkMeta | ClusterMeta;

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  vector?: number[]; // present on chunk nodes only
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
  chunks: Record<string, number[]>;
  representatives: Record<string, number[]>;
}

export interface CoGraphConfig {
  version: number;
  activeLayout: 'structural' | 'semantic';
  metric: string;
  maxDepth: number;
  labelOverrides: Record<string, string>;
  membershipOverrides: Record<string, string>;
  dismissedSuggestions: string[];
  acceptedEdges: string[];
  vectorCache: VectorCache;
}
