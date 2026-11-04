import dotenv from 'dotenv';
import { z } from 'zod';

// Reads the app's own .env first, then the monorepo root one.
dotenv.config({ path: ['.env', '../../.env'], quiet: true });

const schema = z.object({
  AI_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(1),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:4200'),
  CLINIC_TIMEZONE: z.string().default('America/Recife'),

  /**
   * `local` runs a multilingual sentence-transformer on this machine (no API key).
   * `hash` is a deterministic, dependency-free fallback used in tests and offline demos.
   */
  EMBEDDINGS_PROVIDER: z.enum(['local', 'hash']).default('local'),
  EMBEDDING_MODEL: z.string().default('Xenova/paraphrase-multilingual-MiniLM-L12-v2'),

  /** `anthropic` uses the Claude API; `ollama` runs an open model locally. */
  LLM_PROVIDER: z.enum(['anthropic', 'ollama']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-sonnet-5-5'),
  OLLAMA_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen2.5:7b'),

  RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(8),
  REMINDER_INTERVAL_MIN: z.coerce.number().positive().default(60),
});

export const config = schema.parse(process.env);
export type Config = typeof config;

/** Vector size produced by the embedding models above. */
export const EMBEDDING_DIM = 384;
