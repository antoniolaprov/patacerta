import { pool } from './db.js';
import { formatDate } from './documents.js';
import type { LlmProvider } from './llm.js';

export interface RetentionProposal {
  petId: string;
  petName: string;
  tutorId: string;
  tutorName: string;
  phone: string | null;
  reasons: string[];
  priority: 'alta' | 'media' | 'baixa';
  suggestedService: string;
  message: string;
  writtenBy: 'ia' | 'modelo';
}

const SERVICE_FOR: Record<string, string> = {
  VACCINE: 'Aplicação de vacina',
  DEWORMING: 'Consulta clínica',
  EXAM: 'Exames laboratoriais',
  CONSULTATION: 'Consulta clínica',
};
/** A booked appointment of this service type already takes care of the item. */
const COVERED_BY: Record<string, string[]> = {
  VACCINE: ['VACCINATION', 'CONSULTATION'],
  DEWORMING: ['CONSULTATION', 'VACCINATION'],
  EXAM: ['EXAM', 'CONSULTATION'],
  CONSULTATION: ['CONSULTATION'],
};

interface DueItem {
  title: string;
  type: string;
  due: string;
}
interface Upcoming {
  service: string;
  type: string;
  at: string;
}

/**
 * Proactive retention agent: finds pets the clinic is about to lose (care
 * items late or due soon with nothing booked, or no visit for months), and
 * writes a personal message for each one from the pet's history. The team
 * reviews and sends: the agent proposes, a person approves.
 */
export async function runRetention(llm: LlmProvider, windowDays = 30, inactiveDays = 120, limit = 6) {
  const { rows } = await pool.query(
    `WITH due AS (
       SELECT DISTINCT ON (r.pet_id, lower(r.title)) r.pet_id, r.title, r.type, r.next_due_date
       FROM medical_records r WHERE r.next_due_date IS NOT NULL
       ORDER BY r.pet_id, lower(r.title), r.date DESC
     ), visits AS (
       SELECT pet_id, max(starts_at) FILTER (WHERE status = 'DONE') AS last_visit
       FROM appointments GROUP BY pet_id
     ), upcoming AS (
       SELECT a.pet_id, jsonb_agg(jsonb_build_object('service', s.name, 'type', s.type, 'at', a.starts_at)
                                  ORDER BY a.starts_at) AS list
       FROM appointments a JOIN services s ON s.id = a.service_id
       WHERE a.starts_at >= now() AND a.status IN ('SCHEDULED', 'CONFIRMED')
       GROUP BY a.pet_id
     )
     SELECT p.id, p.name, p.species, p.notes, u.id AS tutor_id, u.name AS tutor, u.phone,
            v.last_visit, coalesce(up.list, '[]'::jsonb) AS upcoming,
            coalesce(json_agg(json_build_object('title', d.title, 'type', d.type, 'due', d.next_due_date))
                     FILTER (WHERE d.pet_id IS NOT NULL), '[]') AS items
     FROM pets p JOIN users u ON u.id = p.tutor_id
     LEFT JOIN visits v ON v.pet_id = p.id
     LEFT JOIN upcoming up ON up.pet_id = p.id
     LEFT JOIN due d ON d.pet_id = p.id AND d.next_due_date <= now() + make_interval(days => $1)
     GROUP BY p.id, u.id, v.last_visit, up.list`,
    [windowDays],
  );

  const now = Date.now();
  const candidates = rows.flatMap((r) => {
    const upcoming = r.upcoming as Upcoming[];
    // Items already handled by something booked are not a reason to call.
    const items = (r.items as DueItem[])
      .filter((i) => !upcoming.some((u) => (COVERED_BY[i.type] ?? []).includes(u.type)))
      .sort((a, b) => a.due.localeCompare(b.due));
    const late = items.filter((i) => new Date(i.due).getTime() < now);
    const idleDays = r.last_visit ? Math.round((now - new Date(r.last_visit).getTime()) / 86_400_000) : null;
    const idle = !upcoming.length && (idleDays === null || idleDays > inactiveDays);
    if (!items.length && !idle) return [];

    const reasons = [
      ...items.map((i) =>
        new Date(i.due).getTime() < now
          ? `${i.title} atrasado(a) desde ${formatDate(i.due)}`
          : `${i.title} vence em ${formatDate(i.due)}`,
      ),
      ...(idle ? [idleDays === null ? 'Nenhuma visita finalizada registrada' : `Sem visitas há ${idleDays} dias`] : []),
    ];
    // A visit already booked is a chance to solve the pending item in the same trip.
    const ride = items.length ? upcoming[0] : undefined;
    if (ride) reasons.push(`Já tem ${ride.service} marcado para ${formatDate(ride.at)}: dá para resolver na mesma visita`);
    const priority: RetentionProposal['priority'] = late.length ? 'alta' : items.length ? 'media' : 'baixa';
    const suggestedService = items[0]
      ? (SERVICE_FOR[items[0].type] ?? 'Consulta clínica') + (ride ? ` junto com o ${ride.service.toLowerCase()}` : '')
      : r.species === 'DOG' || r.species === 'CAT'
        ? 'Banho completo'
        : 'Consulta clínica';
    return [{ row: r, items, late, idle, ride, reasons, priority, suggestedService }];
  });

  const order = { alta: 0, media: 1, baixa: 2 };
  candidates.sort((a, b) => order[a.priority] - order[b.priority]);

  return Promise.all(
    candidates.slice(0, limit).map(async (c): Promise<RetentionProposal> => {
      const first = String(c.row.tutor).split(' ')[0];
      const pet = c.row.name;
      const fallback = c.items.length
        ? `Olá, ${first}! Aqui é da PataCerta. ${c.items
            .slice(0, 2)
            .map((i) => i.title)
            .join(' e ')} de ${pet} ${
            c.items.slice(0, 2).length > 1
              ? c.late.length ? 'estão em atraso' : 'vencem em breve'
              : c.late.length ? 'está em atraso' : 'vence em breve'
          }. ${
            c.ride
              ? `Como ${pet} já vem para o ${c.ride.service.toLowerCase()} em ${formatDate(c.ride.at)}, podemos resolver na mesma visita. Quer que a gente deixe tudo combinado?`
              : `Quer que a gente agende?`
          }`
        : `Olá, ${first}! Aqui é da PataCerta. Faz um tempo que não vemos ${pet} por aqui e sentimos falta! Que tal agendar ${c.suggestedService.toLowerCase()}?`;
      const message = await writeMessage(llm, c.row, c.reasons, c.suggestedService).catch((err) => {
        console.error('[retention]', (err as Error).message);
        return null;
      });
      return {
        petId: c.row.id,
        petName: c.row.name,
        tutorId: c.row.tutor_id,
        tutorName: c.row.tutor,
        phone: c.row.phone,
        reasons: c.reasons,
        priority: c.priority,
        suggestedService: c.suggestedService,
        message: message ?? fallback,
        writtenBy: message ? 'ia' : 'modelo',
      };
    }),
  );
}

