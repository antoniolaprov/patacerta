import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, post } from '../lib/api';
import { fmtDay, fmtMoney, fmtTime, localISODate, SPECIES_EMOJI } from '../lib/format';
import type { Pet, Service, Slot } from '../lib/types';
import { useFetch } from '../lib/useFetch';

const nextDays = (n: number) =>
  Array.from({ length: n }, (_, i) => localISODate(new Date(Date.now() + i * 86_400_000)));

export function Schedule() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const pets = useFetch<Pet[]>('/pets');
  const services = useFetch<Service[]>('/services');

  const [petId, setPetId] = useState(params.get('pet') ?? '');
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(localISODate());
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!petId && pets.data?.length === 1) setPetId(pets.data[0].id);
  }, [pets.data, petId]);

  useEffect(() => {
    setSlot('');
    setSlots(null);
    if (!serviceId) return;
    api<Slot[]>(`/appointments/availability?serviceId=${serviceId}&date=${date}`)
      .then(setSlots)
      .catch((e) => setError(e.message));
  }, [serviceId, date]);

  const pet = pets.data?.find((p) => p.id === petId);
  const service = services.data?.find((s) => s.id === serviceId);

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      await post('/appointments', { petId, serviceId, startsAt: slot, notes: notes || undefined });
      navigate('/agendamentos', { state: { booked: true } });
    } catch (err) {
      setError((err as Error).message);
      // The slot may have been taken meanwhile: refresh the options.
      api<Slot[]>(`/appointments/availability?serviceId=${serviceId}&date=${date}`).then(setSlots);
      setSlot('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page page--narrow">
      <h1 className="page__title">Agendar atendimento</h1>

      <ol className="steps">
        <li className="step">
          <h2>Para qual pet?</h2>
          {pets.data?.length === 0 && (
            <p className="muted">
              Cadastre um pet na <Link to="/">página inicial</Link> para agendar.
            </p>
          )}
          <div className="choice-row">
            {pets.data?.map((p) => (
              <button
                key={p.id}
                className="choice"
                aria-pressed={p.id === petId}
                onClick={() => setPetId(p.id)}
              >
                <span aria-hidden="true">{SPECIES_EMOJI[p.species]}</span> {p.name}
              </button>
            ))}
          </div>
        </li>

        <li className="step" aria-disabled={!petId}>
          <h2>Qual serviço?</h2>
          <div className="service-list">
            {services.data?.map((s) => (
              <button
                key={s.id}
                className="service"
                aria-pressed={s.id === serviceId}
                disabled={!petId}
                onClick={() => setServiceId(s.id)}
              >
                <strong>{s.name}</strong>
                <span>
                  {s.durationMin} min, {fmtMoney(s.priceCents)}
                </span>
              </button>
            ))}
          </div>
        </li>

        <li className="step" aria-disabled={!serviceId}>
          <h2>Quando?</h2>
          <div className="day-row" role="group" aria-label="Dia">
            {nextDays(10).map((d) => (
              <button
                key={d}
                className="day"
                aria-pressed={d === date}
                disabled={!serviceId}
                onClick={() => setDate(d)}
              >
                {fmtDay(`${d}T12:00:00-03:00`)}
              </button>
            ))}
          </div>
          {serviceId && slots && slots.length === 0 && (
            <p className="muted">Sem horários livres neste dia. Tente outra data.</p>
          )}
          {slots && slots.length > 0 && (
            <div className="slot-grid" role="group" aria-label="Horário">
              {slots.map((s) => (
                <button
                  key={s.startsAt}
                  className="slot"
                  aria-pressed={s.startsAt === slot}
                  onClick={() => setSlot(s.startsAt)}
                >
                  {fmtTime(s.startsAt)}
                </button>
              ))}
            </div>
          )}
        </li>
      </ol>

      {slot && pet && service && (
        <div className="confirm">
          <p>
            <strong>{service.name}</strong> para <strong>{pet.name}</strong>, {fmtDay(slot)} às{' '}
            {fmtTime(slot)}. Valor: {fmtMoney(service.priceCents)}.
          </p>
          <label>
            <span>
              Recado para a equipe <span className="optional">(opcional)</span>
            </span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button className="btn btn--primary btn--block" disabled={saving} onClick={confirm}>
            {saving ? 'Agendando...' : 'Confirmar agendamento'}
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
