import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import type { Browser, Page } from 'playwright';

const LOGIN_URL = 'https://auth.openai.com/log-in';
const PLATFORM_URL = 'https://platform.openai.com/';

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

async function isAuthenticated(page: Page): Promise<boolean> {
  const currentUrl = page.url();
  
  // If we're on auth page, not authenticated
  if (currentUrl.includes('auth.openai.com') || currentUrl.includes('/login')) {
    return false;
  }
  
  // Check for authenticated indicators on platform
  const authIndicators = [
    '[data-testid="user-menu"]',
    '[aria-label="Open settings"]',
    'nav[aria-label]',
    'a[href*="/settings"]',
    '[data-testid="sidebar"]',
  ];

  for (const selector of authIndicators) {
    if (await page.locator(selector).first().isVisible({ timeout: 2000 }).catch(() => false)) {
      return true;
    }
  }
  
  return false;
}

async function performLogin(page: Page, email: string, password: string, timeoutMs: number): Promise<{ success: boolean; error?: string }> {
  // Wait for email field and enter email
  console.log('[LOGIN] Entering email...');
  const emailInput = page.locator('input[name="email"], input[type="email"], input[id="email"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: timeoutMs });
  
  // Clear and type email using robust method
  await emailInput.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(100);
  await emailInput.fill(email);
  await page.waitForTimeout(300);
  
  // Click Continue for email
  console.log('[LOGIN] Clicking Continue...');
  const continueButton = page.locator('button:has-text("Continue")').first();
  await continueButton.click();
  
  // Wait for either password field or error
  console.log('[LOGIN] Waiting for password field...');
  await page.waitForTimeout(2000);
  
  // Check for email error
  const emailError = page.locator('text="Email is not valid"');
  if (await emailError.isVisible({ timeout: 1000 }).catch(() => false)) {
    return { success: false, error: 'Email is not valid - check email format' };
  }
  
  // Wait for password field
  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
  try {
    await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    // Check if we got an error message
    const errorMessages = [
      'text="Email is not valid"',
      'text="User does not exist"',
      'text="Invalid email"',
      '[role="alert"]',
    ];
    
    for (const errorSelector of errorMessages) {
      const errorEl = page.locator(errorSelector);
      if (await errorEl.isVisible({ timeout: 500 }).catch(() => false)) {
        const errorText = await errorEl.textContent().catch(() => 'Unknown error');
        return { success: false, error: `Login error: ${errorText}` };
      }
    }
    
    return { success: false, error: 'Password field did not appear - email may not be registered' };
  }
  
  // Enter password
  console.log('[LOGIN] Entering password...');
  await passwordInput.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(100);
  await passwordInput.fill(password);
  await page.waitForTimeout(300);
  
  // Click Continue/Log in for password
  console.log('[LOGIN] Submitting credentials...');
  const submitButton = page.locator('button:has-text("Continue"), button:has-text("Log in")').first();
  await submitButton.click();
  
  // Wait for navigation or error
  console.log('[LOGIN] Waiting for result...');
  await page.waitForTimeout(3000);
  
  // Check for password error
  const passwordErrors = [
    'text="Wrong email or password"',
    'text="Invalid password"',
    'text="Incorrect password"',
    'text="credentials"',
  ];
  
  for (const errorSelector of passwordErrors) {
    const errorEl = page.locator(errorSelector);
    if (await errorEl.isVisible({ timeout: 500 }).catch(() => false)) {
      return { success: false, error: 'Invalid credentials - wrong email or password' };
    }
  }
  
  // Check if we're now authenticated
  await page.waitForTimeout(2000);
  const currentUrl = page.url();
  
  if (!currentUrl.includes('auth.openai.com') && !currentUrl.includes('/login')) {
    return { success: true };
  }
  
  // Check for 2FA or verification
  if (currentUrl.includes('verify') || currentUrl.includes('2fa') || currentUrl.includes('mfa')) {
    return { success: false, error: '2FA verification required - manual intervention needed' };
  }
  
  return { success: false, error: 'Login failed - unknown reason' };
}

export default async function LoginToOpenAI(): Promise<LoginResult> {
  console.log('\n========================================');
  console.log('  OpenAI Platform Login Automation');
  console.log('========================================\n');

  try {
    const config = getConfig();

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

    if (await isAuthenticated(page)) {
      console.log('[STEP 1] ✓ Already authenticated');
      return { success: true, message: 'Already authenticated' };
    }
    console.log('[STEP 1] ⚠ Not logged in, proceeding to login');

    // Navigate to login page
    console.log('[STEP 2] ▶ Navigating to login page...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
    await page.waitForTimeout(2000);
    console.log('[STEP 2] ✓ Login page loaded');

    // Perform login with direct Playwright interactions
    console.log('[STEP 3] ▶ Performing login...');
    const loginResult = await performLogin(page, credentials.username, credentials.password, config.timeoutMs);
    
    if (loginResult.success) {
      const successMsg = `Logged in to OpenAI as ${credentials.username}`;
      console.log('\n========================================');
      console.log('[RESULT] ✓ SUCCESS!');
      console.log(successMsg);
      console.log('========================================\n');
      return { success: true, message: successMsg };
    }
    
    console.log(`[STEP 3] ✗ Login failed: ${loginResult.error}`);
    return { success: false, message: loginResult.error || 'Login failed' };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('\n[RESULT] ✗ FAILED');
    console.error('OpenAI login failed:', errorMessage);
    return { success: false, message: errorMessage };
  }
}
