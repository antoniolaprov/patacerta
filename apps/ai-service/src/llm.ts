import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import type { ChatTurn } from './prompt.js';

export interface LlmRequest {
  system: string;
  messages: ChatTurn[];
  maxTokens?: number;
}

/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Provider-neutral conversation used by the agents' tool loop. */
export type AgentMessage =
  | { role: 'user'; content: string }
  /** `raw` keeps the provider's own blocks so they can be replayed unchanged. */
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; raw?: unknown }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export interface CompleteRequest {
  system: string;
  messages: AgentMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
}

export interface CompleteResult {
  text: string;
  toolCalls: ToolCall[];
  raw?: unknown;
}

export interface LlmProvider {
  readonly name: string;
  /** Streams a plain text answer (the RAG assistant). */
  stream(req: LlmRequest): AsyncIterable<string>;
  /** One non-streaming turn that may request tool calls (the agents). */
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
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

  async complete({ system, messages, tools = [], maxTokens = 4096 }: CompleteRequest) {
    const params: Anthropic.MessageParam[] = [];
    for (const m of messages) {
      if (m.role === 'user') {
        params.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant') {
        // Replays the original blocks (thinking included) when we have them.
        const content =
          (m.raw as Anthropic.ContentBlockParam[] | undefined) ??
          ([
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...(m.toolCalls ?? []).map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args })),
          ] as Anthropic.ContentBlockParam[]);
        params.push({ role: 'assistant', content });
      } else {
        // All results of one turn go back together in a single user message.
        const block: Anthropic.ToolResultBlockParam = {
          type: 'tool_result',
          tool_use_id: m.toolCallId,
          content: m.content,
          is_error: m.isError,
        };
        const last = params[params.length - 1];
        if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) {
          last.content.push(block);
        } else {
          params.push({ role: 'user', content: [block] });
        }
      }
    }

    const res = await this.client.messages.create({
      model: config.LLM_MODEL,
      max_tokens: maxTokens,
      system,
      messages: params,
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    });
    if (res.stop_reason === 'refusal') throw new Error('O modelo recusou a solicitação');

    return {
      text: res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(''),
      toolCalls: res.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, args: parseArgs(b.input) })),
      raw: res.content,
    };
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

  async complete({ system, messages, tools = [], maxTokens = 2048 }: CompleteRequest) {
    const res = await fetch(`${config.OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.OLLAMA_MODEL,
        stream: false,
        options: { num_predict: maxTokens, temperature: 0.2 },
        tools: tools.map((t) => ({ type: 'function', function: t })),
        messages: [
          { role: 'system', content: system },
          ...messages.map((m) =>
            m.role === 'assistant'
              ? {
                  role: 'assistant',
                  content: m.content,
                  tool_calls: m.toolCalls?.map((c) => ({ function: { name: c.name, arguments: c.args } })),
                }
              : m.role === 'tool'
                ? { role: 'tool', content: m.content, tool_name: m.name }
                : m,
          ),
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama respondeu ${res.status}`);
    const data = (await res.json()) as {
      message?: { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] };
    };
    return {
      text: data.message?.content ?? '',
      toolCalls: (data.message?.tool_calls ?? []).map((c, i) => ({
        id: `call_${Date.now()}_${i}`,
        name: c.function.name,
        args: parseArgs(c.function.arguments),
      })),
    };
  }
}

/**
 * Any endpoint that speaks the OpenAI chat completions format. Defaults to Groq,
 * which has a free tier; Gemini and OpenRouter work by changing the base URL.
 */
class OpenAICompatibleProvider implements LlmProvider {
  readonly name = `openai:${config.OPENAI_MODEL}`;
  private readonly url = `${config.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  private readonly headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${config.OPENAI_API_KEY ?? ''}`,
  };
  /** gpt-oss models think before answering; "low" keeps turns fast and within free-tier limits. */
  private readonly extra = config.OPENAI_MODEL.includes('gpt-oss') ? { reasoning_effort: 'low' } : {};

  /**
   * POST with a short wait-and-retry on rate limits (429) and overload (503).
   * Free tiers cap tokens per minute; an agent turn makes several calls in a row.
   */
  private async post(body: Record<string, unknown>) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ ...body, ...this.extra }),
      });
      if ((res.status !== 429 && res.status !== 503) || attempt >= 5) return res;
      const detail = await res.text().catch(() => '');
      const hinted = Number(res.headers.get('retry-after')) || Number(/try again in ([\d.]+)s/i.exec(detail)?.[1]);
      const waitMs = Math.min(Number.isFinite(hinted) && hinted > 0 ? hinted * 1000 + 300 : 2000 * (attempt + 1), 20_000);
      console.warn(`[llm] limite do provedor (${res.status}), nova tentativa em ${Math.round(waitMs / 100) / 10}s`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  async *stream({ system, messages, maxTokens = 1024 }: LlmRequest) {
    const res = await this.post({
      model: config.OPENAI_MODEL,
      stream: true,
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [{ role: 'system', content: system }, ...messages],
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

  async complete({ system, messages, tools = [], maxTokens = 2048 }: CompleteRequest) {
    const res = await this.post({
        model: config.OPENAI_MODEL,
        max_tokens: maxTokens,
        temperature: 0.2,
        ...(tools.length
          ? { tools: tools.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' }
          : {}),
        messages: [
          { role: 'system', content: system },
          ...messages.map((m) =>
            m.role === 'assistant'
              ? {
                  role: 'assistant',
                  content: m.content || null,
                  ...(m.toolCalls?.length
                    ? {
                        tool_calls: m.toolCalls.map((c) => ({
                          id: c.id,
                          type: 'function',
                          function: { name: c.name, arguments: JSON.stringify(c.args) },
                        })),
                      }
                    : {}),
                }
              : m.role === 'tool'
                ? { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
                : m,
          ),
        ],
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Provedor respondeu ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
      }[];
    };
    const message = data.choices?.[0]?.message;
    return {
      text: message?.content ?? '',
      toolCalls: (message?.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        args: parseArgs(c.function.arguments),
      })),
    };
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
