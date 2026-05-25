/**
 * Depth slider and root-path breadcrumb navigation.
 *
 * The depth slider controls which level of the filesystem tree is shown as
 * the primary structural grouping.  The breadcrumb shows the path from the
 * project root to the currently selected root folder and allows one-click
 * navigation to any ancestor.
 */

import React from 'react';

export interface BreadcrumbItem {
  id: string;
  label: string;
}

interface Props {
  depth: number;
  maxDepth: number;
  breadcrumb: BreadcrumbItem[];   // path from project root to selected root
  onChange: (depth: number) => void;
  onBreadcrumbClick: (id: string) => void;
}

export function DepthNav({ depth, maxDepth, breadcrumb, onChange, onBreadcrumbClick }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>

      {/* Breadcrumb — root context */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 11, alignItems: 'center' }}>
        {breadcrumb.map((crumb, i) => (
          <React.Fragment key={crumb.id}>
            {i > 0 && <span style={{ color: '#bbb' }}>/</span>}
            <span
              style={{
                color: i < breadcrumb.length - 1 ? '#1565c0' : '#333',
                cursor: i < breadcrumb.length - 1 ? 'pointer' : 'default',
                fontWeight: i === breadcrumb.length - 1 ? 700 : 400,
              }}
              onClick={() => i < breadcrumb.length - 1 && onBreadcrumbClick(crumb.id)}
            >
              {crumb.label}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Depth slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#777', whiteSpace: 'nowrap' }}>
          depth {depth}/{maxDepth}
        </span>
        <input
          type="range"
          min={0}
          max={maxDepth}
          value={depth}
          disabled={maxDepth === 0}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1, minWidth: 80 }}
        />
      </div>

    </div>
  );
}

/** @deprecated Use DepthNav */
export { DepthNav as LayerNav };
