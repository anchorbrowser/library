import AnchorBrowser from 'anchorbrowser';
import { z } from 'zod';

type Page = any;

// Lazy-loaded config and client
let _anchorClient: InstanceType<typeof AnchorBrowser> | null = null;
let _config: {
  sessionId: string;
  identityId: string | undefined;
  timeoutMs: number;
  loginUrl: string;
} | null = null;

function getConfig() {
  if (!_config) {
    _config = {
      sessionId: process.env['ANCHOR_SESSION_ID'] || '',
      identityId: process.env['ANCHOR_IDENTITY_ID'],
      timeoutMs: parseInt(process.env['ANCHOR_TIMEOUT_MS'] || '30000', 10),
      loginUrl: 'https://www.facebook.com/login',
    };
  }
  return _config;
}

function getAnchorClient() {
  if (!_anchorClient) {
    _anchorClient = new AnchorBrowser();
  }
  return _anchorClient;
}

// Credential schemas
const UsernamePasswordCredentialSchema = z.object({
  type: z.literal('username_password'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const AuthenticatorCredentialSchema = z.object({
  type: z.literal('authenticator'),
  secret: z.string().min(1, 'Secret is required'),
  otp: z.string().optional(),
});

const CredentialSchema = z.discriminatedUnion('type', [
  UsernamePasswordCredentialSchema,
  AuthenticatorCredentialSchema,
]);

type Credential = z.infer<typeof CredentialSchema>;

interface FacebookCredentials {
  username: string;
  password: string;
  otp?: string | undefined;
}

async function getOrConnectBrowser() {
  const config = getConfig();
  const client = getAnchorClient();

  console.log('[BROWSER] Setting up browser connection...');

  if (config.sessionId) {
    console.log(`[BROWSER] Connecting to existing session: ${config.sessionId}`);
    return await client.browser.connect(config.sessionId);
  }

  console.log('[BROWSER] Creating new browser session with stealth...');
  return await client.browser.create({
    sessionOptions: {
      session: {
        proxy: { active: true },
      },
      browser: {
        captcha_solver: { active: true },
        extra_stealth: { active: true },
      },
    },
  });
}

async function fetchIdentityCredentials(identityId: string): Promise<any> {
  const client = getAnchorClient();
  return await client.identities.retrieveCredentials(identityId);
}

function parseFacebookCredentials(credentials: Credential[]): FacebookCredentials {
  let username = '';
  let password = '';
  let otp: string | undefined;

  for (const cred of credentials) {
    const validated = CredentialSchema.parse(cred);
    if (validated.type === 'username_password') {
      username = validated.username;
      password = validated.password;
    } else if (validated.type === 'authenticator') {
      otp = validated.otp;
    }
  }

  if (!username || !password) {
    throw new Error(`Missing required credentials. Found: username=${!!username}, password=${!!password}`);
  }

  return { username, password, otp };
}

async function waitForVisible(page: Page, selector: string, timeout = getConfig().timeoutMs): Promise<void> {
  await page.waitForSelector(selector, { state: 'visible', timeout });
}

async function navigateToLogin(page: Page): Promise<void> {
  const config = getConfig();
  console.log('[STEP 1] ▶ Navigating to Facebook login...');
  console.log(`[STEP 1] URL: ${config.loginUrl}`);

  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
  console.log('[STEP 1] ✓ Login page loaded');
}

async function handleCookieConsent(page: Page): Promise<void> {
  console.log('[STEP 2] ▶ Checking for cookie consent dialog...');

  try {
    // Facebook cookie consent button selectors
    const consentSelectors = [
      'button[data-cookiebanner="accept_button"]',
      'button[data-testid="cookie-policy-manage-dialog-accept-button"]',
      'button:has-text("Allow all cookies")',
      'button:has-text("Accept All")',
      'button:has-text("Allow essential and optional cookies")',
    ];

    for (const selector of consentSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        console.log('[STEP 2] ✓ Cookie consent accepted');
        await page.waitForTimeout(1000);
        return;
      }
    }
    console.log('[STEP 2] ⚠ No cookie consent dialog found, continuing...');
  } catch {
    console.log('[STEP 2] ⚠ Cookie consent handling skipped');
  }
}

async function enterCredentials(page: Page, creds: FacebookCredentials): Promise<void> {
  console.log('[STEP 3] ▶ Entering credentials...');

  // Email/Phone input
  const emailSelector = 'input#email, input[name="email"]';
  await waitForVisible(page, emailSelector);
  await page.locator(emailSelector).fill(creds.username);
  console.log(`[STEP 3] ✓ Email entered: ${creds.username}`);

  // Password input
  const passwordSelector = 'input#pass, input[name="pass"]';
  await waitForVisible(page, passwordSelector);
  await page.locator(passwordSelector).fill(creds.password);
  console.log('[STEP 3] ✓ Password entered');
}

async function submitLogin(page: Page): Promise<void> {
  console.log('[STEP 4] ▶ Submitting login form...');

  const submitSelectors = [
    'button#loginbutton',
    'button[name="login"]',
    'button[type="submit"]',
    'input[type="submit"][value="Log in" i]',
    'input[type="submit"][value="Log In" i]',
  ];

  for (const selector of submitSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null),
        btn.click(),
      ]);
      console.log('[STEP 4] ✓ Login form submitted');
      return;
    }
  }

  // Fallback: press Enter on password field
  await page.locator('input#pass, input[name="pass"]').press('Enter');
  console.log('[STEP 4] ✓ Login submitted via Enter key');
}

