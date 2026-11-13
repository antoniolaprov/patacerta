import { z } from 'zod';
import { defineTool, ToolError } from '../agent.js';
import { config } from '../config.js';

/** What the n8n "Pix" workflow answers. `ok: false` carries a message meant for the model. */
interface PixReply {
  ok: boolean;
  erro?: string;
  valor?: string;
  descricao?: string;
  pix_copia_e_cola?: string;
}

/** Payload the apps render as a "copy the Pix code" card. */
export interface PixCharge {
  amount: string;
  description: string;
  code: string;
}

/**
 * Asks the n8n Pix workflow to build the charge. The model only passes the appointment
 * id: n8n looks the price up in the PataCerta API with the caller's own token, so the
 * amount never comes from the model and tutors can only charge their own appointments.
 */
export async function requestPix(token: string, appointmentId: string): Promise<PixCharge> {
  let res: globalThis.Response;
  try {
    res = await fetch(config.N8N_PIX_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ agendamento_id: appointmentId }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ToolError('O gerador de Pix está indisponível no momento');
  }
  const data = (await res.json().catch(() => null)) as PixReply | null;
  if (!res.ok || !data) throw new ToolError('Não foi possível gerar o Pix agora');
  if (!data.ok || !data.pix_copia_e_cola) throw new ToolError(data.erro ?? 'Não foi possível gerar o Pix');
  return { amount: data.valor ?? '', description: data.descricao ?? '', code: data.pix_copia_e_cola };
}

export const createPix = defineTool({
  name: 'gerar_pix',
  description:
    'Gera o Pix (copia e cola) para pagar um agendamento. Use quando a pessoa pedir para pagar ou pedir o Pix. ' +
    'O agendamento_id vem de `meus_agendamentos` ou de `agendar`. O valor é o do serviço; não informe valores.',
  schema: z.object({ agendamento_id: z.string().uuid() }),
  run: (args, ctx) => requestPix(ctx.token, args.agendamento_id),
  // The code is shown to the user by the app; the model only learns that it was sent.
  present: (result) => {
    const charge = result as PixCharge;
    return {
      forModel: {
        valor: charge.amount,
        descricao: charge.description,
        aviso: 'O código Pix já aparece para a pessoa abaixo da sua resposta. Não escreva nem repita o código.',
      },
      forUser: charge,
    };
  },
  describe: (_a, r) => `Gerou o Pix de ${(r as PixCharge).amount}: ${(r as PixCharge).description}`,
});
