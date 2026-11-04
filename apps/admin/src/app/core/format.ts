import type { AppointmentStatus, RecordType, Species } from './types';

const TZ = 'America/Recife';

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ });
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const fmtMoney = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const localISODate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

export const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

export function dueLabel(iso: string) {
  const d = daysUntil(iso);
  if (d < 0) return `atrasado há ${-d} ${d === -1 ? 'dia' : 'dias'}`;
  if (d === 0) return 'vence hoje';
  return `vence em ${d} ${d === 1 ? 'dia' : 'dias'}`;
}

export function age(birthDate: string | null) {
  if (!birthDate) return null;
  const months = Math.floor((Date.now() - new Date(birthDate).getTime()) / (30.44 * 86_400_000));
  if (months < 12) return `${months} meses`;
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? 'ano' : 'anos'}`;
}

/** WhatsApp link for a Brazilian phone number, with an optional message. */
export function whatsapp(phone: string | null, text = '') {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/55${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

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

/** The next step offered on each card of the agenda board. */
export const NEXT_STEP: Partial<Record<AppointmentStatus, { to: AppointmentStatus; label: string }>> = {
  SCHEDULED: { to: 'CONFIRMED', label: 'Confirmar' },
  CONFIRMED: { to: 'IN_PROGRESS', label: 'Iniciar atendimento' },
  IN_PROGRESS: { to: 'DONE', label: 'Finalizar' },
};
