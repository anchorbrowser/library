import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    workspaceId: z.string().min(1),
  }),
});

function getConfig() {
  const toolInputRaw = process.env.ANCHOR_TOOL_INPUT;
  if (!toolInputRaw) throw new Error('ANCHOR_TOOL_INPUT is required');
  return ConfigSchema.parse({ sessionId: process.env.ANCHOR_SESSION_ID, toolInput: JSON.parse(toolInputRaw) });
}

function getAnchorClient(): Anchorbrowser {
  return new AnchorBrowser();
}

export default async function getSources() {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const input = config.toolInput;

    const prompt = `Get Segment sources:
- Workspace: ${input.workspaceId}

Steps: Navigate to workspace, go to Sources, extract list (name, type, status). Return { "sources": "[...]", "success": true }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        outputSchema: { type: 'object', properties: { sources: { type: 'string' }, success: { type: 'boolean' } }, required: ['sources', 'success'] },
        maxSteps: 20,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
