import { z } from 'zod';
import type { AuthUser } from './auth.js';
import { config } from './config.js';
import type { AgentMessage, LlmProvider, ToolDef } from './llm.js';

/** Who the agent is acting for. Tools act with this user's permissions, never more. */
export interface ToolContext {
  user: AuthUser;
  token: string;
}

/**
 * A business rule said no (slot taken, pet not found...). The message goes back
 * to the model as a tool result, so it can explain or try something else.
 */
export class ToolError extends Error {}

export interface AgentTool<S extends z.ZodType = z.ZodType> {
  def: ToolDef;
  schema: S;
  run(args: z.infer<S>, ctx: ToolContext): Promise<unknown>;
  /** One line for the "what the agent did" log shown in the apps. */
  describe(args: z.infer<S>, result: unknown): string;
  /**
   * Splits the result: `forModel` goes back to the model, `forUser` travels with the
   * action event so the app can render it (e.g. a Pix code the model must not retype).
   */
  present?(result: unknown): { forModel: unknown; forUser: unknown };
}

/** Builds a tool whose JSON Schema (sent to the model) comes from the zod schema. */
export function defineTool<S extends z.ZodObject>(tool: {
  name: string;
  description: string;
  schema: S;
  run: AgentTool<S>['run'];
  describe: AgentTool<S>['describe'];
  present?: AgentTool<S>['present'];
}): AgentTool {
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(tool.schema) as Record<string, unknown>;
  return {
    def: { name: tool.name, description: tool.description, parameters },
    schema: tool.schema,
    run: tool.run,
    describe: tool.describe,
    present: tool.present,
  } as AgentTool;
}

export type AgentStep =
  | { type: 'action'; tool: string; label: string; ok: boolean; data?: unknown }
  | { type: 'final'; text: string };

export interface RunAgentInput {
  llm: LlmProvider;
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  ctx: ToolContext;
  maxSteps?: number;
}

/**
 * The agent loop: the model decides which tool to call, we run it with the
 * user's permissions and hand back the result, until it answers in text.
 */
export async function* runAgent({
  llm,
  system,
  messages,
  tools,
  ctx,
  maxSteps = config.AGENT_MAX_STEPS,
}: RunAgentInput): AsyncGenerator<AgentStep> {
  const byName = new Map(tools.map((t) => [t.def.name, t]));
  const convo = [...messages];

  for (let step = 0; step <= maxSteps; step++) {
    // On the last round the tools are withdrawn, so the model has to answer.
    const offered = step < maxSteps ? tools.map((t) => t.def) : [];
    const res = await llm.complete({ system, messages: convo, tools: offered });
    if (!res.toolCalls.length) {
      yield { type: 'final', text: res.text.trim() };
      return;
    }

    convo.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls, raw: res.raw });
    for (const call of res.toolCalls) {
      const tool = byName.get(call.name);
      let ok = true;
      let content: string;
      let label: string;
      let data: unknown;
      if (!tool) {
        ok = false;
        label = `Ferramenta desconhecida: ${call.name}`;
        content = JSON.stringify({ erro: label });
      } else {
        const parsed = tool.schema.safeParse(call.args);
        try {
          if (!parsed.success) {
            throw new ToolError(
              `Parâmetros inválidos: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
            );
          }
          const result = await tool.run(parsed.data, ctx);
          const view = tool.present?.(result);
          content = JSON.stringify(view ? view.forModel : result);
          data = view?.forUser;
          label = tool.describe(parsed.data, result);
        } catch (err) {
          ok = false;
          const message = err instanceof ToolError ? err.message : 'Falha inesperada ao executar a ação';
          if (!(err instanceof ToolError)) console.error(`[agent] ${call.name}`, err);
          content = JSON.stringify({ erro: message });
          label = `${tool.def.name}: ${message}`;
        }
      }
      convo.push({ role: 'tool', toolCallId: call.id, name: call.name, content, isError: !ok });
      yield { type: 'action', tool: call.name, label, ok, data };
    }
  }
}
