import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    status: z.string().default('All'),
    limit: z.number().default(10),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { orders: string; totalCount: number };
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
  return `Get orders from Amazon Seller Central:

- Status Filter: ${input.status}
- Limit: ${input.limit}

Steps:
1. Navigate to Orders > Manage Orders
2. Apply status filter if not "All"
3. Extract order details: order ID, date, status, total, buyer name
4. Return up to ${input.limit} orders

Return JSON: { "orders": "[{...}]", "totalCount": <number> }`;
}

export default async function getOrders(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://sellercentral.amazon.com/orders-v3',
        outputSchema: {
          type: 'object',
          properties: {
            orders: { type: 'string' },
            totalCount: { type: 'number' },
          },
          required: ['orders', 'totalCount'],
        },
        maxSteps: 30,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: true, output };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
