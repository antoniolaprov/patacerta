import { useEffect, useRef, useState, type FormEvent } from 'react';
import { post } from '../lib/api';
import { SPECIES } from '../lib/format';
import type { Species } from '../lib/types';

export function AddPetDialog({ open, onClose, onSaved }: { open: boolean; onClose(): void; onSaved(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState({ name: '', species: 'DOG' as Species, breed: '', birthDate: '', weightKg: '', notes: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await post('/pets', {
        name: form.name,
        species: form.species,
        breed: form.breed || undefined,
        birthDate: form.birthDate || undefined,
        weightKg: form.weightKg ? Number(form.weightKg.replace(',', '.')) : undefined,
        notes: form.notes || undefined,
      });
      setForm({ name: '', species: 'DOG', breed: '', birthDate: '', weightKg: '', notes: '' });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <form onSubmit={submit}>
        <h2>Cadastrar pet</h2>
        <label>
          Nome
          <input required value={form.name} onChange={set('name')} />
        </label>
        <div className="row">
          <label>
            Espécie
            <select value={form.species} onChange={set('species')}>
              {Object.entries(SPECIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Raça
            <input value={form.breed} onChange={set('breed')} />
          </label>
        </div>
        <div className="row">
          <label>
            Nascimento
            <input type="date" value={form.birthDate} onChange={set('birthDate')} />
          </label>
          <label>
            Peso (kg)
            <input inputMode="decimal" value={form.weightKg} onChange={set('weightKg')} />
          </label>
        </div>
        <label>
          Algo que a equipe precise saber?
          <textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Alergias, medos, cuidados especiais" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn--primary">Cadastrar pet</button>
        </div>
      </form>
    </dialog>
  );
}
