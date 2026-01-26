import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DashboardService, DashboardStats } from './dashboard.service';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @Public()
  @ApiOperation({ summary: 'Get dashboard statistics (Public)' })
  @ApiResponse({ status: 200, description: 'Dashboard statistics' })
  async getStats(): Promise<DashboardStats> {
    return await this.dashboardService.getStats();
  }
}
