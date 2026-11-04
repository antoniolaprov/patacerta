export type Role = 'TUTOR' | 'STAFF' | 'VET' | 'ADMIN';
export type Species = 'DOG' | 'CAT' | 'BIRD' | 'RODENT' | 'OTHER';
export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
export type RecordType = 'CONSULTATION' | 'VACCINE' | 'DEWORMING' | 'EXAM' | 'GROOMING_NOTE' | 'NOTE';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
}

export interface Service {
  id: string;
  name: string;
  type: string;
  durationMin: number;
  priceCents: number;
}

export interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  notes: string | null;
  pet: { id: string; name: string; species: Species; tutorId: string; tutor: { name: string; phone: string | null } };
  service: Service;
  staff: { id: string; name: string } | null;
}

export interface Pet {
  id: string;
  name: string;
  species: Species;
  breed: string | null;
  sex: string | null;
  birthDate: string | null;
  weightKg: number | null;
  notes: string | null;
  tutor: { id: string; name: string; phone: string | null; email?: string };
}

export interface MedicalRecord {
  id: string;
  type: RecordType;
  title: string;
  description: string;
  date: string;
  nextDueDate: string | null;
  author?: { name: string } | null;
}

export interface PetDetail extends Pet {
  records: MedicalRecord[];
  appointments: { id: string; startsAt: string; status: AppointmentStatus; service: Service }[];
}

export interface DueItem extends MedicalRecord {
  pet: { id: string; name: string; species: Species; tutor: { id: string; name: string; phone: string | null } };
}

export interface Overview {
  today: Partial<Record<AppointmentStatus, number>>;
  month: { completed: number; revenueCents: number; revenueByType: Record<string, number> };
  totals: { pets: number; tutors: number };
}
