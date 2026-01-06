import anchorBrowser from 'anchorbrowser';
import { z } from 'zod';

type Page = any;

// Lazy-loaded config and client - only initialized when needed
let _anchorClient: InstanceType<typeof anchorBrowser> | null = null;
let _config: {
  sessionId: string;
  identityId: string | undefined;
  timeoutMs: number;
  homeUrl: string;
} | null = null;

function getConfig() {
  if (!_config) {
    _config = {
      sessionId: process.env.ANCHOR_SESSION_ID || '',
      identityId: process.env.ANCHOR_IDENTITY_ID,
      timeoutMs: parseInt(process.env.ANCHOR_TIMEOUT_MS || '10000', 10),
      homeUrl: 'https://www.linkedin.com/uas/login',
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

  const CredentialSchema = z.discriminatedUnion('type', [UsernamePasswordCredentialSchema, AuthenticatorCredentialSchema]);

type Credential = z.infer<typeof CredentialSchema>;


interface LinkedinCredentials {
  username: string;
  password: string;
  otp: string;
}

async function getAnchorBrowser(extraStealthRequired: boolean) {
  const config = getConfig();
  const client = getAnchorClient();
  console.log('[BROWSER] Setting up Anchor browser...');
  if (config.sessionId) {
    console.log(`[BROWSER] Connecting to existing session: ${config.sessionId}`);
    return await client.browser.connect(config.sessionId);
  }
  const browserConfiguration =  extraStealthRequired ? {
    sessionOptions: {
      session: {
        proxy: {
          active: true
        }
      },
      browser: {
        captcha_solver: {
          active: true
        },
        extra_stealth: {
          active: true
        }
      }
    }
  } : {};
  console.log('[BROWSER] Creating new browser session...');
  return await client.browser.create(browserConfiguration);
}

async function fetchIdentityCredentials(identityId: string): Promise<any> {
  const anchorClient = getAnchorClient();
  return await anchorClient.identities.retrieveCredentials(identityId);
}

function parseLinkedinCredentials(credentials: Credential[]): LinkedinCredentials {
  let username = '';
  let password = '';
  let otp = '';

  for (const cred of credentials) {
    const validatedCred = CredentialSchema.parse(cred);
    if (validatedCred.type === 'username_password') {
      username = validatedCred.username;
      password = validatedCred.password;
    } else if (validatedCred.type === 'authenticator') {
      otp = validatedCred.otp || '';
    }
  }

  if (!username || !password) {
    throw new Error(
      `Missing required credentials. Found: username=${!!username}, password=${!!password}`
    );
  }
  
  return { username, password, otp };
}

function validateRequiredInputs(): void {
  const config = getConfig();
  console.log('[VALIDATE] Checking required inputs...');
  if (!config.identityId?.trim()) {
    throw new Error('Missing required input ANCHOR_IDENTITY_ID. Please set ANCHOR_IDENTITY_ID environment variable.');
  }
  console.log('[VALIDATE] ✓ All required inputs present');
}

async function waitForVisible(page: Page, selector: string, timeout = getConfig().timeoutMs): Promise<void> {
  await page.waitForSelector(selector, { state: 'visible', timeout });
}

async function navigateToHomepage(page: Page): Promise<void> {
  const config = getConfig();
  console.log('[STEP 1] ▶ Navigating to homepage...');
  console.log(`[STEP 1] URL: ${config.homeUrl}`);
  try {
    await page.goto(config.homeUrl, { waitUntil: 'load', timeout: config.timeoutMs });
    console.log('[STEP 1] ✓ Homepage loaded successfully');

  } catch (navErr) {
    const hasLoginButton = await page
      .locator('#login-nav-button')
      .first()
      .isVisible()
      .catch(() => false);
    if (!hasLoginButton) {
      console.error('Homepage load failed and login button not detected.');
      throw navErr;
    }
    console.log('[STEP 1] ⚠ Load timeout but login button visible, proceeding...');
  }
}

async function enterUsername(page: Page, username: string): Promise<void> {
  console.log('[STEP 3] ▶ Entering username...');
  await waitForVisible(page, 'input#username[name="session_key"][type="email"]');
  console.log(`[STEP 3] Username field visible, entering: ${username}`);
  await page.locator('input#username[name="session_key"][type="email"]').fill(username);
  await page.locator('input#username[name="session_key"][type="email"]').press('Tab');
  console.log('[STEP 3] ✓ Username submitted');
}

async function enterPasswordAndSubmit(page: Page, password: string): Promise<void> {
  console.log('[STEP 4] ▶ Entering password...');
  await waitForVisible(page, 'input#password[name="session_password"][type="password"]');
  console.log('[STEP 4] Password field visible, entering password...');
  await page.locator('input#password[name="session_password"][type="password"]').fill(password);
  await page.locator('input#password[name="session_password"][type="password"]').press('Enter');
  console.log('[STEP 4] ✓ Password submitted');
}

async function verifyLogin({page, step, fallbackTimeout = 60000}: {page: Page, step: number, fallbackTimeout?: number}): Promise<boolean> {
  console.log(`[STEP ${step}] ▶ Verifying login success...`);
  try {
    await page.waitForURL('**linkedin.com/feed/**', {
      timeout: Math.max(getConfig().timeoutMs, fallbackTimeout),
    });
    console.log(`[STEP ${step}] ✓ Linkedin Feed URL confirmed`);
    return true;
  } catch {
    const currentUrl = page.url();
    console.log(`[STEP ${step}] ⚠ Timeout waiting for Linkedin Feed URL. Current: ${currentUrl}`);
    const isOnLinkedin = /linkedin\.com\/feed\//.test(currentUrl);
    if (isOnLinkedin) {
      console.log(`[STEP ${step}] ✓ URL check passed - on Linkedin Feed domain`);
    }
    return isOnLinkedin;
  }
}

async function clickCommonSubmit(page: any) {
  const submitSelectors = [
    'button:has-text("Submit")',
    'button:has-text("Verify")',
    'button:has-text("Continue")',
    'button[type="submit"]',
    'input[type="submit"]'
  ];
  for (const sel of submitSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'load', timeout: 45000 }).catch(() => null),
        btn.click(),
      ]);
      return true;
    }
  }
  return false;
}

