import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    contactName: z.string().min(1),
    description: z.string().min(1),
    amount: z.number(),
    dueDate: z.string().optional(),
    accountCode: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { billId: string; success: boolean };
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
  return `Create a new bill in Xero:

- Supplier: ${input.contactName}
- Description: ${input.description}
- Amount: ${input.amount}
${input.dueDate ? `- Due Date: ${input.dueDate}` : ''}
${input.accountCode ? `- Account: ${input.accountCode}` : ''}

Steps:
1. Navigate to Business > Bills to pay
2. Click "New bill"
3. Select or add the supplier
4. Add line item with description and amount
5. Set due date and account if provided
6. Save the bill
7. Extract bill ID

Return JSON: { "billId": "<id>", "success": true }`;
}

export default async function createBill(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://go.xero.com',
        outputSchema: {
          type: 'object',
          properties: {
            billId: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['billId', 'success'],
        },
        maxSteps: 35,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
