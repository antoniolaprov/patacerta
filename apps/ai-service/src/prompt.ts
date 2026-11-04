import type { AuthUser } from './auth.js';
import type { FactSheet } from './context.js';
import { formatDate, SPECIES } from './documents.js';
import type { Chunk } from './store.js';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface Citation {
  ref: number;
  sourceType: Chunk['sourceType'];
  sourceId: string;
  petId: string;
  petName: string;
  title: string;
  date: string | null;
}

/** Drops weak matches and duplicates, keeping the best `limit` chunks. */
export function selectChunks(chunks: Chunk[], limit: number, minScore = 0.2) {
  const seen = new Set<string>();
  return chunks
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .filter((c) => {
      const key = `${c.sourceType}:${c.sourceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export function toCitations(chunks: Chunk[]): Citation[] {
  return chunks.map((c, i) => ({
    ref: i + 1,
    sourceType: c.sourceType,
    sourceId: c.sourceId,
    petId: c.petId,
    petName: c.petName,
    title: c.title,
    date: c.occurredAt ? formatDate(c.occurredAt) : null,
  }));
}

export function systemPrompt(user: AuthUser, facts: FactSheet) {
  const audience =
    user.role === 'TUTOR'
      ? `Você conversa com ${user.name}, tutor(a) de pets atendidos na clínica. Use linguagem simples e acolhedora.`
      : `Você apoia ${user.name}, da equipe da clínica (${user.role}). Seja objetivo e técnico quando útil.`;

  const list = (items: string[], empty: string) =>
    items.length ? items.map((i) => `- ${i}`).join('\n') : `- ${empty}`;

  return `Você é a Pata, assistente virtual do PataCerta, um pet shop e clínica veterinária.
${audience}
Hoje é ${facts.today}.

Regras:
1. Responda somente com base nos DADOS DA CLÍNICA e nas FONTES abaixo. Se a informação não estiver lá, diga que não encontrou no histórico e sugira falar com a equipe.
2. Ao usar uma fonte, cite o número dela entre colchetes, como [2]. Não invente fontes.
3. Você não faz diagnósticos nem prescreve medicamentos ou doses. Pode explicar o que já está registrado no prontuário.
4. Se a pergunta descrever um sinal de urgência (convulsão, envenenamento, falta de ar, sangramento intenso, atropelamento), oriente a procurar atendimento veterinário imediatamente antes de qualquer outra coisa.
5. Responda em português do Brasil, em poucos parágrafos curtos ou uma lista quando ajudar.

DADOS DA CLÍNICA (consultados agora no sistema)
Pets ${user.role === 'TUTOR' ? 'do tutor' : 'cadastrados'}:
${list(
  facts.pets.map((p) => `${p.name} (${SPECIES[p.species] ?? p.species.toLowerCase()}${p.breed ? `, ${p.breed}` : ''})${user.role === 'TUTOR' ? '' : ` — tutor ${p.tutorName}`}`),
  'nenhum pet cadastrado',
)}

Vacinas, vermífugos e retornos atrasados ou vencendo em até 60 dias:
${list(facts.dueItems, 'nada pendente')}

Próximos agendamentos:
${list(facts.upcoming, 'nenhum agendamento futuro')}`;
}

export function userPrompt(question: string, chunks: Chunk[]) {
  const sources = chunks.length
    ? chunks.map((c, i) => `[${i + 1}] ${c.title} (${c.petName}): ${c.content}`).join('\n')
    : 'Nenhum registro relevante encontrado no histórico.';
  return `FONTES (trechos do histórico dos pets):\n${sources}\n\nPERGUNTA: ${question}`;
}

/** Keeps the last turns of the conversation within a rough character budget. */
export function trimHistory(history: ChatTurn[], maxChars = 6000) {
  const kept: ChatTurn[] = [];
  let total = 0;
  for (const turn of [...history].reverse()) {
    total += turn.content.length;
    if (total > maxChars) break;
    kept.unshift(turn);
  }
  // The conversation sent to the model must start with a user turn.
  while (kept[0]?.role === 'assistant') kept.shift();
  return kept;
}