export async function recordOutreach(o: { petId: string; tutorId: string; message: string; sentBy: string }) {
  await pool.query(
    `INSERT INTO agent_outreach (pet_id, tutor_id, message, sent_by) VALUES ($1, $2, $3, $4)`,
    [o.petId, o.tutorId, o.message, o.sentBy],
  );
}

/** The clinic's most recent message to this tutor in the last 7 days, if any. */
export async function latestOutreach(tutorId: string) {
  const { rows } = await pool.query(
    `SELECT o.id, o.pet_id, p.name AS pet_name, o.message, o.created_at
     FROM agent_outreach o JOIN pets p ON p.id = o.pet_id
     WHERE o.tutor_id = $1 AND o.created_at > now() - interval '7 days'
     ORDER BY o.created_at DESC LIMIT 1`,
    [tutorId],
  );
  const r = rows[0];
  return r ? { id: r.id, petId: r.pet_id, petName: r.pet_name, message: r.message, createdAt: r.created_at } : null;
}

async function writeMessage(
  llm: LlmProvider,
  pet: { id: string; name: string; species: string; notes: string | null; tutor: string },
  reasons: string[],
  service: string,
) {
  const { rows } = await pool.query(
    `SELECT title, description, date FROM medical_records WHERE pet_id = $1 ORDER BY date DESC LIMIT 6`,
    [pet.id],
  );
  const history = rows.map((r) => `- ${formatDate(r.date)} ${r.title}: ${r.description}`).join('\n');
  const res = await llm.complete({
    system: `Você escreve mensagens de WhatsApp da clínica PataCerta para tutores. Tom caloroso e pessoal, português do Brasil, no máximo 3 frases, sem emojis em excesso. Cite o pet pelo nome e o motivo do contato.
Se houver mais de um cuidado pendente, ou se o pet já tiver uma visita marcada, proponha resolver tudo na mesma visita: é mais prático para o tutor e é o principal objetivo da mensagem.
Pode mencionar um detalhe do histórico que mostre cuidado (ex.: uma condição acompanhada), mas nunca faça diagnóstico nem indique remédio.
Termine convidando para agendar. Não coloque links (o sistema adiciona). Responda só com o texto da mensagem.`,
    messages: [
      {
        role: 'user',
        content: `Tutor: ${pet.tutor}\nPet: ${pet.name} (${pet.species})\nObservações: ${pet.notes ?? 'nenhuma'}\nMotivos do contato:\n${reasons.map((r) => `- ${r}`).join('\n')}\nServiço sugerido: ${service}\nHistórico recente:\n${history || '- sem registros'}`,
      },
    ],
    maxTokens: 400,
  });
  const text = res.text.trim().replace(/^["']|["']$/g, '');
  return text.length > 20 && text.length < 700 ? text : null;
}
