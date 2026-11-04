import { HttpClient, type HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { catchError, firstValueFrom, throwError } from 'rxjs';
import { env } from './env';
import type { User } from './types';

const TOKEN_KEY = 'patacerta.admin.token';

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly token = signal<string | null>(readToken());
  readonly user = signal<User | null>(null);
  readonly isLoggedIn = computed(() => Boolean(this.token()));

  async restore() {
    if (!this.token()) return;
    try {
      this.user.set(await firstValueFrom(this.http.get<User>(`${env.apiUrl}/auth/me`)));
    } catch {
      this.logout();
    }
  }

  async login(email: string, password: string) {
    const session = await firstValueFrom(
      this.http.post<{ accessToken: string; user: User }>(`${env.apiUrl}/auth/login`, { email, password }),
    );
    if (session.user.role === 'TUTOR') {
      throw new Error('Esta conta é de tutor. Use o app PataCerta para tutores.');
    }
    writeToken(session.accessToken);
    this.token.set(session.accessToken);
    this.user.set(session.user);
  }

  logout() {
    writeToken(null);
    this.token.set(null);
    this.user.set(null);
    this.router.navigateByUrl('/login');
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const authed = token ? req.clone({ setHeaders: { authorization: `Bearer ${token}` } }) : req;
  return next(authed).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && token) auth.logout();
      return throwError(() => err);
    }),
  );
};

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? true : inject(Router).parseUrl('/login');
};

/** Turns an API error into the message the user should see. */
export function errorMessage(err: unknown) {
  if (err instanceof HttpErrorResponse) {
    const m = err.error?.message;
    if (Array.isArray(m)) return m.join('. ');
    if (typeof m === 'string') return m;
    if (err.status === 0) return 'Sem conexão com o servidor.';
  }
  return err instanceof Error ? err.message : 'Não foi possível concluir a ação.';
}
