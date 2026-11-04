import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { isStaff, type AuthUser } from '../common/auth.decorators.js';
import { InjectDb, type Database } from '../db/db.module.js';
import { appointments, medicalRecords, pets, users } from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import { CreatePetDto, UpdatePetDto } from './pets.dto.js';

const tutorColumns = { id: true, name: true, phone: true } as const;

@Injectable()
export class PetsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly events: EventsService,
  ) {}

  async list(user: AuthUser, search?: string) {
    const filters: (SQL | undefined)[] = [];
    if (!isStaff(user)) filters.push(eq(pets.tutorId, user.id));
    if (search) {
      const term = `%${search}%`;
      const tutorIds = this.db
        .select({ id: users.id })
        .from(users)
        .where(ilike(users.name, term));
      filters.push(or(ilike(pets.name, term), inArray(pets.tutorId, tutorIds)));
    }
    return this.db.query.pets.findMany({
      where: and(...filters),
      orderBy: asc(pets.name),
      with: { tutor: { columns: tutorColumns } },
    });
  }

  async get(user: AuthUser, id: string) {
    const pet = await this.db.query.pets.findFirst({
      where: eq(pets.id, id),
      with: {
        tutor: { columns: { ...tutorColumns, email: true } },
        records: {
          orderBy: desc(medicalRecords.date),
          with: { author: { columns: { name: true } } },
        },
        appointments: {
          orderBy: desc(appointments.startsAt),
          limit: 20,
          with: { service: true },
        },
      },
    });
    if (!pet) throw new NotFoundException('Pet não encontrado');
    this.assertAccess(user, pet.tutorId);
    return pet;
  }

  async create(user: AuthUser, dto: CreatePetDto) {
    const tutorId = isStaff(user) && dto.tutorId ? dto.tutorId : user.id;
    const [pet] = await this.db
      .insert(pets)
      .values({
        ...dto,
        tutorId,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
      })
      .returning();
    await this.events.index({ kind: 'pet', id: pet.id });
    return pet;
  }

  async update(user: AuthUser, id: string, dto: UpdatePetDto) {
    const current = await this.findOrFail(id);
    this.assertAccess(user, current.tutorId);

    const { tutorId, birthDate, ...data } = dto;
    const [pet] = await this.db
      .update(pets)
      .set({
        ...data,
        ...(isStaff(user) && tutorId ? { tutorId } : {}),
        ...(birthDate ? { birthDate: new Date(birthDate) } : {}),
      })
      .where(eq(pets.id, id))
      .returning();
    await this.events.index({ kind: 'pet', id });
    return pet;
  }

  async remove(user: AuthUser, id: string) {
    const current = await this.findOrFail(id);
    this.assertAccess(user, current.tutorId);
    await this.db.delete(pets).where(eq(pets.id, id));
    await this.events.index({ kind: 'delete', sourceType: 'pet', id });
  }

  async findOrFail(id: string) {
    const pet = await this.db.query.pets.findFirst({ where: eq(pets.id, id) });
    if (!pet) throw new NotFoundException('Pet não encontrado');
    return pet;
  }

  assertAccess(user: AuthUser, tutorId: string) {
    if (!isStaff(user) && tutorId !== user.id) {
      throw new ForbiddenException('Este pet não pertence a você');
    }
  }
}