async function handle2FA(page: Page, identityId: string): Promise<void> {
  console.log('[STEP 5] ▶ Checking for 2FA prompt...');

  // Wait a moment for potential 2FA redirect
  await page.waitForTimeout(3000);

  // Check for 2FA input
  const twoFaSelectors = [
    'input#approvals_code',
    'input[name="approvals_code"]',
    'input[autocomplete="one-time-code"]',
    'input[placeholder*="code" i]',
  ];

  for (const selector of twoFaSelectors) {
    if (await page.locator(selector).first().isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[STEP 5] 2FA required, fetching fresh OTP...');

      // Fetch fresh credentials with updated OTP
      const freshCreds = await fetchIdentityCredentials(identityId);
      const parsed = parseFacebookCredentials(freshCreds.credentials);

      if (!parsed.otp) {
        throw new Error('2FA required but no OTP available in credentials');
      }

      await page.locator(selector).first().fill(parsed.otp);
      console.log('[STEP 5] ✓ OTP entered');

      // Submit 2FA
      const submitBtn = page.locator('button[type="submit"], button:has-text("Continue")').first();
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
        submitBtn.click().catch(() => page.locator(selector).first().press('Enter')),
      ]);
      console.log('[STEP 5] ✓ 2FA submitted');
      return;
    }
  }

  console.log('[STEP 5] ⚠ No 2FA prompt detected');
}

async function verifyLogin(page: Page): Promise<boolean> {
  console.log('[STEP 6] ▶ Verifying login success...');

  // Wait for navigation to settle
  await page.waitForTimeout(3000);

  const currentUrl = page.url();
  console.log(`[STEP 6] Current URL: ${currentUrl}`);

  // Success indicators
  const successPatterns = [
    /facebook\.com\/?$/,
    /facebook\.com\/\?/,
    /facebook\.com\/home/,
    /facebook\.com\/feed/,
  ];

  if (successPatterns.some((pattern) => pattern.test(currentUrl))) {
    console.log('[STEP 6] ✓ URL indicates successful login');
    return true;
  }

  // Check for authenticated UI elements
  const authIndicators = [
    '[aria-label="Your profile"]',
    '[aria-label="Account"]',
    '[data-pagelet="LeftRail"]',
    'div[role="navigation"] a[href*="/me/"]',
  ];

  for (const selector of authIndicators) {
    if (await page.locator(selector).first().isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[STEP 6] ✓ Authenticated UI element found');
      return true;
    }
  }

  // Check for error messages
  const errorSelectors = [
    'div[role="alert"]',
    '#error_box',
    '.login_error_box',
    'div:has-text("password you entered is incorrect")',
    'div:has-text("doesn\'t match any account")',
  ];

  for (const selector of errorSelectors) {
    if (await page.locator(selector).first().isVisible({ timeout: 2000 }).catch(() => false)) {
      const errorText = await page.locator(selector).first().textContent().catch(() => '');
      throw new Error(`Login failed: ${errorText}`);
    }
  }

  console.log('[STEP 6] ⚠ Could not confirm login status');
  return false;
}

export default async function LoginToFacebook() {
  console.log('\n========================================');
  console.log('  Facebook Login Automation');
  console.log('========================================\n');

  const config = getConfig();

  // Validate identity
  if (!config.identityId?.trim()) {
    const msg = 'Missing required ANCHOR_IDENTITY_ID environment variable';
    console.error(`[ERROR] ${msg}`);
    return { success: false, message: msg };
  }
  console.log('[VALIDATE] ✓ Identity ID present');

  // Fetch credentials
  console.log('\n[CREDENTIALS] Fetching credentials...');
  const identityResponse = await fetchIdentityCredentials(config.identityId);
  const credentials = parseFacebookCredentials(identityResponse.credentials);
  console.log(`[CREDENTIALS] ✓ Credentials fetched for: ${identityResponse.name}`);
  console.log(`[CREDENTIALS] Username: ${credentials.username}`);

  // Connect to browser
  const browser = await getOrConnectBrowser();
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('No browser context available');
  }
  const page = context.pages()[0] || (await context.newPage());
  console.log('[BROWSER] ✓ Browser ready\n');

  try {
    console.log('--- Starting Login Flow ---\n');

    // Step 1: Navigate to login
    await navigateToLogin(page);

    // Step 2: Handle cookie consent
    await handleCookieConsent(page);

    // Check if already logged in
    const alreadyLoggedIn = await verifyLogin(page).catch(() => false);
    if (alreadyLoggedIn) {
      return { success: true, message: 'Already authenticated' };
    }

    // Step 3: Enter credentials
    await enterCredentials(page, credentials);

    // Step 4: Submit login
    await submitLogin(page);

    // Step 5: Handle 2FA if needed
    await handle2FA(page, config.identityId);

    // Step 6: Verify login
    const loggedIn = await verifyLogin(page);

    if (!loggedIn) {
      const msg = `Login flow completed but could not verify success. Current URL: ${page.url()}`;
      console.error(`\n[RESULT] ✗ ${msg}`);
      return { success: false, message: msg };
    }

    const successMsg = `Successfully logged in to Facebook as ${credentials.username}`;
    console.log('\n========================================');
    console.log('[RESULT] ✓ SUCCESS!');
    console.log(successMsg);
    console.log('========================================\n');

    return { success: true, message: successMsg };
  } catch (error: any) {
    console.error('\n[RESULT] ✗ FAILED');
    console.error('Facebook login failed:', error?.message || error);
    return { success: false, message: error?.message || 'Unknown error during Facebook login' };
  }
}