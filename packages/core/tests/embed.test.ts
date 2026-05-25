import { describe, it, expect } from 'vitest';
import { embedChunks } from '../src/embed.js';
import { GraphModel } from '../src/graph.js';
import { GraphNode } from '../src/types.js';
import { MockEmbedder } from './helpers/MockEmbedder.js';

function makeChunk(id: string, content: string, fileId: string): GraphNode {
  const node: GraphNode & { content: string } = {
    id, kind: 'chunk', label: id,
    meta: { position: 0 },
    content,
  };
  return node as unknown as GraphNode;
}

describe('embedChunks', () => {
  it('assigns a vector to each chunk node', async () => {
    const model = new GraphModel();
    const fileNode: GraphNode = { id: 'file::a', kind: 'file', label: 'a.md', meta: { language: 'markdown' } };
    model.addNode(fileNode);
    model.addNode(makeChunk('chunk::a::0', 'hello world text content', 'file::a'));
    model.addNode(makeChunk('chunk::a::1', 'more content here', 'file::a'));

    const cache = { updatedAt: '', chunks: {}, representatives: {} };
    await embedChunks(model, new MockEmbedder(), cache);

    for (const chunk of model.nodesByKind('chunk')) {
      expect(chunk.vector).toBeDefined();
      expect(chunk.vector!.length).toBeGreaterThan(0);
    }
  });

  it('skips chunks already in the cache', async () => {
    const model = new GraphModel();
    model.addNode(makeChunk('chunk::b::0', 'cached text', 'file::b'));
    const preVec = [0.1, 0.2, 0.3];
    const cache = { updatedAt: '', chunks: { 'chunk::b::0': preVec }, representatives: {} };

    let callCount = 0;
    const spy = {
      embed: async (texts: string[]) => { callCount += texts.length; return texts.map(() => preVec); },
    };

    await embedChunks(model, spy, cache);
    expect(callCount).toBe(0);
  });

  it('vectors are approximately unit-norm', async () => {
    const model = new GraphModel();
    model.addNode(makeChunk('chunk::c::0', 'some text for normalisation check', 'file::c'));
    const cache = { updatedAt: '', chunks: {}, representatives: {} };
    await embedChunks(model, new MockEmbedder(), cache);
    const vec = model.nodesByKind('chunk')[0]?.vector!;
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 3);
  });
});
