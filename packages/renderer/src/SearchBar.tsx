/** Free-text semantic search — embeds the query and colors nodes by distance. */

import React, { useState, useCallback } from 'react';
import { EmbeddingProvider } from '@cograph/core';

interface Props {
  provider: EmbeddingProvider | null;
  onSearch: (query: string, vector: number[]) => void;
  onClear: () => void;
}

export function SearchBar({ provider, onSearch, onClear }: Props) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = useCallback(async () => {
    if (!provider || !value.trim()) return;
    setLoading(true);
    try {
      const [vec] = await provider.embed([value]);
      if (vec) onSearch(value, vec);
    } finally {
      setLoading(false);
    }
  }, [provider, value, onSearch]);

  const clear = () => { setValue(''); onClear(); };

  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Search…"
        style={{ flex: 1, padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', fontSize: 12 }}
      />
      <button onClick={submit} disabled={loading || !value.trim()} style={{ fontSize: 12, padding: '4px 8px' }}>
        {loading ? '…' : '⌕'}
      </button>
      {value && <button onClick={clear} style={{ fontSize: 12, padding: '4px 8px' }}>✕</button>}
    </div>
  );
}
