import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    email: z.string().email(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    phone: z.string().optional(),
    company: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { contactId: string; success: boolean };
  error?: string;
}

function getConfig(): Config {
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

function buildPrompt(input: Config['toolInput']): string {
  return `Create a new Contact in HubSpot with:

- Email: ${input.email}
- First Name: ${input.firstName}
- Last Name: ${input.lastName}
${input.phone ? `- Phone: ${input.phone}` : ''}
${input.company ? `- Company: ${input.company}` : ''}

Steps:
1. Navigate to Contacts
2. Click "Create contact"
3. Fill in the fields
4. Save the contact
5. Extract the contact ID from the URL

Return JSON: { "contactId": "<id>", "success": true }`;
}

export default async function createContact(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://app.hubspot.com/contacts',
        outputSchema: {
          type: 'object',
          properties: {
            contactId: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['contactId', 'success'],
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
