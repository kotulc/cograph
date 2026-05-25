import { describe, it, expect } from 'vitest';
import { FixedWindowChunker } from '../src/chunker.js';

const chunker = new FixedWindowChunker();

describe('FixedWindowChunker', () => {
  it('returns empty array for empty input', () => {
    expect(chunker.chunk('', 256, 0.1)).toEqual([]);
    expect(chunker.chunk('   ', 256, 0.1)).toEqual([]);
  });

  it('returns a single chunk when text fits in one window', () => {
    const result = chunker.chunk('hello world foo bar', 256, 0.1);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('hello world foo bar');
  });

  it('produces multiple chunks for text longer than windowSize', () => {
    const words = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
    const result = chunker.chunk(words, 100, 0);
    expect(result.length).toBeGreaterThan(1);
  });

  it('each chunk contains no more than windowSize words', () => {
    const words = Array.from({ length: 500 }, (_, i) => `w${i}`).join(' ');
    const result = chunker.chunk(words, 50, 0);
    for (const chunk of result) {
      expect(chunk.split(/\s+/).length).toBeLessThanOrEqual(50);
    }
  });

  it('overlap causes consecutive chunks to share words', () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
    const [first, second] = chunker.chunk(words, 10, 0.5);
    const firstWords = first!.split(' ');
    const secondWords = second!.split(' ');
    // With 50% overlap, the second chunk starts at word 5
    expect(secondWords[0]).toBe(firstWords[5]);
  });

  it('zero overlap produces non-overlapping chunks', () => {
    const words = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
    const [first, second] = chunker.chunk(words, 10, 0);
    expect(second!.split(' ')[0]).toBe('w10');
    expect(first!.split(' ').at(-1)).toBe('w9');
  });
});
