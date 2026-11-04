import { env } from './env';

export interface Citation {
  ref: number;
  sourceType: 'record' | 'pet' | 'appointment';
  sourceId: string;
  petId: string;
  petName: string;
  title: string;
  date: string | null;
}

export type AssistantEvent =
  | { type: 'meta'; emergency: boolean; model: string }
  | { type: 'sources'; sources: Citation[] }
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** Reads a Server-Sent Events stream from the AI service. */
export async function* streamAssistant(
  path: string,
  token: string | null,
  body: unknown = {},
  signal?: AbortSignal,
): AsyncGenerator<AssistantEvent> {
  const res = await fetch(`${env.aiUrl}${path}`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    yield { type: 'error', message: data.message ?? 'A assistente não respondeu.' };
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('');
      if (data) yield JSON.parse(data) as AssistantEvent;
    }
  }
}
