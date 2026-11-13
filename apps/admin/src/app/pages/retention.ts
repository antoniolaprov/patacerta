import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth';
import { env } from '../core/env';
import { whatsapp } from '../core/format';

interface Proposal {
  petId: string;
  petName: string;
  tutorId: string;
  tutorName: string;
  phone: string | null;
  reasons: string[];
  priority: 'alta' | 'media' | 'baixa';
  suggestedService: string;
  message: string;
  writtenBy: 'ia' | 'modelo';
  sent?: boolean;
}

@Component({
  selector: 'pc-retention',
  imports: [FormsModule, RouterLink],
  template: `
    <header class="page-head">
      <div>
        <h1>Agente de relacionamento</h1>
        <p class="muted">
          O agente encontra os clientes que a clínica está perdendo (cuidados atrasados sem nada agendado, ou sem visitas
          há meses) e escreve uma mensagem com base no histórico, sugerindo resolver tudo na mesma visita. Você revisa e
          envia pelo WhatsApp; o tutor toca no link e agenda com a Pata no app.
        </p>
      </div>
      <button class="btn btn--primary" (click)="run()" [disabled]="loading()">
        {{ loading() ? 'Analisando...' : 'Rodar agente' }}
      </button>
    </header>

    @if (error()) {
      <p class="form-error">{{ error() }}</p>
    }
    @if (model()) {
      <p class="muted small">{{ proposals().length }} clientes para contatar · mensagens escritas por {{ model() }}</p>
    }

    <div class="retention-list">
      @for (p of proposals(); track p.petId) {
        <article class="retention-card">
          <div>
            <span [class]="p.priority === 'alta' ? 'pill pill--late' : 'pill'">prioridade {{ p.priority }}</span>
            <strong> <a [routerLink]="['/pacientes', p.petId]">{{ p.petName }}</a></strong>
            <span class="muted"> · tutor(a) {{ p.tutorName }} · sugerido: {{ p.suggestedService }}</span>
          </div>
          <ul class="small">
            @for (r of p.reasons; track r) {
              <li>{{ r }}</li>
            }
          </ul>
          <label class="small muted" [for]="'msg-' + p.petId">
            Mensagem {{ p.writtenBy === 'ia' ? 'escrita pela IA' : '(modelo padrão: IA indisponível)' }}
          </label>
          <textarea [id]="'msg-' + p.petId" [(ngModel)]="p.message"></textarea>
          <div class="retention-card__actions">
            @if (p.phone) {
              <button class="btn btn--small btn--primary" (click)="send(p, true)">
                {{ p.sent ? 'Enviar de novo no WhatsApp' : 'Enviar no WhatsApp' }}
              </button>
            }
            <button class="btn btn--small" (click)="send(p, false)" [disabled]="p.sent">
              {{ p.sent ? 'Enviado' : 'Só avisar no app' }}
            </button>
            @if (p.sent) {
              <span class="muted small">O tutor já vê a mensagem ao abrir a Pata no app.</span>
            }
          </div>
        </article>
      } @empty {
        @if (!loading() && model()) {
          <p class="muted">Nenhum cliente precisa de contato agora.</p>
        }
      }
    </div>
  `,
})
export class RetentionPage {
  private readonly auth = inject(AuthService);
  protected readonly proposals = signal<Proposal[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly model = signal<string | null>(null);

  private async post<T>(path: string, body: unknown = {}): Promise<T> {
    const res = await fetch(`${env.aiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.auth.token() ?? ''}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? 'O agente não respondeu');
    return data as T;
  }

  async run() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await this.post<{ model: string; proposals: Proposal[] }>('/agents/retention/run');
      this.model.set(data.model);
      this.proposals.set(data.proposals);
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  /** Records the message (the chat in the app picks it up) and optionally opens WhatsApp. */
  async send(p: Proposal, viaWhatsapp: boolean) {
    // Opened before the request so the browser doesn't block it as a pop-up.
    const tab = viaWhatsapp ? window.open('', '_blank') : null;
    try {
      const { whatsappText } = await this.post<{ whatsappText: string }>('/agents/retention/send', {
        petId: p.petId,
        tutorId: p.tutorId,
        message: p.message,
      });
      this.proposals.update((list) => list.map((x) => (x.petId === p.petId ? { ...x, sent: true } : x)));
      const link = whatsapp(p.phone, whatsappText);
      if (tab && link) tab.location.href = link;
    } catch (err) {
      tab?.close();
      this.error.set((err as Error).message);
    }
  }
}
