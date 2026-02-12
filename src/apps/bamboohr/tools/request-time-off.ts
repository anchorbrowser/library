import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    startDate: z.string(),
    endDate: z.string(),
    timeOffType: z.string().min(1),
    notes: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { requestId: string; success: boolean };
  error?: string;
}

function getConfig(): Config {
  const toolInputRaw = process.env['ANCHOR_TOOL_INPUT'];

  if (!toolInputRaw) {
    throw new Error('ANCHOR_TOOL_INPUT is required');
  }

  return ConfigSchema.parse({
    sessionId: process.env['ANCHOR_SESSION_ID'],
    toolInput: JSON.parse(toolInputRaw) as Record<string, unknown>,
  });
}

function getAnchorClient(): Anchorbrowser {
  return new AnchorBrowser();
}

function buildPrompt(input: Config['toolInput']): string {
  return `Submit a time off request in BambooHR:

- Start Date: ${input.startDate}
- End Date: ${input.endDate}
- Type: ${input.timeOffType}
${input.notes ? `- Notes: ${input.notes}` : ''}

Steps:
1. Navigate to Time Off section
2. Click "Request Time Off"
3. Select the time off type
4. Set start and end dates
5. Add notes if provided
6. Submit the request
7. Extract the request ID

Return JSON: { "requestId": "<id>", "success": true }`;
}

export default async function requestTimeOff(): Promise<ToolResult> {
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
            requestId: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['requestId', 'success'],
        },
        maxSteps: 30,
      },
    });

    const output = (typeof result === 'string' ? JSON.parse(result) : result) as {
      requestId: string;
      success: boolean;
    };

    return { success: output.success, output };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return { success: false, error: errorMessage };
  }
}
