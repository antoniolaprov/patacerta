import { z } from 'zod';
import { defineTool, ToolError } from '../agent.js';
import { callApi, clinicDateTime } from '../api-client.js';
import { createPix } from './payments.js';

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
      horarios: slots.slice(0, 12).map((s) => ({ inicio: s.startsAt, quando: clinicDateTime(s.startsAt) })),
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

const setStatusCanceled = (token: string, id: string, notes: string) =>
  callApi<ApiAppointment>(token, 'PATCH', `/appointments/${id}/status`, { status: 'CANCELED', notes });

export const reschedule = defineTool({
  name: 'remarcar_agendamento',
  description:
    'Muda o horário de um agendamento existente (id de meus_agendamentos ou agendamentos_do_dia). O antigo só é cancelado depois que o novo horário for confirmado.',
  schema: z.object({
    agendamento_id: z.string().uuid(),
    novo_inicio: z.string().datetime({ offset: true }).describe('Um horário retornado por horarios_disponiveis'),
  }),
  async run({ agendamento_id, novo_inicio }, ctx) {
    const list = await callApi<(ApiAppointment & { pet: { id: string } })[]>(ctx.token, 'GET', '/appointments');
    const old = list.find((a) => a.id === agendamento_id);
    if (!old) throw new ToolError('Agendamento não encontrado');
    if (!ACTIVE.includes(old.status)) throw new ToolError('Esse agendamento não está ativo para ser remarcado');
    const create = () =>
      callApi<ApiAppointment>(ctx.token, 'POST', '/appointments', {
        petId: old.pet.id,
        serviceId: old.service.id,
        startsAt: novo_inicio,
        notes: `${old.notes ? `${old.notes} · ` : ''}Remarcado pela assistente Pata`,
      });
    let created: ApiAppointment;
    try {
      created = await create();
    } catch (err) {
      // The new time overlaps the old one for the same pet: free the old slot first,
      // and put it back if the new time still can't be booked.
      if (!(err instanceof ToolError) || !/já tem um atendimento/i.test(err.message)) throw err;
      await setStatusCanceled(ctx.token, old.id, 'Remarcado pela assistente Pata');
      try {
        created = await create();
      } catch (retryErr) {
        await callApi(ctx.token, 'POST', '/appointments', {
          petId: old.pet.id,
          serviceId: old.service.id,
          startsAt: old.startsAt,
          notes: old.notes ?? undefined,
        }).catch(() => undefined);
        throw retryErr;
      }
      return { remarcado: summarize(created), antes: clinicDateTime(old.startsAt) };
    }
    await setStatusCanceled(ctx.token, old.id, 'Remarcado pela assistente Pata');
    return { remarcado: summarize(created), antes: clinicDateTime(old.startsAt) };
  },
  describe: (_a, r) => {
    const { remarcado, antes } = r as { remarcado: ReturnType<typeof summarize>; antes: string };
    return `Remarcou ${remarcado.servico} de ${remarcado.pet}: de ${antes} para ${remarcado.quando}`;
  },
});

export const bookPackage = defineTool({
  name: 'agendar_pacote',
  description:
    'Agenda dois ou mais serviços seguidos para o mesmo pet (ex.: banho e depois vacina). Cada um começa quando o anterior termina. Se algum horário não puder ser agendado, desfaz tudo e explica o motivo.',
  schema: z.object({
    pet_id: z.string().uuid(),
    servicos: z.array(z.string().uuid()).min(2).max(4).describe('ids dos serviços, na ordem em que acontecem'),
    inicio: z.string().datetime({ offset: true }).describe('Início do primeiro serviço (de horarios_disponiveis)'),
    observacao: z.string().max(300).optional(),
  }),
  async run({ pet_id, servicos, inicio, observacao }, ctx) {
    const catalog = await callApi<ApiService[]>(ctx.token, 'GET', '/services');
    const done: ApiAppointment[] = [];
    let cursor = new Date(inicio);
    for (const id of servicos) {
      const service = catalog.find((s) => s.id === id);
      if (!service) throw new ToolError(`Serviço ${id} não existe no catálogo`);
      try {
        const a = await callApi<ApiAppointment>(ctx.token, 'POST', '/appointments', {
          petId: pet_id,
          serviceId: id,
          startsAt: cursor.toISOString(),
          notes: `${observacao ? `${observacao} · ` : ''}Pacote agendado pela assistente Pata`,
        });
        done.push(a);
      } catch (err) {
        // All or nothing: undo what was already booked in this package.
        await Promise.all(done.map((a) => setStatusCanceled(ctx.token, a.id, 'Pacote desfeito').catch(() => undefined)));
        const reason = err instanceof ToolError ? err.message : 'erro inesperado';
        throw new ToolError(`Não deu para agendar ${service.name} em ${clinicDateTime(cursor)}: ${reason}. Nada foi agendado.`);
      }
      cursor = new Date(cursor.getTime() + service.durationMin * 60_000);
    }
    const total = servicos.reduce((t, id) => t + (catalog.find((s) => s.id === id)?.priceCents ?? 0), 0);
    return { agendamentos: done.map(summarize), total: brl(total) };
  },
  describe: (_a, r) => {
    const { agendamentos, total } = r as { agendamentos: ReturnType<typeof summarize>[]; total: string };
    return `Agendou pacote para ${agendamentos[0]?.pet}: ${agendamentos.map((a) => `${a.servico} (${a.quando})`).join(' + ')} · total ${total}`;
  },
});

/** Tutors manage their own pets' agenda; the API enforces ownership. */
export const tutorTools = [listServices, availableSlots, book, bookPackage, reschedule, myAppointments, cancel, createPix];
/** The clinic team can book for any pet. */
export const staffSchedulingTools = [listServices, availableSlots, book, bookPackage, reschedule, cancel, createPix];
