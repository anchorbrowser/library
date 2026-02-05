import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';
import type { Browser } from 'playwright';

const RUN_AGENTIC_LOGIN_PROMPT = `Attempt to log in to Slack using the provided credentials.

Instructions:
1. Enter workspace URL or email
2. Enter password
3. Click "Sign in"
4. Handle 2FA if prompted

After navigation settles, classify the outcome:
- "true" - Login succeeded: you see Slack workspace
- "false" - Credentials were rejected
- "attempt_failed" - Could not complete login

Return ONLY one of: "true", "false", "attempt_failed"`;

const ConfigSchema = z.object({
  sessionId: z.string().min(1),
  identityId: z.string().min(1),
});

type Config = z.infer<typeof ConfigSchema>;

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
  return client.browser.connect(config.sessionId);
}

export default async function loginToSlack() {
  try {
    const config = getConfig();
    const client = getAnchorClient();
    const credentials = await client.identities.retrieveCredentials(config.identityId);
    await setupBrowser(config);

    const result = await client.agent.task(RUN_AGENTIC_LOGIN_PROMPT, {
      sessionId: config.sessionId,
      taskOptions: { url: `https://${credentials.source || 'slack.com/signin'}` },
    });

    const resultStr = String(result).toLowerCase().trim();
    if (resultStr === 'true') return { success: true, message: `Logged in to Slack as ${credentials.username}` };
    if (resultStr === 'false') return { success: false, message: 'Invalid credentials' };
    return { success: false, message: 'Login attempt failed' };
  } catch (error: unknown) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}
