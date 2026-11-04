import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  CurrentUser,
  Roles,
  STAFF_ROLES,
  isStaff,
  type AuthUser,
} from '../common/auth.decorators.js';
import { InjectDb, type Database } from '../db/db.module.js';
import {
  medicalRecords,
  pets,
  recordTypeEnum,
  type RecordType,
} from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import { PetsModule } from '../pets/pets.module.js';
import { PetsService } from '../pets/pets.service.js';
import { latestPerItem } from './latest-per-item.js';

class CreateRecordDto {
  @ApiProperty()
  @IsUUID()
  petId: string;

  @ApiProperty({ enum: recordTypeEnum.enumValues })
  @IsIn(recordTypeEnum.enumValues)
  type: RecordType;

  @ApiProperty({ example: 'Vacina V10' })
  @IsString()
  @MinLength(2)
  title: string;

  @ApiProperty({ example: 'Reforço anual aplicado sem reações.' })
  @IsString()
  description: string;

  @ApiProperty({ example: '2026-11-04' })
  @IsDateString()
  date: string;

  @ApiProperty({ required: false, example: '2027-11-04' })
  @IsOptional()
  @IsDateString()
  nextDueDate?: string;
}

class DueQuery {
  @ApiProperty({ required: false, example: 30, description: 'Janela em dias' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  days?: number;
}

@Injectable()
class RecordsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly pets: PetsService,
    private readonly events: EventsService,
  ) {}

  async listForPet(user: AuthUser, petId: string) {
    const pet = await this.pets.findOrFail(petId);
    this.pets.assertAccess(user, pet.tutorId);
    return this.db.query.medicalRecords.findMany({
      where: eq(medicalRecords.petId, petId),
      orderBy: desc(medicalRecords.date),
      with: { author: { columns: { name: true } } },
    });
  }

  /** Vaccines, dewormings and other items that are overdue or due soon. */
  async due(user: AuthUser, days = 30) {
    const until = new Date(Date.now() + days * 86_400_000);
    const ownPets = isStaff(user)
      ? undefined
      : inArray(
          medicalRecords.petId,
          this.db.select({ id: pets.id }).from(pets).where(eq(pets.tutorId, user.id)),
        );

    const records = await this.db.query.medicalRecords.findMany({
      where: and(isNotNull(medicalRecords.nextDueDate), ownPets),
      with: {
        pet: {
          columns: { id: true, name: true, species: true },
          with: { tutor: { columns: { id: true, name: true, phone: true } } },
        },
      },
    });

    return latestPerItem(records)
      .filter((r) => r.nextDueDate && r.nextDueDate <= until)
      .sort((a, b) => a.nextDueDate!.getTime() - b.nextDueDate!.getTime());
  }

  async create(user: AuthUser, dto: CreateRecordDto) {
    const pet = await this.pets.findOrFail(dto.petId);

    const [record] = await this.db
      .insert(medicalRecords)
      .values({
        ...dto,
        authorId: user.id,
        date: new Date(dto.date),
        nextDueDate: dto.nextDueDate ? new Date(dto.nextDueDate) : null,
      })
      .returning();

    await Promise.all([
      this.events.index({ kind: 'record', id: record.id }),
      this.events.publish({
        rooms: [`user:${pet.tutorId}`],
        event: 'record:created',
        payload: {
          record,
          message: `Novo registro no prontuário de ${pet.name}: ${record.title}`,
        },
      }),
    ]);
    return record;
  }
}

@ApiTags('records')
@ApiBearerAuth()
@Controller('records')
class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @Get('due')
  due(@CurrentUser() user: AuthUser, @Query() query: DueQuery) {
    return this.records.due(user, query.days);
  }

  @Get('pet/:petId')
  listForPet(
    @CurrentUser() user: AuthUser,
    @Param('petId', ParseUUIDPipe) petId: string,
  ) {
    return this.records.listForPet(user, petId);
  }

  @Roles(...STAFF_ROLES)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRecordDto) {
    return this.records.create(user, dto);
  }
}

@Module({
  imports: [PetsModule],
  controllers: [RecordsController],
  providers: [RecordsService],
})
export class RecordsModule {}
