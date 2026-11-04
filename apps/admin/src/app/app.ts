import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth';
import { RealtimeService } from './core/realtime';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (auth.user(); as user) {
      <div class="shell">
        <aside class="sidebar">
          <a routerLink="/" class="brand">
            <img src="logo-icon.png" alt="" width="30" height="30" />
            <span>PataCerta <small>Clínica</small></span>
          </a>
          <nav aria-label="Principal">
            <a routerLink="/agenda" routerLinkActive="active">Agenda do dia</a>
            <a routerLink="/pacientes" routerLinkActive="active">Pacientes</a>
            <a routerLink="/pendencias" routerLinkActive="active">Pendências</a>
            <a routerLink="/assistente" routerLinkActive="active">Assistente</a>
          </nav>
          <div class="sidebar__foot">
            <span class="live" [class.live--on]="realtime.connected()">
              {{ realtime.connected() ? 'Ao vivo' : 'Reconectando' }}
            </span>
            <strong>{{ user.name }}</strong>
            <button class="link-btn" (click)="auth.logout()">Sair</button>
          </div>
        </aside>
        <main class="content">
          <router-outlet />
        </main>
      </div>
    } @else {
      <router-outlet />
    }

    <div class="toasts" role="status" aria-live="polite">
      @for (t of realtime.toasts(); track t.id) {
        <div class="toast">
          <p>{{ t.message }}</p>
          <button class="icon-btn" (click)="realtime.dismiss(t.id)" aria-label="Dispensar">✕</button>
        </div>
      }
    </div>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly realtime = inject(RealtimeService);
}
