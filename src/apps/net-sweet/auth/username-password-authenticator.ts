import anchorBrowser from 'anchorbrowser';

const RUN_AGENTIC_VALIDATION_PROMPT = `Use a 3-way result so "invalid credentials" is separated from "could not attempt".

Attempt to log in using the provided credentials.

Within a single login attempt, you may perform the necessary submit actions for:
- Username/email step
- Password step
- 2FA step (if present)

Do not perform more submits than required for a single login flow.

TWO-FACTOR AUTHENTICATION (2FA):
If after submitting credentials you encounter a 2FA/MFA screen (e.g., OTP input, authenticator code, verification code):
- You MUST complete the 2FA step using your available sensitive data placeholders.
- For TOTP/authenticator codes, use the placeholder that starts with "bu_2fa_code_identity_" (e.g., <secret>bu_2fa_code_identity_ConnectionName_IdentityName</secret>). The system will automatically generate the 6-digit code from the secret.
- Enter the code into the OTP/verification input field.
- CRITICAL: After entering the 2FA code, you MUST click the SUBMIT/VERIFY button (e.g., "Verify", "Submit", "Confirm", "Continue", "Sign in"). Do NOT click "Back to Sign In", "Cancel", "Resend", or any navigation button. Look for the primary action button that submits the 2FA code.
- Login is NOT successful until 2FA is fully completed and you reach an authenticated state.
- If no 2FA credential is available in your sensitive data, return "attempt_failed".

After navigation settles (wait for network and DOM to become stable), classify the outcome and respond with EXACTLY ONE of the following strings:

- "true" - Login succeeded: you can confirm authenticated state (e.g., redirected away from login, user avatar or name visible, logout button present, or access to a known authenticated-only page or element). This requires ALL authentication steps including 2FA to be completed.
- "false" - Login attempt was executed but credentials were rejected: you see an authentication error (e.g., "invalid password", "incorrect email", "wrong credentials"), or you remain on the login page with a clear credentials-related error.
- "attempt_failed" - You could not complete a login attempt: required fields or submit control not found, submit disabled, CAPTCHA blocks progress (2FA with available credentials should be completed, not treated as blocking), SSO blocks progress, page crashes, unexpected modal blocks interaction, timeout, or any other automation or UX issue prevented the login.

LOGIN ATTEMPT LIMIT:
- You may perform AT MOST ONE login attempt in total.
- One login attempt is defined as:
  - Entering credentials, and
  - Performing the submit action for those credentials.
- If a 2FA step appears after submitting credentials, it is considered part of the SAME login attempt.
- Completing the 2FA verification counts as the final step of that attempt.

- CRITICAL: After the first credential submit, you MUST NOT click any login submit button again with the same credentials (including the same "Sign in"/"Log in"/"Submit" button), even if the page looks unchanged.
- After the first credential submit, you may only:
  - wait for navigation/DOM stability,
  - check for success indicators,
  - check for a credentials error message,
  - complete 2FA if it is shown.
- If, after waiting, there is no clear success signal, no clear credentials error, and no visible 2FA step, return "false" (do not retry).

Rules:
- Only return one of: "true", "false", "attempt_failed" (lowercase, no extra text).
- If you did not actually perform a submit action, you MUST return "attempt_failed".
- If you performed a submit action and there is no clear success signal AND no clear credentials error, return "attempt_failed".
- If 2FA was required but not completed (either no credentials available or submission failed), return "attempt_failed"
- Do not start a second login attempt under any circumstances.
- If the first attempt clearly fails due to invalid credentials, return "false".`;

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

async function safelyGoto(browser: any, url: string): Promise<void> {
  try {
    await browser.contexts()[0].pages()[0].goto(url);
  } catch (error) {
    console.error('Error in safelyGoto:', error);
  }
}

type TaskResultValue = true | false | 'true' | 'false' | 'attempt_failed' | null;

type TaskResult =
  | TaskResultValue
  | { error: string; result: null }
  | { data: { result: { result: TaskResultValue } | string } };

function parseAgentTaskResponse(taskResult: TaskResult): boolean {
  if (taskResult === null) return false;
  if (typeof taskResult === 'boolean') return taskResult;
  if (typeof taskResult === 'string') return taskResult === 'true';
  if ('error' in taskResult) return false;

  if ('data' in taskResult) {
    const innerResult = taskResult.data.result;

    if (typeof innerResult === 'object' && innerResult !== null) {
      return innerResult.result === true || innerResult.result === 'true';
    }

    if (typeof innerResult === 'string') {
      try {
        const parsed = JSON.parse(innerResult);
        if (typeof parsed === 'object' && parsed !== null && 'result' in parsed) {
          return parsed.result === true || parsed.result === 'true';
        }
      } catch {
        return innerResult === 'true';
      }
    }
  }

  return false;
}

export default async function loginWithAgent() {
  try {
    const client = getAnchorClient();
    const config = getConfig();

    const credentials = await client.identities.retrieveCredentials(config.identityId);

    const browser = await setupBrowser();

    await safelyGoto(browser, `https://${credentials.source}`);

    const agentResult: any = await client.agent.task(RUN_AGENTIC_VALIDATION_PROMPT, { sessionId: config.sessionId ,
      taskOptions: {
        maxSteps: 20
      }
    });

    const success = parseAgentTaskResponse(agentResult);

    return {
      success,
      message: success ? 'Agent-based login succeeded' : 'Agent-based login failed',
    };
  } catch (error) {
    console.error('Error in agent-based login:', error);
    return { success: false, message: 'Agent-based login failed' };
  }
}
