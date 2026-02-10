import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    caseNumber: z.string().optional(),
    dateFrom: z.string().min(1),
    dateTo: z.string().min(1),
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
  return `Download Case Filings in Tyler Technologies:

- caseNumber: ${input.caseNumber || 'N/A'}
- dateFrom: ${input.dateFrom || 'N/A'}
- dateTo: ${input.dateTo || 'N/A'}

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
            filePath: { type: 'string' },
            filingCount: { type: 'number' },
            success: { type: 'boolean' },
          },
          required: ['filePath', 'filingCount', 'success'],
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
