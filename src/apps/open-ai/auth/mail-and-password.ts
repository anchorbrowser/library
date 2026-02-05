import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import type { Browser } from 'playwright';

const LOGIN_URL = 'https://auth.openai.com/log-in';
const PLATFORM_URL = 'https://platform.openai.com/';

const LOGIN_PROMPT = `You are logging into OpenAI platform. Follow these steps precisely:

1. You are on or navigating to the OpenAI login page (auth.openai.com/log-in)
2. IMPORTANT: If you see a "Your session has ended" or "Session expired" page, click the "Log in" button first to get to the actual login form
3. Once you see the login form with an email field:
   - Triple-click on the email field to select any existing text, then type the email address
   - Click "Continue" button
4. Wait for the password field to appear
5. Triple-click on the password field to select any existing text, then type the password
6. Click "Continue" or "Log in" button
7. Wait for navigation to complete

After login attempt, classify the outcome and respond with EXACTLY ONE of these strings:
- "true" - Login succeeded: you see the OpenAI platform dashboard, organization selector, or any authenticated page
- "false" - Login failed: credentials were rejected, you see an error message about invalid email/password
- "attempt_failed" - Could not complete login: CAPTCHA appeared, page didn't load, elements not found, or other technical issue

Rules:
- Return only one of: "true", "false", "attempt_failed" (lowercase, no extra text)
- Be patient and wait for elements to load before interacting
- If you see "session has ended" or similar, click the "Log in" button to proceed
- Always triple-click to select all before typing to ensure the field is cleared
- Do not click any button more than once unless clearly necessary (e.g., separate Continue for email and password)
`;

interface LoginResult {
  success: boolean;
  message: string;
}

let _anchorClient: Anchorbrowser | null = null;
let _config: {
  sessionId: string;
  identityId: string;
  timeoutMs: number;
} | null = null;

function getConfig() {
  if (!_config) {
    const identityId = process.env['ANCHOR_IDENTITY_ID'];
    if (!identityId) {
      throw new Error('ANCHOR_IDENTITY_ID is required');
    }
    _config = {
      sessionId: process.env['ANCHOR_SESSION_ID'] || '',
      identityId,
      timeoutMs: parseInt(process.env['ANCHOR_TIMEOUT_MS'] || '30000', 10),
    };
  }
  return _config;
}

function getAnchorClient(): Anchorbrowser {
  if (!_anchorClient) {
    _anchorClient = new AnchorBrowser();
  }
  return _anchorClient;
}

async function getAnchorBrowser(sessionId: string): Promise<Browser> {
  const client = getAnchorClient();
  if (sessionId) {
    console.log(`[BROWSER] Connecting to existing session: ${sessionId}`);
    return client.browser.connect(sessionId);
  }
  throw new Error('ANCHOR_SESSION_ID is required for auth tasks');
}

async function fetchIdentityCredentials(identityId: string) {
  const client = getAnchorClient();
  return client.identities.retrieveCredentials(identityId);
}

function parseCredentials(credentials: { type: string; username?: string; password?: string }[]) {
  let username = '';
  let password = '';

  for (const cred of credentials) {
    if (cred.type === 'username_password') {
      username = cred.username || '';
      password = cred.password || '';
    }
  }

  if (!username || !password) {
    throw new Error('Missing username_password credentials');
  }

  return { username, password };
}

export default async function LoginToOpenAI(): Promise<LoginResult> {
  console.log('\n========================================');
  console.log('  OpenAI Platform Login Automation');
  console.log('========================================\n');

  try {
    const config = getConfig();
    const client = getAnchorClient();

    console.log('[VALIDATE] ✓ IDENTITY_ID present');

    // Fetch credentials
    console.log('[CREDENTIALS] Fetching credentials...');
    const identityResponse = await fetchIdentityCredentials(config.identityId);
    const credentials = parseCredentials(identityResponse.credentials);
    console.log(`[CREDENTIALS] ✓ Fetched for: ${identityResponse.name}`);
    console.log(`[CREDENTIALS] Email: ${credentials.username}`);

    // Setup browser
    const browser = await getAnchorBrowser(config.sessionId);
    const context = browser.contexts()[0];
    if (!context) {
      return { success: false, message: 'Failed to get browser context' };
    }
    const page = context.pages()[0];
    if (!page) {
      return { success: false, message: 'Failed to get browser page' };
    }
    console.log('[BROWSER] ✓ Browser ready\n');

    // Check if already logged in
    console.log('[STEP 1] ▶ Checking if already authenticated...');
    await page.goto(PLATFORM_URL, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    if (!currentUrl.includes('auth.openai.com') && !currentUrl.includes('/login')) {
      // Check for authenticated indicators
      const authIndicators = [
        '[data-testid="user-menu"]',
        '[aria-label="Open settings"]',
        'nav[aria-label]',
        'a[href*="/settings"]',
      ];

      for (const selector of authIndicators) {
        if (await page.locator(selector).first().isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log('[STEP 1] ✓ Already authenticated');
          return { success: true, message: 'Already authenticated' };
        }
      }
    }
    console.log('[STEP 1] ⚠ Not logged in, proceeding to login');

    // Navigate to login page
    console.log('[STEP 2] ▶ Navigating to login page...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
    await page.waitForTimeout(2000);
    console.log('[STEP 2] ✓ Login page loaded');

    // Use agent to perform login with credentials
    console.log('[STEP 3] ▶ Performing login via agent...');
    const agentPrompt = `${LOGIN_PROMPT}

Credentials to use:
- Email: ${credentials.username}
- Password: ${credentials.password}

Start by triple-clicking the email field to select all, then type the email and click Continue.`;

    const result = await client.agent.task(agentPrompt, { sessionId: config.sessionId });
    console.log(`[STEP 3] Agent result: ${result}`);

    // Parse agent result
    const resultStr = String(result).toLowerCase().trim();

    if (resultStr === 'true') {
      const successMsg = `Logged in to OpenAI as ${credentials.username}`;
      console.log('\n========================================');
      console.log('[RESULT] ✓ SUCCESS!');
      console.log(successMsg);
      console.log('========================================\n');
      return { success: true, message: successMsg };
    }

    if (resultStr === 'false') {
      return { success: false, message: 'Login failed: Invalid credentials' };
    }

    return { success: false, message: `Login attempt failed: ${result}` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('\n[RESULT] ✗ FAILED');
    console.error('OpenAI login failed:', errorMessage);
    return { success: false, message: errorMessage };
  }
}
