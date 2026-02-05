import anchorBrowser from 'anchorbrowser';
import type { Browser } from 'playwright';

const RUN_AGENTIC_VALIDATION_PROMPT = `Use a 3-way result so "invalid credentials" is separated from "could not attempt".

Attempt to log in using the provided credentials. You are allowed to perform AT MOST ONE submit action (one click on "Log in", "Sign in", or "Submit", or one Enter-key submit on a login form). Do not submit twice, unless the password has it's own button (the second click on "Log in", "Sign in", "Submit", "Next", "Continue", "Continue with Password", "Sign up", or one Enter-key submit on a login form). Do not submit a third time, only if it is for 2fa - that will be the second or third click and also the last click (the third click on "Log in", "Sign in", "Submit", "Next", "Continue", "Verify", "Sign up", or one Enter-key submit on a login form).

After navigation settles (wait for network and DOM to become stable), classify the outcome and respond with EXACTLY ONE of the following strings:

- "true" - Login succeeded: you can confirm authenticated state (e.g., redirected away from login, user avatar or name visible, logout button present, or access to a known authenticated-only page or element).
- "false" - Login attempt was executed but credentials were rejected: you see an authentication error (e.g., "invalid password", "incorrect email", "wrong credentials"), or you remain on the login page with a clear credentials-related error.
- "attempt_failed" - You could not complete a login attempt: required fields or submit control not found, submit disabled, CAPTCHA/2FA/SSO blocks progress, page crashes, unexpected modal blocks interaction, timeout, or any other automation or UX issue prevented the single submit action.

Rules:
- Only return one of: "true", "false", "attempt_failed" (lowercase, no extra text).
- If you did not actually perform a submit action, you MUST return "attempt_failed".
- If you performed a submit action and there is no clear success signal AND no clear credentials error, return "attempt_failed".`;

// Lazy-loaded config and client - only initialized when needed
let _anchorClient: InstanceType<typeof anchorBrowser> | null = null;
let _config: {
  sessionId: string;
  identityId: string;
} | null = null;

function getConfig() {
  if (!_config) {
    _config = {
      sessionId: process.env['ANCHOR_SESSION_ID']!,
      identityId: process.env['ANCHOR_IDENTITY_ID']!,
    };
  }
  return _config;
}

function getAnchorClient() {
  if (!_anchorClient) {
    _anchorClient = new anchorBrowser();
  }
  return _anchorClient;
}

async function setupBrowser() {
  const config = getConfig();
  const client = getAnchorClient();
  console.log(`[BROWSER] Connecting to existing session: ${config.sessionId}`);
  return await client.browser.connect(config.sessionId);
}

async function safelyGoto(browser: Browser, url: string): Promise<void> {
  try {
    await browser.contexts()[0]?.pages()[0]?.goto(url);
  } catch (error) {
    console.error('Error in safelyGoto:', error);
  }
}

export default async function loginWithAgent() {
  try {
    const client = getAnchorClient();
    const config = getConfig();

    const credentials = await client.identities.retrieveCredentials(config.identityId);

    const browser = await setupBrowser();

    await safelyGoto(browser, `https://${credentials.source}`);

    await client.agent.task(RUN_AGENTIC_VALIDATION_PROMPT, { sessionId: config.sessionId });

    console.log('Placeholder for agent-based login implementation');
    return { success: true, message: 'Agent-based login placeholder' };
  } catch (error) {
    console.error('Error in agent-based login:', error);
    return { success: false, message: 'Agent-based login failed' };
  }
}
