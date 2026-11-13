import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgent, type AgentStep } from './agent.js';
import type { CompleteResult, LlmProvider } from './llm.js';
import { createPix } from './tools/payments.js';

const ID = '3f2b8c1e-aaaa-4bbb-8ccc-1234567890ab';
const ctx = { user: { id: 'u1', name: 'Ana', role: 'TUTOR' as const }, token: 'tutor-token' };

function scripted(script: CompleteResult[]) {
  const seen: Parameters<LlmProvider['complete']>[0][] = [];
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

async function run(reply: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(reply), { status }));
  vi.stubGlobal('fetch', fetchMock);
  const { llm, seen } = scripted([
    { text: '', toolCalls: [{ id: 'c1', name: 'gerar_pix', args: { agendamento_id: ID } }] },
    { text: 'Pronto, é só copiar o código.', toolCalls: [] },
  ]);
  const steps: AgentStep[] = [];
  for await (const s of runAgent({ llm, system: 's', messages: [{ role: 'user', content: 'quero pagar' }], tools: [createPix], ctx })) {
    steps.push(s);
  }
  return { steps, seen, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe('gerar_pix', () => {
  it('pede o Pix ao n8n com o token de quem pediu e entrega o código só ao app', async () => {
    const code = '00020126...6304ABCD';
    const { steps, seen, fetchMock } = await run({ ok: true, valor: 'R$ 65,00', descricao: 'Banho de Thor', pix_copia_e_cola: code });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tutor-token');
    expect(JSON.parse(init.body as string)).toEqual({ agendamento_id: ID });

    const action = steps.find((s) => s.type === 'action');
    expect(action).toMatchObject({ ok: true, data: { amount: 'R$ 65,00', code } });
    // O modelo não recebe o código (não pode reescrevê-lo errado).
    expect(JSON.stringify(seen[1].messages)).not.toContain(code);
    expect(JSON.stringify(seen[1].messages)).toContain('R$ 65,00');
  });

  it('devolve ao modelo o motivo quando o n8n recusa', async () => {
    const { steps, seen } = await run({ ok: false, erro: 'Esse agendamento foi cancelado.' });
    expect(steps.find((s) => s.type === 'action')).toMatchObject({ ok: false });
    expect(JSON.stringify(seen[1].messages)).toContain('foi cancelado');
  });

  it('trata o n8n fora do ar como erro de ferramenta', async () => {
    const { steps } = await run({}, 404);
    expect(steps.find((s) => s.type === 'action')).toMatchObject({ ok: false });
  });
});
