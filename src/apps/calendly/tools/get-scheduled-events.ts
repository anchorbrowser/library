import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({ dateRange: z.string().default('week') }),
});

function getConfig() {
  const toolInputRaw = process.env.ANCHOR_TOOL_INPUT;
  if (!toolInputRaw) throw new Error('ANCHOR_TOOL_INPUT is required');
  return ConfigSchema.parse({ sessionId: process.env.ANCHOR_SESSION_ID, toolInput: JSON.parse(toolInputRaw) });
}

function getAnchorClient(): Anchorbrowser { return new AnchorBrowser(); }

export default async function getScheduledEvents() {
  try {
    const config = getConfig();
    const client = getAnchorClient();

    const prompt = `Get Calendly scheduled events for ${config.toolInput.dateRange}:
Steps: Navigate to scheduled events, filter by date range, extract events (name, invitee, date, time, type).
Return { "events": "[...]", "totalCount": <n> }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://calendly.com/app/scheduled_events/user/me',
        outputSchema: { type: 'object', properties: { events: { type: 'string' }, totalCount: { type: 'number' } }, required: ['events', 'totalCount'] },
        maxSteps: 25,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: true, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
