/** Fixed-size sliding window text chunker. Splits text into overlapping word windows. */

import { IChunker } from './types.js';


export class FixedWindowChunker implements IChunker {
  /**
   * Splits text into overlapping windows of `windowSize` words.
   * `overlap` is a fraction [0, 1) of the window that carries over to the next chunk.
   */
  chunk(text: string, windowSize: number, overlap: number): string[] {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) return [];

    const step = Math.max(1, Math.floor(windowSize * (1 - overlap)));
    const chunks: string[] = [];

    for (let i = 0; i < words.length; i += step) {
      chunks.push(words.slice(i, i + windowSize).join(' '));
      if (i + windowSize >= words.length) break;
    }

    return chunks;
  }
}


export const defaultChunker: IChunker = new FixedWindowChunker();
