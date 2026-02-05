import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    projectKey: z.string().min(1),
    issueType: z.string().min(1),
    summary: z.string().min(1),
    description: z.string().optional(),
    assignee: z.string().optional(),
    priority: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { issueKey: string; success: boolean };
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
  return `Create a new Jira issue:

- Project: ${input.projectKey}
- Type: ${input.issueType}
- Summary: ${input.summary}
${input.description ? `- Description: ${input.description}` : ''}
${input.assignee ? `- Assignee: ${input.assignee}` : ''}
${input.priority ? `- Priority: ${input.priority}` : ''}

Steps:
1. Click "Create" button or press C
2. Select project and issue type
3. Enter summary
4. Add description if provided
5. Set assignee and priority if provided
6. Create the issue
7. Extract the issue key (e.g., PROJ-123)

Return JSON: { "issueKey": "<key>", "success": true }`;
}

export default async function createIssue(): Promise<ToolResult> {
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
            issueKey: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['issueKey', 'success'],
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
