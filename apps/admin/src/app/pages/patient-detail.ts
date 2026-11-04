import { HttpClient } from '@angular/common/http';
import { Component, effect, inject, input, OnDestroy, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { streamAssistant } from '../core/assistant';
import { AuthService, errorMessage } from '../core/auth';
import { env } from '../core/env';
import { age, dueLabel, fmtDate, localISODate, RECORD_TYPE, SPECIES, SPECIES_EMOJI, STATUS, whatsapp } from '../core/format';
import { RealtimeService } from '../core/realtime';
import type { PetDetail, RecordType } from '../core/types';
import { RichText } from '../shared/rich-text';

@Component({
  selector: 'pc-patient-detail',
  imports: [RouterLink, ReactiveFormsModule, RichText],
  template: `
    <a routerLink="/pacientes" class="back">Pacientes</a>
    @if (pet(); as p) {
      <header class="patient-head">
        <span class="patient-head__avatar" aria-hidden="true">{{ emoji[p.species] }}</span>
        <div>
          <h1>{{ p.name }}</h1>
          <p class="muted">
            {{ species[p.species] }}{{ p.breed ? ', ' + p.breed : '' }}{{ p.sex ? ', ' + p.sex : '' }}{{
              age(p.birthDate) ? ', ' + age(p.birthDate) : ''
            }}{{ p.weightKg ? ', ' + p.weightKg.toLocaleString('pt-BR') + ' kg' : '' }}
          </p>
          <p>
            Tutor: <strong>{{ p.tutor.name }}</strong>@if (p.tutor.phone) {<span>, {{ p.tutor.phone }}</span>
              <a [href]="wa(p)" target="_blank" rel="noopener">WhatsApp</a>
            }
          </p>
        </div>
      </header>
      @if (p.notes) {
        <p class="alert-note">{{ p.notes }}</p>
      }

      <div class="patient-grid">
        <section class="brief" aria-labelledby="brief-title">
          <div class="brief__head">
            <h2 id="brief-title">Resumo pré-atendimento</h2>
            <button class="btn btn--small" (click)="generateBrief()" [disabled]="briefBusy()">
              {{ brief() ? 'Gerar novamente' : 'Gerar resumo' }}
            </button>
          </div>
          @if (!brief() && !briefBusy() && !briefError()) {
            <p class="muted">
              A assistente lê todo o histórico de {{ p.name }} e destaca alergias, condições crônicas, pendências e
              observações recentes da equipe.
            </p>
          }
          @if (briefBusy() && !brief()) {
            <p class="muted">Lendo o prontuário...</p>
          }
          @if (brief()) {
            <pc-rich-text [text]="brief()" />
          }
          @if (briefError()) {
            <p class="form-error">{{ briefError() }}</p>
          }
        </section>

        <section class="new-record" aria-labelledby="new-record-title">
          <h2 id="new-record-title">Novo registro</h2>
          <form [formGroup]="form" (ngSubmit)="save(p.id)">
            <div class="row">
              <label>
                Tipo
                <select formControlName="type">
                  @for (t of recordTypes; track t[0]) {
                    <option [value]="t[0]">{{ t[1] }}</option>
                  }
                </select>
              </label>
              <label>
                Data
                <input type="date" formControlName="date" />
              </label>
            </div>
            <label>
              Título
              <input formControlName="title" placeholder="Ex.: Vacina V10, Retorno dermatológico" />
            </label>
            <label>
              Descrição
              <textarea rows="3" formControlName="description" placeholder="O que foi feito, observado ou orientado"></textarea>
            </label>
            <label>
              <span>Próxima data <span class="optional">(retorno, reforço ou nova dose)</span></span>
              <input type="date" formControlName="nextDueDate" />
            </label>
            @if (saveError()) {
              <p class="form-error">{{ saveError() }}</p>
            }
            <button class="btn btn--primary" [disabled]="form.invalid || saving()">
              {{ saving() ? 'Salvando...' : 'Salvar no prontuário' }}
            </button>
          </form>
        </section>
      </div>

      <section aria-labelledby="history-title">
        <h2 id="history-title">Prontuário</h2>
        <ol class="history">
          @for (r of p.records; track r.id) {
            <li [class]="'history__item history__item--' + r.type.toLowerCase()">
              <time>{{ date(r.date) }}</time>
              <div>
                <h3>
                  {{ r.title }} <span class="tag">{{ recordType[r.type] }}</span>
                </h3>
                <p>{{ r.description }}</p>
                <p class="muted small">
                  {{ r.author?.name ?? 'Equipe' }}@if (r.nextDueDate) {<span>, próxima data {{ date(r.nextDueDate) }} ({{ due(r.nextDueDate) }})</span>}
                </p>
              </div>
            </li>
          } @empty {
            <li class="muted">Sem registros ainda.</li>
          }
        </ol>
      </section>

      <section aria-labelledby="appts-title">
        <h2 id="appts-title">Atendimentos recentes</h2>
        <ul class="simple-list">
          @for (a of p.appointments; track a.id) {
            <li>{{ date(a.startsAt) }}: {{ a.service.name }}, {{ status[a.status].toLowerCase() }}</li>
          } @empty {
            <li class="muted">Nenhum atendimento.</li>
          }
        </ul>
      </section>
    } @else if (error()) {
      <p class="form-error">{{ error() }}</p>
    } @else {
      <p class="muted">Carregando...</p>
    }
  `,
})
export class PatientDetailPage implements OnDestroy {
  readonly id = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly realtime = inject(RealtimeService);
  private abort?: AbortController;

  protected readonly pet = signal<PetDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly brief = signal('');
  protected readonly briefBusy = signal(false);
  protected readonly briefError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly emoji = SPECIES_EMOJI;
  protected readonly species = SPECIES;
  protected readonly recordType = RECORD_TYPE;
  protected readonly status = STATUS;
  protected readonly recordTypes = Object.entries(RECORD_TYPE) as [RecordType, string][];
  protected readonly age = age;
  protected readonly date = fmtDate;
  protected readonly due = dueLabel;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    type: ['CONSULTATION' as RecordType, Validators.required],
    date: [localISODate(), Validators.required],
    title: ['', [Validators.required, Validators.minLength(2)]],
    description: ['', Validators.required],
    nextDueDate: [''],
  });

  constructor() {
    effect(() => {
      this.realtime.version();
      this.load(this.id());
    });
  }

  ngOnDestroy() {
    this.abort?.abort();
  }

  protected wa(p: PetDetail) {
    return whatsapp(p.tutor.phone, `Olá, ${p.tutor.name.split(' ')[0]}! Aqui é da PataCerta, sobre ${p.name}.`);
  }

  private async load(id: string) {
    try {
      this.pet.set(await firstValueFrom(this.http.get<PetDetail>(`${env.apiUrl}/pets/${id}`)));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected async generateBrief() {
    this.abort?.abort();
    this.abort = new AbortController();
    this.brief.set('');
    this.briefError.set(null);
    this.briefBusy.set(true);
    try {
      for await (const e of streamAssistant(`/assist/pet-brief/${this.id()}`, this.auth.token(), {}, this.abort.signal)) {
        if (e.type === 'token') this.brief.update((b) => b + e.text);
        if (e.type === 'error') this.briefError.set(e.message);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') this.briefError.set('Sem conexão com a assistente.');
    } finally {
      this.briefBusy.set(false);
    }
  }

  protected async save(petId: string) {
    this.saving.set(true);
    this.saveError.set(null);
    const v = this.form.getRawValue();
    try {
      await firstValueFrom(
        this.http.post(`${env.apiUrl}/records`, { ...v, petId, nextDueDate: v.nextDueDate || undefined }),
      );
      this.form.reset({ type: 'CONSULTATION', date: localISODate(), title: '', description: '', nextDueDate: '' });
      await this.load(petId);
    } catch (err) {
      this.saveError.set(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
