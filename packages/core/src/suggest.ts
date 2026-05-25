/**
 * Similarity edge generation and phantom edge suggestions.
 *
 * `buildSimilarEdges` produces the primary user-visible semantic edges —
 * direct file↔file connections ranked by cosine similarity of their
 * representative embeddings.  These replace the internal `merges` edges
 * as the rendered signal in the graph UI.
 *
 * `suggestEdges` surfaces high-similarity pairs not already linked as
 * accept/dismiss phantom suggestions (FR-20).
 */

import { GraphModel } from './graph.js';
import { GraphEdge, FileMeta } from './types.js';
import { cosine } from './cluster.js';


// ── Primary: top-K similar edges for rendering ────────────────────────────────

/**
 * Computes pairwise cosine similarity between all file representatives and
 * returns the top `k` pairs as `similar` edges, sorted by descending similarity.
 *
 * These are the edges rendered in both structural and semantic graph views.
 * Already-dismissed edges (by id) are excluded.
 */
export function buildSimilarEdges(
  model: GraphModel,
  k = 30,
  dismissed: string[] = [],
): GraphEdge[] {
  const dismissedSet = new Set(dismissed);
  const files = model.nodesByKind('file').filter(
    (f) => (f.meta as FileMeta).representative?.length,
  );

  const pairs: Array<{ a: string; b: string; score: number }> = [];
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const a = files[i]!;
      const b = files[j]!;
      const score = cosine(
        (a.meta as FileMeta).representative!,
        (b.meta as FileMeta).representative!,
      );
      const id = `similar::${a.id}::${b.id}`;
      if (!dismissedSet.has(id)) pairs.push({ a: a.id, b: b.id, score });
    }
  }

  return pairs
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map(({ a, b, score }) => ({
      id: `similar::${a}::${b}`,
      source: a,
      target: b,
      kind: 'similar' as const,
      weight: score,
    }));
}


// ── Phantom suggestions (FR-20) ───────────────────────────────────────────────

/**
 * Returns top-K highly similar file pairs that are not already linked by a
 * `similar` or `reference` edge and are not in the dismissed list.
 * Surfaces as dashed phantom edges in the SuggestPanel.
 */
export function suggestEdges(
  model: GraphModel,
  k = 10,
  dismissed: string[] = [],
): GraphEdge[] {
  const dismissedSet = new Set(dismissed);

  const existingEdgeKeys = new Set(
    model.allEdges()
      .filter((e) => e.kind === 'similar' || e.kind === 'reference')
      .map((e) => `${e.source}::${e.target}`),
  );

  const files = model.nodesByKind('file').filter(
    (f) => (f.meta as FileMeta).representative?.length,
  );

  const pairs: Array<{ a: string; b: string; score: number }> = [];
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const a = files[i]!;
      const b = files[j]!;
      const edgeKey = `${a.id}::${b.id}`;
      const id = `suggest::${edgeKey}`;
      if (dismissedSet.has(id) || existingEdgeKeys.has(edgeKey)) continue;
      const score = cosine(
        (a.meta as FileMeta).representative!,
        (b.meta as FileMeta).representative!,
      );
      pairs.push({ a: a.id, b: b.id, score });
    }
  }

  return pairs
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map(({ a, b, score }) => ({
      id: `suggest::${a}::${b}`,
      source: a,
      target: b,
      kind: 'reference' as const,
      weight: score,
    }));
}
