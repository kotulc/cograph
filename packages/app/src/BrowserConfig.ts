/** IConfigStore implementation using localStorage. */

import { IConfigStore, CoGraphConfig } from '@cograph/core';

const KEY = 'cograph:config';

export class BrowserConfig implements IConfigStore {
  async load(): Promise<CoGraphConfig | null> {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    try { return JSON.parse(raw) as CoGraphConfig; } catch { return null; }
  }

  async save(config: CoGraphConfig): Promise<void> {
    localStorage.setItem(KEY, JSON.stringify(config));
  }

  exportJSON(): void {
    const data = localStorage.getItem(KEY) ?? '{}';
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '.cograph.json';
    a.click();
    URL.revokeObjectURL(url);
  }
}
