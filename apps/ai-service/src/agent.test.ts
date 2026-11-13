import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, runAgent, ToolError, type AgentStep } from './agent.js';
import type { CompleteRequest, CompleteResult, LlmProvider } from './llm.js';

/** Scripted model: returns the queued results in order and records what it saw. */
function fakeLlm(script: CompleteResult[]) {
  const seen: CompleteRequest[] = [];
  const llm: LlmProvider = {
    name: 'fake',
    async *stream() {},
    async complete(req) {
      seen.push(structuredClone(req));
      return script.shift() ?? { text: 'fim', toolCalls: [] };
    },
  };
  return { llm, seen };
}

const book = defineTool({
  name: 'agendar',
  description: 'agenda',
  schema: z.object({ hora: z.string() }),
  async run({ hora }) {
    if (hora === '09:00') throw new ToolError('Esse horário acabou de ser preenchido');
    return { ok: true, hora };
  },
  describe: ({ hora }) => `Agendou às ${hora}`,
});

const ctx = { user: { id: 'u1', name: 'Ana', role: 'TUTOR' as const }, token: 't' };

async function collect(gen: AsyncGenerator<AgentStep>) {
  const steps: AgentStep[] = [];
  for await (const s of gen) steps.push(s);
  return steps;
}

describe('runAgent', () => {
  it('executa a ferramenta, devolve o erro de regra ao modelo e deixa ele corrigir', async () => {
    const { llm, seen } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'agendar', args: { hora: '09:00' } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 'agendar', args: { hora: '10:00' } }] },
      { text: 'Agendei às 10h, porque 9h estava ocupado.', toolCalls: [] },
    ]);
    const steps = await collect(
      runAgent({ llm, system: 's', messages: [{ role: 'user', content: 'banho às 9h' }], tools: [book], ctx }),
    );

    expect(steps).toEqual([
      { type: 'action', tool: 'agendar', label: 'agendar: Esse horário acabou de ser preenchido', ok: false },
      { type: 'action', tool: 'agendar', label: 'Agendou às 10:00', ok: true },
      { type: 'final', text: 'Agendei às 10h, porque 9h estava ocupado.' },
    ]);
    const firstResult = seen[1].messages.at(-1);
    expect(firstResult).toMatchObject({ role: 'tool', isError: true });
  });

  it('recusa parâmetros inválidos e ferramentas inexistentes sem quebrar', async () => {
    const { llm } = fakeLlm([
      {
        text: '',
        toolCalls: [
          { id: 'c1', name: 'agendar', args: { hora: 9 } },
          { id: 'c2', name: 'apagar_tudo', args: {} },
        ],
      },
      { text: 'Não consegui.', toolCalls: [] },
    ]);
    const steps = await collect(
      runAgent({ llm, system: 's', messages: [{ role: 'user', content: 'x' }], tools: [book], ctx }),
    );
    expect(steps.filter((s) => s.type === 'action').map((s) => s.type === 'action' && s.ok)).toEqual([false, false]);
    expect(steps.at(-1)).toEqual({ type: 'final', text: 'Não consegui.' });
  });

  it('retira as ferramentas na última rodada para o modelo não entrar em laço', async () => {
    const loop = { text: '', toolCalls: [{ id: 'c', name: 'agendar', args: { hora: '10:00' } }] };
    const { llm, seen } = fakeLlm([loop, loop, { text: 'Resumo final', toolCalls: [] }]);
    const steps = await collect(
      runAgent({ llm, system: 's', messages: [{ role: 'user', content: 'x' }], tools: [book], ctx, maxSteps: 2 }),
    );
    expect(seen.at(-1)!.tools).toEqual([]);
    expect(steps.at(-1)).toEqual({ type: 'final', text: 'Resumo final' });
  });
});
