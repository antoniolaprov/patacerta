import { runAgent, type AgentTool } from './agent.js';
import { clinicToday } from './api-client.js';
import type { AuthUser } from './auth.js';
import { isStaff } from './auth.js';
import { accessiblePets, buildFactSheet, mentionedPets, type PetSummary } from './context.js';
import { pool } from './db.js';
import { formatDate } from './documents.js';
import type { LlmProvider } from './llm.js';
import { latestOutreach } from './retention.js';
import { managementTools } from './tools/management.js';
import { staffSchedulingTools, tutorTools } from './tools/scheduling.js';
import {
  selectChunks,
  systemPrompt,
  toCitations,
  trimHistory,
  userPrompt,
  type ChatTurn,
  type Citation,
} from './prompt.js';
import { detectEmergency } from './safety.js';
import { search, type Chunk } from './store.js';

export type AssistantEvent =
  | { type: 'meta'; emergency: boolean; model: string }
  | { type: 'sources'; sources: Citation[] }
  | { type: 'token'; text: string }
  /** Something the agent did in the system (booked, checked the agenda...). */
  | { type: 'action'; tool: string; label: string; ok: boolean; data?: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface AskInput {
  user: AuthUser;
  question: string;
  history?: ChatTurn[];
  /** Optional: the screen the user is on (e.g. a pet's page) narrows the search. */
  petId?: string;
  /** The user's token: when present the assistant can act, not only answer. */
  token?: string;
}

/** What each role's agent may do. Tutors act on their own pets only (enforced by the API). */
export function toolsFor(user: AuthUser): AgentTool[] {
  return isStaff(user) ? [...managementTools, ...staffSchedulingTools] : tutorTools;
}

export interface Outreach {
  petName: string;
  message: string;
  createdAt: string | Date;
}

export function agentInstructions(user: AuthUser, pets: PetSummary[], now = new Date(), outreach?: Outreach | null) {
  const today = clinicToday(now);
  const ids = pets.map((p) => `- ${p.name}: ${p.id}`).join('\n') || '- nenhum';
  const role =
    user.role === 'TUTOR'
      ? `Você também AGE no sistema para este tutor: lista serviços, consulta horários, agenda, mostra e cancela agendamentos dos pets dele.
- Se o pedido for claro (pet, serviço, dia e período), agende sem pedir confirmação. Se faltar algo, pergunte antes.
- Cancele só quando o tutor disser claramente qual agendamento.
- Sugestão na mesma visita: ao agendar para um pet, confira os itens atrasados ou vencendo desse pet (lista acima). Se houver algum, ofereça UMA vez resolver na mesma ida (agendando o serviço extra logo antes ou depois). Se o tutor aceitar, agende os dois; se recusar, não insista.
- Para encadear dois serviços, o segundo começa quando o primeiro termina (início + duração do serviço, ex.: banho de 60 min às 09:00 → vacina às 10:00). Escolha esse horário na lista de horários livres.
- Pagamento: se o tutor pedir para pagar ou pedir o Pix, use gerar_pix com o id do agendamento (de meus_agendamentos ou agendar). O código aparece sozinho para ele; só avise o valor e que é só copiar e colar no app do banco. Nunca invente valores nem códigos.
- Se o histórico pedir um cuidado no atendimento (ex.: shampoo de clorexidina por dermatite), coloque isso na observação do agendamento.${
          outreach
            ? `
- A clínica enviou a este tutor, em ${formatDate(outreach.createdAt)}, sobre ${outreach.petName}, a mensagem: "${outreach.message}". Se o tutor responder a esse convite (ex.: "pode ser sábado", "quero"), entenda que é sobre ele e conduza até o agendamento.`
            : ''
        }`
      : `Você também AGE como copiloto da gestão: consulta faturamento, ocupação da agenda, agendamentos do dia e clientes inativos, e pode agendar ou cancelar para qualquer pet.
- Para perguntas de gestão, use as ferramentas em vez de estimar. Traga números exatos e uma recomendação prática curta.
- Agende ou cancele só quando a pessoa pedir.`;
  return `

AÇÕES NO SISTEMA
${role}
- Hoje é ${today.weekday}, ${today.iso} (fuso da clínica). Converta "amanhã", "sábado", "semana que vem" em datas AAAA-MM-DD.
- Para agendar: obtenha o serviço com listar_servicos, consulte horarios_disponiveis e use em \`inicio\` exatamente um horário retornado.
- Se uma ferramenta devolver erro, explique de forma simples e ofereça alternativas.
- Depois de agir, confirme em uma frase o que foi feito (serviço, pet, dia e hora).
IDs dos pets:
${ids}`;
}

export class Assistant {
  constructor(
    private readonly llm: LlmProvider,
    private readonly topK = 8,
  ) {}

  /** Retrieval step: semantic search scoped to what the user is allowed to see. */
  async retrieve(user: AuthUser, question: string, pets: PetSummary[], petId?: string) {
    const tutorId = isStaff(user) ? undefined : user.id;
    const focus = petId ? pets.filter((p) => p.id === petId) : mentionedPets(question, pets);

    const searches: Promise<Chunk[]>[] = [search(question, { tutorId }, this.topK)];
    // A pet named in the question gets its own search so its records aren't
    // crowded out by similar records of other pets.
    for (const pet of focus.slice(0, 3)) {
      searches.push(search(question, { tutorId, petId: pet.id }, this.topK));
    }
    const results = (await Promise.all(searches)).flat();
    const focusIds = new Set(focus.map((p) => p.id));
    // Small boost for the focused pets.
    for (const c of results) if (focusIds.has(c.petId)) c.score += 0.1;
    return selectChunks(results, this.topK);
  }

  async *ask({ user, question, history = [], petId, token }: AskInput): AsyncGenerator<AssistantEvent> {
    const pets = await accessiblePets(user);
    if (petId && !pets.some((p) => p.id === petId)) {
      yield { type: 'error', message: 'Pet não encontrado' };
      return;
    }

    yield { type: 'meta', emergency: detectEmergency(question), model: this.llm.name };

    const [facts, chunks] = await Promise.all([
      buildFactSheet(user, pets),
      this.retrieve(user, question, pets, petId),
    ]);
    yield { type: 'sources', sources: toCitations(chunks) };

    const messages: ChatTurn[] = [
      ...trimHistory(history),
      { role: 'user', content: userPrompt(question, chunks) },
    ];

    // Agent mode: the model may call tools before answering. Each tool round resends
    // the context, so it carries only the strongest sources (keeps free tiers usable).
    if (token) {
      const agentMessages: ChatTurn[] = [
        ...trimHistory(history),
        { role: 'user', content: userPrompt(question, chunks.slice(0, 3)) },
      ];
      const actions: string[] = [];
      try {
        const outreach = isStaff(user) ? null : await latestOutreach(user.id);
        let answer = '';
        for await (const step of runAgent({
          llm: this.llm,
          system: systemPrompt(user, facts) + agentInstructions(user, pets, new Date(), outreach),
          messages: agentMessages,
          tools: toolsFor(user),
          ctx: { user, token },
        })) {
          if (step.type === 'action') {
            if (step.ok) actions.push(step.label);
            yield { type: 'action', tool: step.tool, label: step.label, ok: step.ok, data: step.data };
          } else {
            answer = step.text;
          }
        }
        if (answer) {
          yield { type: 'token', text: answer };
          yield { type: 'done' };
          return;
        }
      } catch (err) {
        console.error('[agent]', err);
      }
      // Something already happened in the system: report it rather than
      // answering as if nothing was done.
      if (actions.length) {
        yield { type: 'token', text: `Pronto. O que fiz:\n${actions.map((a) => `- ${a}`).join('\n')}` };
        yield { type: 'done' };
        return;
      }
      // Otherwise fall back to the plain answer below (no tools).
    }

    try {
      for await (const text of this.llm.stream({ system: systemPrompt(user, facts), messages })) {
        yield { type: 'token', text };
      }
      yield { type: 'done' };
    } catch (err) {
      console.error('[assistant]', err);
      yield {
        type: 'error',
        message: 'O assistente está indisponível agora. Tente novamente em instantes.',
      };
    }
  }

  /**
   * Pre-consultation brief for the vet: reads the pet's whole history (no
   * retrieval needed, it fits in context) and highlights what matters today.
   */
  async *petBrief(user: AuthUser, petId: string): AsyncGenerator<AssistantEvent> {
    const { rows: [pet] } = await pool.query(
      `SELECT p.*, u.name AS tutor_name FROM pets p JOIN users u ON u.id = p.tutor_id WHERE p.id = $1`,
      [petId],
    );
    if (!pet) {
      yield { type: 'error', message: 'Pet não encontrado' };
      return;
    }
    const { rows: records } = await pool.query(
      `SELECT type, title, description, date, next_due_date FROM medical_records
       WHERE pet_id = $1 ORDER BY date DESC LIMIT 60`,
      [petId],
    );

    yield { type: 'meta', emergency: false, model: this.llm.name };
    const history = records
      .map(
        (r) =>
          `- ${formatDate(r.date)} | ${r.type} | ${r.title}: ${r.description}${
            r.next_due_date ? ` (próxima: ${formatDate(r.next_due_date)})` : ''
          }`,
      )
      .join('\n');

    const system = `Você é a Pata, assistente da equipe do PataCerta. Hoje é ${formatDate(new Date())}.
Escreva um resumo pré-atendimento para ${user.name} em português, com no máximo 180 palavras, usando só os dados fornecidos.
Use exatamente estas seções em markdown: **Quem é**, **Pontos de atenção**, **Pendências**, **Sugestões para o atendimento**.
Não faça diagnósticos novos; destaque condições crônicas, alergias, itens atrasados e observações recentes da equipe.`;

    const content = `Pet: ${pet.name} (${pet.species}, ${pet.breed ?? 'raça não informada'}), ${
      pet.weight_kg ?? '?'
    } kg, nascido em ${formatDate(pet.birth_date)}. Tutor: ${pet.tutor_name}.
Observações do cadastro: ${pet.notes ?? 'nenhuma'}
Histórico (mais recente primeiro):
${history || '- sem registros'}`;

    try {
      for await (const text of this.llm.stream({
        system,
        messages: [{ role: 'user', content }],
        maxTokens: 600,
      })) {
        yield { type: 'token', text };
      }
      yield { type: 'done' };
    } catch (err) {
      console.error('[assistant]', err);
      yield { type: 'error', message: 'Não foi possível gerar o resumo agora.' };
    }
  }
}
