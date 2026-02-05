import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    boardName: z.string().min(1),
    itemName: z.string().min(1),
    groupName: z.string().optional(),
    status: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { itemId: string; success: boolean };
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
  return `Create a new item in Monday.com:

- Board: ${input.boardName}
- Item Name: ${input.itemName}
${input.groupName ? `- Group: ${input.groupName}` : ''}
${input.status ? `- Status: ${input.status}` : ''}

Steps:
1. Navigate to the board
2. Find the group if specified
3. Click "Add item" or type in the new item row
4. Enter item name
5. Set status if provided
6. Extract the item ID

Return JSON: { "itemId": "<id>", "success": true }`;
}

export default async function createItem(): Promise<ToolResult> {
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
            itemId: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['itemId', 'success'],
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
