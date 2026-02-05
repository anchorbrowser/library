import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    conversationId: z.string().min(1),
    message: z.string().min(1),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { messageId: string; success: boolean };
  error?: string;
}

function getConfig(): Config {
  const toolInputRaw = process.env.ANCHOR_TOOL_INPUT;
  if (!toolInputRaw) throw new Error('ANCHOR_TOOL_INPUT is required');

  return ConfigSchema.parse({
    sessionId: process.env.ANCHOR_SESSION_ID,
    toolInput: JSON.parse(toolInputRaw),
  });
}

function getAnchorClient(): Anchorbrowser {
  return new AnchorBrowser();
}

function buildPrompt(input: Config['toolInput']): string {
  return `Send a message in Drift:

- Conversation/Contact: ${input.conversationId}
- Message: ${input.message}

Steps:
1. Search for and open the conversation
2. Type the message
3. Send it
4. Extract message ID

Return JSON: { "messageId": "<id>", "success": true }`;
}

export default async function sendMessage(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://app.drift.com',
        outputSchema: {
          type: 'object',
          properties: {
            messageId: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['messageId', 'success'],
        },
        maxSteps: 25,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
