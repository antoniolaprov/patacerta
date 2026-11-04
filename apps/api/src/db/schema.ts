import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['TUTOR', 'STAFF', 'VET', 'ADMIN']);
export const speciesEnum = pgEnum('species', ['DOG', 'CAT', 'BIRD', 'RODENT', 'OTHER']);
export const serviceTypeEnum = pgEnum('service_type', [
  'BATH',
  'GROOMING',
  'CONSULTATION',
  'VACCINATION',
  'EXAM',
]);
export const appointmentStatusEnum = pgEnum('appointment_status', [
  'SCHEDULED',
  'CONFIRMED',
  'IN_PROGRESS',
  'DONE',
  'CANCELED',
]);
export const recordTypeEnum = pgEnum('record_type', [
  'CONSULTATION',
  'VACCINE',
  'DEWORMING',
  'EXAM',
  'GROOMING_NOTE',
  'NOTE',
]);

export type Role = (typeof roleEnum.enumValues)[number];
export type Species = (typeof speciesEnum.enumValues)[number];
export type ServiceType = (typeof serviceTypeEnum.enumValues)[number];
export type AppointmentStatus = (typeof appointmentStatusEnum.enumValues)[number];
export type RecordType = (typeof recordTypeEnum.enumValues)[number];

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('TUTOR'),
  createdAt: createdAt(),
});

export const pets = pgTable(
  'pets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    species: speciesEnum('species').notNull(),
    breed: text('breed'),
    sex: text('sex'),
    birthDate: timestamp('birth_date', { withTimezone: true, mode: 'date' }),
    weightKg: real('weight_kg'),
    notes: text('notes'),
    tutorId: uuid('tutor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [index('pets_tutor_idx').on(t.tutorId)],
);

export const services = pgTable('services', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: serviceTypeEnum('type').notNull(),
  durationMin: integer('duration_min').notNull(),
  priceCents: integer('price_cents').notNull(),
  active: boolean('active').notNull().default(true),
});

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    petId: uuid('pet_id')
      .notNull()
      .references(() => pets.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id),
    staffId: uuid('staff_id').references(() => users.id, { onDelete: 'set null' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: appointmentStatusEnum('status').notNull().default('SCHEDULED'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('appointments_starts_idx').on(t.startsAt),
    index('appointments_pet_idx').on(t.petId),
  ],
);

export const medicalRecords = pgTable(
  'medical_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    petId: uuid('pet_id')
      .notNull()
      .references(() => pets.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    type: recordTypeEnum('type').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    date: timestamp('date', { withTimezone: true }).notNull(),
    nextDueDate: timestamp('next_due_date', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('records_pet_date_idx').on(t.petId, t.date),
    index('records_due_idx').on(t.nextDueDate),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  pets: many(pets),
}));

export const petsRelations = relations(pets, ({ one, many }) => ({
  tutor: one(users, { fields: [pets.tutorId], references: [users.id] }),
  appointments: many(appointments),
  records: many(medicalRecords),
}));

export const servicesRelations = relations(services, ({ many }) => ({
  appointments: many(appointments),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  pet: one(pets, { fields: [appointments.petId], references: [pets.id] }),
  service: one(services, { fields: [appointments.serviceId], references: [services.id] }),
  staff: one(users, { fields: [appointments.staffId], references: [users.id] }),
}));

export const medicalRecordsRelations = relations(medicalRecords, ({ one }) => ({
  pet: one(pets, { fields: [medicalRecords.petId], references: [pets.id] }),
  author: one(users, { fields: [medicalRecords.authorId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Pet = typeof pets.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type MedicalRecord = typeof medicalRecords.$inferSelect;
