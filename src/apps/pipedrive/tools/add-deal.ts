import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    title: z.string().min(1),
    value: z.number(),
    currency: z.string().default('USD'),
    personName: z.string().optional(),
    orgName: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { dealId: string; success: boolean };
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
  return `Add a new Deal in Pipedrive:

- Title: ${input.title}
- Value: ${input.value} ${input.currency}
${input.personName ? `- Contact: ${input.personName}` : ''}
${input.orgName ? `- Organization: ${input.orgName}` : ''}

Steps:
1. Click "Add deal" or use the quick add
2. Fill in deal title and value
3. Add person/organization if provided
4. Save the deal
5. Extract the deal ID

Return JSON: { "dealId": "<id>", "success": true }`;
}

export default async function addDeal(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://app.pipedrive.com/pipeline',
        outputSchema: {
          type: 'object',
          properties: {
            dealId: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['dealId', 'success'],
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
