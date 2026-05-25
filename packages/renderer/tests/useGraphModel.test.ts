import { describe, it, expect } from 'vitest';
import { GraphModel } from '@cograph/core';
import { graphElements, maxDepthBelow, projectRoot } from './helpers/elementBuilders.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a minimal model: root → folderA → fileA, root → folderB → fileB */
function twoFolderModel(): { model: GraphModel; rootId: string } {
  const model = new GraphModel();
  model.addNode({ id: 'folder::', kind: 'folder', label: 'root', meta: { depth: 0 } });
  model.addNode({ id: 'folder::a', kind: 'folder', label: 'a', meta: { depth: 1 } });
  model.addNode({ id: 'folder::b', kind: 'folder', label: 'b', meta: { depth: 1 } });
  model.addNode({ id: 'file::a/f1', kind: 'file', label: 'f1.md', meta: { language: 'markdown' } });
  model.addNode({ id: 'file::b/f2', kind: 'file', label: 'f2.md', meta: { language: 'markdown' } });
  model.addEdge({ id: 'e1', source: 'folder::', target: 'folder::a', kind: 'contains', weight: 1 });
  model.addEdge({ id: 'e2', source: 'folder::', target: 'folder::b', kind: 'contains', weight: 1 });
  model.addEdge({ id: 'e3', source: 'folder::a', target: 'file::a/f1', kind: 'contains', weight: 1 });
  model.addEdge({ id: 'e4', source: 'folder::b', target: 'file::b/f2', kind: 'contains', weight: 1 });
  return { model, rootId: 'folder::' };
}

/** Builds a deeper model: root → posts → 2020 → imgFolder → imgFile */
function deepModel(): { model: GraphModel; rootId: string } {
  const model = new GraphModel();
  model.addNode({ id: 'folder::', kind: 'folder', label: 'root', meta: { depth: 0 } });
  model.addNode({ id: 'folder::posts', kind: 'folder', label: 'posts', meta: { depth: 1 } });
  model.addNode({ id: 'folder::posts/2020', kind: 'folder', label: '2020', meta: { depth: 2 } });
  model.addNode({ id: 'folder::posts/2020/images', kind: 'folder', label: 'images', meta: { depth: 3 } });
  model.addNode({ id: 'file::posts/2020/images/img.jpg', kind: 'file', label: 'img.jpg', meta: { language: 'markdown' } });
  model.addEdge({ id: 'e1', source: 'folder::', target: 'folder::posts', kind: 'contains', weight: 1 });
  model.addEdge({ id: 'e2', source: 'folder::posts', target: 'folder::posts/2020', kind: 'contains', weight: 1 });
  model.addEdge({ id: 'e3', source: 'folder::posts/2020', target: 'folder::posts/2020/images', kind: 'contains', weight: 1 });
  model.addEdge({ id: 'e4', source: 'folder::posts/2020/images', target: 'file::posts/2020/images/img.jpg', kind: 'contains', weight: 1 });
  return { model, rootId: 'folder::' };
}


// ── projectRoot ───────────────────────────────────────────────────────────────

describe('projectRoot', () => {
  it('returns the folder with no parent', () => {
    const { model } = twoFolderModel();
    expect(projectRoot(model)).toBe('folder::');
  });
});


// ── maxDepthBelow ─────────────────────────────────────────────────────────────

describe('maxDepthBelow', () => {
  it('returns 0 for a leaf folder', () => {
    const { model } = twoFolderModel();
    expect(maxDepthBelow(model, 'folder::a')).toBe(0);
  });

  it('returns 1 for root with single-level children', () => {
    const { model, rootId } = twoFolderModel();
    expect(maxDepthBelow(model, rootId)).toBe(1);
  });

  it('returns 3 for a four-level deep tree', () => {
    const { model, rootId } = deepModel();
    expect(maxDepthBelow(model, rootId)).toBe(3);
  });
});


// ── graphElements — structural ────────────────────────────────────────────────

describe('graphElements — structural', () => {
  it('emits one folder compound per immediate child at depth 0', () => {
    const { model, rootId } = twoFolderModel();
    const elems = graphElements(model, rootId, 0);
    const folders = elems.filter((e) => e.data.kind === 'folder' && !('source' in e.data));
    expect(folders.map((f) => f.data.id).sort()).toEqual(['folder::a', 'folder::b']);
  });

  it('file nodes are present at depth 0', () => {
    const { model, rootId } = twoFolderModel();
    const elems = graphElements(model, rootId, 0);
    const files = elems.filter((e) => e.data.kind === 'file');
    expect(files).toHaveLength(2);
  });

  it('no cluster or subcluster nodes emitted when all files in separate clusters', () => {
    const { model, rootId } = twoFolderModel();
    const elems = graphElements(model, rootId, 0);
    // No global clusters exist → no sub-cluster compounds
    expect(elems.filter((e) => e.data.kind === 'subcluster')).toHaveLength(0);
  });

  it('remaining-files compound is added for files directly in root', () => {
    const model = new GraphModel();
    model.addNode({ id: 'folder::', kind: 'folder', label: 'root', meta: { depth: 0 } });
    model.addNode({ id: 'folder::a', kind: 'folder', label: 'a', meta: { depth: 1 } });
    model.addNode({ id: 'file::config.toml', kind: 'file', label: 'config.toml', meta: { language: 'toml' } });
    model.addEdge({ id: 'e1', source: 'folder::', target: 'folder::a', kind: 'contains', weight: 1 });
    model.addEdge({ id: 'e2', source: 'folder::', target: 'file::config.toml', kind: 'contains', weight: 1 });

    const elems = graphElements(model, 'folder::', 0);
    const remaining = elems.find((e) => e.data.id === 'remaining::folder::');
    expect(remaining).toBeDefined();
  });
});


// ── graphElements — depth frontier ───────────────────────────────────────────

describe('graphElements — depth frontier', () => {
  it('at depth 1, leaf folders at depth 0 are still included', () => {
    // root → leafA (no children), root → posts → 2020
    const model = new GraphModel();
    model.addNode({ id: 'folder::', kind: 'folder', label: 'root', meta: { depth: 0 } });
    model.addNode({ id: 'folder::about', kind: 'folder', label: 'about', meta: { depth: 1 } });
    model.addNode({ id: 'folder::posts', kind: 'folder', label: 'posts', meta: { depth: 1 } });
    model.addNode({ id: 'folder::posts/2020', kind: 'folder', label: '2020', meta: { depth: 2 } });
    model.addEdge({ id: 'e1', source: 'folder::', target: 'folder::about', kind: 'contains', weight: 1 });
    model.addEdge({ id: 'e2', source: 'folder::', target: 'folder::posts', kind: 'contains', weight: 1 });
    model.addEdge({ id: 'e3', source: 'folder::posts', target: 'folder::posts/2020', kind: 'contains', weight: 1 });

    const elems = graphElements(model, 'folder::', 1);
    const folders = elems.filter((e) => e.data.kind === 'folder').map((e) => e.data.id);
    // about stays (leaf), posts/2020 appears (frontier), posts is collapsed
    expect(folders).toContain('folder::about');
    expect(folders).toContain('folder::posts/2020');
    expect(folders).not.toContain('folder::posts');
  });

  it('no edges emitted when no global HAC clusters exist', () => {
    const { model, rootId } = twoFolderModel();
    const elems = graphElements(model, rootId, 0);
    const edges = elems.filter((e) => 'source' in e.data && e.data.kind === 'similar');
    expect(edges).toHaveLength(0);
  });
});
