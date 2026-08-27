import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService, DashboardStats } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // Authenticated but role-free: this is the landing page for every signed-in
  // user. It used to be @Public(), which exposed the whole loan table.
  @Get('stats')
  @ApiOperation({ summary: 'Get dashboard statistics (requires authentication)' })
  @ApiResponse({ status: 200, description: 'Dashboard statistics' })
  async getStats(): Promise<DashboardStats> {
    return await this.dashboardService.getStats();
  }
}
