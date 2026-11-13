import { Component, ElementRef, inject, OnDestroy, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { streamAssistant, type Citation, type PixCharge } from '../core/assistant';
import { AuthService } from '../core/auth';
import { RichText } from '../shared/rich-text';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Citation[];
  error?: string;
  pending?: boolean;
  actions?: { label: string; ok: boolean }[];
  pix?: PixCharge[];
}

const SUGGESTIONS = [
  'Quanto faturamos este mês e com quais serviços?',
  'Qual dia da próxima semana está mais vazio?',
  'Quais clientes não aparecem há mais de 90 dias?',
  'Quais pets estão com vacina atrasada?',
];

@Component({
  selector: 'pc-assistant',
  imports: [FormsModule, RichText],
  template: `
    <header class="page-head">
      <div>
        <h1>Assistente da clínica</h1>
        <p class="muted">Pergunte sobre pacientes, agenda, faturamento ou clientes inativos. A Pata consulta o sistema e pode agendar por você.</p>
      </div>
    </header>

    <div class="chat">
      <div class="chat__body" #body aria-live="polite">
        @if (messages().length === 0) {
          <div class="chips">
            @for (s of suggestions; track s) {
              <button class="chip" (click)="ask(s)">{{ s }}</button>
            }
          </div>
        }
        @for (m of messages(); track $index) {
          @if (m.role === 'user') {
            <p class="bubble bubble--user">{{ m.content }}</p>
          } @else {
            <div class="bubble bubble--pata">
              @if (m.actions?.length) {
                <ul class="agent-actions" aria-label="O que a Pata fez">
                  @for (a of m.actions; track $index) {
                    <li [class.agent-actions__fail]="!a.ok">{{ a.ok ? '✓' : '!' }} {{ a.label }}</li>
                  }
                </ul>
              }
              @if (m.pending) {
                <span class="typing" aria-label="Pensando"></span>
              }
              @if (m.content) {
                <pc-rich-text [text]="m.content" [sources]="m.sources ?? []" />
              }
              @for (c of m.pix ?? []; track $index) {
                <div class="pix-card">
                  <p class="pix-card__title">Pix de {{ c.amount }} <span>{{ c.description }}</span></p>
                  <textarea class="pix-card__code" readonly rows="3" aria-label="Pix copia e cola" [value]="c.code" (focus)="$any($event.target).select()"></textarea>
                  <button class="btn btn--primary" type="button" (click)="copyPix(c.code)">
                    {{ copied() === c.code ? 'Copiado!' : 'Copiar código Pix' }}
                  </button>
                </div>
              }
              @if (m.error) {
                <p class="form-error">{{ m.error }}</p>
              }
              @if (!m.pending && m.sources?.length && m.content) {
                <details class="sources">
                  <summary>Consultou {{ m.sources!.length }} registros</summary>
                  <ol>
                    @for (s of m.sources; track s.ref) {
                      <li>{{ s.title }}, {{ s.petName }}{{ s.date ? ', ' + s.date : '' }}</li>
                    }
                  </ol>
                </details>
              }
            </div>
          }
        }
      </div>
      <form class="chat__form" (ngSubmit)="ask(input)">
        <input name="q" [(ngModel)]="input" placeholder="Ex.: o Bidu já teve otite?" aria-label="Pergunta" maxlength="2000" />
        <button class="btn btn--primary" [disabled]="busy() || !input.trim()">Perguntar</button>
      </form>
    </div>
  `,
})
export class AssistantPage implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private abort?: AbortController;

  protected readonly suggestions = SUGGESTIONS;
  protected readonly messages = signal<Message[]>([]);
  protected readonly busy = signal(false);
  protected input = '';

  ngOnDestroy() {
    this.abort?.abort();
  }

  private patchLast(patch: Partial<Message>) {
    this.messages.update((m) => [...m.slice(0, -1), { ...m[m.length - 1], ...patch }]);
    queueMicrotask(() => {
      const el = this.body()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  readonly copied = signal('');

  async copyPix(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      this.copied.set(code);
      setTimeout(() => this.copied.set(''), 2500);
    } catch {
      // Clipboard blocked: the code stays selectable in the box.
    }
  }

  async ask(question: string) {
    if (!question.trim() || this.busy()) return;
    const history = this.messages()
      .filter((m) => m.content && !m.error)
      .map(({ role, content }) => ({ role, content }));
    this.messages.update((m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: '', pending: true }]);
    this.input = '';
    this.busy.set(true);
    this.abort = new AbortController();
    let answer = '';
    const actions: { label: string; ok: boolean }[] = [];
    const pix: PixCharge[] = [];
    try {
      for await (const e of streamAssistant('/chat', this.auth.token(), { message: question, history }, this.abort.signal)) {
        if (e.type === 'sources') this.patchLast({ sources: e.sources });
        if (e.type === 'action') {
          actions.push({ label: e.label, ok: e.ok });
          this.patchLast({ actions: [...actions] });
          if (e.tool === 'gerar_pix' && e.ok && e.data) {
            pix.push(e.data as PixCharge);
            this.patchLast({ pix: [...pix] });
          }
        }
        if (e.type === 'token') {
          answer += e.text;
          this.patchLast({ content: answer, pending: false });
        }
        if (e.type === 'error') this.patchLast({ error: e.message, pending: false });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') this.patchLast({ error: 'Sem conexão com a assistente.' });
    } finally {
      this.patchLast({ pending: false });
      this.busy.set(false);
    }
  }
}
