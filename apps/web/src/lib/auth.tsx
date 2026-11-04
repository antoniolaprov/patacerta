import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, post, tokenStore } from './api';
import type { User } from './types';

interface Session {
  accessToken: string;
  user: User;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(data: { name: string; email: string; password: string; phone?: string }): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  useEffect(() => {
    if (!tokenStore.get()) return;
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => tokenStore.set(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('patacerta:logout', onLogout);
    return () => window.removeEventListener('patacerta:logout', onLogout);
  }, []);

  const start = useCallback((session: Session) => {
    if (session.user.role !== 'TUTOR') {
      throw new Error('Esta conta é da equipe. Use o painel da clínica.');
    }
    tokenStore.set(session.accessToken);
    setUser(session.user);
  }, []);

  const value: AuthState = {
    user,
    loading,
    login: async (email, password) => start(await post<Session>('/auth/login', { email, password })),
    register: async (data) => start(await post<Session>('/auth/register', data)),
    logout: () => {
      tokenStore.set(null);
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return ctx;
}
