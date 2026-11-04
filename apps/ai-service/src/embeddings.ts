import { config, EMBEDDING_DIM } from './config.js';

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Runs a multilingual sentence-transformer locally through ONNX. The model is
 * downloaded once (≈120 MB) and cached; after that no data leaves the server.
 */
class LocalEmbedder implements Embedder {
  private extractor?: Promise<(texts: string[], opts: object) => Promise<{ tolist(): number[][] }>>;

  private load() {
    this.extractor ??= import('@huggingface/transformers').then(
      ({ pipeline }) =>
        pipeline('feature-extraction', config.EMBEDDING_MODEL) as unknown as (
          texts: string[],
          opts: object,
        ) => Promise<{ tolist(): number[][] }>,
    );
    return this.extractor;
  }

  async embed(texts: string[]) {
    const extract = await this.load();
    const output = await extract(texts, { pooling: 'mean', normalize: true });
    return output.tolist();
  }
}

/**
 * Feature-hashing embedder: tokens and character trigrams are hashed into a
 * fixed-size vector. Far weaker than a real model, but deterministic and
 * offline, which makes it ideal for tests and CI.
 */
export class HashEmbedder implements Embedder {
  constructor(private readonly dim = EMBEDDING_DIM) {}

  async embed(texts: string[]) {
    return texts.map((text) => this.vector(text));
  }

  private vector(text: string) {
    const v = new Array<number>(this.dim).fill(0);
    const words = normalize(text).split(/\s+/).filter((w) => w.length > 2);
    for (const word of words) {
      v[hash(word) % this.dim] += 2;
      const padded = `#${word}#`;
      for (let i = 0; i < padded.length - 2; i++) {
        v[hash(padded.slice(i, i + 3)) % this.dim] += 1;
      }
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
}

export function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const embedder: Embedder =
  config.EMBEDDINGS_PROVIDER === 'hash' ? new HashEmbedder() : new LocalEmbedder();

export async function embedOne(text: string) {
  const [vector] = await embedder.embed([text]);
  return vector;
}
