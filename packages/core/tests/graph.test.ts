import { describe, it, expect, beforeEach } from 'vitest';
import { GraphModel } from '../src/graph.js';
import { GraphNode, GraphEdge } from '../src/types.js';

const makeFile = (id: string): GraphNode => ({
  id, kind: 'file', label: id, meta: { language: 'markdown' },
});

const makeFolder = (id: string): GraphNode => ({
  id, kind: 'folder', label: id, meta: { depth: 0 },
});

const makeEdge = (id: string, source: string, target: string): GraphEdge => ({
  id, source, target, kind: 'contains', weight: 1,
});

describe('GraphModel', () => {
  let model: GraphModel;

  beforeEach(() => { model = new GraphModel(); });

  it('addNode / getNode round-trip', () => {
    const node = makeFile('f1');
    model.addNode(node);
    expect(model.getNode('f1')).toEqual(node);
  });

  it('removeNode also removes incident edges', () => {
    model.addNode(makeFolder('root'));
    model.addNode(makeFile('child'));
    model.addEdge(makeEdge('e1', 'root', 'child'));
    model.removeNode('child');
    expect(model.getNode('child')).toBeUndefined();
    expect(model.allEdges()).toHaveLength(0);
  });

  it('children() returns only contains-outgoing neighbors', () => {
    model.addNode(makeFolder('root'));
    model.addNode(makeFile('a'));
    model.addNode(makeFile('b'));
    model.addEdge(makeEdge('e1', 'root', 'a'));
    model.addEdge(makeEdge('e2', 'root', 'b'));
    const kids = model.children('root').map((n) => n.id).sort();
    expect(kids).toEqual(['a', 'b']);
  });

  it('parent() returns the contains-incoming node', () => {
    model.addNode(makeFolder('root'));
    model.addNode(makeFile('child'));
    model.addEdge(makeEdge('e1', 'root', 'child'));
    expect(model.parent('child')?.id).toBe('root');
  });

  it('nodesByKind filters correctly', () => {
    model.addNode(makeFolder('f'));
    model.addNode(makeFile('a'));
    model.addNode(makeFile('b'));
    expect(model.nodesByKind('folder')).toHaveLength(1);
    expect(model.nodesByKind('file')).toHaveLength(2);
  });

  it('toJSON / fromJSON round-trip preserves all nodes and edges', () => {
    model.addNode(makeFolder('root'));
    model.addNode(makeFile('child'));
    model.addEdge(makeEdge('e1', 'root', 'child'));
    const json = model.toJSON();
    const restored = GraphModel.fromJSON(json);
    expect(restored.allNodes()).toHaveLength(2);
    expect(restored.allEdges()).toHaveLength(1);
    expect(restored.children('root')[0]?.id).toBe('child');
  });

  it('subgraph contains only the requested nodes and connecting edges', () => {
    model.addNode(makeFolder('root'));
    model.addNode(makeFile('a'));
    model.addNode(makeFile('b'));
    model.addEdge(makeEdge('e1', 'root', 'a'));
    model.addEdge(makeEdge('e2', 'root', 'b'));
    const sub = model.subgraph(['root', 'a']);
    expect(sub.allNodes()).toHaveLength(2);
    expect(sub.allEdges()).toHaveLength(1);
  });
});
