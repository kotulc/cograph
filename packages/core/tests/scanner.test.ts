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

  it('emits at least one chunk per text file', async () => {
    const { model } = await walkDir(SAMPLE_ROOT, reader);
    const files = model.nodesByKind('file');
    const chunks = model.nodesByKind('chunk');
    expect(chunks.length).toBeGreaterThanOrEqual(files.length);
  });

  it('does not emit nodes for image/binary files', async () => {
    const { model } = await walkDir(SAMPLE_ROOT, reader);
    const allLabels = model.allNodes().map((n) => n.label);
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    for (const label of allLabels) {
      const lower = label.toLowerCase();
      for (const ext of imageExtensions) {
        expect(lower.endsWith(ext), `Unexpected image node: ${label}`).toBe(false);
      }
    }
  });

  it('every file node has at least one chunk child via contains edge', async () => {
    const { model } = await walkDir(SAMPLE_ROOT, reader);
    for (const file of model.nodesByKind('file')) {
      const kids = model.children(file.id).filter((c) => c.kind === 'chunk');
      expect(kids.length, `File ${file.label} has no chunk children`).toBeGreaterThan(0);
    }
  });

  it('every non-root folder node has a parent via contains edge', async () => {
    const { model } = await walkDir(SAMPLE_ROOT, reader);
    const folders = model.nodesByKind('folder');
    // All folders except the root (depth 0) should have a parent
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
