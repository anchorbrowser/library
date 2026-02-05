import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    price: z.number(),
    quantity: z.number().default(1),
    tags: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { listingId: string; success: boolean };
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
  return `Create a new listing on Etsy:

- Title: ${input.title}
- Description: ${input.description}
- Price: $${input.price}
- Quantity: ${input.quantity}
${input.tags ? `- Tags: ${input.tags}` : ''}

Steps:
1. Navigate to Shop Manager > Listings
2. Click "Add a listing"
3. Enter title and description
4. Set price and quantity
5. Add tags if provided
6. Publish the listing
7. Extract listing ID

Return JSON: { "listingId": "<id>", "success": true }`;
}

export default async function createListing(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://www.etsy.com/your/shops/me/tools/listings',
        outputSchema: {
          type: 'object',
          properties: {
            listingId: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['listingId', 'success'],
        },
        maxSteps: 45,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
