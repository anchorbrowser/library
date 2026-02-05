import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    chartId: z.string().optional(),
    event: z.string().min(1),
    dateRange: z.string().default('30d'),
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

export default async function getChart() {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const input = config.toolInput;

    const prompt = `Get Amplitude chart data:
${input.chartId ? `- Chart: ${input.chartId}` : '- New chart'}
- Event: ${input.event}
- Date range: ${input.dateRange}

Steps: Go to Analytics, select/create chart, extract data. Return { "chartData": "{...}", "success": true }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        outputSchema: { type: 'object', properties: { chartData: { type: 'string' }, success: { type: 'boolean' } }, required: ['chartData', 'success'] },
        maxSteps: 25,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
