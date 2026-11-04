export type Role = 'TUTOR' | 'STAFF' | 'VET' | 'ADMIN';
export type Species = 'DOG' | 'CAT' | 'BIRD' | 'RODENT' | 'OTHER';
export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
export type RecordType =
  | 'CONSULTATION'
  | 'VACCINE'
  | 'DEWORMING'
  | 'EXAM'
  | 'GROOMING_NOTE'
  | 'NOTE';

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
  type: 'BATH' | 'GROOMING' | 'CONSULTATION' | 'VACCINATION' | 'EXAM';
  durationMin: number;
  priceCents: number;
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
  tutorId: string;
  tutor: { id: string; name: string; phone: string | null; email?: string };
}

export interface MedicalRecord {
  id: string;
  petId: string;
  type: RecordType;
  title: string;
  description: string;
  date: string;
  nextDueDate: string | null;
  author?: { name: string } | null;
}

export interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  notes: string | null;
  pet: { id: string; name: string; species: Species; tutorId: string };
  service: Service;
  staff: { id: string; name: string } | null;
}

export interface PetDetail extends Pet {
  records: MedicalRecord[];
  appointments: (Omit<Appointment, 'pet' | 'staff'> & { service: Service })[];
}

export interface DueItem extends MedicalRecord {
  pet: { id: string; name: string; species: Species };
}

export interface Slot {
  startsAt: string;
  endsAt: string;
  available: number;
}
