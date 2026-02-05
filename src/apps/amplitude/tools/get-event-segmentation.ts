import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({ eventName: z.string().min(1), dateRange: z.string().default('Last 30 days') }),
});

function getConfig() {
  const toolInputRaw = process.env.ANCHOR_TOOL_INPUT;
  if (!toolInputRaw) throw new Error('ANCHOR_TOOL_INPUT is required');
  return ConfigSchema.parse({ sessionId: process.env.ANCHOR_SESSION_ID, toolInput: JSON.parse(toolInputRaw) });
}

function getAnchorClient(): Anchorbrowser { return new AnchorBrowser(); }

export default async function getEventSegmentation() {
  try {
    const config = getConfig();
    const client = getAnchorClient();

    const prompt = `Get Amplitude event segmentation for "${config.toolInput.eventName}" over ${config.toolInput.dateRange}:
Extract event count and unique user count. Return { "eventCount": <n>, "userCount": <n> }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://analytics.amplitude.com',
        outputSchema: { type: 'object', properties: { eventCount: { type: 'number' }, userCount: { type: 'number' } }, required: ['eventCount', 'userCount'] },
        maxSteps: 30,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: true, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
