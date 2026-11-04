import type { AuthUser } from './auth.js';
import { isStaff } from './auth.js';
import { accessiblePets, buildFactSheet, mentionedPets, type PetSummary } from './context.js';
import { pool } from './db.js';
import { formatDate } from './documents.js';
import type { LlmProvider } from './llm.js';
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
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface AskInput {
  user: AuthUser;
  question: string;
  history?: ChatTurn[];
  /** Optional: the screen the user is on (e.g. a pet's page) narrows the search. */
  petId?: string;
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

  async *ask({ user, question, history = [], petId }: AskInput): AsyncGenerator<AssistantEvent> {
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

    try {
      const messages: ChatTurn[] = [
        ...trimHistory(history),
        { role: 'user', content: userPrompt(question, chunks) },
      ];
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
