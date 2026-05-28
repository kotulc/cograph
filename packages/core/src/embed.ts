/** Embedding provider interface and @huggingface/transformers implementation. */

import { GraphModel } from './graph.js';
import { VectorCache } from './types.js';


export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}


// ── Transformers.js embedder (lazy-loaded, runs in-browser via WASM) ───────────

export class TransformersEmbedder implements EmbeddingProvider {
  private extractor: unknown = null;
  private readonly model: string;
  private readonly batchSize: number;

  constructor(model = 'Xenova/all-MiniLM-L6-v2', batchSize = 64) {
    this.model = model;
    this.batchSize = batchSize;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.extractor) {
      const { pipeline, env } = await import('@huggingface/transformers');

      // Disable multi-threading — avoids the SharedArrayBuffer COOP/COEP
      // requirement that blocks Firefox and non-HTTPS environments.
      if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
      env.allowLocalModels = false;

      this.extractor = await pipeline('feature-extraction', this.model);
    }

    type Extractor = (
      texts: string[],
      opts: { pooling: string; normalize: boolean },
    ) => Promise<{ data: Float32Array; dims: number[] }>;

    const pipe = this.extractor as Extractor;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const output = await pipe(batch, { pooling: 'mean', normalize: true });

      const [batchSize, dim] = output.dims;
      for (let j = 0; j < (batchSize ?? batch.length); j++) {
        results.push(Array.from(output.data.slice(j * (dim ?? 0), (j + 1) * (dim ?? 0))));
      }
    }

    return results;
  }
}


// ── Graph embedding pass ──────────────────────────────────────────────────────

/**
 * Embeds all element nodes in `model` using `provider`.
 * Skips elements whose id is already present in `cache.elements`.
 * Mutates element node vectors and updates the cache in place.
 */
export async function embedElements(
  model: GraphModel,
  provider: EmbeddingProvider,
  cache: VectorCache,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const elements = model.nodesByKind('element');
  const toEmbed = elements.filter((e) => !cache.elements[e.id]);
  const total = toEmbed.length;
  let done = 0;

  const BATCH = 64;
  for (let i = 0; i < toEmbed.length; i += BATCH) {
    const batch = toEmbed.slice(i, i + BATCH);
    const texts = batch.map((e) => (e as unknown as { content: string }).content ?? e.label);
    const vectors = await provider.embed(texts);

    batch.forEach((element, j) => {
      const vec = vectors[j] ?? [];
      model.updateNode(element.id, { vector: vec });
      cache.elements[element.id] = vec;
    });

    done += batch.length;
    onProgress?.(done, total);
  }

  // Restore cached vectors for already-embedded elements
  for (const element of elements) {
    if (cache.elements[element.id] && !element.vector) {
      model.updateNode(element.id, { vector: cache.elements[element.id] });
    }
  }
}
