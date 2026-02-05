import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    subject: z.string().min(1),
    description: z.string().min(1),
    requesterEmail: z.string().email(),
    priority: z.string().optional(),
  }),
});

function getConfig() {
  const toolInputRaw = process.env.ANCHOR_TOOL_INPUT;
  if (!toolInputRaw) throw new Error('ANCHOR_TOOL_INPUT is required');
  return ConfigSchema.parse({ sessionId: process.env.ANCHOR_SESSION_ID, toolInput: JSON.parse(toolInputRaw) });
}

function getAnchorClient(): Anchorbrowser {
  return new AnchorBrowser();
}

export default async function createTicket() {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const input = config.toolInput;

    const prompt = `Create Zendesk ticket:
- Subject: ${input.subject}
- Description: ${input.description}
- Requester: ${input.requesterEmail}
${input.priority ? `- Priority: ${input.priority}` : ''}

Steps: Click +Add, fill form, submit. Return { "ticketId": "<id>", "success": true }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        outputSchema: { type: 'object', properties: { ticketId: { type: 'string' }, success: { type: 'boolean' } }, required: ['ticketId', 'success'] },
        maxSteps: 30,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
