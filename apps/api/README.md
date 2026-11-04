# PataCerta API

API principal em NestJS com Drizzle ORM e PostgreSQL.

```bash
npm install
npm run db:migrate   # aplica as migrações em ./drizzle
npm run db:seed      # dados de exemplo
npm run start:dev    # http://localhost:3000/api, Swagger em /docs
npm test
```

Ao alterar `src/db/schema.ts`, gere a migração com `npm run db:generate`.

Módulos: `auth` (JWT), `pets`, `appointments` (disponibilidade, conflitos e status), `records` (prontuário e pendências), `services`, `users` e `dashboard`. Mudanças relevantes são enviadas ao serviço de IA pela fila `indexing` e por Redis pub/sub (`src/events`).
