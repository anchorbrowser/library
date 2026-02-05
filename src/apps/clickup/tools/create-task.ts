import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    listName: z.string().min(1),
    taskName: z.string().min(1),
    description: z.string().optional(),
    assignee: z.string().optional(),
    dueDate: z.string().optional(),
    priority: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { taskId: string; success: boolean };
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
  return `Create a new task in ClickUp:

- List: ${input.listName}
- Task Name: ${input.taskName}
${input.description ? `- Description: ${input.description}` : ''}
${input.assignee ? `- Assignee: ${input.assignee}` : ''}
${input.dueDate ? `- Due Date: ${input.dueDate}` : ''}
${input.priority ? `- Priority: ${input.priority}` : ''}

Steps:
1. Navigate to the list
2. Click "Add Task"
3. Enter task name and description
4. Set assignee, due date, and priority if provided
5. Save the task
6. Extract task ID

Return JSON: { "taskId": "<id>", "success": true }`;
}

export default async function createTask(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://app.clickup.com',
        outputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['taskId', 'success'],
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
