import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { and, asc, count, eq, ilike, or } from 'drizzle-orm';
import { Roles, STAFF_ROLES } from '../common/auth.decorators.js';
import { InjectDb, type Database } from '../db/db.module.js';
import { pets, users } from '../db/schema.js';

@ApiTags('users')
@ApiBearerAuth()
@Roles(...STAFF_ROLES)
@Controller('users')
class UsersController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Get('tutors')
  @ApiQuery({ name: 'search', required: false })
  tutors(@Query('search') search?: string) {
    const term = search ? `%${search}%` : undefined;
    return this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        petCount: count(pets.id),
      })
      .from(users)
      .leftJoin(pets, eq(pets.tutorId, users.id))
      .where(
        and(
          eq(users.role, 'TUTOR'),
          term ? or(ilike(users.name, term), ilike(users.email, term)) : undefined,
        ),
      )
      .groupBy(users.id)
      .orderBy(asc(users.name));
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
