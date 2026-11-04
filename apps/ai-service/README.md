# PataCerta AI Service

Serviço Node responsável pela assistente (RAG), pelo streaming das respostas e pelos eventos em tempo real.

```bash
npm install
npm run dev        # http://localhost:4000
npm run reindex    # reconstrói a base vetorial a partir do banco
npm test
```

| Rota | Descrição |
| --- | --- |
| `POST /chat` | Pergunta à assistente. Resposta em Server-Sent Events: `meta`, `sources`, `token`, `done` |
| `POST /assist/pet-brief/:petId` | Resumo pré-atendimento (somente equipe) |
| WebSocket | Eventos `appointment:*`, `record:created` e `reminder` |

Arquivos principais: `documents.ts` (texto de cada registro), `store.ts` (pgvector e isolamento por tutor), `context.ts` (fatos via SQL), `prompt.ts`, `assistant.ts` (orquestração), `llm.ts` (Claude ou Ollama) e `indexer.ts` (consumidor da fila).
