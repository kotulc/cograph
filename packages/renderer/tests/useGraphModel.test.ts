import { describe, it, expect } from 'vitest';
import { GraphModel } from '@cograph/core';
import { graphElements, displayChildren, projectRoot } from '../src/useGraphModel.js';


// ── Model builders ────────────────────────────────────────────────────────────

/** root → folderA (fileA1, fileA2), root → folderB (fileB1) */
function twoFolderModel() {
  const m = new GraphModel();
  const add = (id: string, kind: string, label: string, meta: object) =>
    m.addNode({ id, kind: kind as never, label, meta: meta as never });
  const link = (src: string, tgt: string, i: number) =>
    m.addEdge({ id: `e${i}`, source: src, target: tgt, kind: 'contains', weight: 1 });

  add('folder::', 'folder', 'root', { depth: 0 });
  add('folder::a', 'folder', 'a', { depth: 1 });
  add('folder::b', 'folder', 'b', { depth: 1 });
  add('file::a/f1', 'file', 'f1.md', { language: 'markdown', expandable: true });
  add('file::a/f2', 'file', 'f2.md', { language: 'markdown', expandable: true });
  add('file::b/f3', 'file', 'f3.md', { language: 'markdown', expandable: true });
  link('folder::', 'folder::a', 0);
  link('folder::', 'folder::b', 1);
  link('folder::a', 'file::a/f1', 2);
  link('folder::a', 'file::a/f2', 3);
  link('folder::b', 'file::b/f3', 4);
  return m;
}

/** root → folder::src (file::src/a) where file::src/a has two element children */
function fileWithElementsModel() {
  const m = new GraphModel();
  const add = (id: string, kind: string, label: string, meta: object) =>
    m.addNode({ id, kind: kind as never, label, meta: meta as never });
  const link = (src: string, tgt: string, i: number) =>
    m.addEdge({ id: `e${i}`, source: src, target: tgt, kind: 'contains', weight: 1 });

  add('folder::', 'folder', 'root', { depth: 0 });
  add('folder::src', 'folder', 'src', { depth: 1 });
  add('file::src/a', 'file', 'a.md', { language: 'markdown', expandable: true });
  add('element::src/a::0', 'element', 'a.md[0]', { position: 0 });
  add('element::src/a::1', 'element', 'a.md[1]', { position: 1 });
  link('folder::', 'folder::src', 0);
  link('folder::src', 'file::src/a', 1);
  link('file::src/a', 'element::src/a::0', 2);
  link('file::src/a', 'element::src/a::1', 3);
  return m;
}

/** File with a binary sibling */
function modelWithBinary() {
  const m = new GraphModel();
  const add = (id: string, kind: string, label: string, meta: object) =>
    m.addNode({ id, kind: kind as never, label, meta: meta as never });
  const link = (src: string, tgt: string, i: number) =>
    m.addEdge({ id: `e${i}`, source: src, target: tgt, kind: 'contains', weight: 1 });

  add('folder::', 'folder', 'root', { depth: 0 });
  add('file::img.png', 'file', 'img.png', { language: 'image', expandable: false });
  add('file::readme.md', 'file', 'readme.md', { language: 'markdown', expandable: true });
  add('element::readme.md::0', 'element', 'readme[0]', { position: 0 });
  link('folder::', 'file::img.png', 0);
  link('folder::', 'file::readme.md', 1);
  link('file::readme.md', 'element::readme.md::0', 2);
  return m;
}


// ── projectRoot ───────────────────────────────────────────────────────────────

describe('projectRoot', () => {
  it('returns the folder with no parent', () => {
    expect(projectRoot(twoFolderModel())).toBe('folder::');
  });
});


// ── displayChildren ───────────────────────────────────────────────────────────

describe('displayChildren', () => {
  it('folder returns sub-folders and files', () => {
    const m = twoFolderModel();
    const ids = displayChildren('folder::', m).map((n) => n.id).sort();
    expect(ids).toEqual(['folder::a', 'folder::b']);
  });

  it('file returns elements when no blocks exist', () => {
    const m = fileWithElementsModel();
    const ids = displayChildren('file::src/a', m).map((n) => n.id).sort();
    expect(ids).toEqual(['element::src/a::0', 'element::src/a::1']);
  });

  it('binary file returns no children', () => {
    const m = modelWithBinary();
    expect(displayChildren('file::img.png', m)).toHaveLength(0);
  });

  it('element returns no children (leaf)', () => {
    const m = fileWithElementsModel();
    expect(displayChildren('element::src/a::0', m)).toHaveLength(0);
  });
});


// ── graphElements — structural ────────────────────────────────────────────────

describe('graphElements — uniform containment view', () => {
  it('viewing root: emits two folder compounds with file dots inside', () => {
    const m = twoFolderModel();
    const elems = graphElements(m, 'folder::');

    // Two folder compound nodes
    const compounds = elems.filter((e) => !e.data.parent && e.data.kind === 'folder');
    expect(compounds.map((c) => c.data.id).sort()).toEqual(['folder::a', 'folder::b']);

    // Dots inside folder::a: file::a/f1 and file::a/f2
    const inA = elems.filter((e) => e.data.parent === 'folder::a');
    expect(inA.map((e) => e.data.id).sort()).toEqual(['file::a/f1', 'file::a/f2']);

    // Dots inside folder::b: file::b/f3
    const inB = elems.filter((e) => e.data.parent === 'folder::b');
    expect(inB.map((e) => e.data.id)).toEqual(['file::b/f3']);
  });

  it('viewing a folder: each file dot shown inside its folder compound', () => {
    const m = twoFolderModel();
    const elems = graphElements(m, 'folder::a');
    // folder::a is the selected context; its direct children are files
    // Files that have element children → compounds; without elements → dots
    // (no elements in this model → dots)
    const fileDots = elems.filter((e) => e.data.kind === 'file');
    expect(fileDots.map((e) => e.data.id).sort()).toEqual(['file::a/f1', 'file::a/f2']);
  });

  it('viewing a file: emits element dots (no blocks)', () => {
    const m = fileWithElementsModel();
    const elems = graphElements(m, 'file::src/a');
    const elementDots = elems.filter((e) => e.data.kind === 'element');
    expect(elementDots.map((e) => e.data.id).sort()).toEqual([
      'element::src/a::0', 'element::src/a::1',
    ]);
  });

  it('binary file shown as grey dot (no children inside compound)', () => {
    const m = modelWithBinary();
    const elems = graphElements(m, 'folder::');
    const binary = elems.find((e) => e.data.id === 'file::img.png');
    expect(binary).toBeDefined();
    expect(binary!.data.color).toBe('#bdbdbd');
    // No elements should have img.png as parent
    expect(elems.filter((e) => e.data.parent === 'file::img.png')).toHaveLength(0);
  });

  it('text file shown as compound when it has element children', () => {
    const m = fileWithElementsModel();
    const elems = graphElements(m, 'folder::src');
    // file::src/a has elements → shown as compound with element dots inside
    const fileCompound = elems.find((e) => e.data.id === 'file::src/a' && !e.data.parent);
    expect(fileCompound).toBeDefined();
    const inside = elems.filter((e) => e.data.parent === 'file::src/a');
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.every((e) => e.data.kind === 'element')).toBe(true);
  });

  it('no edges emitted in a model with no similar relationships', () => {
    const m = twoFolderModel();
    const edges = graphElements(m, 'folder::').filter((e) => 'source' in e.data);
    expect(edges).toHaveLength(0);
  });
});
