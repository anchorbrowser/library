import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({ baseUrl: z.string().url(), tableName: z.string().min(1), fields: z.string().min(1) }),
});

function getConfig() {
  const toolInputRaw = process.env.ANCHOR_TOOL_INPUT;
  if (!toolInputRaw) throw new Error('ANCHOR_TOOL_INPUT is required');
  return ConfigSchema.parse({ sessionId: process.env.ANCHOR_SESSION_ID, toolInput: JSON.parse(toolInputRaw) });
}

function getAnchorClient(): Anchorbrowser { return new AnchorBrowser(); }

export default async function createRecord() {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const input = config.toolInput;
    const fields = JSON.parse(input.fields);

    const fieldsList = Object.entries(fields).map(([k, v]) => `- ${k}: ${v}`).join('\n');

    const prompt = `Create Airtable record in table "${input.tableName}":
${fieldsList}

Steps: Navigate to base, select table, click + to add row, fill fields, save. Return { "recordId": "<id>", "success": true }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: input.baseUrl,
        outputSchema: { type: 'object', properties: { recordId: { type: 'string' }, success: { type: 'boolean' } }, required: ['recordId', 'success'] },
        maxSteps: 35,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