async function locateOtpInputs(page: any) {
  // Single field variants
  const singleSelectors = [
    'input[name="pin"][maxlength="6"]',
    'input[name="code"]',
    'input[autocomplete="one-time-code"]',
    'input[id*="verification" i]',
    'input[inputmode="numeric"][maxlength="6"]'
  ];
  for (const sel of singleSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      return { type: 'single', locator: loc } as const;
    }
  }

  // Multi-digit inputs (six separate boxes)
  const digitInputs = page.locator('input[aria-label*="digit" i], input[pattern="\\d*"][maxlength="1"], input[inputmode="numeric"][maxlength="1"]');
  const count = await digitInputs.count().catch(() => 0);
  if (count >= 6) {
    return { type: 'multi', locator: digitInputs } as const;
  }

  return null;
}

async function submitOtpCode(page: any, otp: string, step: number) {
  const inputs = await locateOtpInputs(page);
  if (!inputs) {
    throw new Error('OTP inputs not found');
  }

  if (inputs.type === 'single') {
    await inputs.locator.fill('');
    await inputs.locator.fill(otp);
    // Try Enter first
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 45000 }).catch(() => null),
      inputs.locator.press('Enter'),
    ]);
    if (!(await verifyLogin({page, step, fallbackTimeout: 10000}))) {
      await clickCommonSubmit(page).catch(() => null);
    }
  } else {
    // Multi-digit fields
    const arr = otp.split('');
    const total = Math.min(await inputs.locator.count(), arr.length);
    for (let i = 0; i < total; i++) {
      const field = inputs.locator.nth(i);
      await field.fill('');
      await field.type(arr[i]);
    }
    // Submit by pressing Enter on last field
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 45000 }).catch(() => null),
      inputs.locator.nth(total - 1).press('Enter'),
    ]);
    if (!(await verifyLogin({page, step, fallbackTimeout: 10000}))) {
      await clickCommonSubmit(page).catch(() => null);
    }
  }
}

