import type { AppointmentStatus, RecordType, Species } from './types';

const TZ = 'America/Recife';

export const fmtDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ });

export const fmtDay = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });

export const fmtTime = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

export const fmtMoney = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** `YYYY-MM-DD` of a date in the clinic's calendar. */
export const localISODate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

export function age(birthDate: string | null) {
  if (!birthDate) return null;
  const months = Math.floor((Date.now() - new Date(birthDate).getTime()) / (30.44 * 86_400_000));
  if (months < 12) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? 'ano' : 'anos'}`;
}

export function daysUntil(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function dueLabel(iso: string) {
  const d = daysUntil(iso);
  if (d < 0) return `atrasado há ${-d} ${d === -1 ? 'dia' : 'dias'}`;
  if (d === 0) return 'vence hoje';
  if (d === 1) return 'vence amanhã';
  return `vence em ${d} dias`;
}

export type DueState = 'late' | 'soon' | 'ok';
export const dueState = (iso: string | null): DueState => {
  if (!iso) return 'ok';
  const d = daysUntil(iso);
  return d < 0 ? 'late' : d <= 30 ? 'soon' : 'ok';
};

export const SPECIES: Record<Species, string> = {
  DOG: 'Cachorro',
  CAT: 'Gato',
  BIRD: 'Ave',
  RODENT: 'Roedor',
  OTHER: 'Outro',
};

export const SPECIES_EMOJI: Record<Species, string> = {
  DOG: '🐕',
  CAT: '🐈',
  BIRD: '🐦',
  RODENT: '🐹',
  OTHER: '🐾',
};

export const RECORD_TYPE: Record<RecordType, string> = {
  CONSULTATION: 'Consulta',
  VACCINE: 'Vacina',
  DEWORMING: 'Vermífugo',
  EXAM: 'Exame',
  GROOMING_NOTE: 'Banho e tosa',
  NOTE: 'Anotação',
};

export const STATUS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Agendado',
  CONFIRMED: 'Confirmado',
  IN_PROGRESS: 'Em atendimento',
  DONE: 'Finalizado',
  CANCELED: 'Cancelado',
};
