import { Component, ElementRef, inject, OnDestroy, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { streamAssistant, type Citation } from '../core/assistant';
import { AuthService } from '../core/auth';
import { RichText } from '../shared/rich-text';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Citation[];
  error?: string;
  pending?: boolean;
}

const SUGGESTIONS = [
  'Quais pets estão com vacina atrasada?',
  'Quem tem histórico de otite?',
  'Quais pacientes têm alergia alimentar?',
  'O que temos na agenda de hoje?',
];

@Component({
  selector: 'pc-assistant',
  imports: [FormsModule, RichText],
  template: `
    <header class="page-head">
      <div>
        <h1>Assistente da clínica</h1>
        <p class="muted">Pergunte sobre qualquer paciente, agenda ou pendência. Cada resposta mostra os registros usados.</p>
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
              @if (m.pending) {
                <span class="typing" aria-label="Pensando"></span>
              }
              @if (m.content) {
                <pc-rich-text [text]="m.content" [sources]="m.sources ?? []" />
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
    try {
      for await (const e of streamAssistant('/chat', this.auth.token(), { message: question, history }, this.abort.signal)) {
        if (e.type === 'sources') this.patchLast({ sources: e.sources });
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
