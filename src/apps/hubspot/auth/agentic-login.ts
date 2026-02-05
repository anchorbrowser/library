import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';
import type { Browser } from 'playwright';

const RUN_AGENTIC_LOGIN_PROMPT = `Attempt to log in to HubSpot using the provided credentials.

Instructions:
1. Enter the email address in the login field
2. Click Continue or Next
3. Enter the password
4. Click "Log in" button
5. Handle any 2FA if prompted

After navigation settles, classify the outcome:
- "true" - Login succeeded: you see the HubSpot dashboard or any authenticated page
- "false" - Credentials were rejected: authentication error message visible
- "attempt_failed" - Could not complete login: CAPTCHA, SSO redirect, or other blocker

Return ONLY one of: "true", "false", "attempt_failed"`;

const ConfigSchema = z.object({
  sessionId: z.string().min(1, 'ANCHOR_SESSION_ID is required'),
  identityId: z.string().min(1, 'ANCHOR_IDENTITY_ID is required'),
});

type Config = z.infer<typeof ConfigSchema>;

interface LoginResult {
  success: boolean;
  message: string;
}

function getConfig(): Config {
  return ConfigSchema.parse({
    sessionId: process.env['ANCHOR_SESSION_ID'],
    identityId: process.env['ANCHOR_IDENTITY_ID'],
  });
}

function getAnchorClient(): Anchorbrowser {
  return new AnchorBrowser();
}

async function setupBrowser(config: Config): Promise<Browser> {
  const client = getAnchorClient();
  console.log(`[BROWSER] Connecting to session: ${config.sessionId}`);
  return client.browser.connect(config.sessionId);
}

export default async function loginToHubSpot(): Promise<LoginResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const credentials = await client.identities.retrieveCredentials(config.identityId);

    await setupBrowser(config);

    const result = await client.agent.task(RUN_AGENTIC_LOGIN_PROMPT, {
      sessionId: config.sessionId,
      taskOptions: { url: 'https://app.hubspot.com/login' },
    });

    const resultStr = String(result).toLowerCase().trim();
    if (resultStr === 'true') {
      return { success: true, message: `Logged in to HubSpot as ${credentials.username}` };
    } else if (resultStr === 'false') {
      return { success: false, message: 'Invalid credentials' };
    }
    return { success: false, message: 'Login attempt failed' };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[HUBSPOT] Login error:', errorMessage);
    return { success: false, message: errorMessage };
  }
}
