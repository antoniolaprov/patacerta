import { config } from './config.js';
import { pool } from './db.js';

const WEEKDAY = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/** Parses "1-5=8-18,6=8-13" into { weekday: [open, close] } (ISO weekdays, 1 = Monday). */
export function parseHours(spec: string) {
  const hours: Record<number, [number, number]> = {};
  for (const part of spec.split(',')) {
    const m = /^\s*(\d)(?:-(\d))?\s*=\s*(\d{1,2})-(\d{1,2})\s*$/.exec(part);
    if (!m) continue;
    const from = Number(m[1]);
    const to = Number(m[2] ?? m[1]);
    for (let d = from; d <= to; d++) hours[d] = [Number(m[3]), Number(m[4])];
  }
  return hours;
}

/** "segunda a sexta, das 8h às 18h; sábado, das 8h às 13h; domingo fechado". */
export function describeHours(spec: string) {
  const hours = parseHours(spec);
  const groups: { from: number; to: number; range: string }[] = [];
  for (let d = 1; d <= 7; d++) {
    const range = hours[d] ? `das ${hours[d][0]}h às ${hours[d][1]}h` : 'fechado';
    const last = groups[groups.length - 1];
    if (last && last.range === range && last.to === d - 1) last.to = d;
    else groups.push({ from: d, to: d, range });
  }
  return groups
    .map((g) => {
      const days = g.from === g.to ? WEEKDAY[g.from] : `${WEEKDAY[g.from]} a ${WEEKDAY[g.to]}`;
      return g.range === 'fechado' ? `${days} fechado` : `${days}, ${g.range}`;
    })
    .join('; ');
}

let cache: { at: number; text: string } | null = null;

/**
 * The clinic facts every agent needs to be specific: contact, hours, the real
 * catalog with prices, and which service takes care of which health item.
 */
export async function clinicProfile() {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.text;
  const { rows } = await pool.query(
    `SELECT id, name, type, duration_min, price_cents FROM services WHERE active ORDER BY type, name`,
  );
  const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  // The ids are here so the agent can go straight to the agenda (one model call less per turn).
  const catalog = rows
    .map((s) => `- ${s.name} (${s.duration_min} min): ${brl(s.price_cents)} · servico_id ${s.id}`)
    .join('\n');
  const text = `SOBRE A CLÍNICA
- Nome: ${config.CLINIC_NAME}, pet shop e clínica veterinária. Telefone: ${config.CLINIC_PHONE}.
- Funcionamento: ${describeHours(config.CLINIC_HOURS)}. Não ofereça horário fora disso.
- Serviços e preços (os únicos que existem; nunca invente outro serviço, preço ou desconto):
${catalog || '- (catálogo indisponível)'}
- Qual serviço resolve cada cuidado:
  - vacinas (V10, V5 felina, antirrábica, gripe canina): "Aplicação de vacina";
  - vermífugo e retornos de acompanhamento: "Consulta clínica" (a veterinária aplica e avalia);
  - exames de sangue ou urina: "Exames laboratoriais";
  - higiene: "Banho completo" ou "Banho e tosa".
- Espécies: banho e tosa só para cães e gatos. Para roedores e aves, ofereça consulta, nunca banho.`;
  cache = { at: Date.now(), text };
  return text;
}
