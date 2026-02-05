import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    baseId: z.string().min(1),
    tableName: z.string().min(1),
    fields: z.string().min(1),
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

export default async function createRecord() {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const input = config.toolInput;
    const fields = JSON.parse(input.fields);

    const prompt = `Create Airtable record:
- Base: ${input.baseId}
- Table: ${input.tableName}
- Fields: ${JSON.stringify(fields)}

Steps: Open base, go to table, click +, fill fields, save. Return { "recordId": "<id>", "success": true }`;

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: `https://airtable.com/${input.baseId}`,
        outputSchema: { type: 'object', properties: { recordId: { type: 'string' }, success: { type: 'boolean' } }, required: ['recordId', 'success'] },
        maxSteps: 30,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
