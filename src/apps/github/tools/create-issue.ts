import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({ repo: z.string().min(1), title: z.string().min(1), body: z.string().optional(), labels: z.string().optional() }),
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

    const prompt = `Create GitHub issue in ${input.repo}:
- Title: ${input.title}
${input.body ? `- Body: ${input.body}` : ''}
${input.labels ? `- Labels: ${input.labels}` : ''}

Steps: Navigate to repo, click New Issue, fill fields, submit. Return { "issueNumber": <n>, "issueUrl": "<url>", "success": true }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: `https://github.com/${input.repo}/issues/new`,
        outputSchema: { type: 'object', properties: { issueNumber: { type: 'number' }, issueUrl: { type: 'string' }, success: { type: 'boolean' } }, required: ['issueNumber', 'issueUrl', 'success'] },
        maxSteps: 30,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
