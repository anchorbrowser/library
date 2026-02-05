import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  identityId: z.string().optional(),
  toolInput: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    company: z.string().min(1),
    phone: z.string().optional(),
    title: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { leadId: string; success: boolean };
  error?: string;
}

function getConfig(): Config {
  const toolInputRaw = process.env.ANCHOR_TOOL_INPUT;
  if (!toolInputRaw) throw new Error('ANCHOR_TOOL_INPUT is required');

  return ConfigSchema.parse({
    sessionId: process.env.ANCHOR_SESSION_ID,
    identityId: process.env.ANCHOR_IDENTITY_ID,
    toolInput: JSON.parse(toolInputRaw),
  });
}

function getAnchorClient(): Anchorbrowser {
  return new AnchorBrowser();
}

function buildPrompt(input: Config['toolInput']): string {
  return `Create a new Lead in Salesforce with the following information:

- First Name: ${input.firstName}
- Last Name: ${input.lastName}
- Email: ${input.email}
- Company: ${input.company}
${input.phone ? `- Phone: ${input.phone}` : ''}
${input.title ? `- Title: ${input.title}` : ''}

Steps:
1. Navigate to Leads tab or use the global "New Lead" action
2. Fill in all the required fields
3. Save the lead
4. Extract the Lead ID from the URL or page

Return a JSON object: { "leadId": "<the lead ID>", "success": true }
If failed, return: { "leadId": "", "success": false }`;
}

export default async function createLead(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://lightning.force.com',
        outputSchema: {
          type: 'object',
          properties: {
            leadId: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['leadId', 'success'],
        },
        maxSteps: 30,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
