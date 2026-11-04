import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../core/auth';
import { env } from '../core/env';
import { daysUntil, dueLabel, fmtDate, SPECIES_EMOJI, whatsapp } from '../core/format';
import { RealtimeService } from '../core/realtime';
import type { DueItem } from '../core/types';

@Component({
  selector: 'pc-pending',
  imports: [RouterLink],
  template: `
    <header class="page-head">
      <div>
        <h1>Pendências</h1>
        <p class="muted">Vacinas, vermífugos e retornos atrasados ou vencendo nos próximos {{ days() }} dias.</p>
      </div>
      <label class="inline-label">
        Janela
        <select [value]="days()" (change)="days.set(+$any($event.target).value)">
          <option value="7">7 dias</option>
          <option value="30">30 dias</option>
          <option value="60">60 dias</option>
        </select>
      </label>
    </header>
    @if (error()) {
      <p class="form-error">{{ error() }}</p>
    }
    <p>
      <strong>{{ late().length }}</strong> atrasados, <strong>{{ items().length - late().length }}</strong> vencendo em breve.
    </p>
    <table class="table">
      <thead>
        <tr>
          <th scope="col">Pet</th>
          <th scope="col">Item</th>
          <th scope="col">Situação</th>
          <th scope="col">Tutor</th>
          <th scope="col"><span class="sr-only">Ações</span></th>
        </tr>
      </thead>
      <tbody>
        @for (item of items(); track item.id) {
          <tr [class.row--late]="isLate(item)">
            <td>
              <span aria-hidden="true">{{ emoji[item.pet.species] }}</span>
              <a [routerLink]="['/pacientes', item.pet.id]">{{ item.pet.name }}</a>
            </td>
            <td>{{ item.title }}</td>
            <td>
              <span [class]="isLate(item) ? 'pill pill--late' : 'pill'">{{ label(item.nextDueDate!) }}</span>
              <span class="muted small">{{ date(item.nextDueDate!) }}</span>
            </td>
            <td>{{ item.pet.tutor.name }}</td>
            <td>
              @if (wa(item); as link) {
                <a class="btn btn--small" [href]="link" target="_blank" rel="noopener">Avisar no WhatsApp</a>
              } @else {
                <span class="muted small">sem telefone</span>
              }
            </td>
          </tr>
        } @empty {
          <tr>
            <td colspan="5" class="muted">Nada pendente nesta janela.</td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class PendingPage {
  private readonly http = inject(HttpClient);
  private readonly realtime = inject(RealtimeService);
  protected readonly days = signal(30);
  protected readonly items = signal<DueItem[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly late = computed(() => this.items().filter((i) => this.isLate(i)));
  protected readonly emoji = SPECIES_EMOJI;
  protected readonly label = dueLabel;
  protected readonly date = fmtDate;

  constructor() {
    effect(() => {
      this.realtime.version();
      this.load(this.days());
    });
  }

  protected isLate(item: DueItem) {
    return daysUntil(item.nextDueDate!) < 0;
  }

  protected wa(item: DueItem) {
    const first = item.pet.tutor.name.split(' ')[0];
    const text = this.isLate(item)
      ? `Olá, ${first}! Aqui é da PataCerta. ${item.title} de ${item.pet.name} venceu em ${fmtDate(item.nextDueDate!)}. Podemos agendar?`
      : `Olá, ${first}! Aqui é da PataCerta. ${item.title} de ${item.pet.name} vence em ${fmtDate(item.nextDueDate!)}. Quer agendar?`;
    return whatsapp(item.pet.tutor.phone, text);
  }

  private async load(days: number) {
    try {
      this.items.set(
        await firstValueFrom(this.http.get<DueItem[]>(`${env.apiUrl}/records/due`, { params: { days } })),
      );
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
