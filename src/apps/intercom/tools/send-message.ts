import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    conversationId: z.string().min(1),
    message: z.string().min(1),
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

export default async function sendMessage() {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const input = config.toolInput;

    const prompt = `Send message in Intercom:
- Conversation/User: ${input.conversationId}
- Message: ${input.message}

Steps: Find conversation, type message, send. Return { "messageId": "<id>", "success": true }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        outputSchema: { type: 'object', properties: { messageId: { type: 'string' }, success: { type: 'boolean' } }, required: ['messageId', 'success'] },
        maxSteps: 25,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
