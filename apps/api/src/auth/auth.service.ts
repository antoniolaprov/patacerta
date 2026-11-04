import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { InjectDb, type Database } from '../db/db.module.js';
import { users, type User } from '../db/schema.js';
import { LoginDto, RegisterDto } from './auth.dto.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const exists = await this.db.query.users.findFirst({ where: eq(users.email, email) });
    if (exists) throw new ConflictException('E-mail já cadastrado');

    const [user] = await this.db
      .insert(users)
      .values({
        name: dto.name,
        email,
        phone: dto.phone,
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: 'TUTOR',
      })
      .returning();
    return this.session(user);
  }

  async login(dto: LoginDto) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.email, dto.email.toLowerCase()),
    });
    const valid = user && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!valid) throw new UnauthorizedException('E-mail ou senha inválidos');
    return this.session(user);
  }

  profile(id: string) {
    return this.db.query.users.findFirst({
      where: eq(users.id, id),
      columns: { id: true, name: true, email: true, phone: true, role: true },
    });
  }

  private session(user: User) {
    const { passwordHash: _hash, ...profile } = user;
    const accessToken = this.jwt.sign({
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
    return { accessToken, user: profile };
  }
}
