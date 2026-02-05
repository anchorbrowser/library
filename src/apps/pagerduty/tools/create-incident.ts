import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    title: z.string().min(1),
    serviceId: z.string().min(1),
    urgency: z.string().optional(),
    description: z.string().optional(),
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

export default async function createIncident() {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const input = config.toolInput;

    const prompt = `Create PagerDuty incident:
- Title: ${input.title}
- Service: ${input.serviceId}
${input.urgency ? `- Urgency: ${input.urgency}` : ''}
${input.description ? `- Description: ${input.description}` : ''}

Steps: Click New Incident, fill form, create. Return { "incidentId": "<id>", "incidentUrl": "<url>", "success": true }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        outputSchema: { type: 'object', properties: { incidentId: { type: 'string' }, incidentUrl: { type: 'string' }, success: { type: 'boolean' } }, required: ['incidentId', 'incidentUrl', 'success'] },
        maxSteps: 25,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
