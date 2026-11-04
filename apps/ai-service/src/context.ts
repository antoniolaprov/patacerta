import { isStaff, type AuthUser } from './auth.js';
import { pool } from './db.js';
import { config } from './config.js';
import { formatDate } from './documents.js';

export interface PetSummary {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  tutorName: string;
}

/**
 * Structured facts that vector search is bad at: lists, dates and counts.
 * They are computed with SQL and handed to the model next to the retrieved
 * chunks, so "quais vacinas estão atrasadas?" gets an exact answer.
 */
export interface FactSheet {
  today: string;
  pets: PetSummary[];
  dueItems: string[];
  upcoming: string[];
}

export async function accessiblePets(user: AuthUser): Promise<PetSummary[]> {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.species, p.breed, u.name AS tutor_name
     FROM pets p JOIN users u ON u.id = p.tutor_id
     ${isStaff(user) ? '' : 'WHERE p.tutor_id = $1'}
     ORDER BY p.name`,
    isStaff(user) ? [] : [user.id],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    species: r.species,
    breed: r.breed,
    tutorName: r.tutor_name,
  }));
}

/** Finds pets mentioned by name in the question ("o Thor", "a mel"). */
export function mentionedPets(question: string, pets: PetSummary[]) {
  const text = ` ${question.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')} `;
  return pets.filter((p) => {
    const name = p.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return new RegExp(`[^a-z0-9]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`).test(text);
  });
}

export async function buildFactSheet(user: AuthUser, pets: PetSummary[]): Promise<FactSheet> {
  const staff = isStaff(user);
  const scope = staff ? '' : 'AND p.tutor_id = $1';
  const params = staff ? [] : [user.id];

  const [due, upcoming] = await Promise.all([
    // Latest record of each item per pet, overdue or due within 60 days.
    pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (r.pet_id, lower(r.title))
                p.name AS pet_name, u.name AS tutor_name, r.title, r.next_due_date
         FROM medical_records r
         JOIN pets p ON p.id = r.pet_id
         JOIN users u ON u.id = p.tutor_id
         WHERE r.next_due_date IS NOT NULL ${scope}
         ORDER BY r.pet_id, lower(r.title), r.date DESC
       ) latest
       WHERE next_due_date <= now() + interval '60 days'
       ORDER BY next_due_date
       LIMIT 40`,
      params,
    ),
    pool.query(
      `SELECT p.name AS pet_name, s.name AS service, a.starts_at, a.status
       FROM appointments a
       JOIN pets p ON p.id = a.pet_id
       JOIN services s ON s.id = a.service_id
       WHERE a.starts_at >= date_trunc('day', now())
         AND a.status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS') ${scope}
       ORDER BY a.starts_at
       LIMIT ${staff ? 30 : 10}`,
      params,
    ),
  ]);

  const now = Date.now();
  return {
    today: formatDate(new Date()),
    pets,
    dueItems: due.rows.map((r) => {
      const late = new Date(r.next_due_date).getTime() < now;
      const who = staff ? `${r.pet_name} (tutor ${r.tutor_name})` : r.pet_name;
      return `${who}: ${r.title} — ${late ? 'ATRASADO desde' : 'previsto para'} ${formatDate(r.next_due_date)}`;
    }),
    upcoming: upcoming.rows.map(
      (r) =>
        `${r.pet_name}: ${r.service} em ${new Date(r.starts_at).toLocaleString('pt-BR', {
          timeZone: config.CLINIC_TIMEZONE,
          dateStyle: 'short',
          timeStyle: 'short',
        })} (${r.status === 'CONFIRMED' ? 'confirmado' : r.status === 'IN_PROGRESS' ? 'em atendimento' : 'agendado'})`,
    ),
  };
}
