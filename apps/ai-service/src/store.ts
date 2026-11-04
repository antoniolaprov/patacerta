import pgvector from 'pgvector/pg';
import { pool } from './db.js';
import type { KnowledgeDocument, SourceType } from './documents.js';
import { embedder, embedOne } from './embeddings.js';

export interface Chunk {
  sourceType: SourceType;
  sourceId: string;
  petId: string;
  petName: string;
  title: string;
  content: string;
  occurredAt: Date | null;
  score: number;
}

export interface SearchScope {
  /** Restricts results to one tutor's pets. Required for tutors, omitted for staff. */
  tutorId?: string;
  petId?: string;
}

export async function upsertDocuments(docs: KnowledgeDocument[], batchSize = 32) {
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const vectors = await embedder.embed(batch.map((d) => d.content));
    await Promise.all(
      batch.map((doc, j) =>
        pool.query(
          `INSERT INTO knowledge_chunks
             (source_type, source_id, pet_id, tutor_id, title, content, occurred_at, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (source_type, source_id) DO UPDATE SET
             pet_id = EXCLUDED.pet_id, tutor_id = EXCLUDED.tutor_id, title = EXCLUDED.title,
             content = EXCLUDED.content, occurred_at = EXCLUDED.occurred_at,
             embedding = EXCLUDED.embedding, updated_at = now()`,
          [
            doc.sourceType, doc.sourceId, doc.petId, doc.tutorId, doc.title,
            doc.content, doc.occurredAt, pgvector.toSql(vectors[j]),
          ],
        ),
      ),
    );
  }
}

export async function deleteSource(sourceType: SourceType, sourceId: string) {
  await pool.query(
    sourceType === 'pet'
      ? 'DELETE FROM knowledge_chunks WHERE pet_id = $1'
      : 'DELETE FROM knowledge_chunks WHERE source_type = $2 AND source_id = $1',
    sourceType === 'pet' ? [sourceId] : [sourceId, sourceType],
  );
}

/**
 * Builds the WHERE clause that enforces data isolation. It lives in one place
 * so a tutor can never retrieve another family's records, whatever they ask.
 */
export function scopeFilter(scope: SearchScope, firstParam: number) {
  const clauses: string[] = [];
  const params: string[] = [];
  if (scope.tutorId) {
    params.push(scope.tutorId);
    clauses.push(`k.tutor_id = $${firstParam + params.length - 1}`);
  }
  if (scope.petId) {
    params.push(scope.petId);
    clauses.push(`k.pet_id = $${firstParam + params.length - 1}`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function search(query: string, scope: SearchScope, k = 8): Promise<Chunk[]> {
  const vector = await embedOne(query);
  const { where, params } = scopeFilter(scope, 3);
  const { rows } = await pool.query(
    `SELECT k.source_type, k.source_id, k.pet_id, p.name AS pet_name, k.title, k.content,
            k.occurred_at, 1 - (k.embedding <=> $1) AS score
     FROM knowledge_chunks k
     JOIN pets p ON p.id = k.pet_id
     ${where}
     ORDER BY k.embedding <=> $1
     LIMIT $2`,
    [pgvector.toSql(vector), k, ...params],
  );
  return rows.map((r) => ({
    sourceType: r.source_type,
    sourceId: r.source_id,
    petId: r.pet_id,
    petName: r.pet_name,
    title: r.title,
    content: r.content,
    occurredAt: r.occurred_at,
    score: Number(r.score),
  }));
}
