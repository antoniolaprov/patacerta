import { ApiProperty } from '@nestjs/swagger';
import {
  appointmentStatusEnum,
  type AppointmentStatus,
} from '../db/schema.js';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateAppointmentDto {
  @ApiProperty()
  @IsUUID()
  petId: string;

  @ApiProperty()
  @IsUUID()
  serviceId: string;

  @ApiProperty({ example: '2026-11-10T13:00:00.000Z' })
  @IsDateString()
  startsAt: string;

  @ApiProperty({ required: false, example: 'Ele fica agitado com secador' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateStatusDto {
  @ApiProperty({ enum: appointmentStatusEnum.enumValues })
  @IsIn(appointmentStatusEnum.enumValues)
  status: AppointmentStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AvailabilityQuery {
  @ApiProperty()
  @IsUUID()
  serviceId: string;

  @ApiProperty({ example: '2026-11-10' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;
}

export class ListAppointmentsQuery {
  @ApiProperty({ required: false, example: '2026-11-10' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiProperty({ required: false, enum: appointmentStatusEnum.enumValues })
  @IsOptional()
  @IsIn(appointmentStatusEnum.enumValues)
  status?: AppointmentStatus;
}
