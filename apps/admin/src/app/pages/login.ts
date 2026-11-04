import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, errorMessage } from '../core/auth';

@Component({
  selector: 'pc-login',
  imports: [FormsModule],
  template: `
    <div class="login">
      <form class="login__card" (ngSubmit)="submit()">
        <img src="favicon.svg" alt="" width="48" height="48" />
        <h1>Painel da clínica</h1>
        <p class="muted">Agenda, prontuários e a assistente da equipe.</p>
        <label>
          E-mail
          <input type="email" name="email" [(ngModel)]="email" required autocomplete="email" />
        </label>
        <label>
          Senha
          <input type="password" name="password" [(ngModel)]="password" required autocomplete="current-password" />
        </label>
        @if (error()) {
          <p class="form-error" role="alert">{{ error() }}</p>
        }
        <button class="btn btn--primary btn--block" [disabled]="busy()">
          {{ busy() ? 'Entrando...' : 'Entrar' }}
        </button>
        <p class="demo-hint">
          Para testar: <code>marina&#64;patacerta.dev</code> com a senha <code>patacerta123</code>
        </p>
      </form>
    </div>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected email = '';
  protected password = '';
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  async submit() {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.email, this.password);
      this.router.navigateByUrl('/agenda');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
