import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    policyNumber: z.string().min(1),
    documentType: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: Record<string, unknown>;
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
  return `Download Policy Documents in State Farm:

- policyNumber: ${input.policyNumber ?? 'N/A'}
- documentType: ${input.documentType ?? 'N/A'}

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
        maxSteps: 30,
      },
    });

    const output = (typeof result === 'string' ? JSON.parse(result) : result) as Record<
      string,
      unknown
    >;

    return { success: Boolean(output['success']), output };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return { success: false, error: errorMessage };
  }
}
