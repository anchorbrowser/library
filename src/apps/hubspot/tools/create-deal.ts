import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    dealName: z.string().min(1),
    amount: z.number(),
    stage: z.string().default('Qualification'),
    contactEmail: z.string().optional(),
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
  return `Create a new Deal in HubSpot:

- Deal Name: ${input.dealName}
- Amount: $${input.amount}
- Stage: ${input.stage}
${input.contactEmail ? `- Associate with contact: ${input.contactEmail}` : ''}

Steps:
1. Navigate to Deals
2. Click "Create deal"
3. Fill in deal name, amount, and stage
4. Associate contact if provided
5. Save and extract deal ID

Return JSON: { "dealId": "<id>", "success": true }`;
}

export default async function createDeal(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://app.hubspot.com/deals',
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
