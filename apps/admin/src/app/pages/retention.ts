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
        <h1>Retenção com IA</h1>
        <p class="muted">
          O agente procura pets com cuidados atrasados ou vencendo sem nada agendado, e clientes que sumiram.
          Para cada um, escreve uma mensagem a partir do histórico. Você revisa e envia.
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
            <button class="btn btn--small btn--primary" (click)="send(p)" [disabled]="p.sent">
              {{ p.sent ? 'Enviado no app' : 'Enviar no app do tutor' }}
            </button>
            @if (wa(p); as link) {
              <a class="btn btn--small" [href]="link" target="_blank" rel="noopener">Abrir no WhatsApp</a>
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

  async send(p: Proposal) {
    try {
      await this.post('/agents/retention/send', { petId: p.petId, tutorId: p.tutorId, message: p.message });
      this.proposals.update((list) => list.map((x) => (x.petId === p.petId ? { ...x, sent: true } : x)));
    } catch (err) {
      this.error.set((err as Error).message);
    }
  }

  protected wa(p: Proposal) {
    return whatsapp(p.phone, p.message);
  }
}
