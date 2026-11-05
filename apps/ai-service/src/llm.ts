import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import type { ChatTurn } from './prompt.js';

export interface LlmRequest {
  system: string;
  messages: ChatTurn[];
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  stream(req: LlmRequest): AsyncIterable<string>;
}

class AnthropicProvider implements LlmProvider {
  readonly name = `anthropic:${config.LLM_MODEL}`;
  private readonly client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  async *stream({ system, messages, maxTokens = 1024 }: LlmRequest) {
    const stream = this.client.messages.stream({
      model: config.LLM_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}

/** Open model running locally with Ollama: the whole assistant works offline. */
class OllamaProvider implements LlmProvider {
  readonly name = `ollama:${config.OLLAMA_MODEL}`;

  async *stream({ system, messages, maxTokens = 1024 }: LlmRequest) {
    const res = await fetch(`${config.OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.OLLAMA_MODEL,
        stream: true,
        options: { num_predict: maxTokens, temperature: 0.2 },
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    if (!res.ok || !res.body) throw new Error(`Ollama respondeu ${res.status}`);

    const decoder = new TextDecoder();
    let buffer = '';
    for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(part, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const data = JSON.parse(line) as { message?: { content?: string } };
        if (data.message?.content) yield data.message.content;
      }
    }
  }
}

/**
 * Any endpoint that speaks the OpenAI chat completions format. Defaults to Groq,
 * which has a free tier; Gemini and OpenRouter work by changing the base URL.
 */
class OpenAICompatibleProvider implements LlmProvider {
  readonly name = `openai:${config.OPENAI_MODEL}`;

  async *stream({ system, messages, maxTokens = 1024 }: LlmRequest) {
    const res = await fetch(`${config.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.OPENAI_API_KEY ?? ''}`,
      },
      body: JSON.stringify({
        model: config.OPENAI_MODEL,
        stream: true,
        max_tokens: maxTokens,
        temperature: 0.2,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Provedor respondeu ${res.status}: ${detail.slice(0, 200)}`);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(part, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        const data = JSON.parse(payload) as { choices?: { delta?: { content?: string | null } }[] };
        const text = data.choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    }
  }
}

export function createProvider(): LlmProvider {
  if (config.LLM_PROVIDER === 'ollama') return new OllamaProvider();
  if (config.LLM_PROVIDER === 'openai') {
    if (!config.OPENAI_API_KEY) console.warn('[llm] OPENAI_API_KEY ausente para o provedor compatível com OpenAI');
    return new OpenAICompatibleProvider();
  }
  if (!config.ANTHROPIC_API_KEY) {
    console.warn('[llm] ANTHROPIC_API_KEY ausente: configure a chave ou use LLM_PROVIDER=ollama');
  }
  return new AnthropicProvider();
}
