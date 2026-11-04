import { createServer } from 'node:http';
import cors from 'cors';
import express, { type Response } from 'express';
import { z } from 'zod';
import { Assistant, type AssistantEvent } from './assistant.js';
import { isStaff, requireAuth } from './auth.js';
import { config } from './config.js';
import { ensureSchema, pool } from './db.js';
import { reindexAll, startIndexer } from './indexer.js';
import { createProvider } from './llm.js';
import { startRealtime } from './realtime.js';
import { startReminders } from './reminders.js';

const assistant = new Assistant(createProvider(), config.RETRIEVAL_TOP_K);

const chatBody = z.object({
  message: z.string().trim().min(1).max(2000),
  petId: z.string().uuid().optional(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
    .max(30)
    .optional(),
});

/** Streams assistant events as Server-Sent Events. */
async function streamEvents(res: Response, events: AsyncIterable<AssistantEvent>) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  let closed = false;
  res.on('close', () => (closed = true));
  try {
    for await (const event of events) {
      if (closed) break;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
  } catch (err) {
    console.error('[sse]', err);
    if (!closed) {
      res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: 'Erro inesperado' })}\n\n`);
    }
  }
  res.end();
}

async function main() {
  await ensureSchema();

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM knowledge_chunks');
  if (rows[0].n === 0) {
    console.log('[boot] base de conhecimento vazia, indexando dados existentes...');
    console.log(`[boot] ${await reindexAll()} documentos indexados`);
  }

  const app = express();
  app.use(cors({ origin: config.CORS_ORIGINS.split(',') }));
  app.use(express.json({ limit: '200kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'patacerta-ai', embeddings: config.EMBEDDINGS_PROVIDER });
  });

  app.post('/chat', requireAuth, async (req, res) => {
    const parsed = chatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Mensagem inválida', issues: parsed.error.issues });
      return;
    }
    const { message, history, petId } = parsed.data;
    await streamEvents(res, assistant.ask({ user: req.user!, question: message, history, petId }));
  });

  app.post('/assist/pet-brief/:petId', requireAuth, async (req, res) => {
    if (!isStaff(req.user!)) {
      res.status(403).json({ message: 'Recurso exclusivo da equipe' });
      return;
    }
    const petId = z.string().uuid().safeParse(req.params.petId);
    if (!petId.success) {
      res.status(400).json({ message: 'Pet inválido' });
      return;
    }
    await streamEvents(res, assistant.petBrief(req.user!, petId.data));
  });

  const http = createServer(app);
  const { emit } = startRealtime(http);
  startIndexer();
  startReminders(emit);

  http.listen(config.AI_PORT, () => {
    console.log(`[boot] serviço de IA em http://localhost:${config.AI_PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
