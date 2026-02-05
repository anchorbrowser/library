import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    amount: z.number(),
    merchant: z.string().min(1),
    category: z.string().min(1),
    memo: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { reimbursementId: string; success: boolean };
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
  return `Submit a reimbursement request in Ramp:

- Amount: $${input.amount}
- Merchant: ${input.merchant}
- Category: ${input.category}
${input.memo ? `- Memo: ${input.memo}` : ''}

Steps:
1. Navigate to Reimbursements
2. Click "Submit reimbursement"
3. Enter amount and merchant
4. Select category
5. Add memo if provided
6. Submit the request
7. Extract reimbursement ID

Return JSON: { "reimbursementId": "<id>", "success": true }`;
}

export default async function submitReimbursement(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://app.ramp.com/reimbursements',
        outputSchema: {
          type: 'object',
          properties: {
            reimbursementId: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['reimbursementId', 'success'],
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
