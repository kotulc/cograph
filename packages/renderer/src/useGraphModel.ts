/**
 * Converts a GraphModel into Cytoscape elements using the uniform containment rule:
 *
 * Given a selected container (folder, file, or block), the canvas shows its immediate
 * children. Each child that has its own children is rendered as a compound node with
 * those grandchildren shown as dots inside. Each childless child is a plain dot.
 *
 * This rule applies identically at every level:
 *   Folder  → sub-folders and files as dots/compounds
 *   File    → blocks as dots/compounds  (derived from local HAC merges tree)
 *   Block   → elements as dots          (leaves — no further expansion)
 */

import { useMemo } from 'react';
import { GraphModel, FileMeta, BlockMeta, ElementMeta } from '@cograph/core';
import type { GraphNode } from '@cograph/core';
import type { Metric } from './ColorMap.js';


// ── Language → color ──────────────────────────────────────────────────────────

const LANG_COLORS: Record<string, string> = {
  markdown: '#4caf50', typescript: '#2196f3', tsx: '#00bcd4',
  javascript: '#ff9800', jsx: '#ff5722', python: '#9c27b0',
  json: '#607d8b', yaml: '#795548', css: '#e91e63',
  scss: '#f06292', html: '#ff6f00', text: '#78909c',
  shell: '#424242', rust: '#bf360c', go: '#00acc1',
  svg: '#4caf50', xml: '#607d8b', sql: '#1976d2',
};

/** Binary/unsupported format languages — always rendered grey regardless of metric. */
export const BINARY_LANGS = new Set(['image', 'pdf', 'video', 'audio', 'font', 'archive']);

/** Language hue for text files; grey for binary/unsupported formats. */
export function langColor(language: string): string {
  if (BINARY_LANGS.has(language)) return '#bdbdbd';
  return LANG_COLORS[language] ?? '#9e9e9e';
}

/** Maps a normalised [0, 1] value onto a blue→green→red 3-stop scale. */
function continuousColor(t: number): string {
  let r, g, b;
  if (t <= 0.5) {
    const u = t * 2;
    r = Math.round(79  + u * (129 - 79));
    g = Math.round(134 + u * (199 - 134));
    b = Math.round(198 + u * (132 - 198));
  } else {
    const u = (t - 0.5) * 2;
    r = Math.round(129 + u * (224 - 129));
    g = Math.round(199 + u * (92  - 199));
    b = Math.round(132 + u * (92  - 132));
  }
  return `rgb(${r},${g},${b})`;
}


// ── Cytoscape element types ───────────────────────────────────────────────────

export interface CyData {
  id: string;
  label?: string;
  kind?: string;
  parent?: string;
  source?: string;
  target?: string;
  weight?: number;
  color?: string;
  language?: string;
  [key: string]: unknown;
}

export interface CyElement { data: CyData }


// ── Block / element tree helpers ──────────────────────────────────────────────

/**
 * Walks up the merges-edge chain from a node to find the root block for its file.
 * Returns null if there are no block ancestors (file has only one element or no blocks).
 */
function rootBlockOf(startId: string, model: GraphModel): GraphNode | null {
  let current = startId;
  let rootBlock: GraphNode | null = null;
  for (let guard = 0; guard < 200; guard++) {
    const parentEdge = model.edgesOf(current, 'merges').find((e) => e.target === current);
    if (!parentEdge) break;
    const parent = model.getNode(parentEdge.source);
    if (!parent || parent.kind !== 'block') break;
    rootBlock = parent;
    current = parent.id;
  }
  return rootBlock;
}

/**
 * Cuts the block dendrogram for a file to produce ~sqrt(n) top-level blocks.
 * Expands the most-recently-merged block first until we reach the target count.
 */
function cutBlocks(root: GraphNode, model: GraphModel, target: number): GraphNode[] {
  const frontier: GraphNode[] = [root];
  while (frontier.length < target) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < frontier.length; i++) {
      const n = frontier[i]!;
      if (n.kind === 'block') {
        const score = (n.meta as BlockMeta).mergeScore;
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
    }
    if (bestIdx < 0) break;
    const toExpand = frontier[bestIdx]!;
    const children = model.edgesOf(toExpand.id, 'merges')
      .filter((e) => e.source === toExpand.id)
      .map((e) => model.getNode(e.target))
      .filter((n): n is GraphNode => n !== undefined);
    if (children.length === 0) break;
    frontier.splice(bestIdx, 1, ...children);
  }
  return frontier;
}

/** All element nodes reachable downward from a block via merges edges. */
function elementsInBlock(blockId: string, model: GraphModel): GraphNode[] {
  const result: GraphNode[] = [];
  const stack = [blockId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = model.getNode(id);
    if (!node) continue;
    if (node.kind === 'element') {
      result.push(node);
    } else if (node.kind === 'block') {
      for (const e of model.edgesOf(id, 'merges')) {
        if (e.source === id) stack.push(e.target);
      }
    }
  }
  return result;
}

/**
 * Returns the "display children" for any container node:
 *   folder  → immediate child folders and files (via contains)
 *   file    → top-level blocks from local HAC dendrogram; elements if no blocks
 *   block   → all elements reachable via merges edges
 *   element / cluster → [] (leaf)
 */
export function displayChildren(id: string, model: GraphModel): GraphNode[] {
  const node = model.getNode(id);
  if (!node) return [];

  if (node.kind === 'folder') {
    return model.children(id).filter((n) => n.kind === 'folder' || n.kind === 'file');
  }

  if (node.kind === 'file') {
    const lang = (node.meta as FileMeta).language ?? '';
    if (BINARY_LANGS.has(lang)) return [];
    const elements = model.children(id).filter((n) => n.kind === 'element');
    if (elements.length === 0) return [];
    // Find root block (walk up from first element)
    const root = rootBlockOf(elements[0]!.id, model);
    if (!root) return elements; // not yet clustered → show elements directly
    const target = Math.min(8, Math.max(2, Math.floor(Math.sqrt(elements.length))));
    return cutBlocks(root, model, target);
  }

  if (node.kind === 'block') {
    return elementsInBlock(id, model);
  }

  return []; // element, cluster — leaves
}

