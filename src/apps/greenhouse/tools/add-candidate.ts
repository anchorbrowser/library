import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  toolInput: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    jobTitle: z.string().min(1),
    source: z.string().default('Referral'),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface ToolResult {
  success: boolean;
  output?: { candidateId: string; success: boolean };
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
  return `Add a new candidate to Greenhouse:

- First Name: ${input.firstName}
- Last Name: ${input.lastName}
- Email: ${input.email}
- Job: ${input.jobTitle}
- Source: ${input.source}

Steps:
1. Click "Add Candidate" or navigate to the job
2. Fill in candidate details
3. Select the source
4. Save the candidate
5. Extract the candidate ID

Return JSON: { "candidateId": "<id>", "success": true }`;
}

export default async function addCandidate(): Promise<ToolResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.toolInput);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: 'https://app.greenhouse.io',
        outputSchema: {
          type: 'object',
          properties: {
            candidateId: { type: 'string' },
            success: { type: 'boolean' },
          },
          required: ['candidateId', 'success'],
        },
        maxSteps: 35,
      },
    });

    const output = typeof result === 'string' ? JSON.parse(result) : result;
    return { success: output.success, output };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
