import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const RUN_AGENTIC_LOGIN_PROMPT = `Attempt to log in to GitHub using the provided credentials.

Instructions: Enter username/email, enter password, click "Sign in", handle 2FA if prompted.

Classify:
- "true" - Login succeeded: you see GitHub dashboard/profile
- "false" - Credentials rejected
- "attempt_failed" - Could not complete

Return ONLY: "true", "false", or "attempt_failed"`;

const ConfigSchema = z.object({ sessionId: z.string().min(1), identityId: z.string().min(1) });

function getConfig() {
  return ConfigSchema.parse({ sessionId: process.env['ANCHOR_SESSION_ID'], identityId: process.env['ANCHOR_IDENTITY_ID'] });
}

function getAnchorClient(): Anchorbrowser { return new AnchorBrowser(); }

export default async function loginToGitHub() {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const credentials = await client.identities.retrieveCredentials(config.identityId);
    await client.browser.connect(config.sessionId);

    const result = await client.agent.task(RUN_AGENTIC_LOGIN_PROMPT, {
      sessionId: config.sessionId,
      taskOptions: { url: 'https://github.com/login' },
    });

    const resultStr = String(result).toLowerCase().trim();
    if (resultStr === 'true') return { success: true, message: `Logged in to GitHub as ${credentials.username}` };
    if (resultStr === 'false') return { success: false, message: 'Invalid credentials' };
    return { success: false, message: 'Login attempt failed' };
  } catch (error: unknown) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}
