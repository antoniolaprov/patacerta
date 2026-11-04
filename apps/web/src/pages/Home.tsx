import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AddPetDialog } from '../components/AddPetDialog';
import { useAuth } from '../lib/auth';
import { age, dueLabel, dueState, fmtDay, fmtTime, SPECIES, SPECIES_EMOJI, STATUS } from '../lib/format';
import type { Appointment, DueItem, Pet } from '../lib/types';
import { useFetch } from '../lib/useFetch';

export function Home() {
  const { user } = useAuth();
  const pets = useFetch<Pet[]>('/pets');
  const due = useFetch<DueItem[]>('/records/due?days=30');
  const appts = useFetch<Appointment[]>('/appointments');
  const [adding, setAdding] = useState(false);

  const upcoming = (appts.data ?? [])
    .filter((a) => ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'].includes(a.status))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 3);

  const hour = Number(new Date().toLocaleString('pt-BR', { timeZone: 'America/Recife', hour: 'numeric' }));
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="page">
      <h1 className="page__title">
        {greeting}, {user?.name.split(' ')[0]}.
      </h1>

      <section className="section" aria-labelledby="pending">
        <h2 id="pending">Precisa de atenção</h2>
        {due.data?.length === 0 && <p className="muted">Tudo em dia com seus pets. Nada vence nos próximos 30 dias.</p>}
        <ul className="due-list">
          {due.data?.map((item) => (
            <li key={item.id} className={`due due--${dueState(item.nextDueDate)}`}>
              <span className="due__stamp" aria-hidden="true">
                {SPECIES_EMOJI[item.pet.species]}
              </span>
              <div>
                <strong>
                  {item.title} de {item.pet.name}
                </strong>
                <span>{dueLabel(item.nextDueDate!)}</span>
              </div>
              <Link className="btn btn--small" to={`/agendar?pet=${item.pet.id}`}>
                Agendar
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="next">
        <div className="section__head">
          <h2 id="next">Próximos atendimentos</h2>
          <Link to="/agendamentos">Ver agenda</Link>
        </div>
        {upcoming.length === 0 && !appts.loading && (
          <p className="muted">
            Nenhum atendimento marcado. <Link to="/agendar">Agende banho, consulta ou vacina.</Link>
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
                <span>{a.pet.name}</span>
              </div>
              <span className={`status status--${a.status.toLowerCase()}`}>{STATUS[a.status]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="pets">
        <div className="section__head">
          <h2 id="pets">Seus pets</h2>
          <button className="link-btn" onClick={() => setAdding(true)}>
            Cadastrar pet
          </button>
        </div>
        <div className="pet-grid">
          {pets.data?.map((pet) => (
            <Link key={pet.id} to={`/pets/${pet.id}`} className="pet-card">
              <span className="pet-card__avatar" aria-hidden="true">
                {SPECIES_EMOJI[pet.species]}
              </span>
              <strong>{pet.name}</strong>
              <span>
                {pet.breed ?? SPECIES[pet.species]}
                {age(pet.birthDate) ? `, ${age(pet.birthDate)}` : ''}
              </span>
            </Link>
          ))}
          {pets.data?.length === 0 && (
            <button className="pet-card pet-card--new" onClick={() => setAdding(true)}>
              <strong>Cadastre seu primeiro pet</strong>
              <span>Leva menos de um minuto</span>
            </button>
          )}
        </div>
      </section>

      <AddPetDialog open={adding} onClose={() => setAdding(false)} onSaved={pets.reload} />
    </div>
  );
}
