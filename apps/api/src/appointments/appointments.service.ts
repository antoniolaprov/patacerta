import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, desc, eq, gt, gte, inArray, lt, or, type SQL } from 'drizzle-orm';
import { isStaff, type AuthUser } from '../common/auth.decorators.js';
import { InjectDb, type Database } from '../db/db.module.js';
import {
  appointments,
  pets,
  services,
  type AppointmentStatus,
} from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import {
  AvailabilityQuery,
  CreateAppointmentDto,
  ListAppointmentsQuery,
  UpdateStatusDto,
} from './appointments.dto.js';
import { CAPACITY, computeSlots } from './availability.js';

const ACTIVE: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'];

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: 'agendado',
  CONFIRMED: 'confirmado',
  IN_PROGRESS: 'em atendimento',
  DONE: 'finalizado',
  CANCELED: 'cancelado',
};

/** Allowed status transitions, so the flow can't jump backwards. */
export const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'IN_PROGRESS', 'CANCELED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELED'],
  IN_PROGRESS: ['DONE'],
  DONE: [],
  CANCELED: [],
};

const withRelations = {
  pet: {
    columns: { id: true, name: true, species: true, tutorId: true },
    with: { tutor: { columns: { name: true, phone: true } } },
  },
  service: true,
  staff: { columns: { id: true, name: true } },
} as const;

@Injectable()
export class AppointmentsService {
  private readonly utcOffset: string;

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly events: EventsService,
    config: ConfigService,
  ) {
    this.utcOffset = config.get('CLINIC_UTC_OFFSET', '-03:00');
  }

  private dayRange(date: string) {
    const start = new Date(`${date}T00:00:00${this.utcOffset}`);
    return { start, end: new Date(start.getTime() + 86_400_000) };
  }

  /** Appointments of the same service type that are still occupying the agenda. */
  private sameTypeIds(type: (typeof services.$inferSelect)['type']) {
    return this.db.select({ id: services.id }).from(services).where(eq(services.type, type));
  }

  async availability({ serviceId, date }: AvailabilityQuery) {
    const service = await this.db.query.services.findFirst({
      where: eq(services.id, serviceId),
    });
    if (!service) throw new NotFoundException('Serviço não encontrado');

    const { start, end } = this.dayRange(date);
    const busy = await this.db
      .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
      .from(appointments)
      .where(
        and(
          inArray(appointments.status, ACTIVE),
          gte(appointments.startsAt, start),
          lt(appointments.startsAt, end),
          inArray(appointments.serviceId, this.sameTypeIds(service.type)),
        ),
      );

    return computeSlots({
      date,
      durationMin: service.durationMin,
      capacity: CAPACITY[service.type],
      busy,
      utcOffset: this.utcOffset,
    });
  }

  list(user: AuthUser, query: ListAppointmentsQuery) {
    const filters: (SQL | undefined)[] = [];
    if (!isStaff(user)) {
      const ownPets = this.db.select({ id: pets.id }).from(pets).where(eq(pets.tutorId, user.id));
      filters.push(inArray(appointments.petId, ownPets));
    }
    if (query.date) {
      const { start, end } = this.dayRange(query.date);
      filters.push(gte(appointments.startsAt, start), lt(appointments.startsAt, end));
    }
    if (query.status) filters.push(eq(appointments.status, query.status));

    return this.db.query.appointments.findMany({
      where: and(...filters),
      with: withRelations,
      orderBy: isStaff(user) ? asc(appointments.startsAt) : desc(appointments.startsAt),
    });
  }

  private findOne(id: string) {
    return this.db.query.appointments.findFirst({
      where: eq(appointments.id, id),
      with: withRelations,
    });
  }

  async create(user: AuthUser, dto: CreateAppointmentDto) {
    const [pet, service] = await Promise.all([
      this.db.query.pets.findFirst({ where: eq(pets.id, dto.petId) }),
      this.db.query.services.findFirst({ where: eq(services.id, dto.serviceId) }),
    ]);
    if (!pet) throw new NotFoundException('Pet não encontrado');
    if (!service || !service.active) throw new NotFoundException('Serviço não encontrado');
    if (!isStaff(user) && pet.tutorId !== user.id) {
      throw new ForbiddenException('Este pet não pertence a você');
    }

    const startsAt = new Date(dto.startsAt);
    if (startsAt <= new Date()) throw new BadRequestException('Escolha um horário futuro');
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

    const created = await this.db.transaction(
      async (tx) => {
        const overlapping = await tx
          .select({ petId: appointments.petId, serviceId: appointments.serviceId })
          .from(appointments)
          .where(
            and(
              inArray(appointments.status, ACTIVE),
              lt(appointments.startsAt, endsAt),
              gt(appointments.endsAt, startsAt),
              or(
                eq(appointments.petId, pet.id),
                inArray(appointments.serviceId, this.sameTypeIds(service.type)),
              ),
            ),
          );

        if (overlapping.some((a) => a.petId === pet.id)) {
          throw new ConflictException(`${pet.name} já tem um atendimento nesse horário`);
        }
        if (overlapping.length >= CAPACITY[service.type]) {
          throw new ConflictException('Esse horário acabou de ser preenchido');
        }
        const [row] = await tx
          .insert(appointments)
          .values({ petId: pet.id, serviceId: service.id, startsAt, endsAt, notes: dto.notes })
          .returning();
        return row;
      },
      // Serializable prevents two people from taking the last spot at once.
      { isolationLevel: 'serializable' },
    );

    const appointment = await this.findOne(created.id);
    await Promise.all([
      this.events.index({ kind: 'appointment', id: created.id }),
      this.events.publish({ rooms: ['staff'], event: 'appointment:created', payload: appointment }),
    ]);
    return appointment;
  }

  async updateStatus(user: AuthUser, id: string, dto: UpdateStatusDto) {
    const current = await this.findOne(id);
    if (!current) throw new NotFoundException('Agendamento não encontrado');

    const owner = current.pet.tutorId === user.id;
    // Tutors may only cancel their own appointments.
    if (!isStaff(user) && !(owner && dto.status === 'CANCELED')) {
      throw new ForbiddenException('Você não pode alterar este agendamento');
    }
    if (!TRANSITIONS[current.status].includes(dto.status)) {
      throw new BadRequestException(
        `Não é possível mudar de "${STATUS_LABEL[current.status]}" para "${STATUS_LABEL[dto.status]}"`,
      );
    }

    await this.db
      .update(appointments)
      .set({
        status: dto.status,
        notes: dto.notes ?? current.notes,
        staffId: isStaff(user) && dto.status === 'IN_PROGRESS' ? user.id : current.staffId,
      })
      .where(eq(appointments.id, id));

    const appointment = await this.findOne(id);
    const message = `${current.service.name} de ${current.pet.name}: ${STATUS_LABEL[dto.status]}`;
    await Promise.all([
      this.events.index({ kind: 'appointment', id }),
      this.events.publish({
        rooms: [`user:${current.pet.tutorId}`, 'staff'],
        event: 'appointment:updated',
        payload: { appointment, message },
      }),
    ]);
    return appointment;
  }
}
