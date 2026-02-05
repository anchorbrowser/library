import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({ dateRange: z.string().default('today') }),
});

function getConfig() {
  const toolInputRaw = process.env.ANCHOR_TOOL_INPUT;
  if (!toolInputRaw) throw new Error('ANCHOR_TOOL_INPUT is required');
  return ConfigSchema.parse({ sessionId: process.env.ANCHOR_SESSION_ID, toolInput: JSON.parse(toolInputRaw) });
}

function getAnchorClient(): Anchorbrowser { return new AnchorBrowser(); }

export default async function getEmailActivity() {
  try {
    const config = getConfig();
    const client = getAnchorClient();

    const prompt = `Get SendGrid email activity for ${config.toolInput.dateRange}:
Steps: Navigate to Activity/Stats, filter by date, extract metrics (delivered, opened, clicked, bounced).
Return { "delivered": <n>, "opened": <n>, "clicked": <n>, "bounced": <n> }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://app.sendgrid.com/statistics',
        outputSchema: { type: 'object', properties: { delivered: { type: 'number' }, opened: { type: 'number' }, clicked: { type: 'number' }, bounced: { type: 'number' } }, required: ['delivered', 'opened', 'clicked', 'bounced'] },
        maxSteps: 25,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: true, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
