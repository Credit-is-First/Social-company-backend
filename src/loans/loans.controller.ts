import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { Loan } from './entities/loan.entity';

@ApiTags('loans')
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new loan' })
  @ApiResponse({ status: 201, description: 'Loan created successfully', type: Loan })
  create(@Body() createLoanDto: CreateLoanDto) {
    return this.loansService.create(createLoanDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all loans' })
  @ApiResponse({ status: 200, description: 'List of all loans', type: [Loan] })
  findAll(@Query('userId') userId?: string, @Query('bookId') bookId?: string) {
    if (userId) {
      return this.loansService.findByUser(+userId);
    }
    if (bookId) {
      return this.loansService.findByBook(+bookId);
    }
    return this.loansService.findAll();
  }

  @Get('active')
  @ApiOperation({ summary: 'Get all active loans' })
  @ApiResponse({ status: 200, description: 'List of active loans', type: [Loan] })
  getActiveLoans() {
    return this.loansService.getActiveLoans();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a loan by ID' })
  @ApiResponse({ status: 200, description: 'Loan found', type: Loan })
  @ApiResponse({ status: 404, description: 'Loan not found' })
  findOne(@Param('id') id: string) {
    return this.loansService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a loan (e.g., return book)' })
  @ApiResponse({ status: 200, description: 'Loan updated successfully', type: Loan })
  update(@Param('id') id: string, @Body() updateLoanDto: UpdateLoanDto) {
    return this.loansService.update(+id, updateLoanDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a loan' })
  @ApiResponse({ status: 200, description: 'Loan deleted successfully' })
  remove(@Param('id') id: string) {
    return this.loansService.remove(+id);
  }
}

