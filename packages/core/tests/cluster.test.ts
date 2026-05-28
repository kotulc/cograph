import { describe, it, expect } from 'vitest';
import { GraphModel } from '../src/graph.js';
import { GraphNode } from '../src/types.js';
import { groupFileElements, clusterFiles, buildClusters, cosine } from '../src/cluster.js';
import { MockEmbedder } from './helpers/MockEmbedder.js';
import { embedElements } from '../src/embed.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function addFileWithElements(model: GraphModel, fileId: string, contents: string[]): void {
  const file: GraphNode = { id: fileId, kind: 'file', label: fileId, meta: { language: 'text' } };
  model.addNode(file);
  contents.forEach((content, i) => {
    const element: GraphNode & { content: string } = {
      id: `${fileId}::element::${i}`, kind: 'element',
      label: `element[${i}]`, meta: { position: i }, content,
    };
    model.addNode(element as unknown as GraphNode);
    model.addEdge({ id: `${fileId}::e${i}`, source: fileId, target: element.id, kind: 'contains', weight: 1 });
  });
}

describe('cosine', () => {
  it('returns 1 for identical unit vectors', () => {
    const v = [0.6, 0.8];
    expect(cosine(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0.0);
  });
});

describe('groupFileElements (Pass 1)', () => {
  it('adds block nodes for a file with multiple elements', async () => {
    const model = new GraphModel();
    addFileWithElements(model, 'file::a', ['element text one two', 'element text three four', 'element text five six']);
    await embedElements(model, new MockEmbedder(), { updatedAt: '', elements: {}, representatives: {} });
    groupFileElements('file::a', model);

    const blocks = model.nodesByKind('block');
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('stores a representative on the file node after pass 1', async () => {
    const model = new GraphModel();
    addFileWithElements(model, 'file::b', ['alpha beta', 'gamma delta']);
    await embedElements(model, new MockEmbedder(), { updatedAt: '', elements: {}, representatives: {} });
    groupFileElements('file::b', model);

    const file = model.getNode('file::b')!;
    const rep = (file.meta as { representative?: number[] }).representative;
    expect(rep).toBeDefined();
    expect(rep!.length).toBeGreaterThan(0);
  });

  it('all merges edges point from a block parent to a child', async () => {
    const model = new GraphModel();
    addFileWithElements(model, 'file::c', ['a b c', 'd e f', 'g h i']);
    await embedElements(model, new MockEmbedder(), { updatedAt: '', elements: {}, representatives: {} });
    groupFileElements('file::c', model);

    const mergesEdges = model.allEdges().filter((e) => e.kind === 'merges');
    for (const edge of mergesEdges) {
      expect(model.getNode(edge.source)?.kind).toBe('block');
    }
  });
});

describe('clusterFiles (Pass 2)', () => {
  it('adds global cluster nodes when multiple files are present', async () => {
    const model = new GraphModel();
    addFileWithElements(model, 'file::x', ['text about bikes wheels spokes']);
    addFileWithElements(model, 'file::y', ['content about trails enduro riding']);
    addFileWithElements(model, 'file::z', ['discussion of carbon fiber rims weight']);
    const cache = { updatedAt: '', elements: {}, representatives: {} };
    await embedElements(model, new MockEmbedder(), cache);
    for (const f of model.nodesByKind('file')) groupFileElements(f.id, model);
    clusterFiles(model);

    const globals = model.nodesByKind('cluster');
    expect(globals.length).toBeGreaterThan(0);
  });
});

describe('buildClusters (full pipeline)', () => {
  it('produces both block and global cluster nodes', async () => {
    const model = new GraphModel();
    for (let i = 0; i < 4; i++) {
      addFileWithElements(model, `file::${i}`, [`content alpha ${i}`, `content beta ${i}`]);
    }
    const cache = { updatedAt: '', elements: {}, representatives: {} };
    await embedElements(model, new MockEmbedder(), cache);
    buildClusters(model);

    expect(model.nodesByKind('block').length).toBeGreaterThan(0);
    expect(model.nodesByKind('cluster').length).toBeGreaterThan(0);
  });

  it('merges edges all originate from block or cluster nodes', async () => {
    const model = new GraphModel();
    for (let i = 0; i < 3; i++) {
      addFileWithElements(model, `file::${i}`, [`sample text ${i}`]);
    }
    await embedElements(model, new MockEmbedder(), { updatedAt: '', elements: {}, representatives: {} });
    buildClusters(model);

    const mergesEdges = model.allEdges().filter((e) => e.kind === 'merges');
    for (const edge of mergesEdges) {
      const srcKind = model.getNode(edge.source)?.kind;
      expect(['block', 'cluster']).toContain(srcKind);
    }
  });
});
