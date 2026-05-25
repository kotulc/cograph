/** TF-IDF cluster label generator and label suggestion utilities. */

import { GraphModel } from './graph.js';
import { ClusterMeta } from './types.js';


const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'this', 'that', 'these', 'those', 'it', 'its',
  'as', 'not', 'no', 'so', 'if', 'up', 'can', 'we', 'you', 'i', 'they',
]);


/** Tokenise text into lowercase words, stripping markdown/punctuation. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, '') // strip code fences
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}


/**
 * Collect all chunk content reachable from a set of node ids (files or clusters).
 * Traverses `merges` and `contains` edges recursively to reach chunk nodes.
 */
function collectChunkContent(ids: string[], model: GraphModel, visited = new Set<string>()): string[] {
  const texts: string[] = [];
  for (const id of ids) {
    if (visited.has(id)) continue;
    visited.add(id);
    const node = model.getNode(id);
    if (!node) continue;

    if (node.kind === 'chunk') {
      const content = (node as unknown as { content: string }).content;
      if (content) texts.push(content);
    } else {
      // Descend into children (contains) and cluster members (merges)
      const children = [
        ...model.children(id),
        ...model.neighbors(id, 'merges'),
      ];
      texts.push(...collectChunkContent(children.map((c) => c.id), model, visited));
    }
  }
  return texts;
}


/**
 * Generate a TF-IDF label for a cluster from its member content.
 * Returns the top `topN` terms joined by spaces.
 */
export function tfidfLabel(clusterId: string, model: GraphModel, topN = 5): string {
  const texts = collectChunkContent([clusterId], model);
  if (texts.length === 0) return 'cluster';

  const termFreq = new Map<string, number>();
  const docFreq = new Map<string, number>();

  for (const text of texts) {
    const words = tokenize(text);
    const unique = new Set(words);
    for (const w of words) termFreq.set(w, (termFreq.get(w) ?? 0) + 1);
    for (const w of unique) docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
  }

  const N = Math.max(texts.length, 1);
  const scored = Array.from(termFreq.entries()).map(([term, tf]) => {
    const df = docFreq.get(term) ?? 1;
    return [term, tf * Math.log((N + 1) / df)] as [string, number];
  });

  return scored
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([t]) => t)
    .join(' ');
}


/**
 * Generate `n` alternative label variants for a cluster by varying topN and stop-word exclusion.
 */
export function suggestLabels(clusterId: string, model: GraphModel, n = 3): string[] {
  const variants: string[] = [];
  for (let i = 0; i < n; i++) {
    variants.push(tfidfLabel(clusterId, model, 3 + i * 2));
  }
  return [...new Set(variants)].slice(0, n);
}


/**
 * Apply TF-IDF labels to all cluster nodes in the model.
 * Respects existing label overrides from `overrides`.
 */
export function labelClusters(
  model: GraphModel,
  overrides: Record<string, string> = {},
): void {
  for (const node of model.nodesByKind('cluster')) {
    if (overrides[node.id]) {
      model.updateNode(node.id, { label: overrides[node.id] });
    } else {
      const scope = (node.meta as ClusterMeta).scope;
      const label = tfidfLabel(node.id, model, scope === 'global' ? 5 : 3);
      model.updateNode(node.id, { label: label || node.label });
    }
  }
}
