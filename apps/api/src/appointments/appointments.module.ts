import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/auth.decorators.js';
import {
  AvailabilityQuery,
  CreateAppointmentDto,
  ListAppointmentsQuery,
  UpdateStatusDto,
} from './appointments.dto.js';
import { AppointmentsService } from './appointments.service.js';

@ApiTags('appointments')
@ApiBearerAuth()
@Controller('appointments')
class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get('availability')
  availability(@Query() query: AvailabilityQuery) {
    return this.appointments.availability(query);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListAppointmentsQuery) {
    return this.appointments.list(user, query);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAppointmentDto) {
    return this.appointments.create(user, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.appointments.updateStatus(user, id, dto);
  }
}

@Module({
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
