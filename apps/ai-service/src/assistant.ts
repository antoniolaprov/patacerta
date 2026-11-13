import { runAgent, type AgentTool } from './agent.js';
import { clinicToday } from './api-client.js';
import type { AuthUser } from './auth.js';
import { clinicProfile } from './clinic.js';
import { config } from './config.js';
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
      ? `COMO A PATA ATENDE O TUTOR
Você age no sistema por este tutor: lista serviços, consulta horários, agenda, remarca, mostra e cancela agendamentos dos pets dele, e gera o Pix.

Estilo (é uma conversa de WhatsApp):
- No máximo 3 frases curtas por mensagem, sem títulos nem tabelas, no máximo 1 emoji.
- Chame o tutor pelo primeiro nome e o pet pelo nome.
- Datas e horas por extenso: "sábado, 15/11, às 9h".

Agendar:
1. Descubra pet, serviço, dia e período. Se faltar algo, pergunte uma coisa por vez.
2. Use o servico_id do catálogo acima (não precisa chamar listar_servicos) → horarios_disponiveis → agendar, usando em \`inicio\` exatamente um horário retornado. Se o pedido for claro, agende sem pedir confirmação.
3. Para mudar o horário de algo já agendado, use remarcar_agendamento (não cancele e agende separado).
4. Para dois ou mais serviços na mesma ida (ex.: banho e vacina), use agendar_pacote: ele encadeia os horários e desfaz tudo se algum falhar.
5. Cancele só quando o tutor disser claramente qual agendamento.
6. Se o histórico pedir um cuidado no atendimento (ex.: shampoo de clorexidina por dermatite), escreva isso na observação.

Sugestão na mesma visita (upsell):
- Só itens atrasados ou que vencem em até 30 dias, do mesmo pet (lista de pendências acima), resolvidos pelo serviço certo (ver SOBRE A CLÍNICA).
- Ofereça uma vez, com o motivo e o preço. Se o tutor recusar, não repita.

Pagamento: se o tutor pedir para pagar ou pedir o Pix, use gerar_pix com o id do agendamento (de meus_agendamentos, agendar ou agendar_pacote). O código aparece sozinho para ele; só diga o valor e que é copiar e colar no app do banco. Nunca invente valores nem códigos.

Saúde: você não faz diagnóstico nem indica remédio ou dose. Para sintomas, sugira agendar uma consulta. Em emergência (convulsão, envenenamento, falta de ar, sangramento), oriente a ligar já para ${config.CLINIC_PHONE}.

Passe para a equipe ("vou pedir para alguém da equipe te chamar") em reclamação, pedido de desconto ou assunto que as ferramentas não resolvem.

Exemplos de boas respostas:
- Tutor: "pode ser sábado?" → "Tenho sábado, 15/11, às 8h, 9h e 10h. Qual fica melhor para o Thor? Aproveitando: a antirrábica dele está atrasada e dá para aplicar logo depois do banho, por R$ 90,00."
- Horário recusado pela agenda → "Esse horário acabou de ser preenchido 😕 Tenho 10h ou 11h, pode ser?"${
          outreach
            ? `

Contexto: a clínica enviou a este tutor, em ${formatDate(outreach.createdAt)}, sobre ${outreach.petName}, a mensagem: "${outreach.message}". Se ele responder a esse convite (ex.: "pode ser sábado", "quero"), entenda que é sobre isso e conduza até o agendamento.`
            : ''
        }`
      : `COMO O COPILOTO DA GESTÃO RESPONDE À EQUIPE
- Para gestão, sempre consulte a ferramenta (faturamento, ocupacao_da_agenda, agendamentos_do_dia, clientes_inativos); nunca estime.
- Diga o período usado ("de 01/11 a 13/11") e traga números exatos.
- "Este mês" = do dia 1 até hoje. "Semana que vem" = segunda a sábado da próxima semana. Dias fechados não contam como vazios.
- Formato: 1 frase com a resposta, até 4 tópicos curtos e 1 recomendação prática (ex.: "a terça tem só 2 atendimentos: vale rodar o agente de relacionamento para chamar quem tem banho vencendo").
- Agende, remarque ou cancele para qualquer pet só quando pedirem.`;
  return `

${role}

REGRAS GERAIS
- Hoje é ${today.weekday}, ${today.iso} (fuso da clínica). Converta "amanhã", "sábado", "semana que vem" em datas AAAA-MM-DD.
- Se uma ferramenta devolver erro, explique de forma simples e ofereça a alternativa.
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
        { role: 'user', content: userPrompt(question, chunks.slice(0, 2)) },
      ];
      const actions: string[] = [];
      try {
        const [outreach, profile] = await Promise.all([
          isStaff(user) ? null : latestOutreach(user.id),
          clinicProfile(),
        ]);
        let answer = '';
        for await (const step of runAgent({
          llm: this.llm,
          system: `${systemPrompt(user, facts)}\n\n${profile}${agentInstructions(user, pets, new Date(), outreach)}`,
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
