import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { AI_URL, tokenStore } from './api';
import { useAuth } from './auth';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'alert';
}

interface RealtimeState {
  toasts: Toast[];
  dismiss(id: number): void;
  /** Increments on every event, so pages can refetch when something changed. */
  version: number;
}

const RealtimeContext = createContext<RealtimeState>({ toasts: [], dismiss: () => {}, version: 0 });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [version, setVersion] = useState(0);
  const nextId = useRef(1);

  useEffect(() => {
    if (!user) return;
    const socket: Socket = io(AI_URL, { auth: { token: tokenStore.get() } });

    const push = (message: string, tone: Toast['tone'] = 'info') => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, message, tone }]);
      setVersion((v) => v + 1);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
    };

    socket.on('appointment:updated', (p: { message: string }) => push(p.message));
    socket.on('record:created', (p: { message: string }) => push(p.message));
    socket.on('reminder', (p: { message: string }) => push(p.message, 'alert'));
    return () => {
      socket.disconnect();
    };
  }, [user]);

  return (
    <RealtimeContext.Provider
      value={{ toasts, version, dismiss: (id) => setToasts((t) => t.filter((x) => x.id !== id)) }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

export const useRealtime = () => useContext(RealtimeContext);
