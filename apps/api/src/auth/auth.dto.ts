import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Ana Souza' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'ana@email.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'senha123' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ required: false, example: '(81) 99999-0000' })
  @IsOptional()
  @IsString()
  phone?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'ana@patacerta.dev' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'patacerta123' })
  @IsString()
  password: string;
}
