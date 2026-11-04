import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export type Role = 'TUTOR' | 'STAFF' | 'VET' | 'ADMIN';

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
}

export const isStaff = (user: AuthUser) => user.role !== 'TUTOR';

/** Tokens are issued by the NestJS API; both services share the same secret. */
export function verifyToken(token: string | undefined): AuthUser | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as {
      sub: string;
      name: string;
      role: Role;
    };
    return { id: payload.sub, name: payload.name, role: payload.role };
  } catch {
    return null;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const user = verifyToken(header?.startsWith('Bearer ') ? header.slice(7) : undefined);
  if (!user) {
    res.status(401).json({ message: 'Sessão inválida ou expirada' });
    return;
  }
  req.user = user;
  next();
}
