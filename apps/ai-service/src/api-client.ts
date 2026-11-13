import { ToolError } from './agent.js';
import { config } from './config.js';

/**
 * Calls the NestJS API with the user's own token. Writes go through the API,
 * not straight to the database, so agents get the same validations, capacity
 * rules, transactions and events as a person using the app.
 */
export async function callApi<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: globalThis.Response;
  try {
    res = await fetch(`${config.API_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ToolError('O sistema de agendamentos está indisponível no momento');
  }
  const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join('; ') : data.message;
    throw new ToolError(msg ?? `A API respondeu ${res.status}`);
  }
  return data as T;
}

/** Date and time in the clinic's timezone, e.g. "sáb., 15/11 às 09:30". */
export function clinicDateTime(iso: string | Date) {
  const d = new Date(iso);
  const day = d.toLocaleDateString('pt-BR', {
    timeZone: config.CLINIC_TIMEZONE,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
  const time = d.toLocaleTimeString('pt-BR', {
    timeZone: config.CLINIC_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${day} às ${time}`;
}

/** Today in the clinic's calendar: ISO date and weekday name. */
export function clinicToday(now = new Date()) {
  const iso = now.toLocaleDateString('en-CA', { timeZone: config.CLINIC_TIMEZONE });
  const weekday = now.toLocaleDateString('pt-BR', { timeZone: config.CLINIC_TIMEZONE, weekday: 'long' });
  return { iso, weekday };
}

/** Adds days to a `YYYY-MM-DD` date. */
export function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
