import anchorBrowser from 'anchorbrowser';
import { z } from 'zod';

type Page = any;
type BrowserContext = any;

// Lazy-loaded config and client - only initialized when needed
let _anchorClient: InstanceType<typeof anchorBrowser> | null = null;
let _config: {
  sessionId: string;
  apiKey: string;
  identityId: string | undefined;
  timeoutMs: number;
  homeUrl: string;
  meshUrl: string;
} | null = null;

function getConfig() {
  if (!_config) {
    _config = {
      sessionId: process.env.ANCHOR_SESSION_ID || '',
      apiKey: process.env.ANCHORBROWSER_API_KEY!,
      identityId: process.env.ANCHOR_IDENTITY_ID,
      timeoutMs: parseInt(process.env.ANCHOR_TIMEOUT_MS || '10000', 10),
      homeUrl: 'https://complyadvantage.com/',
      meshUrl: 'https://mesh.complyadvantage.com/',
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

const CustomFieldSchema = z.object({
  name: z.string().min(1, 'Field name is required'),
  value: z.string().min(1, 'Field value is required'),
});

const CustomCredentialSchema = z.object({
  type: z.literal('custom'),
  fields: z.array(CustomFieldSchema).min(1, 'At least one field is required'),
});

const CredentialSchema = z.union([
  UsernamePasswordCredentialSchema,
  CustomCredentialSchema,
]);

type Credential = z.infer<typeof CredentialSchema>;

interface ComplyAdvantageCredentials {
  organization: string;
  username: string;
  password: string;
}

async function getAnchorBrowser() {
  const config = getConfig();
  const client = getAnchorClient();
  console.log('[BROWSER] Setting up Anchor browser...');
  if (config.sessionId) {
    console.log(`[BROWSER] Connecting to existing session: ${config.sessionId}`);
    return await client.browser.connect(config.sessionId);
  }
  console.log('[BROWSER] Creating new browser session...');
  return await client.browser.create();
}

async function fetchIdentityCredentials(identityId: string): Promise<any> {
  const anchorClient = getAnchorClient();
  console.log(`Fetching credentials for identity: ${identityId}`);
  return await anchorClient.identities.retrieveCredentials(identityId);
}

function parseComplyAdvantageCredentials(credentials: Credential[]): ComplyAdvantageCredentials {
  let organization = '';
  let username = '';
  let password = '';
  try {
    
    for (const cred of credentials) {
      const validatedCred = CredentialSchema.parse(cred);
      if (validatedCred.type === 'username_password') {
        username = validatedCred.username;
        password = validatedCred.password;
      } else if (validatedCred.type === 'custom') {
        // Look for organization in custom fields
        for (const field of validatedCred.fields) {
          if (field.name.toLowerCase().includes('organization') || field.name.toLowerCase().includes('company')) {
            organization = field.value;
          }
        }
      }
    }
} catch (error) {
  throw new Error('Failed to parse credentials.');
}
  if (!organization || !username || !password) {
    throw new Error(
      `Missing required credentials. Found: organization=${!!organization}, username=${!!username}, password=${!!password}`
    );
  }

  return { organization, username, password };
}

function validateRequiredInputs(): void {
  const config = getConfig();
  console.log('[VALIDATE] Checking required inputs...');
  if (!config.identityId?.trim()) {
    throw new Error('Missing required input ANCHOR_IDENTITY_ID. Please set ANCHOR_IDENTITY_ID environment variable.');
  }
  if (!config.apiKey?.trim()) {
    throw new Error('Missing required input ANCHOR_API_KEY. Please set ANCHOR_API_KEY environment variable.');
  }
  console.log('[VALIDATE] ✓ All required inputs present');
}

async function waitForVisible(page: Page, selector: string, timeout = getConfig().timeoutMs): Promise<void> {
  await page.waitForSelector(selector, { state: 'visible', timeout });
}

async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function clickWithFallback(page: Page, selector: string, description: string): Promise<boolean> {
  const config = getConfig();
  const element = page.locator(selector).first();
  await waitForVisible(page, selector);
  await scrollToTop(page);

  try {
    console.log(`Clicking ${description}...`);
    await element.click({ timeout: config.timeoutMs });
    return true;
  } catch {
    console.log(`Standard click failed for ${description}, trying JS fallback...`);
    try {
      await element.evaluate((node: HTMLElement) => node.click());
      return true;
    } catch (e2: any) {
      console.error(`Click failed for ${description}: ${e2?.message || e2}`);
      return false;
    }
  }
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

async function dismissCookieBanner(page: Page): Promise<void> {
  console.log('[STEP 2] ▶ Checking for cookie banner...');
  try {
    const banner = page.locator('#notice');
    const isVisible = await banner.isVisible({ timeout: 2000 }).catch(() => false);

    if (isVisible) {
      console.log('[STEP 2] Cookie banner detected, dismissing...');
      const acceptBtn = banner.locator("button[title='Accept all'], button[aria-label='Accept all']").first();
      if (await acceptBtn.isVisible().catch(() => false)) {
        await acceptBtn.click();
        console.log('[STEP 2] ✓ Cookie banner dismissed');
      }
    } else {
      console.log('[STEP 2] ✓ No cookie banner present');
    }
  } catch {
    console.log('[STEP 2] ✓ Cookie banner not present or already dismissed');
  }
}

async function openLoginModal(page: Page): Promise<boolean> {
  const config = getConfig();
  console.log('[STEP 3] ▶ Opening login modal...');
  const clicked = await clickWithFallback(page, '#login-nav-button', 'Login button');

  if (!clicked) {
    console.log('[STEP 3] ⚠ Login button click failed, navigating directly to Mesh...');
    await page.goto(config.meshUrl, { waitUntil: 'load', timeout: config.timeoutMs }).catch(() => {});
    return false;
  }

  console.log('[STEP 3] Waiting for login modal to appear...');
  const modalVisible = await page
    .locator('#mesh-li-modal-button, #loginModal')
    .first()
    .isVisible()
    .catch(() => false);

  if (!modalVisible) {
    console.log('[STEP 3] ⚠ Login modal not detected, navigating directly to Mesh...');
    await page.goto(config.meshUrl, { waitUntil: 'load', timeout: config.timeoutMs }).catch(() => {});
    return false;
  }

  console.log('[STEP 3] ✓ Login modal opened');
  return true;
}

async function selectMeshLoginOption(page: Page, context: BrowserContext): Promise<Page> {
  console.log('[STEP 4] ▶ Selecting Mesh login option...');
  // Check if a new tab already opened
  let authPage = context.pages().find((p: Page) => p !== page) || null;

  if (authPage) {
    console.log('[STEP 4] Found existing auth page in new tab');
  }

  if (!authPage) {
    const meshBtn = page.locator('#mesh-li-modal-button').first();
    const isVisible = await meshBtn.isVisible().catch(() => false);

    if (isVisible) {
      console.log('[STEP 4] Clicking Mesh button to open new tab...');
      const [newPage] = await Promise.all([
        context.waitForEvent('page', { timeout: getConfig().timeoutMs }),
        meshBtn.click(),
      ]);
      authPage = newPage;
      console.log('[STEP 4] ✓ New auth tab opened');
    }
  }

  // Fallback: find any page with auth/mesh URL
  if (!authPage) {
    console.log('[STEP 4] ⚠ No new tab, searching for auth page...');
    authPage = context.pages().find((p: Page) => /complyadvantage|auth0|mesh/i.test(p.url())) || page;
  }

  console.log(`[STEP 4] Auth page URL: ${authPage.url()}`);
  return authPage;
}

async function waitForAuth0Page(page: Page): Promise<void> {
  console.log('[STEP 5] ▶ Waiting for Auth0 page...');
  try {
    await page.waitForURL('**auth0.com/**', { timeout: getConfig().timeoutMs });
    console.log('[STEP 5] ✓ Auth0 login page detected');
  } catch {
    console.log('[STEP 5] ⚠ Auth0 URL not detected, proceeding with login selectors...');
  }
  console.log(`[STEP 5] Current URL: ${page.url()}`);
}

async function enterOrganization(page: Page, organization: string): Promise<void> {
  console.log('[STEP 6] ▶ Checking for organization input...');
  try {
    await page.waitForSelector('#organizationName', { state: 'visible', timeout: 7000 });
    console.log(`[STEP 6] Entering organization: ${organization}`);
    await page.locator('#organizationName').fill(organization);
    await page.locator('#organizationName').press('Enter');
    console.log('[STEP 6] ✓ Organization submitted');
  } catch {
    console.log('[STEP 6] ✓ Organization step not required, skipping');
  }
}

async function enterUsername(page: Page, username: string): Promise<void> {
  console.log('[STEP 7] ▶ Entering username...');
  await waitForVisible(page, '#username');
  console.log(`[STEP 7] Username field visible, entering: ${username}`);
  await page.locator('#username').fill(username);
  await page.locator('#username').press('Enter');
  console.log('[STEP 7] ✓ Username submitted');
}

async function enterPassword(page: Page, password: string): Promise<void> {
  console.log('[STEP 8] ▶ Entering password...');
  await waitForVisible(page, '#password');
  console.log('[STEP 8] Password field visible, entering password...');
  await page.locator('#password').fill(password);
  await page.locator('#password').press('Enter');
  console.log('[STEP 8] ✓ Password submitted');
}

async function verifyMeshLogin(page: Page): Promise<boolean> {
  console.log('[STEP 9] ▶ Verifying Mesh login success...');
  try {
    await page.waitForURL('**mesh.complyadvantage.com/**', {
      timeout: Math.max(getConfig().timeoutMs, 60000),
    });
    console.log('[STEP 9] ✓ Mesh dashboard URL confirmed');
    return true;
  } catch {
    const currentUrl = page.url();
    console.log(`[STEP 9] ⚠ Timeout waiting for Mesh URL. Current: ${currentUrl}`);
    const isOnMesh = /mesh\.complyadvantage\.com\//.test(currentUrl);
    if (isOnMesh) {
      console.log('[STEP 9] ✓ URL check passed - on Mesh domain');
    }
    return isOnMesh;
  }
}

export default async function LoginToComplyAdvantageMesh() {
  console.log('\n========================================');
  console.log('  ComplyAdvantage Mesh Login Automation');
  console.log('========================================\n');

  // Validate inputs
  try {
    validateRequiredInputs();
  } catch (e: any) {
    console.error('[ERROR] ' + (e?.message || e));
    return { success: false, message: e?.message || 'Missing required inputs' };
  }

  // Fetch credentials from identity API
  console.log('\n[CREDENTIALS] Fetching credentials from identity API...');
  let credentials: ComplyAdvantageCredentials;
  try {
    const identityResponse = await fetchIdentityCredentials(getConfig().identityId!);
    credentials = parseComplyAdvantageCredentials(identityResponse.credentials);
    console.log(`[CREDENTIALS] ✓ Fetched credentials for identity: ${identityResponse.name}`);
    console.log(`[CREDENTIALS] Organization: ${credentials.organization}`);
    console.log(`[CREDENTIALS] Username: ${credentials.username}`);
  } catch (e: any) {
    console.error('[ERROR] ' + (e?.message || e));
    return { success: false, message: e?.message || 'Failed to fetch credentials' };
  }

  // Setup browser
  const browser = await getAnchorBrowser();
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  console.log('[BROWSER] ✓ Browser ready\n');

  try {
    console.log('--- Starting Login Flow ---\n');

    // Step 1: Navigate to homepage
    await navigateToHomepage(page);
    console.log('');

    // Step 2: Dismiss cookie banner
    await dismissCookieBanner(page);
    console.log('');

    // Step 3: Open login modal
    await openLoginModal(page);
    console.log('');

    // Step 4: Select Mesh login option
    const authPage = await selectMeshLoginOption(page, context);
    console.log('');

    // Step 5: Wait for Auth0 page
    await waitForAuth0Page(authPage);
    console.log('');

    // Step 6: Enter organization
    await enterOrganization(authPage, credentials.organization);
    console.log('');

    // Step 7: Enter username
    await enterUsername(authPage, credentials.username);
    console.log('');

    // Step 8: Enter password
    await enterPassword(authPage, credentials.password);
    console.log('');

    // Step 9: Verify login success
    const meshReached = await verifyMeshLogin(authPage);

    if (!meshReached) {
      const finalUrl = authPage.url();
      const msg = `Login flow completed but Mesh URL not confirmed. Current URL: ${finalUrl}`;
      console.error('\n[RESULT] ✗ ' + msg);
      return { success: false, message: msg };
    }

    const successMsg = `Logged in to ComplyAdvantage Mesh as ${credentials.username} (org: ${credentials.organization}).`;
    console.log('\n========================================');
    console.log('[RESULT] ✓ SUCCESS!');
    console.log(successMsg);
    console.log('========================================\n');
    return { success: true, message: successMsg };
  } catch (error: any) {
    console.error('\n[RESULT] ✗ FAILED');
    console.error('Mesh login automation failed:', error?.message || error);
    return { success: false, message: error?.message || 'Unknown error during Mesh login.' };
  }
  finally {
    await browser.close();
  }
}
