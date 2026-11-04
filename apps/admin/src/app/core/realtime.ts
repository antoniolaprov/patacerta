import { effect, inject, Injectable, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import { AuthService } from './auth';
import { env } from './env';

export interface Toast {
  id: number;
  message: string;
}

/**
 * Connects to the realtime gateway while someone is logged in. `version` bumps
 * on every event so pages can refetch, and `toasts` shows what happened.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly auth = inject(AuthService);
  private socket?: Socket;
  private nextId = 1;

  readonly version = signal(0);
  readonly toasts = signal<Toast[]>([]);
  readonly connected = signal(false);

  constructor() {
    effect(() => {
      const token = this.auth.token();
      this.socket?.disconnect();
      this.connected.set(false);
      if (!token) return;

      const socket = io(env.aiUrl, { auth: { token } });
      socket.on('connect', () => this.connected.set(true));
      socket.on('disconnect', () => this.connected.set(false));
      socket.on('appointment:created', (a: { pet?: { name: string }; service?: { name: string } }) =>
        this.push(`Novo agendamento: ${a.service?.name ?? 'serviço'} de ${a.pet?.name ?? 'pet'}`),
      );
      socket.on('appointment:updated', (p: { message: string }) => this.push(p.message));
      this.socket = socket;
    });
  }

  dismiss(id: number) {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }

  private push(message: string) {
    const id = this.nextId++;
    this.toasts.update((t) => [...t.slice(-3), { id, message }]);
    this.version.update((v) => v + 1);
    setTimeout(() => this.dismiss(id), 6000);
  }
}
