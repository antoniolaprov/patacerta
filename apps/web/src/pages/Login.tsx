import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';

export function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register({ ...form, phone: form.phone || undefined });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="login__intro">
        <img src="/logo-icon.png" alt="" width={56} height={56} />
        <h1>A carteirinha do seu pet, sempre com você.</h1>
        <p>
          Vacinas, consultas e banhos num só lugar. Agende em poucos toques e acompanhe o
          atendimento em tempo real.
        </p>
      </section>

      <form className="login__card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Entrar' : 'Criar conta'}</h2>
        {mode === 'register' && (
          <>
            <label>
              Nome
              <input required minLength={2} value={form.name} onChange={set('name')} autoComplete="name" />
            </label>
            <label>
              <span>
                Celular <span className="optional">(opcional)</span>
              </span>
              <input value={form.phone} onChange={set('phone')} autoComplete="tel" inputMode="tel" />
            </label>
          </>
        )}
        <label>
          E-mail
          <input type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
        </label>
        <label>
          Senha
          <input
            type="password"
            required
            minLength={6}
            value={form.password}
            onChange={set('password')}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--primary btn--block" disabled={busy}>
          {busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode === 'login' ? 'Ainda não tem conta? Cadastre-se' : 'Já tem conta? Entre'}
        </button>
        {mode === 'login' && (
          <p className="demo-hint">
            Para testar: <code>ana@patacerta.dev</code> com a senha <code>patacerta123</code>
          </p>
        )}
      </form>
    </div>
  );
}
