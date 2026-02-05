import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    recipientEmail: z.string().email(),
    recipientName: z.string().min(1),
    subject: z.string().min(1),
    message: z.string().optional(),
  }),
});

function getConfig() {
  const toolInputRaw = process.env.ANCHOR_TOOL_INPUT;
  if (!toolInputRaw) throw new Error('ANCHOR_TOOL_INPUT is required');
  return ConfigSchema.parse({ sessionId: process.env.ANCHOR_SESSION_ID, toolInput: JSON.parse(toolInputRaw) });
}

function getAnchorClient(): Anchorbrowser { return new AnchorBrowser(); }

export default async function sendEnvelope() {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const input = config.toolInput;

    const prompt = `Send DocuSign envelope:
- Recipient: ${input.recipientName} (${input.recipientEmail})
- Subject: ${input.subject}
${input.message ? `- Message: ${input.message}` : ''}

Steps: Start new envelope, add recipient, set subject/message, send. Return { "envelopeId": "<id>", "status": "sent", "success": true }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://app.docusign.com',
        outputSchema: { type: 'object', properties: { envelopeId: { type: 'string' }, status: { type: 'string' }, success: { type: 'boolean' } }, required: ['envelopeId', 'status', 'success'] },
        maxSteps: 40,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
