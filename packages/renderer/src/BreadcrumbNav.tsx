/**
 * Breadcrumb navigation bar.
 * Shows the full path from workspace root to the current context as clickable chips.
 * Each entry in `navStack` is a container ID; labels are looked up from the model.
 */

import React from 'react';
import { GraphModel } from '@cograph/core';

interface Props {
  model: GraphModel;
  navStack: string[];           // ordered list of container IDs, root-first
  onNavigateTo: (id: string) => void;
}

const CRUMB_LINK: React.CSSProperties = {
  color: '#1565c0', cursor: 'pointer', textDecoration: 'underline',
  textUnderlineOffset: '2px', fontSize: 12, whiteSpace: 'nowrap',
};
const CRUMB_CURRENT: React.CSSProperties = {
  color: '#333', cursor: 'default', fontWeight: 700,
  fontSize: 12, whiteSpace: 'nowrap',
};
const SEP: React.CSSProperties = {
  color: '#bbb', fontSize: 14, userSelect: 'none',
};

export function BreadcrumbNav({ model, navStack, onNavigateTo }: Props) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {navStack.map((id, i) => {
        const label = model.getNode(id)?.label || id.replace(/^(folder|file|block):+/, '') || '/';
        const isCurrent = i === navStack.length - 1;
        return (
          <React.Fragment key={id}>
            {i > 0 && <span style={SEP}>›</span>}
            <span
              style={isCurrent ? CRUMB_CURRENT : CRUMB_LINK}
              onClick={() => !isCurrent && onNavigateTo(id)}
            >
              {label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}
