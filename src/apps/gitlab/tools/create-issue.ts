import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({ project: z.string().min(1), title: z.string().min(1), description: z.string().optional() }),
});

function getConfig() {
  const toolInputRaw = process.env.ANCHOR_TOOL_INPUT;
  if (!toolInputRaw) throw new Error('ANCHOR_TOOL_INPUT is required');
  return ConfigSchema.parse({ sessionId: process.env.ANCHOR_SESSION_ID, toolInput: JSON.parse(toolInputRaw) });
}

function getAnchorClient(): Anchorbrowser { return new AnchorBrowser(); }

export default async function createIssue() {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const input = config.toolInput;

    const prompt = `Create GitLab issue in ${input.project}:
- Title: ${input.title}
${input.description ? `- Description: ${input.description}` : ''}

Steps: Navigate to project issues, click New Issue, fill fields, submit. Return { "issueId": <n>, "issueUrl": "<url>", "success": true }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: `https://gitlab.com/${input.project}/-/issues/new`,
        outputSchema: { type: 'object', properties: { issueId: { type: 'number' }, issueUrl: { type: 'string' }, success: { type: 'boolean' } }, required: ['issueId', 'issueUrl', 'success'] },
        maxSteps: 30,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
