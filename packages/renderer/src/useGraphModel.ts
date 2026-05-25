/**
 * Converts a GraphModel into Cytoscape elements for the unified depth-based view.
 *
 * A single view replaces the old structural/semantic split:
 *   - Structural containment is shown through compound nesting (folders wrap sub-clusters wrap files)
 *   - Semantic similarity is shown through `similar` edges between sub-cluster compounds
 *     that share the same global HAC concept across different frontier folders
 *
 * Depth slider semantics:
 *   0 → selected root's immediate child folders are the structural compounds
 *   n → the "frontier" of the folder tree at depth n from the selected root;
 *       leaf folders that cannot expand further remain visible at all depths ≥ their depth
 *
 * Within each frontier folder, files are grouped into semantic sub-cluster compounds
 * by cutting the global HAC dendrogram at an auto-selected level (~sqrt(n) groups).
 * Files in roots or above-frontier positions go into a synthetic "root files" compound.
 */

import { useMemo } from 'react';
import { GraphModel, ClusterMeta, FileMeta } from '@cograph/core';
import type { GraphNode } from '@cograph/core';

export interface CyData {
  id: string;
  label: string;
  kind: string;
  parent?: string;
  source?: string;
  target?: string;
  weight?: number;
  [key: string]: unknown;
}

export interface CyElement { data: CyData }


// ── Language → color ──────────────────────────────────────────────────────────

const LANG_COLORS: Record<string, string> = {
  markdown: '#4caf50', typescript: '#2196f3', tsx: '#00bcd4',
  javascript: '#ff9800', jsx: '#ff5722', python: '#9c27b0',
  json: '#607d8b', yaml: '#795548', css: '#e91e63',
  scss: '#f06292', html: '#ff6f00', text: '#9e9e9e',
  shell: '#424242', rust: '#bf360c', go: '#00acc1',
};

export function langColor(language: string): string {
  return LANG_COLORS[language] ?? '#9e9e9e';
}


// ── Dendrogram cut helpers ────────────────────────────────────────────────────

function buildChildToParent(model: GraphModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const edge of model.allEdges()) {
    if (edge.kind !== 'merges') continue;
    const src = model.getNode(edge.source);
    if (src?.kind === 'cluster' && (src.meta as ClusterMeta).scope === 'global') {
      map.set(edge.target, edge.source);
    }
  }
  return map;
}

function cutClusterFor(
  fileId: string,
  childToParent: Map<string, string>,
  model: GraphModel,
  cutLevel: number,
): string | null {
  let current = fileId;
  let result: string | null = null;
  for (let guard = 0; guard < 200; guard++) {
    const parentId = childToParent.get(current);
    if (!parentId) break;
    const parent = model.getNode(parentId);
    if (!parent) break;
    if ((parent.meta as ClusterMeta).level <= cutLevel) {
      result = parentId;
      current = parentId;
    } else {
      break;
    }
  }
  return result;
}

function dendrogramCut(model: GraphModel, cutLevel: number): Map<string, string> {
  const childToParent = buildChildToParent(model);
  const fileToCluster = new Map<string, string>();
  for (const file of model.nodesByKind('file')) {
    const cid = cutClusterFor(file.id, childToParent, model, cutLevel);
    if (cid) fileToCluster.set(file.id, cid);
  }
  return fileToCluster;
}


// ── Filesystem depth helpers ──────────────────────────────────────────────────

/**
 * Returns the "frontier" folder nodes at depth `d` from `rootId`.
 * Leaf folders at depth < d are included unchanged — they cannot expand further.
 */
function frontierFolders(model: GraphModel, rootId: string, depth: number): GraphNode[] {
  const childFolders = model.children(rootId).filter((n) => n.kind === 'folder');
  if (depth === 0 || childFolders.length === 0) return childFolders;
  return childFolders.flatMap((f) => {
    const grandchildren = model.children(f.id).filter((n) => n.kind === 'folder');
    return grandchildren.length === 0 ? [f] : frontierFolders(model, f.id, depth - 1);
  });
}

/** All file nodes recursively below a folder via contains edges. */
function filesInSubtree(model: GraphModel, folderId: string): GraphNode[] {
  return model.children(folderId).flatMap((child) =>
    child.kind === 'file' ? [child] :
    child.kind === 'folder' ? filesInSubtree(model, child.id) : [],
  );
}

/** Maximum folder depth below `folderId` (0 if no child folders). */
export function maxDepthBelow(model: GraphModel, folderId: string): number {
  const childFolders = model.children(folderId).filter((n) => n.kind === 'folder');
  if (childFolders.length === 0) return 0;
  return 1 + Math.max(...childFolders.map((f) => maxDepthBelow(model, f.id)));
}

/** Returns the project root folder ID (the single folder with no parent). */
export function projectRoot(model: GraphModel): string {
  const root = model.nodesByKind('folder').find((f) => !model.parent(f.id));
  return root?.id ?? 'folder::';
}


// ── Auto HAC level ────────────────────────────────────────────────────────────

/**
 * Selects the global HAC cut level that produces approximately
 * floor(sqrt(fileCount)) clusters, capped between 3 and 12.
 * Used for both visual sub-cluster grouping and inter-folder edge generation.
 */
