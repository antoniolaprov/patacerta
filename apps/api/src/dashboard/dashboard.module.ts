import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, count, eq, gte, lt, sql, sum } from 'drizzle-orm';
import { Roles, STAFF_ROLES } from '../common/auth.decorators.js';
import { InjectDb, type Database } from '../db/db.module.js';
import { appointments, pets, services, users } from '../db/schema.js';

export function parseOffset(offset: string) {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

@Injectable()
class DashboardService {
  private readonly utcOffset: string;

  constructor(
    @InjectDb() private readonly db: Database,
    config: ConfigService,
  ) {
    this.utcOffset = config.get('CLINIC_UTC_OFFSET', '-03:00');
  }

  async overview() {
    const local = new Date(Date.now() + parseOffset(this.utcOffset));
    const today = local.toISOString().slice(0, 10);
    const dayStart = new Date(`${today}T00:00:00${this.utcOffset}`);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00${this.utcOffset}`);

    const [todayByStatus, revenueByType, [{ petCount }], [{ tutorCount }]] =
      await Promise.all([
        this.db
          .select({ status: appointments.status, total: count() })
          .from(appointments)
          .where(and(gte(appointments.startsAt, dayStart), lt(appointments.startsAt, dayEnd)))
          .groupBy(appointments.status),
        this.db
          .select({
            type: services.type,
            completed: count(),
            revenueCents: sum(services.priceCents).mapWith(Number),
          })
          .from(appointments)
          .innerJoin(services, eq(services.id, appointments.serviceId))
          .where(
            and(
              eq(appointments.status, 'DONE'),
              gte(appointments.startsAt, monthStart),
              lt(appointments.startsAt, dayEnd),
            ),
          )
          .groupBy(services.type),
        this.db.select({ petCount: count() }).from(pets),
        this.db
          .select({ tutorCount: sql<number>`count(*)::int` })
          .from(users)
          .where(eq(users.role, 'TUTOR')),
      ]);

    return {
      today: Object.fromEntries(todayByStatus.map((s) => [s.status, s.total])),
      month: {
        completed: revenueByType.reduce((n, r) => n + r.completed, 0),
        revenueCents: revenueByType.reduce((n, r) => n + r.revenueCents, 0),
        revenueByType: Object.fromEntries(revenueByType.map((r) => [r.type, r.revenueCents])),
      },
      totals: { pets: petCount, tutors: tutorCount },
    };
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Roles(...STAFF_ROLES)
@Controller('dashboard')
class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  overview() {
    return this.dashboard.overview();
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