/** Returns the project root folder ID (the folder with no parent). */
export function projectRoot(model: GraphModel): string {
  const root = model.nodesByKind('folder').find((f) => !model.parent(f.id));
  return root?.id ?? 'folder::';
}


// ── Color helpers ─────────────────────────────────────────────────────────────

/** Best-effort language for any node kind (for color purposes). */
function nodeLanguage(node: GraphNode, model: GraphModel): string {
  if (node.kind === 'file') return (node.meta as FileMeta).language ?? '';
  if (node.kind === 'folder') return '';
  // For block/element, walk up to the parent file to get its language
  let current: GraphNode | undefined = node;
  for (let guard = 0; guard < 20; guard++) {
    const parent = model.parent(current.id);
    if (!parent) break;
    if (parent.kind === 'file') return (parent.meta as FileMeta).language ?? '';
    current = parent;
  }
  return '';
}

/**
 * Builds a per-node color function for the active metric.
 * Binary files always return grey; for 'language' metric each language gets a hue;
 * for continuous metrics values are normalised across the visible node set.
 */
function buildColorFn(
  nodes: GraphNode[],
  metric: Metric,
  model: GraphModel,
): (node: GraphNode) => string {
  if (metric === 'language') {
    return (node) => {
      const lang = nodeLanguage(node, model);
      return langColor(lang || '');
    };
  }

  // Continuous metrics — normalise across visible nodes
  const rawVal = (node: GraphNode): number => {
    if (metric === 'chunkCount') {
      return model.children(node.id).filter((n) => n.kind === 'element').length;
    }
    if (metric === 'tightness' && node.kind === 'block') {
      return (node.meta as BlockMeta).mergeScore;
    }
    return 0;
  };

  const vals = nodes.map(rawVal);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const range = maxVal - minVal;

  return (node) => {
    const lang = nodeLanguage(node, model);
    if (BINARY_LANGS.has(lang)) return '#bdbdbd';
    const t = range > 0 ? (rawVal(node) - minVal) / range : 0.5;
    return continuousColor(t);
  };
}


// ── Main element builder ──────────────────────────────────────────────────────

/**
 * Builds Cytoscape elements for the uniform containment view of `selectedId`.
 *
 * Each immediate child is shown as either:
 *   - A compound node (when it has display-children) with grandchildren as dots inside
 *   - A plain dot (when it has no display-children, e.g. binary file or leaf element)
 */
export function graphElements(
  model: GraphModel,
  selectedId: string,
  metric: Metric = 'language',
): CyElement[] {
  const elements: CyElement[] = [];

  const children = displayChildren(selectedId, model);

  // Collect all visible leaf-ish nodes for color normalisation
  const allVisible: GraphNode[] = [];
  for (const child of children) {
    allVisible.push(child);
    allVisible.push(...displayChildren(child.id, model));
  }
  const colorFn = buildColorFn(allVisible, metric, model);

  // Track visible element IDs for similar-edge filtering
  const visibleElements = new Set<string>();

  for (const child of children) {
    const grandchildren = displayChildren(child.id, model);
    const isBinary = child.kind === 'file' &&
      BINARY_LANGS.has((child.meta as FileMeta).language ?? '');

    if (grandchildren.length > 0 && !isBinary) {
      // Compound: child is a navigable container
      elements.push({ data: {
        id: child.id,
        label: child.label,
        kind: child.kind,
        color: colorFn(child),
        language: nodeLanguage(child, model),
      } });
      // Grandchildren as dots inside the compound
      for (const gc of grandchildren) {
        if (gc.kind === 'element') visibleElements.add(gc.id);
        elements.push({ data: {
          id: gc.id,
          label: gc.label,
          kind: gc.kind,
          parent: child.id,
          color: colorFn(gc),
          language: nodeLanguage(gc, model),
          tokens: gc.kind === 'element' ? ((gc.meta as ElementMeta).tokens ?? []) : undefined,
        } });
      }
    } else {
      // Leaf dot (binary file, or no children)
      if (child.kind === 'element') visibleElements.add(child.id);
      elements.push({ data: {
        id: child.id,
        label: child.label,
        kind: child.kind,
        color: isBinary ? '#bdbdbd' : colorFn(child),
        language: nodeLanguage(child, model),
        tokens: child.kind === 'element' ? ((child.meta as ElementMeta).tokens ?? []) : undefined,
      } });
    }
  }

  // Emit `similar` edges between visible elements (stored in model by computeSimilarEdges)
  if (visibleElements.size > 0) {
    const emittedEdges = new Set<string>();
    for (const elemId of visibleElements) {
      for (const edge of model.edgesOf(elemId, 'similar')) {
        if (!emittedEdges.has(edge.id) && visibleElements.has(edge.source) && visibleElements.has(edge.target)) {
          emittedEdges.add(edge.id);
          elements.push({ data: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            kind: 'similar',
            weight: edge.weight,
          } });
        }
      }
    }
  }

  return elements;
}


// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGraphModel(
  model: GraphModel | null,
  selectedId: string,
  metric: Metric = 'language',
): { elements: CyElement[] } {
  const elements = useMemo(() => {
    if (!model) return [];
    return graphElements(model, selectedId, metric);
  }, [model, selectedId, metric]);

  return { elements };
}
