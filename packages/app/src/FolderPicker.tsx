/**
 * Folder picker using <input webkitdirectory>.
 * Works in Chrome, Firefox, Edge, and Safari — no File System Access API required.
 */

import React, { useRef } from 'react';

interface Props {
  onPick: (files: FileList) => void;
}

export function FolderPicker({ onPick }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) onPick(files);
    // Reset so the same folder can be re-selected
    e.target.value = '';
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 16,
    }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1565c0' }}>cograph</h1>
      <p style={{ color: '#555', fontSize: 14 }}>Semantic graph visualisation of your project</p>

      {/* Hidden file input with webkitdirectory */}
      <input
        ref={inputRef}
        type="file"
        // @ts-expect-error — webkitdirectory is not in TS lib but is universally supported
        webkitdirectory=""
        multiple
        style={{ display: 'none' }}
        onChange={handleChange}
      />

      <button
        onClick={() => inputRef.current?.click()}
        style={{
          padding: '10px 24px', fontSize: 16, borderRadius: 6,
          background: '#1565c0', color: '#fff', border: 'none', cursor: 'pointer',
        }}
      >
        Open folder…
      </button>

      <p style={{ fontSize: 12, color: '#aaa', maxWidth: 320, textAlign: 'center' }}>
        Works in Chrome, Firefox, Edge, and Safari.
        The first scan downloads the embedding model (~22 MB); subsequent runs are fully offline.
      </p>
    </div>
  );
}
