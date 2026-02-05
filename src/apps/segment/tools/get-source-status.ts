import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({ workspaceSlug: z.string().min(1) }),
});

function getConfig() {
  const toolInputRaw = process.env.ANCHOR_TOOL_INPUT;
  if (!toolInputRaw) throw new Error('ANCHOR_TOOL_INPUT is required');
  return ConfigSchema.parse({ sessionId: process.env.ANCHOR_SESSION_ID, toolInput: JSON.parse(toolInputRaw) });
}

function getAnchorClient(): Anchorbrowser { return new AnchorBrowser(); }

export default async function getSourceStatus() {
  try {
    const config = getConfig();
    const client = getAnchorClient();

    const prompt = `Get Segment source status for workspace ${config.toolInput.workspaceSlug}:
Navigate to Sources, extract each source name, type, status. Return { "sources": "[...]", "activeCount": <n> }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: `https://app.segment.com/${config.toolInput.workspaceSlug}/sources`,
        outputSchema: { type: 'object', properties: { sources: { type: 'string' }, activeCount: { type: 'number' } }, required: ['sources', 'activeCount'] },
        maxSteps: 25,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: true, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