export default async function LoginToLinkedin() {
  console.log('\n========================================');
  console.log('  Linkedin Login Automation');
  console.log('========================================\n');

  // Validate inputs
  const config = getConfig();
  if (!config.identityId?.trim()) {
    console.error('[ERROR] ' + 'Missing required input ANCHOR_IDENTITY_ID. Please set ANCHOR_IDENTITY_ID environment variable.');
    return { success: false, message: 'Missing required input ANCHOR_IDENTITY_ID. Please set ANCHOR_IDENTITY_ID environment variable.' };
  } else {
    console.log('[VALIDATE] ✓ IDENTITY_ID present');
  }

  // Fetch credentials from identity API
  console.log('\n[CREDENTIALS] Fetching credentials from identity API...');
  let credentials: LinkedinCredentials;

  const identityResponse = await fetchIdentityCredentials(getConfig().identityId!);
  credentials = parseLinkedinCredentials(identityResponse.credentials);
  console.log(`[CREDENTIALS] ✓ Fetched credentials for identity: ${identityResponse.name}`);
  console.log(`[CREDENTIALS] Username: ${credentials.username}`);


  // Setup browser
  const extraStealthRequired = credentials.otp ? false : true;
  const browser = await getAnchorBrowser(extraStealthRequired);
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  console.log('[BROWSER] ✓ Browser ready\n');

  try {
    console.log('--- Starting Login Flow ---\n');
  
    // Step 1: Navigate to homepage
    await navigateToHomepage(page);
    console.log('');

    // Step 2: Verify login success
    const loggedIn = await verifyLogin({page, step: 2, fallbackTimeout: 10000});
    if (loggedIn) {
      return { success: true, message: 'Already authenticated. Landed on /feed.' };
    }
    else {
      console.log(`[STEP 2] ⚠ Not logged in, proceeding to login.`);
      console.log('');
    }
    
    // Step 3: Enter username
    await enterUsername(page, credentials.username);
    console.log('');
    
    // Step 4: Enter password
    await enterPasswordAndSubmit(page, credentials.password);
    console.log('');
    
    if (credentials.otp) {
    // Step 5: Fetch updated credentials
    const updatedCredentials = await fetchIdentityCredentials(getConfig().identityId!);
    credentials = parseLinkedinCredentials(updatedCredentials.credentials);
    console.log(`[STEP 5] ✓ Fetch updated credentials.`);
    console.log('');

    // Step 6: Submit OTP code
    await submitOtpCode(page, credentials.otp, 6);
    console.log('');
    }
    else {
        console.log(`[STEP 5] ✓ No OTP found, skipping OTP submission.`);
        console.log('');
    }
    // Step 7: Verify login success
    const Loggedin = await verifyLogin({page, step: credentials.otp ? 7 : 6, fallbackTimeout: 10000});

    if (!Loggedin) {
      const finalUrl = page.url();
      const msg = `Login flow completed but Linkedin Feed URL not confirmed. Current URL: ${finalUrl}`;
      console.error('\n[RESULT] ✗ ' + msg);
      return { success: false, message: msg };
    }

    const successMsg = `Logged in to Linkedin as ${credentials.username}.`;
    console.log('\n========================================');
    console.log('[RESULT] ✓ SUCCESS!');
    console.log(successMsg);
    console.log('========================================\n');
    return { success: true, message: successMsg };
  } catch (error: any) {
    console.error('\n[RESULT] ✗ FAILED');
    console.error('Linkedin login automation failed:', error?.message || error);
    return { success: false, message: error?.message || 'Unknown error during Linkedin login.' };
  } finally {
    await browser.close();
  }
}