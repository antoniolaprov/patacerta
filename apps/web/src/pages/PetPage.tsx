import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  age,
  dueLabel,
  dueState,
  fmtDate,
  RECORD_TYPE,
  SPECIES,
  SPECIES_EMOJI,
} from '../lib/format';
import type { MedicalRecord, PetDetail } from '../lib/types';
import { useFetch } from '../lib/useFetch';

/** The latest vaccine/deworming of each kind: what goes on the booklet. */
function bookletItems(records: MedicalRecord[]) {
  const latest = new Map<string, MedicalRecord>();
  for (const r of records) {
    if (r.type !== 'VACCINE' && r.type !== 'DEWORMING') continue;
    const key = r.title.toLowerCase();
    const prev = latest.get(key);
    if (!prev || prev.date < r.date) latest.set(key, r);
  }
  return [...latest.values()].sort((a, b) => a.title.localeCompare(b.title));
}

const stampTitle = (title: string) => {
  const short = title.replace(/^Vacina /i, '');
  return short.charAt(0).toUpperCase() + short.slice(1);
};

export function PetPage() {
  const { id } = useParams();
  const { hash } = useLocation();
  const { data: pet, error } = useFetch<PetDetail>(`/pets/${id}`);

  // Citations from the assistant link to `#<recordId>`: scroll and highlight it.
  useEffect(() => {
    if (!pet || !hash) return;
    const el = document.getElementById(hash.slice(1));
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.add('highlight');
    const t = setTimeout(() => el?.classList.remove('highlight'), 2400);
    return () => clearTimeout(t);
  }, [pet, hash]);

  if (error) return <p className="page form-error">{error}</p>;
  if (!pet) return <p className="page muted">Carregando...</p>;

  const booklet = bookletItems(pet.records);

  return (
    <div className="page">
      <header className="pet-head">
        <span className="pet-head__avatar" aria-hidden="true">
          {SPECIES_EMOJI[pet.species]}
        </span>
        <div>
          <h1>{pet.name}</h1>
          <p>
            {[pet.breed ?? SPECIES[pet.species], pet.sex, age(pet.birthDate), pet.weightKg && `${pet.weightKg.toLocaleString('pt-BR')} kg`]
              .filter(Boolean)
              .join(', ')}
          </p>
        </div>
        <Link className="btn btn--primary" to={`/agendar?pet=${pet.id}`}>
          Agendar para {pet.name}
        </Link>
      </header>

      {pet.notes && <p className="pet-notes">{pet.notes}</p>}

      <section className="booklet" aria-labelledby="booklet-title">
        <h2 id="booklet-title">Carteira de vacinação</h2>
        {booklet.length === 0 && <p className="muted">Nenhuma vacina registrada ainda.</p>}
        <ul className="stamps">
          {booklet.map((r) => {
            const state = dueState(r.nextDueDate);
            return (
              <li key={r.id} id={r.id} className={`stamp stamp--${state}`}>
                <span className="stamp__kind">{RECORD_TYPE[r.type]}</span>
                <strong>{stampTitle(r.title)}</strong>
                <span>Aplicada em {fmtDate(r.date)}</span>
                {r.nextDueDate && (
                  <span className="stamp__due">
                    {state === 'ok' ? `Próxima em ${fmtDate(r.nextDueDate)}` : dueLabel(r.nextDueDate)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="section" aria-labelledby="history">
        <h2 id="history">Histórico</h2>
        <ol className="timeline">
          {pet.records.map((r) => (
            <li key={r.id} id={r.id} className={`timeline__item timeline__item--${r.type.toLowerCase()}`}>
              <time dateTime={r.date}>{fmtDate(r.date)}</time>
              <div>
                <h3>
                  {r.title} <span className="tag">{RECORD_TYPE[r.type]}</span>
                </h3>
                <p>{r.description}</p>
                {r.author && <p className="muted small">Registrado por {r.author.name}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
