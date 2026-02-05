import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    startDate: z.string(),
    endDate: z.string(),
    cardId: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { transactionCount: number; totalSpend: number; success: boolean };
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
  return `Export transactions from Brex:

- Start Date: ${input.startDate}
- End Date: ${input.endDate}
${input.cardId ? `- Card: ${input.cardId}` : ''}

Steps:
1. Navigate to Transactions
2. Set date filter for the range
3. Filter by card if specified
4. Count transactions and sum total spend
5. Export or note the totals

Return JSON: { "transactionCount": <count>, "totalSpend": <amount>, "success": true }`;
}

export default async function exportTransactions(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://dashboard.brex.com/transactions',
        outputSchema: {
          type: 'object',
          properties: {
            transactionCount: { type: 'number' },
            totalSpend: { type: 'number' },
            success: { type: 'boolean' },
          },
          required: ['transactionCount', 'totalSpend', 'success'],
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
