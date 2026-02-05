import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';
import type { Browser } from 'playwright';

const RUN_AGENTIC_LOGIN_PROMPT = `Attempt to log in to Salesforce using the provided credentials.

Instructions:
1. Enter the username/email in the login field
2. Enter the password
3. Click the "Log In" button
4. Handle any 2FA/MFA if prompted (enter verification code if available)
5. Wait for the page to settle

After navigation settles, classify the outcome:
- "true" - Login succeeded: you see the Salesforce dashboard, Setup, or any authenticated page
- "false" - Credentials were rejected: you see an authentication error message
- "attempt_failed" - Could not complete login: CAPTCHA, SSO redirect, unexpected modal, or other blocker

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

export default async function loginToSalesforce(): Promise<LoginResult> {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const credentials = await client.identities.retrieveCredentials(config.identityId);

    await setupBrowser(config);

    const result = await client.agent.task(RUN_AGENTIC_LOGIN_PROMPT, {
      sessionId: config.sessionId,
      taskOptions: { url: `https://login.salesforce.com` },
    });

    const resultStr = String(result).toLowerCase().trim();
    if (resultStr === 'true') {
      return { success: true, message: `Logged in to Salesforce as ${credentials.username}` };
    } else if (resultStr === 'false') {
      return { success: false, message: 'Invalid credentials' };
    }
    return { success: false, message: 'Login attempt failed - could not complete authentication' };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[SALESFORCE] Login error:', errorMessage);
    return { success: false, message: errorMessage };
  }
}
