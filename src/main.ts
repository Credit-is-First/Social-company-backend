import { env } from './config/env';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Only the configured frontend origins may call this API from a browser.
  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  }));

  // Swagger exposes the full API surface, so keep it out of production.
  if (!env.isProduction) {
    const config = new DocumentBuilder()
      .setTitle('Library Management API')
      .setDescription('Electronic Library Management System API Documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('books')
      .addTag('users')
      .addTag('loans')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
  }

  await app.listen(env.port);
  console.log(`Application is running on: http://localhost:${env.port}`);
  if (!env.isProduction) {
    console.log(`Swagger documentation: http://localhost:${env.port}/api`);
  }
}
bootstrap();
