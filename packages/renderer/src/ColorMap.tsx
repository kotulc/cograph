/** Metric selector, color scale legend, and per-node color computation. */

import React from 'react';

export type Metric = 'language' | 'degree' | 'chunkCount' | 'tightness' | 'searchDistance';

const METRICS: { value: Metric; label: string }[] = [
  { value: 'language', label: 'Language' },
  { value: 'degree', label: 'Connections' },
  { value: 'chunkCount', label: 'Chunk count' },
  { value: 'tightness', label: 'Cluster tightness' },
  { value: 'searchDistance', label: 'Search distance' },
];

interface Props {
  metric: Metric;
  onChange: (m: Metric) => void;
}

export function ColorMap({ metric, onChange }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap' }}>Color by</span>
      <select
        value={metric}
        onChange={(e) => onChange(e.target.value as Metric)}
        style={{ fontSize: 12, padding: '2px 4px', borderRadius: 4, border: '1px solid #ccc' }}
      >
        {METRICS.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
    </div>
  );
}
