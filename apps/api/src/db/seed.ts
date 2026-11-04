import dotenv from 'dotenv';

dotenv.config({ path: ['.env', '../../.env'], quiet: true });
import bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import {
  appointments,
  medicalRecords,
  pets,
  services,
  users,
  type AppointmentStatus,
  type RecordType,
  type Role,
  type Service,
} from './schema.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const DAY = 86_400_000;
/** A date relative to today, at a given clinic local hour (UTC-03:00). */
const daysFromNow = (d: number, hour = 10) => {
  const date = new Date(Date.now() + d * DAY);
  date.setUTCHours(hour + 3, 0, 0, 0);
  return date;
};

async function main() {
  await db.delete(medicalRecords);
  await db.delete(appointments);
  await db.delete(services);
  await db.delete(pets);
  await db.delete(users);

  const passwordHash = await bcrypt.hash('patacerta123', 10);
  const user = async (name: string, email: string, role: Role, phone?: string) =>
    (await db.insert(users).values({ name, email, role, phone, passwordHash }).returning())[0];

  const admin = await user('Renata Lima', 'admin@patacerta.dev', 'ADMIN');
  const vet = await user('Dra. Marina Costa', 'marina@patacerta.dev', 'VET');
  const groomer = await user('Felipe Rocha', 'felipe@patacerta.dev', 'STAFF');
  const ana = await user('Ana Souza', 'ana@patacerta.dev', 'TUTOR', '(81) 99812-4410');
  const carlos = await user('Carlos Mendes', 'carlos@patacerta.dev', 'TUTOR', '(81) 98877-1203');
  const julia = await user('Júlia Andrade', 'julia@patacerta.dev', 'TUTOR', '(81) 99654-3321');

  const [bath, grooming, consult, vaccine] = await db
    .insert(services)
    .values([
      { name: 'Banho completo', type: 'BATH', durationMin: 60, priceCents: 7000 },
      { name: 'Banho e tosa', type: 'GROOMING', durationMin: 90, priceCents: 11000 },
      { name: 'Consulta clínica', type: 'CONSULTATION', durationMin: 30, priceCents: 15000 },
      { name: 'Aplicação de vacina', type: 'VACCINATION', durationMin: 30, priceCents: 9000 },
      { name: 'Exames laboratoriais', type: 'EXAM', durationMin: 30, priceCents: 18000 },
    ])
    .returning();

  const [thor, mel, bidu, luna, pipoca] = await db
    .insert(pets)
    .values([
      {
        name: 'Thor', species: 'DOG', breed: 'Golden Retriever', sex: 'Macho',
        birthDate: new Date('2021-03-15'), weightKg: 32.4, tutorId: ana.id,
        notes: 'Muito dócil. Tem dermatite alérgica e não pode comer ração com frango.',
      },
      {
        name: 'Mel', species: 'CAT', breed: 'SRD', sex: 'Fêmea',
        birthDate: new Date('2016-08-02'), weightKg: 4.1, tutorId: ana.id,
        notes: 'Fica estressada no transporte; usar feromônio sintético antes das consultas.',
      },
      {
        name: 'Bidu', species: 'DOG', breed: 'Shih Tzu', sex: 'Macho',
        birthDate: new Date('2015-11-20'), weightKg: 7.8, tutorId: carlos.id,
        notes: 'Idoso. Sopro cardíaco leve em acompanhamento.',
      },
      {
        name: 'Luna', species: 'DOG', breed: 'Border Collie', sex: 'Fêmea',
        birthDate: new Date('2024-01-10'), weightKg: 15.2, tutorId: julia.id,
        notes: 'Muito ativa. Castrada em 2025.',
      },
      {
        name: 'Pipoca', species: 'RODENT', breed: 'Porquinho-da-índia', sex: 'Fêmea',
        birthDate: new Date('2025-02-01'), weightKg: 0.9, tutorId: julia.id,
      },
    ])
    .returning();

  type Rec = {
    pet: string; type: RecordType; title: string; description: string;
    date: number; next?: number; author?: string;
  };
  const records: Rec[] = [
    // Thor
    { pet: thor.id, type: 'VACCINE', title: 'Vacina V10', description: 'Reforço anual da V10 aplicado sem reações adversas.', date: -340, next: 25 },
    { pet: thor.id, type: 'VACCINE', title: 'Vacina antirrábica', description: 'Antirrábica anual aplicada. Lote 4471-B.', date: -380, next: -15 },
    { pet: thor.id, type: 'DEWORMING', title: 'Vermífugo', description: 'Vermífugo oral (praziquantel + pirantel), dose para 32 kg.', date: -95, next: -5 },
    { pet: thor.id, type: 'CONSULTATION', title: 'Consulta dermatológica', description: 'Coceira intensa nas patas e na região abdominal. Diagnóstico de dermatite atópica com piora sazonal. Prescrito oclacitinib por 14 dias e troca para ração hipoalergênica à base de proteína de peixe. Evitar frango.', date: -200 },
    { pet: thor.id, type: 'CONSULTATION', title: 'Retorno dermatológico', description: 'Melhora de 80% das lesões. Manter ração hipoalergênica. Banhos com shampoo de clorexidina a cada 15 dias.', date: -180 },
    { pet: thor.id, type: 'EXAM', title: 'Hemograma e bioquímico', description: 'Hemograma sem alterações. ALT e creatinina dentro da referência. Apto para procedimentos.', date: -60 },
    { pet: thor.id, type: 'GROOMING_NOTE', title: 'Observação do banho', description: 'Pele avermelhada entre os dedos da pata dianteira esquerda. Usado shampoo de clorexidina. Recomendado avaliar com a veterinária.', date: -12, author: groomer.id },
    { pet: thor.id, type: 'NOTE', title: 'Pesagem', description: 'Peso atual 32,4 kg (era 30,1 kg há 6 meses). Orientada redução de petiscos.', date: -12 },
    // Mel
    { pet: mel.id, type: 'VACCINE', title: 'Vacina V5 felina', description: 'Reforço anual da quíntupla felina.', date: -150, next: 215 },
    { pet: mel.id, type: 'VACCINE', title: 'Vacina antirrábica', description: 'Antirrábica anual aplicada.', date: -150, next: 215 },
    { pet: mel.id, type: 'CONSULTATION', title: 'Consulta de rotina', description: 'Gata idosa saudável. Leve tártaro dentário; sugerida limpeza dentária nos próximos 6 meses. Estresse no transporte: usar feromônio sintético 30 minutos antes.', date: -150 },
    { pet: mel.id, type: 'EXAM', title: 'Exame de urina', description: 'Densidade urinária levemente baixa. Repetir em 6 meses e estimular a ingestão de água com fonte.', date: -150, next: 30 },
    // Bidu
    { pet: bidu.id, type: 'CONSULTATION', title: 'Cardiologia', description: 'Sopro cardíaco grau II/VI em valva mitral. Ecocardiograma sem remodelamento. Sem medicação por enquanto; reavaliar a cada 6 meses e observar cansaço ou tosse.', date: -170, next: 10 },
    { pet: bidu.id, type: 'VACCINE', title: 'Vacina V10', description: 'Reforço anual aplicado.', date: -300, next: 65 },
    { pet: bidu.id, type: 'VACCINE', title: 'Vacina antirrábica', description: 'Antirrábica anual aplicada.', date: -300, next: 65 },
    { pet: bidu.id, type: 'CONSULTATION', title: 'Otite', description: 'Otite externa bilateral por malassezia. Prescrita limpeza auricular diária e pomada otológica por 10 dias.', date: -45 },
    { pet: bidu.id, type: 'CONSULTATION', title: 'Retorno otite', description: 'Otite resolvida. Manter limpeza auricular semanal, principalmente após o banho.', date: -32 },
    { pet: bidu.id, type: 'GROOMING_NOTE', title: 'Observação da tosa', description: 'Tutor pediu tosa baby. Secar bem as orelhas por histórico de otite.', date: -20, author: groomer.id },
    // Luna
    { pet: luna.id, type: 'VACCINE', title: 'Vacina V10', description: 'Reforço anual aplicado.', date: -90, next: 275 },
    { pet: luna.id, type: 'VACCINE', title: 'Vacina antirrábica', description: 'Antirrábica anual aplicada.', date: -90, next: 275 },
    { pet: luna.id, type: 'VACCINE', title: 'Vacina gripe canina', description: 'Vacina contra tosse dos canis, recomendada por frequentar creche.', date: -370, next: -5 },
    { pet: luna.id, type: 'CONSULTATION', title: 'Claudicação', description: 'Mancando da pata traseira direita após corrida. Distensão muscular leve. Repouso por 7 dias e anti-inflamatório por 5 dias.', date: -25 },
    { pet: luna.id, type: 'DEWORMING', title: 'Vermífugo', description: 'Vermífugo oral, dose para 15 kg.', date: -40, next: 50 },
    // Pipoca
    { pet: pipoca.id, type: 'CONSULTATION', title: 'Primeira consulta', description: 'Porquinho-da-índia saudável. Orientada suplementação de vitamina C e feno à vontade. Dentes com desgaste normal.', date: -200 },
  ];

  await db.insert(medicalRecords).values(
    records.map((r) => ({
      petId: r.pet,
      authorId: r.author ?? vet.id,
      type: r.type,
      title: r.title,
      description: r.description,
      date: daysFromNow(r.date),
      nextDueDate: r.next === undefined ? null : daysFromNow(r.next),
    })),
  );

  type Appt = {
    pet: string; service: Service; day: number; hour: number;
    status: AppointmentStatus; staff?: string; notes?: string;
  };
  const appts: Appt[] = [
    { pet: thor.id, service: bath, day: -12, hour: 9, status: 'DONE', staff: groomer.id },
    { pet: thor.id, service: consult, day: -200, hour: 14, status: 'DONE', staff: vet.id },
    { pet: thor.id, service: bath, day: 2, hour: 9, status: 'CONFIRMED', notes: 'Usar shampoo de clorexidina' },
    { pet: mel.id, service: consult, day: -150, hour: 11, status: 'DONE', staff: vet.id },
    { pet: bidu.id, service: grooming, day: -20, hour: 10, status: 'DONE', staff: groomer.id },
    { pet: bidu.id, service: consult, day: -45, hour: 15, status: 'DONE', staff: vet.id },
    { pet: bidu.id, service: consult, day: 0, hour: 16, status: 'SCHEDULED', notes: 'Reavaliação cardiológica' },
    { pet: luna.id, service: consult, day: -25, hour: 17, status: 'DONE', staff: vet.id },
    { pet: luna.id, service: vaccine, day: 0, hour: 14, status: 'CONFIRMED', notes: 'Vacina gripe canina atrasada' },
    { pet: pipoca.id, service: bath, day: -7, hour: 11, status: 'CANCELED' },
  ];

  await db.insert(appointments).values(
    appts.map((a) => {
      const startsAt = daysFromNow(a.day, a.hour);
      return {
        petId: a.pet,
        serviceId: a.service.id,
        staffId: a.staff,
        status: a.status,
        notes: a.notes,
        startsAt,
        endsAt: new Date(startsAt.getTime() + a.service.durationMin * 60_000),
      };
    }),
  );

  console.log('Seed concluído. Logins (senha: patacerta123):');
  for (const u of [admin, vet, groomer, ana, carlos, julia]) {
    console.log(`  ${u.role.padEnd(6)} ${u.email}`);
  }
}

await main();
await pool.end();
