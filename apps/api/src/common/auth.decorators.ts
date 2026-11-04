import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Role } from '../db/schema.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Staff roles: anyone who works at the clinic. */
export const STAFF_ROLES: Role[] = ['STAFF', 'VET', 'ADMIN'];

export const isStaff = (user: AuthUser) => STAFF_ROLES.includes(user.role);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
