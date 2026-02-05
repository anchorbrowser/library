import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    dateRange: z.string().default('Last 7 days'),
  }),
});

function getConfig() {
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

export default async function getAdPerformance() {
  try {
    const config = getConfig();
    const client = getAnchorClient();

    const prompt = `Get Meta Ads performance for ${config.toolInput.dateRange}:

Steps: Navigate to Ads Manager, set date range, extract metrics (campaign name, spend, reach, impressions, clicks).
Return { "campaigns": "[...]", "totalSpend": <number>, "totalReach": <number> }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://adsmanager.facebook.com',
        outputSchema: { type: 'object', properties: { campaigns: { type: 'string' }, totalSpend: { type: 'number' }, totalReach: { type: 'number' } }, required: ['campaigns', 'totalSpend', 'totalReach'] },
        maxSteps: 30,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: true, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
