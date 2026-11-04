import { ApiProperty, PartialType } from '@nestjs/swagger';
import { speciesEnum, type Species } from '../db/schema.js';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreatePetDto {
  @ApiProperty({ example: 'Thor' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ enum: speciesEnum.enumValues, example: 'DOG' })
  @IsIn(speciesEnum.enumValues)
  species: Species;

  @ApiProperty({ required: false, example: 'Golden Retriever' })
  @IsOptional()
  @IsString()
  breed?: string;

  @ApiProperty({ required: false, example: 'Macho' })
  @IsOptional()
  @IsString()
  sex?: string;

  @ApiProperty({ required: false, example: '2021-03-15' })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiProperty({ required: false, example: 32.5 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  weightKg?: number;

  @ApiProperty({ required: false, example: 'Alérgico a frango' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    required: false,
    description: 'Apenas equipe: cadastrar pet para outro tutor',
  })
  @IsOptional()
  @IsUUID()
  tutorId?: string;
}

export class UpdatePetDto extends PartialType(CreatePetDto) {}
