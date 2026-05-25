/** Edge visibility toggles. Structural containment is shown through compound nesting. */

import React from 'react';
import { EdgeKind } from '@cograph/core';

// 'similar' communicates shared semantic concepts between clusters (on by default).
// 'reference' is for future LSP / user-accepted links (off by default).
const EDGE_KINDS: EdgeKind[] = ['similar', 'reference'];

export interface Filters {
  edges: Set<EdgeKind>;
}

interface Props {
  filters: Filters;
  onChange: (filters: Filters) => void;
}

export function FilterPanel({ filters, onChange }: Props) {
  const toggleEdge = (kind: EdgeKind) => {
    const next = new Set(filters.edges);
    next.has(kind) ? next.delete(kind) : next.add(kind);
    onChange({ edges: next });
  };

  return (
    <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontWeight: 'bold', color: '#555' }}>Edges</span>
      {EDGE_KINDS.map((k) => (
        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
          <input type="checkbox" checked={filters.edges.has(k)} onChange={() => toggleEdge(k)} />
          {k}
        </label>
      ))}
    </div>
  );
}
