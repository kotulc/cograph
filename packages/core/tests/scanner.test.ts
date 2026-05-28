/**
 * Scanner tests using the /sample directory as the fixture.
 * Assertions target structural properties (node kinds, edge topology, binary exclusion)
 * so that any project with a similar layout can substitute for the sample.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { walkDir } from '../src/scanner.js';
import { NodeFileReader } from './helpers/NodeFileReader.js';
import { FileMeta } from '../src/types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Configurable — substitute any project root here
const SAMPLE_ROOT = resolve(__dirname, '../../../sample/frww');

const reader = new NodeFileReader();

describe('walkDir (sample project)', () => {
  it('emits at least one folder node', async () => {
    const { model } = await walkDir(SAMPLE_ROOT, reader);
    expect(model.nodesByKind('folder').length).toBeGreaterThan(0);
  });

  it('emits at least one file node', async () => {
    const { model } = await walkDir(SAMPLE_ROOT, reader);
    expect(model.nodesByKind('file').length).toBeGreaterThan(0);
  });

  it('emits at least one element per text file (binary files have no elements)', async () => {
    const { model } = await walkDir(SAMPLE_ROOT, reader);
    const BINARY_LANGS = new Set(['image', 'pdf', 'video', 'audio', 'font', 'archive']);
    const textFiles = model.nodesByKind('file')
      .filter((f) => !BINARY_LANGS.has((f.meta as FileMeta).language));
    const elements = model.nodesByKind('element');
    expect(elements.length).toBeGreaterThanOrEqual(textFiles.length);
  });

  it('binary file nodes carry expandable:false and have no element children', async () => {
    const { model } = await walkDir(SAMPLE_ROOT, reader);
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const imageFiles = model.nodesByKind('file').filter((f) => {
      const label = f.label.toLowerCase();
      return imageExtensions.some((ext) => label.endsWith(ext));
    });
    expect(imageFiles.length).toBeGreaterThan(0);
    for (const f of imageFiles) {
      expect((f.meta as FileMeta).expandable).toBe(false);
      const children = model.children(f.id).filter((c) => c.kind === 'element');
      expect(children.length, `Binary file ${f.label} should have no element children`).toBe(0);
    }
  });

  it('every text file node has at least one element child via contains edge', async () => {
    const { model } = await walkDir(SAMPLE_ROOT, reader);
    const BINARY_LANGS = new Set(['image', 'pdf', 'video', 'audio', 'font', 'archive']);
    const textFiles = model.nodesByKind('file')
      .filter((f) => !BINARY_LANGS.has((f.meta as FileMeta).language));
    for (const file of textFiles) {
      const kids = model.children(file.id).filter((c) => c.kind === 'element');
      expect(kids.length, `Text file ${file.label} has no element children`).toBeGreaterThan(0);
    }
  });

  it('every non-root folder node has a parent via contains edge', async () => {
    const { model } = await walkDir(SAMPLE_ROOT, reader);
    const folders = model.nodesByKind('folder');
    const nonRoot = folders.filter((f) => (f.meta as { depth: number }).depth > 0);
    for (const folder of nonRoot) {
      expect(model.parent(folder.id), `Folder ${folder.label} has no parent`).toBeDefined();
    }
  });

  it('no node stores a path in its meta', async () => {
    const { model } = await walkDir(SAMPLE_ROOT, reader);
    for (const node of model.allNodes()) {
      expect((node.meta as Record<string, unknown>)['path']).toBeUndefined();
      expect((node.meta as Record<string, unknown>)['absolutePath']).toBeUndefined();
    }
  });

  it('pathIndex maps sample root to the root folder node id', async () => {
    const { pathIndex } = await walkDir(SAMPLE_ROOT, reader);
    const rootId = pathIndex.byPath.get(SAMPLE_ROOT);
    expect(rootId).toBeDefined();
    expect(rootId).toMatch(/^folder::/);
  });
});
