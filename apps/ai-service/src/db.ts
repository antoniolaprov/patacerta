import pg from 'pg';
import { config, EMBEDDING_DIM } from './config.js';

/*
 * Vectors are sent as text with `pgvector.toSql()` and never read back, so the
 * pool doesn't need pgvector's custom type parsers.
 */
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

/**
 * The AI service owns its own table. The API never reads it: it only tells this
 * service (through the queue) which records changed.
 */
export async function ensureSchema() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_type text NOT NULL,
      source_id   uuid NOT NULL,
      pet_id      uuid NOT NULL,
      tutor_id    uuid NOT NULL,
      title       text NOT NULL,
      content     text NOT NULL,
      occurred_at timestamptz,
      embedding   vector(${EMBEDDING_DIM}) NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source_type, source_id)
    );
    CREATE INDEX IF NOT EXISTS knowledge_chunks_tutor_idx ON knowledge_chunks (tutor_id);
    CREATE INDEX IF NOT EXISTS knowledge_chunks_pet_idx ON knowledge_chunks (pet_id);
    CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
      ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
  `);
}
