import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4200').split(','),
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const docs = new DocumentBuilder()
    .setTitle('PataCerta API')
    .setDescription('API de agendamentos, pets e prontuários do PataCerta')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, docs));

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API em http://localhost:${port}/api · docs em /docs`, 'Bootstrap');
}
await bootstrap();
