import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    payPeriodEnd: z.string(),
    payDate: z.string(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { payrollId: string; totalAmount: number; success: boolean };
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
  return `Run payroll in Gusto:

- Pay Period End: ${input.payPeriodEnd}
- Pay Date: ${input.payDate}

Steps:
1. Navigate to Payroll section
2. Start a new payroll run
3. Verify pay period and pay date
4. Review and approve payroll
5. Submit the payroll
6. Extract payroll ID and total amount

Return JSON: { "payrollId": "<id>", "totalAmount": <amount>, "success": true }`;
}

export default async function runPayroll(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://app.gusto.com/payroll',
        outputSchema: {
          type: 'object',
          properties: {
            payrollId: { type: 'string' },
            totalAmount: { type: 'number' },
            success: { type: 'boolean' },
          },
          required: ['payrollId', 'totalAmount', 'success'],
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
