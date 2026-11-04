import { Redis } from 'ioredis';
import { config } from './config.js';
import { pool } from './db.js';
import { formatDate } from './documents.js';
import type { RealtimeEvent } from './realtime.js';

/**
 * Periodically looks for vaccines, dewormings and check-ups due in the next
 * 3 days (or already late) and notifies the tutor once per item per day.
 */
export function startReminders(emit: (e: RealtimeEvent) => void) {
  const redis = new Redis(config.REDIS_URL);

  const run = async () => {
    const { rows } = await pool.query(`
      SELECT * FROM (
        SELECT DISTINCT ON (r.pet_id, lower(r.title))
               r.id, r.title, r.next_due_date, p.id AS pet_id, p.name AS pet_name, p.tutor_id
        FROM medical_records r JOIN pets p ON p.id = r.pet_id
        WHERE r.next_due_date IS NOT NULL
        ORDER BY r.pet_id, lower(r.title), r.date DESC
      ) latest
      WHERE next_due_date <= now() + interval '3 days'`);

    const day = new Date().toISOString().slice(0, 10);
    for (const r of rows) {
      // SET NX makes the reminder idempotent across restarts and replicas.
      const fresh = await redis.set(`reminder:${r.id}:${day}`, '1', 'EX', 86_400, 'NX');
      if (!fresh) continue;
      const late = new Date(r.next_due_date) < new Date();
      emit({
        rooms: [`user:${r.tutor_id}`],
        event: 'reminder',
        payload: {
          petId: r.pet_id,
          message: late
            ? `${r.title} de ${r.pet_name} está atrasado(a) desde ${formatDate(r.next_due_date)}. Que tal agendar?`
            : `${r.title} de ${r.pet_name} vence em ${formatDate(r.next_due_date)}.`,
        },
      });
    }
  };

  const tick = () => run().catch((err) => console.error('[reminders]', err));
  tick();
  return setInterval(tick, config.REMINDER_INTERVAL_MIN * 60_000);
}
