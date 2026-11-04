import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { patch } from '../lib/api';
import { fmtDay, fmtTime, STATUS } from '../lib/format';
import type { Appointment } from '../lib/types';
import { useFetch } from '../lib/useFetch';

const ACTIVE = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'];

export function Appointments() {
  const { state } = useLocation();
  const { data, reload } = useFetch<Appointment[]>('/appointments');
  const [error, setError] = useState<string | null>(null);

  const upcoming = (data ?? [])
    .filter((a) => ACTIVE.includes(a.status))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = (data ?? []).filter((a) => !ACTIVE.includes(a.status));

  async function cancel(a: Appointment) {
    if (!confirm(`Cancelar ${a.service.name} de ${a.pet.name}?`)) return;
    try {
      await patch(`/appointments/${a.id}/status`, { status: 'CANCELED' });
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="page page--narrow">
      <h1 className="page__title">Agenda</h1>
      {state?.booked && (
        <p className="notice" role="status">
          Agendado. Você recebe uma notificação aqui quando a equipe confirmar e quando o
          atendimento começar.
        </p>
      )}
      {error && <p className="form-error">{error}</p>}

      <section className="section" aria-labelledby="up">
        <h2 id="up">Próximos</h2>
        {upcoming.length === 0 && (
          <p className="muted">
            Nada marcado. <Link to="/agendar">Agendar atendimento</Link>
          </p>
        )}
        <ul className="appt-list">
          {upcoming.map((a) => (
            <li key={a.id} className="appt">
              <time dateTime={a.startsAt}>
                <span>{fmtDay(a.startsAt)}</span>
                <strong>{fmtTime(a.startsAt)}</strong>
              </time>
              <div>
                <strong>{a.service.name}</strong>
                <span>
                  {a.pet.name}
                  {a.staff ? `, com ${a.staff.name}` : ''}
                </span>
              </div>
              <span className={`status status--${a.status.toLowerCase()}`}>{STATUS[a.status]}</span>
              {a.status !== 'IN_PROGRESS' && (
                <button className="link-btn link-btn--danger" onClick={() => cancel(a)}>
                  Cancelar
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="past">
        <h2 id="past">Anteriores</h2>
        <ul className="appt-list appt-list--past">
          {past.map((a) => (
            <li key={a.id} className="appt">
              <time dateTime={a.startsAt}>
                <span>{fmtDay(a.startsAt)}</span>
                <strong>{fmtTime(a.startsAt)}</strong>
              </time>
              <div>
                <strong>{a.service.name}</strong>
                <span>{a.pet.name}</span>
              </div>
              <span className={`status status--${a.status.toLowerCase()}`}>{STATUS[a.status]}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
