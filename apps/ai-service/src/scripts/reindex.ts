import { ensureSchema, pool } from '../db.js';
import { reindexAll } from '../indexer.js';

await ensureSchema();
await pool.query('TRUNCATE knowledge_chunks');
const total = await reindexAll();
console.log(`${total} documentos indexados.`);
await pool.end();
