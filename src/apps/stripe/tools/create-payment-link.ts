import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    productName: z.string().min(1),
    amount: z.number(),
    currency: z.string().default('usd'),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { paymentLinkUrl: string; success: boolean };
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
  const amountFormatted = (input.amount / 100).toFixed(2);
  return `Create a new payment link in Stripe:

- Product Name: ${input.productName}
- Amount: ${amountFormatted} ${input.currency.toUpperCase()}

Steps:
1. Navigate to Payment Links
2. Click "Create payment link" or "+ New"
3. Add product with name and price
4. Create the link
5. Copy the payment link URL

Return JSON: { "paymentLinkUrl": "<url>", "success": true }`;
}

export default async function createPaymentLink(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://dashboard.stripe.com/payment-links',
        outputSchema: {
          type: 'object',
          properties: {
            paymentLinkUrl: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['paymentLinkUrl', 'success'],
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
