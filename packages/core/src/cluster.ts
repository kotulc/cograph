/** Two-pass agglomerative clustering: Pass 1 per-file (local), Pass 2 cross-file (global). */

import { GraphModel } from './graph.js';
import { GraphNode, GraphEdge, ClusterMeta, FileMeta } from './types.js';


// ── Math helpers ──────────────────────────────────────────────────────────────

/** Cosine similarity between two unit-norm vectors. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

/** Mean of a list of equal-length vectors. */
function meanVec(vecs: number[][]): number[] {
  if (vecs.length === 0) return [];
  const dim = vecs[0]?.length ?? 0;
  const out = new Array<number>(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) out[i]! += (v[i] ?? 0);
  return out.map((x) => x / vecs.length);
}

let clusterSeq = 0;
const clusterId = (scope: 'local' | 'global') => `cluster::${scope}::${clusterSeq++}`;


// ── Core HAC algorithm ────────────────────────────────────────────────────────

interface HacItem { id: string; vec: number[] }

interface MergeStep {
  parentId: string;
  leftId: string;
  rightId: string;
  score: number;
  level: number;
  representative: number[];
}

/**
 * Bottom-up average-linkage HAC.
 * Returns the ordered list of merge steps (level = merge order, 1-indexed).
 */
function hac(items: HacItem[], scope: 'local' | 'global'): MergeStep[] {
  if (items.length === 0) return [];

  // Each item starts as its own "cluster" with its own representative
  const clusters = items.map((it) => ({ id: it.id, vec: it.vec }));
  const steps: MergeStep[] = [];

  while (clusters.length > 1) {
    let bestI = 0, bestJ = 1, bestSim = -Infinity;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const sim = cosine(clusters[i]!.vec, clusters[j]!.vec);
        if (sim > bestSim) { bestSim = sim; bestI = i; bestJ = j; }
      }
    }

    const left = clusters[bestI]!;
    const right = clusters[bestJ]!;
    const rep = meanVec([left.vec, right.vec]);
    const parentId = clusterId(scope);

    steps.push({ parentId, leftId: left.id, rightId: right.id, score: bestSim, level: steps.length + 1, representative: rep });

    // Replace the two with the merged cluster
    clusters.splice(bestJ, 1);
    clusters.splice(bestI, 1);
    clusters.push({ id: parentId, vec: rep });
  }

  return steps;
}


// ── Pass 1: intra-file local clustering ──────────────────────────────────────

/**
 * Runs HAC on all chunk children of `fileId`.
 * Adds local cluster nodes and merges edges to `model`.
 * Stores the root cluster representative on the file node.
 */
export function clusterFileChunks(fileId: string, model: GraphModel): void {
  const chunks = model.children(fileId).filter((n) => n.kind === 'chunk' && n.vector);
  if (chunks.length < 2) {
    // Single chunk: the file representative is the chunk vector itself
    const solo = chunks[0];
    if (solo?.vector) {
      const fileMeta = model.getNode(fileId)?.meta as FileMeta | undefined;
      if (fileMeta) model.updateNode(fileId, { meta: { ...fileMeta, representative: solo.vector } });
    }
    return;
  }

  const items: HacItem[] = chunks.map((c) => ({ id: c.id, vec: c.vector! }));
  const steps = hac(items, 'local');
  let edgeSeq = model.allEdges().length;

  // Track which ids are "leaf" chunk ids vs synthesized cluster ids
  const allLeafIds = new Set(chunks.map((c) => c.id));

  for (const step of steps) {
    const meta: ClusterMeta = { scope: 'local', mergeScore: step.score, level: step.level };
    const clusterNode: GraphNode = {
      id: step.parentId, kind: 'cluster', label: `cluster[${step.level}]`,
      vector: step.representative, meta,
    };
    model.addNode(clusterNode);

    // merges edges: parent → left and parent → right
    const leftEdge: GraphEdge = { id: `me${edgeSeq++}`, source: step.parentId, target: step.leftId, kind: 'merges', weight: step.score };
    const rightEdge: GraphEdge = { id: `me${edgeSeq++}`, source: step.parentId, target: step.rightId, kind: 'merges', weight: step.score };
    model.addEdge(leftEdge);
    model.addEdge(rightEdge);
  }

  // Root representative → store on file node
  const rootStep = steps.at(-1);
  if (rootStep) {
    const fileMeta = model.getNode(fileId)?.meta as FileMeta | undefined;
    if (fileMeta) {
      model.updateNode(fileId, { meta: { ...fileMeta, representative: rootStep.representative } });
    }
  }
}


// ── Pass 2: cross-file global clustering ─────────────────────────────────────

/**
 * Runs HAC on all file representatives.
 * Adds global cluster nodes and merges edges to `model`.
 */
export function clusterFiles(model: GraphModel): void {
  const files = model.nodesByKind('file').filter((f) => {
    const meta = f.meta as FileMeta;
    return meta.representative && meta.representative.length > 0;
  });

  if (files.length < 2) return;

  const items: HacItem[] = files.map((f) => ({
    id: f.id,
    vec: (f.meta as FileMeta).representative!,
  }));

  const steps = hac(items, 'global');
  let edgeSeq = model.allEdges().length;

  for (const step of steps) {
    const meta: ClusterMeta = { scope: 'global', mergeScore: step.score, level: step.level };
    const clusterNode: GraphNode = {
      id: step.parentId, kind: 'cluster', label: `group[${step.level}]`,
      vector: step.representative, meta,
    };
    model.addNode(clusterNode);

    const leftEdge: GraphEdge = { id: `ge${edgeSeq++}`, source: step.parentId, target: step.leftId, kind: 'merges', weight: step.score };
    const rightEdge: GraphEdge = { id: `ge${edgeSeq++}`, source: step.parentId, target: step.rightId, kind: 'merges', weight: step.score };
    model.addEdge(leftEdge);
    model.addEdge(rightEdge);
  }
}


// ── Orchestration ─────────────────────────────────────────────────────────────

/** Run both clustering passes on a fully embedded model. */
export function buildClusters(model: GraphModel): void {
  clusterSeq = 0; // reset for deterministic ids in tests
  for (const file of model.nodesByKind('file')) {
    clusterFileChunks(file.id, model);
  }
  clusterFiles(model);
}
