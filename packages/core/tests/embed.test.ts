import { describe, it, expect } from 'vitest';
import { embedElements } from '../src/embed.js';
import { GraphModel } from '../src/graph.js';
import { GraphNode } from '../src/types.js';
import { MockEmbedder } from './helpers/MockEmbedder.js';

function makeElement(id: string, content: string): GraphNode {
  const node: GraphNode & { content: string } = {
    id, kind: 'element', label: id,
    meta: { position: 0 },
    content,
  };
  return node as unknown as GraphNode;
}

describe('embedElements', () => {
  it('assigns a vector to each element node', async () => {
    const model = new GraphModel();
    const fileNode: GraphNode = { id: 'file::a', kind: 'file', label: 'a.md', meta: { language: 'markdown' } };
    model.addNode(fileNode);
    model.addNode(makeElement('element::a::0', 'hello world text content'));
    model.addNode(makeElement('element::a::1', 'more content here'));

    const cache = { updatedAt: '', elements: {}, representatives: {} };
    await embedElements(model, new MockEmbedder(), cache);

    for (const el of model.nodesByKind('element')) {
      expect(el.vector).toBeDefined();
      expect(el.vector!.length).toBeGreaterThan(0);
    }
  });

  it('skips elements already in the cache', async () => {
    const model = new GraphModel();
    model.addNode(makeElement('element::b::0', 'cached text'));
    const preVec = [0.1, 0.2, 0.3];
    const cache = { updatedAt: '', elements: { 'element::b::0': preVec }, representatives: {} };

    let callCount = 0;
    const spy = {
      embed: async (texts: string[]) => { callCount += texts.length; return texts.map(() => preVec); },
    };

    await embedElements(model, spy, cache);
    expect(callCount).toBe(0);
  });

  it('vectors are approximately unit-norm', async () => {
    const model = new GraphModel();
    model.addNode(makeElement('element::c::0', 'some text for normalisation check'));
    const cache = { updatedAt: '', elements: {}, representatives: {} };
    await embedElements(model, new MockEmbedder(), cache);
    const vec = model.nodesByKind('element')[0]?.vector!;
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 3);
  });
});
