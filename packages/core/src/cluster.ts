/** Two-pass agglomerative clustering: Pass 1 per-file (local blocks), Pass 2 cross-file (global). */

import { GraphModel } from './graph.js';
import { GraphNode, GraphEdge, BlockMeta, ClusterMeta, FileMeta } from './types.js';


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

let nodeSeq = 0;
const blockId   = () => `block::${nodeSeq++}`;
const clusterId = () => `cluster::${nodeSeq++}`;


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
function hac(items: HacItem[], makeId: () => string): MergeStep[] {
  if (items.length === 0) return [];

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
    const parentId = makeId();

    steps.push({ parentId, leftId: left.id, rightId: right.id, score: bestSim, level: steps.length + 1, representative: rep });

    clusters.splice(bestJ, 1);
    clusters.splice(bestI, 1);
    clusters.push({ id: parentId, vec: rep });
  }

  return steps;
}


// ── Pass 1: intra-file block grouping ─────────────────────────────────────────

/**
 * Runs HAC on all element children of `fileId`.
 * Adds `block` nodes and `merges` edges to `model`.
 * Stores the root block's representative embedding on the file node.
 */
export function groupFileElements(fileId: string, model: GraphModel): void {
  const elements = model.children(fileId).filter((n) => n.kind === 'element' && n.vector);
  if (elements.length < 2) {
    // Single element: the file representative is the element vector itself
    const solo = elements[0];
    if (solo?.vector) {
      const fileMeta = model.getNode(fileId)?.meta as FileMeta | undefined;
      if (fileMeta) model.updateNode(fileId, { meta: { ...fileMeta, representative: solo.vector } });
    }
    return;
  }

  const items: HacItem[] = elements.map((e) => ({ id: e.id, vec: e.vector! }));
  const steps = hac(items, blockId);
  let edgeSeq = model.allEdges().length;

  for (const step of steps) {
    const meta: BlockMeta = { mergeScore: step.score, level: step.level };
    const node: GraphNode = {
      id: step.parentId, kind: 'block', label: `block[${step.level}]`,
      vector: step.representative, meta,
    };
    model.addNode(node);

    const leftEdge: GraphEdge  = { id: `me${edgeSeq++}`, source: step.parentId, target: step.leftId,  kind: 'merges', weight: step.score };
    const rightEdge: GraphEdge = { id: `me${edgeSeq++}`, source: step.parentId, target: step.rightId, kind: 'merges', weight: step.score };
    model.addEdge(leftEdge);
    model.addEdge(rightEdge);
  }

  // Store root block representative on the file node
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
 * Adds global `cluster` nodes and `merges` edges to `model`.
 * Global clusters are internal — they drive `similar` edge computation but are not rendered.
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

  const steps = hac(items, clusterId);
  let edgeSeq = model.allEdges().length;

  for (const step of steps) {
    const meta: ClusterMeta = { mergeScore: step.score, level: step.level };
    const node: GraphNode = {
      id: step.parentId, kind: 'cluster', label: `group[${step.level}]`,
      vector: step.representative, meta,
    };
    model.addNode(node);

    const leftEdge: GraphEdge  = { id: `ge${edgeSeq++}`, source: step.parentId, target: step.leftId,  kind: 'merges', weight: step.score };
    const rightEdge: GraphEdge = { id: `ge${edgeSeq++}`, source: step.parentId, target: step.rightId, kind: 'merges', weight: step.score };
    model.addEdge(leftEdge);
    model.addEdge(rightEdge);
  }
}


// ── Pass 3: cross-block similar edges ────────────────────────────────────────

const SIMILAR_THRESHOLD = 0.70;

/**
 * Adds `similar` edges between element pairs within the same file whose cosine
 * similarity meets the threshold.  Edges crossing block boundaries surface as
 * visual links in the file-level canvas view; same-block pairs are redundant
 * (containment already shows membership) and are omitted.
 */
export function computeSimilarEdges(model: GraphModel, threshold = SIMILAR_THRESHOLD): void {
  let edgeSeq = model.allEdges().length;

  for (const file of model.nodesByKind('file')) {
    const elems = model.children(file.id).filter((n) => n.kind === 'element' && n.vector);
    if (elems.length < 2) continue;

    for (let i = 0; i < elems.length; i++) {
      for (let j = i + 1; j < elems.length; j++) {
        const sim = cosine(elems[i]!.vector!, elems[j]!.vector!);
        if (sim >= threshold) {
          model.addEdge({
            id: `se${edgeSeq++}`,
            source: elems[i]!.id,
            target: elems[j]!.id,
            kind: 'similar',
            weight: sim,
          });
        }
      }
    }
  }
}


// ── Orchestration ─────────────────────────────────────────────────────────────

/** Run both clustering passes and emit cross-block similar edges. */
export function buildClusters(model: GraphModel): void {
  nodeSeq = 0; // reset for deterministic ids in tests
  for (const file of model.nodesByKind('file')) {
    groupFileElements(file.id, model);
  }
  clusterFiles(model);
  computeSimilarEdges(model);
}
