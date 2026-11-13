import { z } from 'zod';
import { defineTool, ToolError } from '../agent.js';
import { callApi, clinicDateTime } from '../api-client.js';

interface ApiService {
  id: string;
  name: string;
  type: string;
  durationMin: number;
  priceCents: number;
}
interface ApiSlot {
  startsAt: string;
  available: number;
}
interface ApiAppointment {
  id: string;
  startsAt: string;
  status: string;
  notes: string | null;
  pet: { id: string; name: string };
  service: { id: string; name: string };
}

const ACTIVE = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');
const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const summarize = (a: ApiAppointment) => ({
  agendamento_id: a.id,
  pet: a.pet.name,
  servico: a.service.name,
  quando: clinicDateTime(a.startsAt),
  status: a.status,
});

export const listServices = defineTool({
  name: 'listar_servicos',
  description: 'Lista os serviços da clínica (banho, tosa, consulta, vacina, exames) com id, duração e preço.',
  schema: z.object({}),
  async run(_args, ctx) {
    const services = await callApi<ApiService[]>(ctx.token, 'GET', '/services');
    return services.map((s) => ({
      servico_id: s.id,
      nome: s.name,
      tipo: s.type,
      duracao_min: s.durationMin,
      preco: brl(s.priceCents),
    }));
  },
  describe: (_a, r) => `Consultou o catálogo (${(r as unknown[]).length} serviços)`,
});

export const availableSlots = defineTool({
  name: 'horarios_disponiveis',
  description:
    'Horários livres de um serviço em um dia. Use o campo `inicio` retornado ao chamar `agendar`.',
  schema: z.object({ servico_id: z.string().uuid(), data: date.describe('Dia no formato AAAA-MM-DD') }),
  async run({ servico_id, data }, ctx) {
    const slots = await callApi<ApiSlot[]>(
      ctx.token,
      'GET',
      `/appointments/availability?serviceId=${servico_id}&date=${data}`,
    );
    return {
      data,
      horarios: slots.slice(0, 16).map((s) => ({ inicio: s.startsAt, quando: clinicDateTime(s.startsAt), vagas: s.available })),
      total_livres: slots.length,
    };
  },
  describe: ({ data }, r) =>
    `Consultou a agenda de ${data.split('-').reverse().join('/')}: ${(r as { total_livres: number }).total_livres} horários livres`,
});

export const book = defineTool({
  name: 'agendar',
  description:
    'Cria um agendamento. `inicio` deve ser um horário retornado por `horarios_disponiveis`. A API valida capacidade e conflitos.',
  schema: z.object({
    pet_id: z.string().uuid(),
    servico_id: z.string().uuid(),
    inicio: z.string().datetime({ offset: true }),
    observacao: z.string().max(300).optional(),
  }),
  async run({ pet_id, servico_id, inicio, observacao }, ctx) {
    const a = await callApi<ApiAppointment>(ctx.token, 'POST', '/appointments', {
      petId: pet_id,
      serviceId: servico_id,
      startsAt: inicio,
      notes: observacao ? `${observacao} (agendado pela assistente Pata)` : 'Agendado pela assistente Pata',
    });
    return summarize(a);
  },
  describe: (_a, r) => {
    const s = r as ReturnType<typeof summarize>;
    return `Agendou ${s.servico} de ${s.pet} para ${s.quando}`;
  },
});

export const myAppointments = defineTool({
  name: 'meus_agendamentos',
  description: 'Lista os próximos agendamentos ativos dos pets deste tutor, com o id de cada um.',
  schema: z.object({}),
  async run(_args, ctx) {
    const list = await callApi<ApiAppointment[]>(ctx.token, 'GET', '/appointments');
    const now = Date.now();
    return list
      .filter((a) => ACTIVE.includes(a.status) && new Date(a.startsAt).getTime() >= now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map(summarize);
  },
  describe: (_a, r) => `Consultou os próximos agendamentos (${(r as unknown[]).length})`,
});

export const cancel = defineTool({
  name: 'cancelar_agendamento',
  description:
    'Cancela um agendamento pelo id (obtido em `meus_agendamentos`). Só use quando a pessoa pedir claramente.',
  schema: z.object({
    agendamento_id: z.string().uuid(),
    motivo: z.string().max(200).optional(),
  }),
  async run({ agendamento_id, motivo }, ctx) {
    const a = await callApi<ApiAppointment>(ctx.token, 'PATCH', `/appointments/${agendamento_id}/status`, {
      status: 'CANCELED',
      notes: motivo ? `Cancelado pela assistente Pata: ${motivo}` : 'Cancelado pela assistente Pata',
    });
    if (a.status !== 'CANCELED') throw new ToolError('Não foi possível cancelar');
    return summarize(a);
  },
  describe: (_a, r) => {
    const s = r as ReturnType<typeof summarize>;
    return `Cancelou ${s.servico} de ${s.pet} (${s.quando})`;
  },
});

/** Tutors manage their own pets' agenda; the API enforces ownership. */
export const tutorTools = [listServices, availableSlots, book, myAppointments, cancel];
/** The clinic team can book for any pet. */
export const staffSchedulingTools = [listServices, availableSlots, book, cancel];
