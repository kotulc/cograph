/**
 * Slide-in panel that shows an element's representative tokens when clicked.
 * Appears on the right side of the canvas; dismissed by clicking ✕ or elsewhere.
 */

import React from 'react';

export interface TokenPanelProps {
  elementId: string | null;    // null = hidden
  tokens: string[];
  onClose: () => void;
}

const PANEL: React.CSSProperties = {
  position: 'absolute', top: 0, right: 0, bottom: 0,
  width: 260, zIndex: 20,
  background: '#fff', borderLeft: '1px solid #e0e0e0',
  boxShadow: '-2px 0 8px rgba(0,0,0,0.08)',
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
};

const HEADER: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 14px', borderBottom: '1px solid #e0e0e0',
  background: '#f5f5f5',
};

const CLOSE_BTN: React.CSSProperties = {
  border: 'none', background: 'none', cursor: 'pointer',
  fontSize: 18, color: '#757575', lineHeight: 1, padding: 2,
};

const TOKEN_LIST: React.CSSProperties = {
  flex: 1, overflowY: 'auto', padding: '12px 14px',
  display: 'flex', flexDirection: 'column', gap: 6,
};

const TOKEN_CHIP: React.CSSProperties = {
  fontSize: 12, padding: '3px 8px', borderRadius: 12,
  background: '#e3f2fd', color: '#1565c0', wordBreak: 'break-word',
};

const EMPTY: React.CSSProperties = {
  fontSize: 12, color: '#bbb', fontStyle: 'italic', paddingTop: 8,
};

export function TokenPanel({ elementId, tokens, onClose }: TokenPanelProps) {
  if (!elementId) return null;

  return (
    <div style={PANEL}>
      <div style={HEADER}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#333' }}>Tokens</span>
        <button style={CLOSE_BTN} onClick={onClose} title="Close">✕</button>
      </div>
      <div style={TOKEN_LIST}>
        {tokens.length > 0 ? (
          tokens.map((tok, i) => (
            <span key={i} style={TOKEN_CHIP}>{tok}</span>
          ))
        ) : (
          <span style={EMPTY}>No tokens recorded for this element.</span>
        )}
      </div>
    </div>
  );
}
