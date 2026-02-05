import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    requesterEmail: z.string().email(),
    subject: z.string().min(1),
    description: z.string().min(1),
    priority: z.number().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { ticketId: string; success: boolean };
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
  const priorityMap: Record<number, string> = { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' };
  return `Create a new support ticket in Freshdesk:

- Requester: ${input.requesterEmail}
- Subject: ${input.subject}
- Description: ${input.description}
${input.priority ? `- Priority: ${priorityMap[input.priority] || input.priority}` : ''}

Steps:
1. Click "New Ticket" or "+"
2. Enter requester email
3. Enter subject and description
4. Set priority if provided
5. Create the ticket
6. Extract ticket ID

Return JSON: { "ticketId": "<id>", "success": true }`;
}

export default async function createTicket(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        outputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['ticketId', 'success'],
        },
        maxSteps: 30,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
