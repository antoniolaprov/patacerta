import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppointmentsModule } from './appointments/appointments.module.js';
import { AuthModule } from './auth/auth.module.js';
import { Public } from './common/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from './common/guards.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { EventsModule } from './events/events.module.js';
import { PetsModule } from './pets/pets.module.js';
import { DbModule } from './db/db.module.js';
import { RecordsModule } from './records/records.module.js';
import { ServicesModule } from './services/services.module.js';
import { UsersModule } from './users/users.module.js';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'ok', service: 'patacerta-api' };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    DbModule,
    EventsModule,
    AuthModule,
    UsersModule,
    PetsModule,
    ServicesModule,
    AppointmentsModule,
    RecordsModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
