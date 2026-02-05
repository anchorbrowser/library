import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    price: z.number(),
    sku: z.string().optional(),
    inventory: z.number().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { productId: string; success: boolean };
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
  return `Create a new product in Shopify:

- Title: ${input.title}
${input.description ? `- Description: ${input.description}` : ''}
- Price: $${input.price}
${input.sku ? `- SKU: ${input.sku}` : ''}
${input.inventory !== undefined ? `- Inventory: ${input.inventory}` : ''}

Steps:
1. Navigate to Products
2. Click "Add product"
3. Enter title and description
4. Set price in variants
5. Set SKU and inventory if provided
6. Save the product
7. Extract product ID

Return JSON: { "productId": "<id>", "success": true }`;
}

export default async function createProduct(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        outputSchema: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['productId', 'success'],
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
