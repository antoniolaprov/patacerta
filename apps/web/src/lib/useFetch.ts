import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useRealtime } from './realtime';

/** Loads a resource and reloads it whenever a realtime event arrives. */
export function useFetch<T>(path: string | null) {
  const { version } = useRealtime();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load, version]);

  return { data, error, loading, reload: load };
}
