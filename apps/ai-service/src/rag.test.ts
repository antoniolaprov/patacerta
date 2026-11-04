import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  config: { CLINIC_TIMEZONE: 'America/Recife', EMBEDDINGS_PROVIDER: 'hash' },
  EMBEDDING_DIM: 384,
}));
vi.mock('./db.js', () => ({ pool: {} }));

const { HashEmbedder } = await import('./embeddings.js');
const { mentionedPets } = await import('./context.js');
const { recordDocument, petDocument } = await import('./documents.js');
const { selectChunks, systemPrompt, toCitations, trimHistory, userPrompt } = await import('./prompt.js');
const { detectEmergency } = await import('./safety.js');
const { scopeFilter } = await import('./store.js');

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

const pets = [
  { id: 'p1', name: 'Thor', species: 'DOG', breed: 'Golden', tutorName: 'Ana' },
  { id: 'p2', name: 'Mel', species: 'CAT', breed: null, tutorName: 'Ana' },
  { id: 'p3', name: 'Bidu', species: 'DOG', breed: 'Shih Tzu', tutorName: 'Carlos' },
];

const chunk = (id: string, score: number, petId = 'p1') => ({
  sourceType: 'record' as const,
  sourceId: id,
  petId,
  petName: 'Thor',
  title: `Registro ${id}`,
  content: `conteúdo ${id}`,
  occurredAt: new Date('2026-10-01T12:00:00Z'),
  score,
});

describe('scopeFilter (data isolation)', () => {
  it('always filters by tutor when a tutor id is given', () => {
    expect(scopeFilter({ tutorId: 'u1' }, 3)).toEqual({
      where: 'WHERE k.tutor_id = $3',
      params: ['u1'],
    });
  });

  it('combines tutor and pet filters with sequential placeholders', () => {
    expect(scopeFilter({ tutorId: 'u1', petId: 'p1' }, 3)).toEqual({
      where: 'WHERE k.tutor_id = $3 AND k.pet_id = $4',
      params: ['u1', 'p1'],
    });
  });

  it('has no filter for staff searching the whole clinic', () => {
    expect(scopeFilter({}, 3)).toEqual({ where: '', params: [] });
  });
});

describe('mentionedPets', () => {
  it('finds pets by name ignoring case and accents', () => {
    expect(mentionedPets('quando o THOR tomou vermífugo?', pets).map((p) => p.id)).toEqual(['p1']);
    expect(mentionedPets('A mél está bem?', pets).map((p) => p.id)).toEqual(['p2']);
  });

  it('does not match names inside other words', () => {
    expect(mentionedPets('Melhorou a coceira?', pets)).toEqual([]);
  });
});

describe('HashEmbedder', () => {
  const embedder = new HashEmbedder();
  let vectors: number[][];

  beforeAll(async () => {
    vectors = await embedder.embed([
      'Vermifugação de Thor: vermífugo oral dose para 32 kg',
      'quando o Thor tomou vermífugo',
      'Consulta cardiológica do Bidu com sopro cardíaco',
    ]);
  });

  it('produces normalized vectors of the configured size', () => {
    expect(vectors[0]).toHaveLength(384);
    expect(Math.hypot(...vectors[0])).toBeCloseTo(1, 5);
  });

  it('places related texts closer than unrelated ones', () => {
    expect(cosine(vectors[0], vectors[1])).toBeGreaterThan(cosine(vectors[2], vectors[1]));
  });
});

describe('documents', () => {
  it('writes the pet name, date and due date into each record chunk', () => {
    const doc = recordDocument({
      id: 'r1', pet_id: 'p1', tutor_id: 'u1', pet_name: 'Thor', type: 'VACCINE',
      title: 'Vacina V10', description: 'Reforço anual.', date: new Date('2026-03-10T13:00:00Z'),
      next_due_date: new Date('2027-03-10T13:00:00Z'), author: 'Dra. Marina',
    });
    expect(doc.content).toBe(
      'Vacina de Thor em 10/03/2026: Vacina V10. Reforço anual. Próxima data prevista: 10/03/2027. Registrado por Dra. Marina.',
    );
    expect(doc).toMatchObject({ sourceType: 'record', petId: 'p1', tutorId: 'u1' });
  });

  it('describes the pet profile in natural language', () => {
    const doc = petDocument({
      id: 'p1', tutor_id: 'u1', name: 'Thor', species: 'DOG', breed: 'Golden Retriever',
      sex: 'Macho', birth_date: null, weight_kg: 32.4, notes: 'Alérgico a frango.', tutor_name: 'Ana',
    });
    expect(doc.content).toContain('Thor é cachorro da raça Golden Retriever');
    expect(doc.content).toContain('32,4 kg');
    expect(doc.content).toContain('Alérgico a frango.');
  });
});

describe('prompt building', () => {
  it('keeps the best unique chunks above the minimum score', () => {
    const selected = selectChunks([chunk('a', 0.5), chunk('b', 0.9), chunk('a', 0.6), chunk('c', 0.1)], 5);
    expect(selected.map((c) => [c.sourceId, c.score])).toEqual([['b', 0.9], ['a', 0.6]]);
  });

  it('numbers sources so the answer can cite them', () => {
    const chunks = [chunk('a', 0.9), chunk('b', 0.8)];
    expect(userPrompt('Pergunta?', chunks)).toContain('[2] Registro b (Thor): conteúdo b');
    expect(toCitations(chunks)[1]).toMatchObject({ ref: 2, sourceId: 'b', date: '01/10/2026' });
  });

  it('puts the structured facts and the citation rule in the system prompt', () => {
    const prompt = systemPrompt(
      { id: 'u1', name: 'Ana', role: 'TUTOR' },
      { today: '04/11/2026', pets: pets.slice(0, 2), dueItems: ['Thor: Vermífugo — ATRASADO desde 30/10/2026'], upcoming: [] },
    );
    expect(prompt).toContain('Hoje é 04/11/2026');
    expect(prompt).toContain('- Thor: Vermífugo — ATRASADO desde 30/10/2026');
    expect(prompt).toContain('cite o número');
    expect(prompt).not.toContain('Carlos');
  });

  it('trims history to the budget and starts on a user turn', () => {
    const history = [
      { role: 'user' as const, content: 'x'.repeat(50) },
      { role: 'assistant' as const, content: 'y'.repeat(50) },
      { role: 'user' as const, content: 'z'.repeat(50) },
    ];
    expect(trimHistory(history, 120).map((t) => t.content[0])).toEqual(['z']);
    expect(trimHistory(history, 1000)).toHaveLength(3);
  });
});

describe('detectEmergency', () => {
  it('flags urgent situations', () => {
    expect(detectEmergency('Meu cachorro está tendo uma CONVULSÃO')).toBe(true);
    expect(detectEmergency('acho que ele comeu veneno de rato')).toBe(true);
  });

  it('ignores routine questions', () => {
    expect(detectEmergency('Quando é a próxima vacina da Mel?')).toBe(false);
  });
});
