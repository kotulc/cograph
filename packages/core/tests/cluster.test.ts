import { describe, it, expect } from 'vitest';
import { GraphModel } from '../src/graph.js';
import { GraphNode } from '../src/types.js';
import { clusterFileChunks, clusterFiles, buildClusters, cosine } from '../src/cluster.js';
import { MockEmbedder } from './helpers/MockEmbedder.js';
import { embedChunks } from '../src/embed.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function addFileWithChunks(model: GraphModel, fileId: string, contents: string[]): void {
  const file: GraphNode = { id: fileId, kind: 'file', label: fileId, meta: { language: 'text' } };
  model.addNode(file);
  contents.forEach((content, i) => {
    const chunk: GraphNode & { content: string } = {
      id: `${fileId}::chunk::${i}`, kind: 'chunk',
      label: `chunk[${i}]`, meta: { position: i }, content,
    };
    model.addNode(chunk as unknown as GraphNode);
    model.addEdge({ id: `${fileId}::e${i}`, source: fileId, target: chunk.id, kind: 'contains', weight: 1 });
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

describe('clusterFileChunks (Pass 1)', () => {
  it('adds local cluster nodes for a file with multiple chunks', async () => {
    const model = new GraphModel();
    addFileWithChunks(model, 'file::a', ['chunk text one two', 'chunk text three four', 'chunk text five six']);
    await embedChunks(model, new MockEmbedder(), { updatedAt: '', chunks: {}, representatives: {} });
    clusterFileChunks('file::a', model);

    const clusters = model.nodesByKind('cluster');
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters.every((c) => (c.meta as { scope: string }).scope === 'local')).toBe(true);
  });

  it('stores a representative on the file node after pass 1', async () => {
    const model = new GraphModel();
    addFileWithChunks(model, 'file::b', ['alpha beta', 'gamma delta']);
    await embedChunks(model, new MockEmbedder(), { updatedAt: '', chunks: {}, representatives: {} });
    clusterFileChunks('file::b', model);

    const file = model.getNode('file::b')!;
    const rep = (file.meta as { representative?: number[] }).representative;
    expect(rep).toBeDefined();
    expect(rep!.length).toBeGreaterThan(0);
  });

  it('all merges edges point from a cluster parent to a child', async () => {
    const model = new GraphModel();
    addFileWithChunks(model, 'file::c', ['a b c', 'd e f', 'g h i']);
    await embedChunks(model, new MockEmbedder(), { updatedAt: '', chunks: {}, representatives: {} });
    clusterFileChunks('file::c', model);

    const mergesEdges = model.allEdges().filter((e) => e.kind === 'merges');
    for (const edge of mergesEdges) {
      expect(model.getNode(edge.source)?.kind).toBe('cluster');
    }
  });
});

describe('clusterFiles (Pass 2)', () => {
  it('adds global cluster nodes when multiple files are present', async () => {
    const model = new GraphModel();
    addFileWithChunks(model, 'file::x', ['text about bikes wheels spokes']);
    addFileWithChunks(model, 'file::y', ['content about trails enduro riding']);
    addFileWithChunks(model, 'file::z', ['discussion of carbon fiber rims weight']);
    const cache = { updatedAt: '', chunks: {}, representatives: {} };
    await embedChunks(model, new MockEmbedder(), cache);
    for (const f of model.nodesByKind('file')) clusterFileChunks(f.id, model);
    clusterFiles(model);

    const globals = model.nodesByKind('cluster').filter((c) => (c.meta as { scope: string }).scope === 'global');
    expect(globals.length).toBeGreaterThan(0);
  });
});

describe('buildClusters (full pipeline)', () => {
  it('produces both local and global clusters', async () => {
    const model = new GraphModel();
    for (let i = 0; i < 4; i++) {
      addFileWithChunks(model, `file::${i}`, [`content alpha ${i}`, `content beta ${i}`]);
    }
    const cache = { updatedAt: '', chunks: {}, representatives: {} };
    await embedChunks(model, new MockEmbedder(), cache);
    buildClusters(model);

    const local = model.nodesByKind('cluster').filter((c) => (c.meta as { scope: string }).scope === 'local');
    const global = model.nodesByKind('cluster').filter((c) => (c.meta as { scope: string }).scope === 'global');
    expect(local.length).toBeGreaterThan(0);
    expect(global.length).toBeGreaterThan(0);
  });

  it('no flat semantic edges exist — only merges edges from clusters', async () => {
    const model = new GraphModel();
    for (let i = 0; i < 3; i++) {
      addFileWithChunks(model, `file::${i}`, [`sample text ${i}`]);
    }
    await embedChunks(model, new MockEmbedder(), { updatedAt: '', chunks: {}, representatives: {} });
    buildClusters(model);

    const semantic = model.allEdges().filter((e) => e.kind === 'merges');
    const mergeSourcesAreAllClusters = semantic.every(
      (e) => model.getNode(e.source)?.kind === 'cluster',
    );
    expect(mergeSourcesAreAllClusters).toBe(true);
  });
});
