import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    customerName: z.string().min(1),
    items: z.string(),
    dueDate: z.string().optional(),
    memo: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { invoiceNumber: string; totalAmount: number; success: boolean };
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
  return `Create a new invoice in QuickBooks:

- Customer: ${input.customerName}
- Line Items: ${input.items}
${input.dueDate ? `- Due Date: ${input.dueDate}` : ''}
${input.memo ? `- Memo: ${input.memo}` : ''}

Steps:
1. Navigate to Sales > Invoices
2. Click "Create invoice"
3. Select or add the customer
4. Add line items with descriptions, quantities, and rates
5. Set due date if provided
6. Save the invoice
7. Extract invoice number and total

Return JSON: { "invoiceNumber": "<number>", "totalAmount": <amount>, "success": true }`;
}

export default async function createInvoice(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://qbo.intuit.com',
        outputSchema: {
          type: 'object',
          properties: {
            invoiceNumber: { type: 'string' },
            totalAmount: { type: 'number' },
            success: { type: 'boolean' },
          },
          required: ['invoiceNumber', 'totalAmount', 'success'],
        },
        maxSteps: 40,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
