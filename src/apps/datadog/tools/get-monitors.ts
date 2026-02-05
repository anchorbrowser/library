import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({ status: z.string().default('All') }),
});

function getConfig() {
  const toolInputRaw = process.env.ANCHOR_TOOL_INPUT;
  if (!toolInputRaw) throw new Error('ANCHOR_TOOL_INPUT is required');
  return ConfigSchema.parse({ sessionId: process.env.ANCHOR_SESSION_ID, toolInput: JSON.parse(toolInputRaw) });
}

function getAnchorClient(): Anchorbrowser { return new AnchorBrowser(); }

export default async function getMonitors() {
  try {
    const config = getConfig();
    const client = getAnchorClient();

    const prompt = `Get Datadog monitors${config.toolInput.status !== 'All' ? ` filtered by status: ${config.toolInput.status}` : ''}:
Navigate to Monitors, extract name, status, type for each. Return { "monitors": "[...]", "alertCount": <n> }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://app.datadoghq.com/monitors/manage',
        outputSchema: { type: 'object', properties: { monitors: { type: 'string' }, alertCount: { type: 'number' } }, required: ['monitors', 'alertCount'] },
        maxSteps: 25,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: true, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
