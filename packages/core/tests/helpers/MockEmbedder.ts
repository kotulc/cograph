/**
 * Deterministic mock embedder for tests.
 * Produces unit-norm vectors based on a simple hash of the input text,
 * so semantically identical strings always get the same vector.
 */

import { EmbeddingProvider } from '../../src/embed.js';

const DIM = 16;

function hashVec(text: string): number[] {
  // Simple deterministic vector: hash each character position into a dimension
  const vec = new Array<number>(DIM).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % DIM] += text.charCodeAt(i) / 1000;
  }
  // Normalize to unit length
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}

export class MockEmbedder implements EmbeddingProvider {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(hashVec);
  }
}
