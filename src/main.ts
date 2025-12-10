import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  // Enable CORS for frontend (multiple origins)
  app.enableCors({
    origin: [
      // 'http://localhost:5000',
      // 'http://localhost:3000',
      // 'http://localhost:3001',
    ],
    credentials: true,
  });

  // Serve static files
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  }));

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('Library Management API')
    .setDescription('Electronic Library Management System API Documentation')
    .setVersion('1.0')
    .addTag('books')
    .addTag('users')
    .addTag('loans')
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(5001);
  console.log('Application is running on: http://localhost:5001');
  console.log('Swagger documentation: http://localhost:5001/api');
}
bootstrap();