function autoHacLevel(fileCount: number, model: GraphModel): number {
  const target = Math.min(12, Math.max(3, Math.floor(Math.sqrt(fileCount))));
  const allFiles = model.nodesByKind('file');

  const maxLevel = allFiles.length < 2 ? 0 : Math.max(
    0,
    ...model.nodesByKind('cluster')
      .filter((c) => (c.meta as ClusterMeta).scope === 'global')
      .map((c) => (c.meta as ClusterMeta).level),
  );

  if (maxLevel === 0) return 0;

  const childToParent = buildChildToParent(model);
  let bestLevel = Math.floor(maxLevel / 2);
  let bestDiff = Infinity;

  for (let level = 0; level <= maxLevel; level++) {
    const clusters = new Set(
      allFiles.map((f) => cutClusterFor(f.id, childToParent, model, level)).filter(Boolean),
    );
    const diff = Math.abs(clusters.size - target);
    if (diff < bestDiff) { bestDiff = diff; bestLevel = level; }
    if (clusters.size <= 1) break;
  }
  return bestLevel;
}


// ── Main element builder ──────────────────────────────────────────────────────

/**
 * Builds Cytoscape elements for a depth-based unified graph view.
 *
 * Structural compounds = frontier folders at the given depth.
 * Semantic sub-clusters = HAC groupings of files within each structural compound.
 * Edges = between semantic sub-clusters across different frontier folders
 *         when they share the same global HAC concept.
 */
export function graphElements(
  model: GraphModel,
  rootId: string,
  depth: number,
): CyElement[] {
  const elements: CyElement[] = [];

  // Frontier folder compounds at this depth
  const frontier = frontierFolders(model, rootId, depth);

  // Map each frontier folder to the file IDs in its full subtree
  const folderToFileIds = new Map<string, string[]>();
  const coveredIds = new Set<string>();

  for (const folder of frontier) {
    const ids = filesInSubtree(model, folder.id).map((f) => f.id);
    folderToFileIds.set(folder.id, ids);
    ids.forEach((id) => coveredIds.add(id));
  }

  // Remaining files: in rootId's subtree but not in any frontier folder
  const allRootFileIds = filesInSubtree(model, rootId).map((f) => f.id);
  const remainingIds = allRootFileIds.filter((id) => !coveredIds.has(id));

  // Single HAC cut level for the whole view (consistent grouping + edge semantics)
  const hacLevel = autoHacLevel(allRootFileIds.length, model);
  const cut = dendrogramCut(model, hacLevel);

  // globalClusterId → [{ subId, folderId }] — for inter-folder edge generation
  type SubEntry = { subId: string; folderId: string };
  const globalToSubs = new Map<string, SubEntry[]>();

  /**
   * Adds semantic sub-cluster compounds + file leaves within a parent compound.
   * If all files map to the same cluster, files go directly into the parent (no sub-compound).
   */
  const addContents = (parentId: string, fileIds: string[]) => {
    if (fileIds.length === 0) return;

    // Group by global HAC cluster
    const clusterToFiles = new Map<string, string[]>();
    for (const fid of fileIds) {
      const cid = cut.get(fid) ?? '__none';
      if (!clusterToFiles.has(cid)) clusterToFiles.set(cid, []);
      clusterToFiles.get(cid)!.push(fid);
    }

    const useSubClusters = clusterToFiles.size > 1;

    for (const [cid, cfids] of clusterToFiles) {
      let fileParent = parentId;

      if (useSubClusters) {
        const subId = `sub::${parentId}::${cid}`;
        const label = cid !== '__none' ? (model.getNode(cid)?.label ?? '') : '';
        elements.push({ data: { id: subId, label, kind: 'subcluster', parent: parentId } });
        fileParent = subId;

        if (cid !== '__none') {
          const arr = globalToSubs.get(cid) ?? [];
          arr.push({ subId, folderId: parentId });
          globalToSubs.set(cid, arr);
        }
      }

      for (const fid of cfids) {
        const file = model.getNode(fid);
        if (!file) continue;
        elements.push({ data: {
          id: fid, label: file.label, kind: 'file', parent: fileParent,
          color: langColor((file.meta as FileMeta).language),
          language: (file.meta as FileMeta).language,
        } });
      }
    }
  };

  // Frontier folder structural compounds
  for (const folder of frontier) {
    elements.push({ data: { id: folder.id, label: folder.label, kind: 'folder' } });
    addContents(folder.id, folderToFileIds.get(folder.id) ?? []);
  }

  // Root-files compound (FR-29): files not inside any frontier folder
  if (remainingIds.length > 0) {
    const REMAINING_ID = `remaining::${rootId}`;
    elements.push({ data: { id: REMAINING_ID, label: 'root files', kind: 'folder' } });
    addContents(REMAINING_ID, remainingIds);
  }

  // Edges between sub-cluster compounds across different frontier folders
  // that share the same global HAC concept (FR-08 similar edges)
  const seen = new Set<string>();
  for (const [, subs] of globalToSubs) {
    if (subs.length < 2) continue;
    for (let i = 0; i < subs.length; i++) {
      for (let j = i + 1; j < subs.length; j++) {
        const a = subs[i]!;
        const b = subs[j]!;
        if (a.folderId === b.folderId) continue; // same structural compound — skip
        const [lo, hi] = a.subId < b.subId ? [a.subId, b.subId] : [b.subId, a.subId];
        const edgeId = `similar::${lo}::${hi}`;
        if (seen.has(edgeId)) continue;
        seen.add(edgeId);
        elements.push({ data: { id: edgeId, label: '', kind: 'similar', source: a.subId, target: b.subId } });
      }
    }
  }

  return elements;
}


// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGraphModel(
  model: GraphModel | null,
  rootId: string,
  depth: number,
): { elements: CyElement[] } {
  const elements = useMemo(() => {
    if (!model) return [];
    return graphElements(model, rootId, depth);
  }, [model, rootId, depth]);

  return { elements };
}
