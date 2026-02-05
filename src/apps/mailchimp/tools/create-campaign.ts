import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    name: z.string().min(1),
    subject: z.string().min(1),
    listId: z.string().min(1),
    fromName: z.string().optional(),
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

export default async function createCampaign() {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const input = config.toolInput;

    const prompt = `Create Mailchimp campaign:
- Name: ${input.name}
- Subject: ${input.subject}
- List ID: ${input.listId}
${input.fromName ? `- From: ${input.fromName}` : ''}

Steps: Click Create Campaign, select Regular, fill details, save. Return { "campaignId": "<id>", "success": true }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        outputSchema: { type: 'object', properties: { campaignId: { type: 'string' }, success: { type: 'boolean' } }, required: ['campaignId', 'success'] },
        maxSteps: 35,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
