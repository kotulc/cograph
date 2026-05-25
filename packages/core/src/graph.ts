/** In-memory graph model with typed node/edge kinds and O(1) adjacency lookup. */

import { GraphNode, GraphEdge, NodeKind, EdgeKind, AnyEdgeKind } from './types.js';


export class GraphModel {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();

  // adjacency: nodeId → Set of edgeIds (both directions)
  private adj = new Map<string, Set<string>>();


  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.adj.has(node.id)) this.adj.set(node.id, new Set());
  }

  removeNode(id: string): void {
    for (const eid of this.adj.get(id) ?? []) {
      const edge = this.edges.get(eid);
      if (edge) {
        const other = edge.source === id ? edge.target : edge.source;
        this.adj.get(other)?.delete(eid);
      }
      this.edges.delete(eid);
    }
    this.nodes.delete(id);
    this.adj.delete(id);
  }

  addEdge(edge: GraphEdge): void {
    this.edges.set(edge.id, edge);
    this._touch(edge.source).add(edge.id);
    this._touch(edge.target).add(edge.id);
  }

  removeEdge(id: string): void {
    const edge = this.edges.get(id);
    if (!edge) return;
    this.adj.get(edge.source)?.delete(id);
    this.adj.get(edge.target)?.delete(id);
    this.edges.delete(id);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  updateNode(id: string, patch: Partial<Pick<GraphNode, 'label' | 'vector' | 'meta'>>): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.nodes.set(id, { ...node, ...patch });
  }

  allNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  allEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }

  nodesByKind(kind: NodeKind): GraphNode[] {
    return this.allNodes().filter((n) => n.kind === kind);
  }

  /** All neighbors of `id`, optionally filtered by edge kind (including internal kinds). */
  neighbors(id: string, kind?: AnyEdgeKind): GraphNode[] {
    const result: GraphNode[] = [];
    for (const eid of this.adj.get(id) ?? []) {
      const edge = this.edges.get(eid);
      if (!edge || (kind && edge.kind !== kind)) continue;
      const nid = edge.source === id ? edge.target : edge.source;
      const n = this.nodes.get(nid);
      if (n) result.push(n);
    }
    return result;
  }

  /** Direct children via outgoing `contains` edges. */
  children(id: string): GraphNode[] {
    const result: GraphNode[] = [];
    for (const eid of this.adj.get(id) ?? []) {
      const edge = this.edges.get(eid);
      if (!edge || edge.kind !== 'contains' || edge.source !== id) continue;
      const n = this.nodes.get(edge.target);
      if (n) result.push(n);
    }
    return result;
  }

  /** Parent via incoming `contains` edge. */
  parent(id: string): GraphNode | undefined {
    for (const eid of this.adj.get(id) ?? []) {
      const edge = this.edges.get(eid);
      if (edge?.kind === 'contains' && edge.target === id) {
        return this.nodes.get(edge.source);
      }
    }
    return undefined;
  }

  /** All edges incident to `id`, optionally filtered by kind (including internal kinds). */
  edgesOf(id: string, kind?: AnyEdgeKind): GraphEdge[] {
    return Array.from(this.adj.get(id) ?? [])
      .map((eid) => this.edges.get(eid)!)
      .filter((e) => e && (!kind || e.kind === kind));
  }

  subgraph(ids: string[]): GraphModel {
    const set = new Set(ids);
    const sub = new GraphModel();
    for (const id of ids) {
      const n = this.nodes.get(id);
      if (n) sub.addNode(n);
    }
    for (const e of this.edges.values()) {
      if (set.has(e.source) && set.has(e.target)) sub.addEdge(e);
    }
    return sub;
  }

  toJSON(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return { nodes: this.allNodes(), edges: this.allEdges() };
  }

  static fromJSON(data: { nodes: GraphNode[]; edges: GraphEdge[] }): GraphModel {
    const model = new GraphModel();
    for (const n of data.nodes) model.addNode(n);
    for (const e of data.edges) model.addEdge(e);
    return model;
  }


  private _touch(id: string): Set<string> {
    let s = this.adj.get(id);
    if (!s) { s = new Set(); this.adj.set(id, s); }
    return s;
  }
}
