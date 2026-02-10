import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    reviewDateFrom: z.string().min(1),
    reviewDateTo: z.string().min(1),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: Record<string, unknown>;
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
  return `Automate Coding Review in CureMD:

- reviewDateFrom: ${input.reviewDateFrom || 'N/A'}
- reviewDateTo: ${input.reviewDateTo || 'N/A'}

Steps:
1. Navigate to the relevant section
2. Apply filters and parameters as provided
3. Execute the action
4. Wait for completion
5. Extract and return the result

Return JSON with the result.`;
}

export default async function run(): Promise<ToolResult> {
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
            reviewedCount: { type: 'number' },
            success: { type: 'boolean' },
          },
          required: ['reviewedCount', 'success'],
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
