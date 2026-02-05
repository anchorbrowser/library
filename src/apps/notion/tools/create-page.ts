import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    parentPage: z.string().optional(),
    title: z.string().min(1),
    content: z.string().optional(),
    icon: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { pageUrl: string; success: boolean };
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
  return `Create a new page in Notion:

- Title: ${input.title}
${input.parentPage ? `- Parent Page: ${input.parentPage}` : ''}
${input.content ? `- Content: ${input.content}` : ''}
${input.icon ? `- Icon: ${input.icon}` : ''}

Steps:
1. Navigate to parent page if specified, or workspace root
2. Create a new page
3. Set the title
4. Add icon if provided
5. Add content if provided
6. Copy the page URL

Return JSON: { "pageUrl": "<url>", "success": true }`;
}

export default async function createPage(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://www.notion.so',
        outputSchema: {
          type: 'object',
          properties: {
            pageUrl: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['pageUrl', 'success'],
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
