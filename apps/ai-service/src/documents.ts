import { config } from './config.js';
import { pool } from './db.js';

export type SourceType = 'record' | 'pet' | 'appointment';

export interface KnowledgeDocument {
  sourceType: SourceType;
  sourceId: string;
  petId: string;
  tutorId: string;
  title: string;
  content: string;
  occurredAt: Date | null;
}

export const SPECIES: Record<string, string> = {
  DOG: 'cachorro',
  CAT: 'gato',
  BIRD: 'ave',
  RODENT: 'roedor',
  OTHER: 'outro',
};

const RECORD_TYPE: Record<string, string> = {
  CONSULTATION: 'Consulta',
  VACCINE: 'Vacina',
  DEWORMING: 'Vermifugação',
  EXAM: 'Exame',
  GROOMING_NOTE: 'Observação do banho/tosa',
  NOTE: 'Anotação',
};

const STATUS: Record<string, string> = {
  SCHEDULED: 'agendado',
  CONFIRMED: 'confirmado',
  IN_PROGRESS: 'em atendimento',
  DONE: 'realizado',
  CANCELED: 'cancelado',
};

export const formatDate = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString('pt-BR', { timeZone: config.CLINIC_TIMEZONE })
    : 'sem data';

const formatDateTime = (d: Date | string) =>
  new Date(d).toLocaleString('pt-BR', {
    timeZone: config.CLINIC_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  });

function age(birth: Date | null) {
  if (!birth) return null;
  const months = Math.floor((Date.now() - new Date(birth).getTime()) / (30.44 * 86_400_000));
  if (months < 12) return `${months} meses`;
  const years = Math.floor(months / 12);
  return `${years} ano${years > 1 ? 's' : ''}`;
}

/*
 * Each row becomes a short, self-contained text in Portuguese. Writing the
 * pet's name and the date into every chunk is what lets a question like
 * "quando o Thor tomou vermífugo?" match the right record by meaning.
 */

export function recordDocument(row: {
  id: string; pet_id: string; tutor_id: string; pet_name: string; type: string;
  title: string; description: string; date: Date; next_due_date: Date | null; author: string | null;
}): KnowledgeDocument {
  const lines = [
    `${RECORD_TYPE[row.type] ?? row.type} de ${row.pet_name} em ${formatDate(row.date)}: ${row.title}.`,
    row.description,
  ];
  if (row.next_due_date) lines.push(`Próxima data prevista: ${formatDate(row.next_due_date)}.`);
  if (row.author) lines.push(`Registrado por ${row.author}.`);
  return {
    sourceType: 'record',
    sourceId: row.id,
    petId: row.pet_id,
    tutorId: row.tutor_id,
    title: `${RECORD_TYPE[row.type] ?? row.type}: ${row.title}`,
    content: lines.join(' '),
    occurredAt: row.date,
  };
}

export function petDocument(row: {
  id: string; tutor_id: string; name: string; species: string; breed: string | null;
  sex: string | null; birth_date: Date | null; weight_kg: number | null; notes: string | null;
  tutor_name: string;
}): KnowledgeDocument {
  const facts = [
    `${row.name} é ${SPECIES[row.species] ?? 'pet'}${row.breed ? ` da raça ${row.breed}` : ''}`,
    row.sex && `sexo ${row.sex.toLowerCase()}`,
    age(row.birth_date) && `com ${age(row.birth_date)} (nascido em ${formatDate(row.birth_date)})`,
    row.weight_kg && `pesando ${row.weight_kg.toLocaleString('pt-BR')} kg`,
  ].filter(Boolean);
  const content = `${facts.join(', ')}. Tutor: ${row.tutor_name}.${row.notes ? ` Observações: ${row.notes}` : ''}`;
  return {
    sourceType: 'pet',
    sourceId: row.id,
    petId: row.id,
    tutorId: row.tutor_id,
    title: `Perfil de ${row.name}`,
    content,
    occurredAt: null,
  };
}

export function appointmentDocument(row: {
  id: string; pet_id: string; tutor_id: string; pet_name: string; service: string;
  starts_at: Date; status: string; notes: string | null; staff: string | null;
}): KnowledgeDocument {
  const content = [
    `${row.service} de ${row.pet_name} em ${formatDateTime(row.starts_at)}, status ${STATUS[row.status] ?? row.status}.`,
    row.staff && `Atendido por ${row.staff}.`,
    row.notes && `Observações: ${row.notes}`,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    sourceType: 'appointment',
    sourceId: row.id,
    petId: row.pet_id,
    tutorId: row.tutor_id,
    title: `Agendamento: ${row.service}`,
    content,
    occurredAt: row.starts_at,
  };
}

const RECORD_SQL = `
  SELECT r.id, r.pet_id, p.tutor_id, p.name AS pet_name, r.type, r.title, r.description,
         r.date, r.next_due_date, u.name AS author
  FROM medical_records r
  JOIN pets p ON p.id = r.pet_id
  LEFT JOIN users u ON u.id = r.author_id`;

const PET_SQL = `
  SELECT p.id, p.tutor_id, p.name, p.species, p.breed, p.sex, p.birth_date, p.weight_kg,
         p.notes, u.name AS tutor_name
  FROM pets p JOIN users u ON u.id = p.tutor_id`;

const APPOINTMENT_SQL = `
  SELECT a.id, a.pet_id, p.tutor_id, p.name AS pet_name, s.name AS service, a.starts_at,
         a.status, a.notes, u.name AS staff
  FROM appointments a
  JOIN pets p ON p.id = a.pet_id
  JOIN services s ON s.id = a.service_id
  LEFT JOIN users u ON u.id = a.staff_id`;

export async function loadDocument(
  kind: SourceType,
  id: string,
): Promise<KnowledgeDocument | null> {
  if (kind === 'record') {
    const { rows } = await pool.query(`${RECORD_SQL} WHERE r.id = $1`, [id]);
    return rows[0] ? recordDocument(rows[0]) : null;
  }
  if (kind === 'pet') {
    const { rows } = await pool.query(`${PET_SQL} WHERE p.id = $1`, [id]);
    return rows[0] ? petDocument(rows[0]) : null;
  }
  const { rows } = await pool.query(`${APPOINTMENT_SQL} WHERE a.id = $1`, [id]);
  return rows[0] ? appointmentDocument(rows[0]) : null;
}

export async function loadAllDocuments(): Promise<KnowledgeDocument[]> {
  const [records, pets, appointments] = await Promise.all([
    pool.query(RECORD_SQL),
    pool.query(PET_SQL),
    pool.query(APPOINTMENT_SQL),
  ]);
  return [
    ...pets.rows.map((r) => petDocument(r)),
    ...records.rows.map((r) => recordDocument(r)),
    ...appointments.rows.map((r) => appointmentDocument(r)),
  ];
}
