import { AI_URL, tokenStore } from './api';

export interface Citation {
  ref: number;
  sourceType: 'record' | 'pet' | 'appointment';
  sourceId: string;
  petId: string;
  petName: string;
  title: string;
  date: string | null;
}

export type ChatEvent =
  | { type: 'meta'; emergency: boolean; model: string }
  | { type: 'sources'; sources: Citation[] }
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Reads the assistant's Server-Sent Events stream. `fetch` is used instead of
 * EventSource because the request is a POST with a bearer token.
 */
export async function* streamChat(
  body: { message: string; history?: ChatTurn[]; petId?: string },
  signal?: AbortSignal,
  path = '/chat',
): AsyncGenerator<ChatEvent> {
  const res = await fetch(`${AI_URL}${path}`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tokenStore.get() ?? ''}`,
    },
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
      if (data) yield JSON.parse(data) as ChatEvent;
    }
  }
}
