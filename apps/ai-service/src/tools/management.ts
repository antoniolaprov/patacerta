import { z } from 'zod';
import { defineTool, ToolError } from '../agent.js';
import { clinicDateTime } from '../api-client.js';
import { config } from '../config.js';
import { pool } from '../db.js';

/**
 * Read-only tools for the clinic team. Each one is a fixed, parameterized query:
 * the model picks the tool and the dates, it never writes SQL.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');
const range = z.object({
  inicio: date.describe('Primeiro dia, AAAA-MM-DD'),
  fim: date.describe('Último dia (inclusive), AAAA-MM-DD'),
});
const TZ = config.CLINIC_TIMEZONE;
const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const br = (iso: string) => iso.split('-').reverse().join('/');

function checkRange({ inicio, fim }: { inicio: string; fim: string }) {
  if (fim < inicio) throw new ToolError('A data final é anterior à inicial');
  const days = (Date.parse(fim) - Date.parse(inicio)) / 86_400_000;
  if (days > 370) throw new ToolError('Use um período de até 1 ano');
}

/** Local-midnight bounds of [inicio, fim] in the clinic's timezone. */
const BOUNDS = `a.starts_at >= ($1::date)::timestamp AT TIME ZONE '${TZ}'
  AND a.starts_at < ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'`;

export const revenue = defineTool({
  name: 'faturamento',
  description:
    'Faturamento dos atendimentos FINALIZADOS num período, total e por serviço (quantidade e valor).',
  schema: range,
  async run(args) {
    checkRange(args);
    const { rows } = await pool.query(
      `SELECT s.name, s.type, count(*)::int AS n, sum(s.price_cents)::int AS cents
       FROM appointments a JOIN services s ON s.id = a.service_id
       WHERE a.status = 'DONE' AND ${BOUNDS}
       GROUP BY s.name, s.type ORDER BY cents DESC`,
      [args.inicio, args.fim],
    );
    const total = rows.reduce((t, r) => t + r.cents, 0);
    return {
      periodo: `${br(args.inicio)} a ${br(args.fim)}`,
      total: brl(total),
      atendimentos: rows.reduce((t, r) => t + r.n, 0),
      por_servico: rows.map((r) => ({ servico: r.name, tipo: r.type, quantidade: r.n, valor: brl(r.cents) })),
    };
  },
  describe: (a, r) => `Calculou o faturamento de ${br(a.inicio)} a ${br(a.fim)}: ${(r as { total: string }).total}`,
});

export const agendaLoad = defineTool({
  name: 'ocupacao_da_agenda',
  description:
    'Quantos atendimentos ativos ou finalizados há por dia num período, por tipo de serviço. Use para achar dias cheios ou vazios.',
  schema: range,
  async run(args) {
    checkRange(args);
    const { rows } = await pool.query(
      `SELECT (a.starts_at AT TIME ZONE '${TZ}')::date AS day, s.type, count(*)::int AS n
       FROM appointments a JOIN services s ON s.id = a.service_id
       WHERE a.status <> 'CANCELED' AND ${BOUNDS}
       GROUP BY 1, 2`,
      [args.inicio, args.fim],
    );
    const days: Record<string, { total: number; por_tipo: Record<string, number> }> = {};
    for (let d = args.inicio; d <= args.fim; ) {
      days[d] = { total: 0, por_tipo: {} };
      const next = new Date(`${d}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      d = next.toISOString().slice(0, 10);
    }
    for (const r of rows) {
      const key = new Date(r.day).toISOString().slice(0, 10);
      if (!days[key]) continue;
      days[key].total += r.n;
      days[key].por_tipo[r.type] = r.n;
    }
    return Object.entries(days).map(([d, v]) => ({
      data: br(d),
      dia_semana: new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' }),
      ...v,
    }));
  },
  describe: (a) => `Analisou a ocupação da agenda de ${br(a.inicio)} a ${br(a.fim)}`,
});

export const dayAppointments = defineTool({
  name: 'agendamentos_do_dia',
  description: 'Lista os agendamentos de um dia com id, horário, pet, tutor, serviço e status.',
  schema: z.object({ data: date }),
  async run({ data }) {
    const { rows } = await pool.query(
      `SELECT a.id, a.starts_at, a.status, p.name AS pet, u.name AS tutor, s.name AS service
       FROM appointments a JOIN pets p ON p.id = a.pet_id JOIN users u ON u.id = p.tutor_id
       JOIN services s ON s.id = a.service_id
       WHERE ${BOUNDS} ORDER BY a.starts_at`,
      [data, data],
    );
    return rows.map((r) => ({
      agendamento_id: r.id,
      quando: clinicDateTime(r.starts_at),
      pet: r.pet,
      tutor: r.tutor,
      servico: r.service,
      status: r.status,
    }));
  },
  describe: ({ data }, r) => `Consultou a agenda de ${br(data)} (${(r as unknown[]).length} agendamentos)`,
});

export const inactiveClients = defineTool({
  name: 'clientes_inativos',
  description:
    'Pets sem nenhum atendimento finalizado nos últimos N dias e sem agendamento futuro (risco de perder o cliente).',
  schema: z.object({ dias: z.number().int().min(15).max(730).describe('Janela de inatividade em dias') }),
  async run({ dias }) {
    const { rows } = await pool.query(
      `SELECT p.name AS pet, p.species, u.name AS tutor, u.phone,
              max(a.starts_at) FILTER (WHERE a.status = 'DONE') AS last_visit
       FROM pets p JOIN users u ON u.id = p.tutor_id
       LEFT JOIN appointments a ON a.pet_id = p.id
       GROUP BY p.id, u.id
       HAVING coalesce(max(a.starts_at) FILTER (WHERE a.status = 'DONE'), 'epoch') < now() - make_interval(days => $1)
          AND NOT bool_or(coalesce(a.starts_at >= now() AND a.status IN ('SCHEDULED','CONFIRMED'), false))
       ORDER BY last_visit NULLS FIRST
       LIMIT 30`,
      [dias],
    );
    return rows.map((r) => ({
      pet: r.pet,
      especie: r.species,
      tutor: r.tutor,
      telefone: r.phone,
      ultimo_atendimento: r.last_visit ? clinicDateTime(r.last_visit) : 'nunca',
    }));
  },
  describe: ({ dias }, r) => `Buscou clientes sem atendimento há ${dias} dias: ${(r as unknown[]).length} encontrados`,
});

export const managementTools = [revenue, agendaLoad, dayAppointments, inactiveClients];
