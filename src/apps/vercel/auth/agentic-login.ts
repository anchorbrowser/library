import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';

const RUN_AGENTIC_LOGIN_PROMPT = `Attempt to log in to Vercel using the provided credentials.

Instructions:
1. Click "Continue with Email" or enter email
2. Enter password or use magic link
3. Handle 2FA if prompted

After navigation settles, classify the outcome:
- "true" - Login succeeded: you see Vercel dashboard
- "false" - Credentials were rejected
- "attempt_failed" - Could not complete login

Return ONLY one of: "true", "false", "attempt_failed"`;

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  identityId: z.string().min(1),
});

function getConfig() {
  return ConfigSchema.parse({
    sessionId: process.env['ANCHOR_SESSION_ID'],
    identityId: process.env['ANCHOR_IDENTITY_ID'],
  });
}

function getAnchorClient(): Anchorbrowser {
  return new AnchorBrowser();
}

export default async function loginToVercel() {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const credentials = await client.identities.retrieveCredentials(config.identityId);
    await client.browser.connect(config.sessionId);

    const result = await client.agent.task(RUN_AGENTIC_LOGIN_PROMPT, {
      sessionId: config.sessionId,
      taskOptions: { url: 'https://vercel.com/login' },
    });

    const resultStr = String(result).toLowerCase().trim();
    if (resultStr === 'true') return { success: true, message: `Logged in to Vercel as ${credentials.username}` };
    if (resultStr === 'false') return { success: false, message: 'Invalid credentials' };
    return { success: false, message: 'Login attempt failed' };
  } catch (error: unknown) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}
