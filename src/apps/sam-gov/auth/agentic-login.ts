import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  credentials: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
    mfaCode: z.string().optional(),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

interface AuthResult {
  success: boolean;
  error?: string;
}

function getConfig(): Config {
  const credentialsRaw = process.env['ANCHOR_CREDENTIALS'];

  if (!credentialsRaw) {
    throw new Error('ANCHOR_CREDENTIALS is required');
  }

  return ConfigSchema.parse({
    sessionId: process.env['ANCHOR_SESSION_ID'],
    credentials: JSON.parse(credentialsRaw) as Record<string, unknown>,
  });
}

function getAnchorClient(): Anchorbrowser {
  return new AnchorBrowser();
}

function buildPrompt(creds: Config['credentials']): string {
  return `Log in to SAM.gov:

- Username: ${creds.username}
- Password: ${creds.password}
${creds.mfaCode ? `- MFA Code: ${creds.mfaCode}` : ''}

Steps:
1. Navigate to the login page
2. Enter username and password
3. Handle MFA if prompted
4. Verify successful login
5. Return success status

Return JSON: { "success": true } or { "success": false, "error": "reason" }`;
}

export default async function agenticLogin(): Promise<AuthResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const prompt = buildPrompt(config.credentials);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
          required: ['success'],
        },
        maxSteps: 20,
      },
    });

    const output = (typeof result === 'string' ? JSON.parse(result) : result) as AuthResult;

    return { success: output.success, error: output.error };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return { success: false, error: errorMessage };
  }
}
