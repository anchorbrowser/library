import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    domain: z.string().min(1),
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

export default async function domainOverview() {
  try {
    const config = getConfig();
    const client = getAnchorClient();

    const prompt = `Get domain overview from Semrush for: ${config.toolInput.domain}

Steps: Search the domain, extract organic traffic, organic keywords count, and authority score.
Return { "organicTraffic": <number>, "organicKeywords": <number>, "domainAuthority": <number> }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: `https://www.semrush.com/analytics/overview/?q=${config.toolInput.domain}`,
        outputSchema: { type: 'object', properties: { organicTraffic: { type: 'number' }, organicKeywords: { type: 'number' }, domainAuthority: { type: 'number' } }, required: ['organicTraffic', 'organicKeywords', 'domainAuthority'] },
        maxSteps: 25,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: true, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
