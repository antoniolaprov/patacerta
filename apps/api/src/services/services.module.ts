import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { asc, eq } from 'drizzle-orm';
import { IsIn, IsInt, IsPositive, IsString, Min } from 'class-validator';
import { Public, Roles } from '../common/auth.decorators.js';
import { InjectDb, type Database } from '../db/db.module.js';
import { serviceTypeEnum, services, type ServiceType } from '../db/schema.js';

class CreateServiceDto {
  @ApiProperty({ example: 'Banho e tosa higiênica' })
  @IsString()
  name: string;

  @ApiProperty({ enum: serviceTypeEnum.enumValues })
  @IsIn(serviceTypeEnum.enumValues)
  type: ServiceType;

  @ApiProperty({ example: 60 })
  @IsInt()
  @IsPositive()
  durationMin: number;

  @ApiProperty({ example: 8500, description: 'Preço em centavos' })
  @IsInt()
  @Min(0)
  priceCents: number;
}

@ApiTags('services')
@Controller('services')
class ServicesController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Public()
  @Get()
  list() {
    return this.db.query.services.findMany({
      where: eq(services.active, true),
      orderBy: [asc(services.type), asc(services.name)],
    });
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Post()
  async create(@Body() dto: CreateServiceDto) {
    const [service] = await this.db.insert(services).values(dto).returning();
    return service;
  }
}

@Module({ controllers: [ServicesController] })
export class ServicesModule {}
