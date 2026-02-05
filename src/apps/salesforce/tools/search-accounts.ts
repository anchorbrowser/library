import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    searchQuery: z.string().min(1),
    limit: z.number().default(10),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { accounts: string; totalCount: number };
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
  return `Search for Accounts in Salesforce matching: "${input.searchQuery}"

Steps:
1. Use the global search or navigate to Accounts tab
2. Enter the search query
3. Collect up to ${input.limit} matching accounts
4. For each account, extract: id, name, website, industry, phone

Return JSON: { "accounts": [{ "id": "", "name": "", "website": "", "industry": "", "phone": "" }], "totalCount": <number> }`;
}

export default async function searchAccounts(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://lightning.force.com',
        outputSchema: {
          type: 'object',
          properties: {
            accounts: { type: 'string' },
            totalCount: { type: 'number' },
          },
          required: ['accounts', 'totalCount'],
        },
        maxSteps: 25,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: true, output };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
