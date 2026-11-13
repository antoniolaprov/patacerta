// Testa o código do nó "Montar Pix" fora do n8n: node --test n8n/pix.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('./workflows/ferramenta-pix.json', import.meta.url), 'utf8'));
const code = wf.nodes.find((n) => n.name === 'Montar Pix').parameters.jsCode;
const run = new Function('$env', '$', '$input', code);

const ID = '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab';
const appt = { id: ID, status: 'SCHEDULED', pet: { name: 'Thor' }, service: { name: 'Banho', priceCents: 6500 } };
const env = { PIX_KEY: 'clinica@patacerta.dev', PIX_RECEIVER_NAME: 'Clínica PataCerta', PIX_CITY: 'São Paulo' };
const call = (items, body = { agendamento_id: ID }, e = env) =>
  run(e, () => ({ first: () => ({ json: { body } }) }), { all: () => items.map((json) => ({ json })) })[0].json;

function crc16(s) {
  let c = 0xffff;
  for (const ch of s) {
    c ^= ch.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c.toString(16).toUpperCase().padStart(4, '0');
}

test('gera um BR Code válido com o valor do serviço', () => {
  const r = call([appt]);
  assert.equal(r.ok, true);
  const p = r.pix_copia_e_cola;
  assert.match(p, /^000201/);
  assert.ok(p.includes('0014br.gov.bcb.pix0121clinica@patacerta.dev'));
  assert.ok(p.includes('540565.00'), 'valor 65.00');
  assert.ok(p.includes('5917CLINICA PATACERTA'), 'nome sem acento');
  assert.ok(p.includes('6009SAO PAULO'));
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
  assert.match(r.valor, /65,00/);
  assert.equal(r.descricao, 'Banho de Thor');
});

test('recusa sem chave, sessão inválida, agendamento alheio ou cancelado', () => {
  assert.equal(call([appt], undefined, {}).ok, false);
  assert.match(call([{ error: { message: '401' } }]).erro, /Sessão/);
  assert.match(call([{}]).erro, /não encontrado/);
  assert.match(call([appt], { agendamento_id: 'outro' }).erro, /não encontrado/);
  assert.match(call([{ ...appt, status: 'CANCELED' }]).erro, /cancelado/);
});
