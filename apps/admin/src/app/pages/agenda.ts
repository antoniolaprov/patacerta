import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../core/auth';
import { env } from '../core/env';
import { fmtMoney, fmtTime, localISODate, NEXT_STEP, SPECIES_EMOJI, STATUS, whatsapp } from '../core/format';
import { RealtimeService } from '../core/realtime';
import type { Appointment, AppointmentStatus, Overview } from '../core/types';

const COLUMNS: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'DONE'];

@Component({
  selector: 'pc-agenda',
  imports: [RouterLink],
  template: `
    <header class="page-head">
      <div>
        <h1>Agenda do dia</h1>
        <p class="muted">{{ dateLabel() }}</p>
      </div>
      <div class="date-nav" role="group" aria-label="Escolher dia">
        <button class="btn" (click)="shift(-1)" aria-label="Dia anterior">‹</button>
        <input type="date" [value]="date()" (change)="date.set($any($event.target).value)" aria-label="Data" />
        <button class="btn" (click)="shift(1)" aria-label="Próximo dia">›</button>
        @if (date() !== today) {
          <button class="link-btn" (click)="date.set(today)">Hoje</button>
        }
      </div>
    </header>

    @if (overview(); as o) {
      <section class="stats" aria-label="Resumo">
        <p><strong>{{ total() }}</strong> atendimentos no dia</p>
        <p><strong>{{ o.month.completed }}</strong> finalizados no mês</p>
        <p><strong>{{ money(o.month.revenueCents) }}</strong> faturados no mês</p>
        <p><strong>{{ o.totals.pets }}</strong> pacientes cadastrados</p>
      </section>
    }

    @if (error()) {
      <p class="form-error" role="alert">{{ error() }}</p>
    }

    <div class="board">
      @for (status of columns; track status) {
        <section class="column column--{{ status.toLowerCase() }}" [attr.aria-label]="statusLabel[status]">
          <h2>
            {{ statusLabel[status] }} <span class="count">{{ byStatus()[status].length }}</span>
          </h2>
          @for (a of byStatus()[status]; track a.id) {
            <article class="card" [class.card--busy]="busyId() === a.id">
              <div class="card__time">{{ time(a.startsAt) }}<span>até {{ time(a.endsAt) }}</span></div>
              <h3>
                <span aria-hidden="true">{{ emoji[a.pet.species] }}</span>
                <a [routerLink]="['/pacientes', a.pet.id]">{{ a.pet.name }}</a>
              </h3>
              <p class="card__service">{{ a.service.name }}</p>
              <p class="card__tutor">
                {{ a.pet.tutor.name }}
                @if (wa(a); as link) {
                  <a [href]="link" target="_blank" rel="noopener">WhatsApp</a>
                }
              </p>
              @if (a.notes) {
                <p class="card__notes">{{ a.notes }}</p>
              }
              @if (a.staff) {
                <p class="muted small">Com {{ a.staff.name }}</p>
              }
              <div class="card__actions">
                @if (next[a.status]; as step) {
                  <button class="btn btn--small btn--primary" (click)="move(a, step.to)" [disabled]="busyId() === a.id">
                    {{ step.label }}
                  </button>
                }
                @if (a.status === 'SCHEDULED' || a.status === 'CONFIRMED') {
                  <button class="link-btn link-btn--danger" (click)="move(a, 'CANCELED')">Cancelar</button>
                }
              </div>
            </article>
          } @empty {
            <p class="column__empty">Nenhum atendimento</p>
          }
        </section>
      }
    </div>

    @if (canceled().length) {
      <details class="canceled">
        <summary>{{ canceled().length }} cancelado(s) neste dia</summary>
        <ul>
          @for (a of canceled(); track a.id) {
            <li>{{ time(a.startsAt) }}: {{ a.service.name }} de {{ a.pet.name }}</li>
          }
        </ul>
      </details>
    }
  `,
})
export class AgendaPage {
  private readonly http = inject(HttpClient);
  private readonly realtime = inject(RealtimeService);

  protected readonly today = localISODate();
  protected readonly date = signal(this.today);
  protected readonly appointments = signal<Appointment[]>([]);
  protected readonly overview = signal<Overview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);

  protected readonly columns = COLUMNS;
  protected readonly statusLabel = STATUS;
  protected readonly next = NEXT_STEP;
  protected readonly emoji = SPECIES_EMOJI;
  protected readonly time = fmtTime;
  protected readonly money = fmtMoney;

  protected readonly byStatus = computed(() => {
    const groups = Object.fromEntries(COLUMNS.map((s) => [s, [] as Appointment[]])) as Record<
      AppointmentStatus,
      Appointment[]
    >;
    for (const a of this.appointments()) if (groups[a.status]) groups[a.status].push(a);
    return groups;
  });
  protected readonly canceled = computed(() => this.appointments().filter((a) => a.status === 'CANCELED'));
  protected readonly total = computed(() => this.appointments().length - this.canceled().length);
  protected readonly dateLabel = computed(() =>
    new Date(`${this.date()}T12:00:00-03:00`).toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  );

  constructor() {
    effect(() => {
      // Reload when the date changes or a realtime event arrives.
      this.realtime.version();
      this.load(this.date());
    });
  }

  protected shift(days: number) {
    const d = new Date(`${this.date()}T12:00:00-03:00`);
    d.setDate(d.getDate() + days);
    this.date.set(localISODate(d));
  }

  protected wa(a: Appointment) {
    return whatsapp(a.pet.tutor.phone, `Olá, ${a.pet.tutor.name.split(' ')[0]}! Aqui é da PataCerta, sobre o atendimento de ${a.pet.name}.`);
  }

  private async load(date: string) {
    try {
      const [appointments, overview] = await Promise.all([
        firstValueFrom(this.http.get<Appointment[]>(`${env.apiUrl}/appointments`, { params: { date } })),
        firstValueFrom(this.http.get<Overview>(`${env.apiUrl}/dashboard`)),
      ]);
      this.appointments.set(appointments);
      this.overview.set(overview);
      this.error.set(null);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected async move(a: Appointment, status: AppointmentStatus) {
    if (status === 'CANCELED' && !confirm(`Cancelar ${a.service.name} de ${a.pet.name}?`)) return;
    this.busyId.set(a.id);
    try {
      const updated = await firstValueFrom(
        this.http.patch<Appointment>(`${env.apiUrl}/appointments/${a.id}/status`, { status }),
      );
      // Optimistic local update; the realtime event refreshes the rest.
      this.appointments.update((list) => list.map((x) => (x.id === a.id ? { ...x, ...updated, pet: x.pet } : x)));
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busyId.set(null);
    }
  }
}
