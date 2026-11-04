import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';
import { loadAllDocuments, loadDocument, type SourceType } from './documents.js';
import { deleteSource, upsertDocuments } from './store.js';

export type IndexJob =
  | { kind: SourceType; id: string }
  | { kind: 'delete'; sourceType: SourceType; id: string };

export async function handleJob(job: IndexJob) {
  if (job.kind === 'delete') {
    await deleteSource(job.sourceType, job.id);
    return 'deleted';
  }
  const doc = await loadDocument(job.kind, job.id);
  if (!doc) {
    // The row is gone (e.g. deleted right after the job was queued).
    await deleteSource(job.kind, job.id);
    return 'missing';
  }
  await upsertDocuments([doc]);
  return 'indexed';
}

/** Consumes the queue fed by the API whenever pets, records or appointments change. */
export function startIndexer() {
  const worker = new Worker<IndexJob>(
    'indexing',
    async (job) => handleJob(job.data),
    {
      connection: new Redis(config.REDIS_URL, { maxRetriesPerRequest: null }),
      concurrency: 4,
    },
  );
  worker.on('failed', (job, err) =>
    console.error(`[indexer] job ${job?.id} falhou: ${err.message}`),
  );
  return worker;
}

export async function reindexAll() {
  const docs = await loadAllDocuments();
  await upsertDocuments(docs);
  return docs.length;
}
