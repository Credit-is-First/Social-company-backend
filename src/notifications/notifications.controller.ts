import { Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from './notifications.service';

/**
 * Every signed-in user has a notification list, so these routes need a valid
 * session (the global JWT guard) but no particular role. Each one only ever
 * touches the caller's own notifications.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List my latest notifications and the unread count' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(@CurrentUser() user: User, @Query('limit') limit?: string) {
    return this.notificationsService.listForUser(user.id, limit ? Number(limit) : undefined);
  }

  // Declared before ':id/read' so "read-all" is never taken for an id.
  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  markAllRead(@CurrentUser() user: User) {
    return this.notificationsService.markAllRead(user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one of my notifications as read' })
  markRead(@CurrentUser() user: User, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notificationsService.markRead(user.id, id);
  }
}
