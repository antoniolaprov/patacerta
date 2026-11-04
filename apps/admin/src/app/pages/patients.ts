import { HttpClient } from '@angular/common/http';
import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../core/auth';
import { env } from '../core/env';
import { age, SPECIES, SPECIES_EMOJI } from '../core/format';
import type { Pet } from '../core/types';

@Component({
  selector: 'pc-patients',
  imports: [RouterLink],
  template: `
    <header class="page-head">
      <h1>Pacientes</h1>
      <input
        class="search"
        type="search"
        placeholder="Buscar por pet ou tutor"
        aria-label="Buscar por pet ou tutor"
        [value]="search()"
        (input)="search.set($any($event.target).value)"
      />
    </header>
    @if (error()) {
      <p class="form-error">{{ error() }}</p>
    }
    <table class="table">
      <thead>
        <tr>
          <th scope="col">Pet</th>
          <th scope="col">Espécie e raça</th>
          <th scope="col">Idade</th>
          <th scope="col">Tutor</th>
          <th scope="col">Contato</th>
        </tr>
      </thead>
      <tbody>
        @for (p of pets(); track p.id) {
          <tr>
            <td>
              <span aria-hidden="true">{{ emoji[p.species] }}</span>
              <a [routerLink]="['/pacientes', p.id]">{{ p.name }}</a>
            </td>
            <td>{{ species[p.species] }}{{ p.breed ? ', ' + p.breed : '' }}</td>
            <td>{{ age(p.birthDate) ?? 'não informada' }}</td>
            <td>{{ p.tutor.name }}</td>
            <td>{{ p.tutor.phone ?? 'sem telefone' }}</td>
          </tr>
        } @empty {
          <tr>
            <td colspan="5" class="muted">Nenhum paciente encontrado.</td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class PatientsPage {
  private readonly http = inject(HttpClient);
  protected readonly search = signal('');
  protected readonly pets = signal<Pet[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly emoji = SPECIES_EMOJI;
  protected readonly species = SPECIES;
  protected readonly age = age;

  constructor() {
    let timer: ReturnType<typeof setTimeout>;
    effect(() => {
      const term = this.search();
      clearTimeout(timer);
      timer = setTimeout(() => this.load(term), 200);
    });
  }

  private async load(search: string) {
    try {
      this.pets.set(
        await firstValueFrom(
          this.http.get<Pet[]>(`${env.apiUrl}/pets`, { params: search ? { search } : {} }),
        ),
      );
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
