import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { Loan } from './entities/loan.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { HasRoles } from '../auth/decorators/roles.decorator';
import { Roles } from '../roles/roles.constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('loans')
@Controller('loans')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Post()
  @HasRoles(Roles.BOOK_LENDING_APPROVE)
  @ApiOperation({ summary: 'Create a new loan' })
  @ApiResponse({ status: 201, description: 'Loan created successfully', type: Loan })
  create(@Body() createLoanDto: CreateLoanDto) {
    return this.loansService.create(createLoanDto);
  }

  @Post('borrow')
  @HasRoles(Roles.BOOK_LENDING_REQUEST)
  @ApiOperation({ summary: 'Request to borrow a book (for current user)' })
  @ApiResponse({ status: 201, description: 'Book borrowing requested successfully', type: Loan })
  borrow(@CurrentUser() user: User, @Body() body: { bookId: string }) {
    return this.loansService.createForUser(user.id, body.bookId);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get current user\'s loans' })
  @ApiResponse({ status: 200, description: 'List of current user\'s loans', type: [Loan] })
  getMyLoans(@CurrentUser() user: User) {
    return this.loansService.findByUser(user.id);
  }

  @Get()
  @HasRoles(Roles.BOOK_LENDING_READ)
  @ApiOperation({ summary: 'Get all loans' })
  @ApiResponse({ status: 200, description: 'List of all loans', type: [Loan] })
  findAll(@Query('userId') userId?: string, @Query('bookId') bookId?: string) {
    if (userId) {
      return this.loansService.findByUser(userId);
    }
    if (bookId) {
      return this.loansService.findByBook(bookId);
    }
    return this.loansService.findAll();
  }

  @Get('active')
  @HasRoles(Roles.BOOK_LENDING_READ)
  @ApiOperation({ summary: 'Get all active loans' })
  @ApiResponse({ status: 200, description: 'List of active loans', type: [Loan] })
  getActiveLoans() {
    return this.loansService.getActiveLoans();
  }

  @Get(':id')
  @HasRoles(Roles.BOOK_LENDING_READ)
  @ApiOperation({ summary: 'Get a loan by ID' })
  @ApiResponse({ status: 200, description: 'Loan found', type: Loan })
  @ApiResponse({ status: 404, description: 'Loan not found' })
  findOne(@Param('id') id: string) {
    return this.loansService.findOne(id);
  }

  @Patch(':id/approve')
  @HasRoles(Roles.BOOK_LENDING_APPROVE)
  @ApiOperation({ summary: 'Approve a loan request' })
  @ApiResponse({ status: 200, description: 'Loan approved successfully', type: Loan })
  approve(@Param('id') id: string) {
    return this.loansService.approve(id);
  }

  @Patch(':id/decline')
  @HasRoles(Roles.BOOK_LENDING_DECLINE)
  @ApiOperation({ summary: 'Decline a loan request' })
  @ApiResponse({ status: 200, description: 'Loan declined successfully', type: Loan })
  decline(@Param('id') id: string) {
    return this.loansService.decline(id);
  }

  @Patch(':id')
  @HasRoles(Roles.BOOK_LENDING_APPROVE)
  @ApiOperation({ summary: 'Update a loan (e.g., return book)' })
  @ApiResponse({ status: 200, description: 'Loan updated successfully', type: Loan })
  update(@Param('id') id: string, @Body() updateLoanDto: UpdateLoanDto) {
    return this.loansService.update(id, updateLoanDto);
  }

  @Delete('my/:id')
  @ApiOperation({ summary: 'Cancel/delete current user\'s own loan' })
  @ApiResponse({ status: 200, description: 'Loan cancelled successfully' })
  cancelMyLoan(@CurrentUser() user: User, @Param('id') id: string) {
    return this.loansService.cancelUserLoan(user.id, id);
  }

  @Delete(':id')
  @HasRoles(Roles.BOOK_LENDING_DELETE)
  @ApiOperation({ summary: 'Delete a loan' })
  @ApiResponse({ status: 200, description: 'Loan deleted successfully' })
  remove(@Param('id') id: string) {
    return this.loansService.remove(id);
  }
}

