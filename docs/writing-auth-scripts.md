# Writing Auth Scripts

This document provides a complete guide to writing authentication scripts for the browser automation library.

## Auth Task Flow

When a session is created with an identity, the authentication flow is:

1. **Session created with identity** triggers `executeAuthenticationTasks`
2. **Auth task fetches credentials** via `client.identities.retrieveCredentials(identityId)`
3. **Auth task performs login automation** using Playwright
4. **Session is now authenticated** for subsequent tool tasks

## Environment Variables

Auth scripts receive these environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `ANCHOR_SESSION_ID` | Browser session ID to connect to | Yes (if connecting to existing) |
| `ANCHOR_IDENTITY_ID` | Identity ID to fetch credentials for | Yes |
| `ANCHOR_TIMEOUT_MS` | Timeout in milliseconds | No (default varies) |

## Fetching Credentials

**IMPORTANT**: Auth scripts fetch credentials from the API, NOT from environment variables.

```typescript
import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';

function getAnchorClient(): Anchorbrowser {
  return new AnchorBrowser();
}

async function fetchIdentityCredentials(identityId: string) {
  const anchorClient = getAnchorClient();
  return anchorClient.identities.retrieveCredentials(identityId);
}
```

The response includes credentials by type:

```typescript
interface CredentialsResponse {
  name: string;
  credentials: Array<{
    type: 'username_password' | 'authenticator' | 'custom';
    username?: string;
    password?: string;
    otp?: string;
    // ... other fields
  }>;
}
```

### Parsing Credentials

```typescript
function parseCredentials(credentials: CredentialsResponse['credentials']) {
  let username = '';
  let password = '';
  let otp = '';

  credentials.forEach((cred) => {
    if (cred.type === 'username_password') {
      username = cred.username;
      password = cred.password;
    } else if (cred.type === 'authenticator') {
      otp = cred.otp || '';
    }
  });

  if (!username || !password) {
    throw new Error('Missing required credentials');
  }

  return { username, password, otp };
}
```

## Browser Setup

### Connecting to Existing Session

```typescript
async function getAnchorBrowser(sessionId: string): Promise<Browser> {
  const client = getAnchorClient();
  
  if (sessionId) {
    console.log(`[BROWSER] Connecting to existing session: ${sessionId}`);
    return client.browser.connect(sessionId);
  }
  
  throw new Error('ANCHOR_SESSION_ID is required');
}
```

### Creating New Session (with stealth)

```typescript
async function getAnchorBrowser(extraStealthRequired: boolean): Promise<Browser> {
  const client = getAnchorClient();
  
  const browserConfiguration = extraStealthRequired
    ? {
        sessionOptions: {
          session: {
            proxy: { active: true },
          },
          browser: {
            captcha_solver: { active: true },
            extra_stealth: { active: true },
          },
        },
      }
    : {};

  return client.browser.create(browserConfiguration);
}
```

## Navigation Rules

**CRITICAL**: Social media sites (Facebook, LinkedIn, etc.) never reach "networkidle" state due to constant background activity.

**Always use:**
```typescript
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
```

**NEVER use:**
```typescript
// This will timeout on social media sites!
await page.goto(url, { waitUntil: 'networkidle' });
```

## Login Flow Patterns

### Step 1: Navigate to Login Page

```typescript
async function navigateToLogin(page: Page, loginUrl: string, timeoutMs: number): Promise<void> {
  console.log('[STEP 1] ▶ Navigating to login page...');
  
  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    console.log('[STEP 1] ✓ Login page loaded');
  } catch (navErr) {
    // Check if we're already on a usable page
    const hasLoginForm = await page.locator('input[type="email"], input[type="text"]')
      .first().isVisible().catch(() => false);
    
    if (!hasLoginForm) {
      throw navErr;
    }
    console.log('[STEP 1] ⚠ Timeout but login form visible, proceeding...');
  }
}
```

### Step 2: Check If Already Logged In

```typescript
async function checkIfAlreadyLoggedIn(page: Page, feedUrl: string, timeoutMs: number): Promise<boolean> {
  console.log('[STEP 2] ▶ Checking if already authenticated...');
  
  try {
    await page.waitForURL(`**${feedUrl}**`, { timeout: timeoutMs });
    console.log('[STEP 2] ✓ Already authenticated');
    return true;
  } catch {
    const currentUrl = page.url();
    if (currentUrl.includes('/feed') || currentUrl.includes('/home')) {
      return true;
    }
    console.log('[STEP 2] ⚠ Not logged in, proceeding to login');
    return false;
  }
}
```

### Step 3: Enter Username

```typescript
async function enterUsername(page: Page, username: string, timeoutMs: number): Promise<void> {
  console.log('[STEP 3] ▶ Entering username...');
  
  const usernameSelectors = [
    'input#username',
    'input[name="email"]',
    'input[type="email"]',
    'input[name="session_key"]',
  ];
  
  for (const selector of usernameSelectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible({ timeout: timeoutMs }).catch(() => false)) {
      await input.fill(username);
      await input.press('Tab');
      console.log('[STEP 3] ✓ Username entered');
      return;
    }
  }
  
  throw new Error('Username input not found');
}
```

### Step 4: Enter Password and Submit

```typescript
async function enterPasswordAndSubmit(page: Page, password: string, timeoutMs: number): Promise<void> {
  console.log('[STEP 4] ▶ Entering password...');
  
  const passwordSelectors = [
    'input#password',
    'input[name="password"]',
    'input[type="password"]',
    'input[name="session_password"]',
  ];
  
  for (const selector of passwordSelectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible({ timeout: timeoutMs }).catch(() => false)) {
      await input.fill(password);
      await input.press('Enter');
      console.log('[STEP 4] ✓ Password submitted');
      return;
    }
  }
  
  throw new Error('Password input not found');
}
```

### Step 5: Handle 2FA (if required)

```typescript
async function handle2FA(page: Page, identityId: string, timeoutMs: number): Promise<void> {
  console.log('[STEP 5] ▶ Checking for 2FA...');
  
  // Fetch fresh OTP
  const updatedCredentials = await fetchIdentityCredentials(identityId);
  const { otp } = parseCredentials(updatedCredentials.credentials);
  
  if (!otp) {
    console.log('[STEP 5] ⚠ No OTP available, skipping 2FA');
    return;
  }
  
  // Find OTP input
  const otpSelectors = [
    'input[name="pin"]',
    'input[name="code"]',
    'input[autocomplete="one-time-code"]',
    'input[maxlength="6"]',
  ];
  
  for (const selector of otpSelectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible({ timeout: 5000 }).catch(() => false)) {
      await input.fill(otp);
      await input.press('Enter');
      console.log('[STEP 5] ✓ OTP submitted');
      return;
    }
  }
  
  console.log('[STEP 5] ⚠ No 2FA prompt found');
}
```

### Step 6: Verify Login Success

```typescript
async function verifyLoginSuccess(page: Page, successUrlPattern: string, timeoutMs: number): Promise<boolean> {
  console.log('[STEP 6] ▶ Verifying login success...');
  
  try {
    await page.waitForURL(`**${successUrlPattern}**`, { timeout: Math.max(timeoutMs, 30000) });
    console.log('[STEP 6] ✓ Login successful');
    return true;
  } catch {
    const currentUrl = page.url();
    const isSuccess = currentUrl.includes('/feed') || currentUrl.includes('/home');
    
    if (isSuccess) {
      console.log('[STEP 6] ✓ URL check passed');
    } else {
      console.log(`[STEP 6] ⚠ Unexpected URL: ${currentUrl}`);
    }
    
    return isSuccess;
  }
}
```

## Return Value Structure

Auth scripts must return this structure:

```typescript
interface LoginResult {
  success: boolean;
  message: string;
}

// Success example
return { success: true, message: `Logged in as ${username}` };

// Failure example
return { success: false, message: 'Login failed: Invalid credentials' };
```

## Complete Auth Script Template

```typescript
import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';
import type { Browser, Page } from 'playwright';

// Configuration schema
const ConfigSchema = z.object({
  sessionId: z.string().default(''),
  identityId: z.string().min(1, 'ANCHOR_IDENTITY_ID is required'),
  timeoutMs: z.coerce.number().default(10000),
});

type Config = z.infer<typeof ConfigSchema>;

interface LoginResult {
  success: boolean;
  message: string;
}

function getConfig(): Config {
  return ConfigSchema.parse({
    sessionId: process.env['ANCHOR_SESSION_ID'],
    identityId: process.env['ANCHOR_IDENTITY_ID'],
    timeoutMs: process.env['ANCHOR_TIMEOUT_MS'],
  });
}

function getAnchorClient(): Anchorbrowser {
  return new AnchorBrowser();
}

async function getAnchorBrowser(config: Config, extraStealthRequired: boolean): Promise<Browser> {
  const client = getAnchorClient();

  if (config.sessionId) {
    console.log(`[BROWSER] Connecting to existing session: ${config.sessionId}`);
    return client.browser.connect(config.sessionId);
  }

  const browserConfiguration = extraStealthRequired
    ? {
        sessionOptions: {
          session: { proxy: { active: true } },
          browser: {
            captcha_solver: { active: true },
            extra_stealth: { active: true },
          },
        },
      }
    : {};

  console.log('[BROWSER] Creating new browser session...');
  return client.browser.create(browserConfiguration);
}

async function fetchIdentityCredentials(identityId: string) {
  const anchorClient = getAnchorClient();
  return anchorClient.identities.retrieveCredentials(identityId);
}

// Add your login step functions here...

export default async function LoginToApp(): Promise<LoginResult> {
  console.log('\n========================================');
  console.log('  App Login Automation');
  console.log('========================================\n');

  const config = getConfig();
  console.log('[VALIDATE] ✓ IDENTITY_ID present');

  // Fetch credentials
  console.log('[CREDENTIALS] Fetching credentials...');
  const identityResponse = await fetchIdentityCredentials(config.identityId);
  const credentials = parseCredentials(identityResponse.credentials);
  console.log(`[CREDENTIALS] ✓ Fetched for: ${identityResponse.name}`);

  // Setup browser
  const browser = await getAnchorBrowser(config, !credentials.otp);
  const context = browser.contexts()[0];
  if (!context) {
    return { success: false, message: 'Failed to get browser context' };
  }
  const page = context.pages()[0];
  if (!page) {
    return { success: false, message: 'Failed to get browser page' };
  }
  console.log('[BROWSER] ✓ Browser ready\n');

  try {
    console.log('--- Starting Login Flow ---\n');

    // Step 1: Navigate to login
    await navigateToLogin(page, 'https://example.com/login', config.timeoutMs);

    // Step 2: Check if already logged in
    const alreadyLoggedIn = await checkIfAlreadyLoggedIn(page, '/feed/', config.timeoutMs);
    if (alreadyLoggedIn) {
      return { success: true, message: 'Already authenticated' };
    }

    // Step 3: Enter username
    await enterUsername(page, credentials.username, config.timeoutMs);

    // Step 4: Enter password
    await enterPasswordAndSubmit(page, credentials.password, config.timeoutMs);

    // Step 5: Handle 2FA if needed
    if (credentials.otp) {
      await handle2FA(page, config.identityId, config.timeoutMs);
    }

    // Step 6: Verify success
    const success = await verifyLoginSuccess(page, '/feed/', config.timeoutMs);
    if (!success) {
      return { success: false, message: 'Login verification failed' };
    }

    const successMsg = `Logged in as ${credentials.username}`;
    console.log('\n========================================');
    console.log('[RESULT] ✓ SUCCESS!');
    console.log(successMsg);
    console.log('========================================\n');

    return { success: true, message: successMsg };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('\n[RESULT] ✗ FAILED');
    console.error('Login failed:', errorMessage);
    return { success: false, message: errorMessage || 'Unknown error' };
  } finally {
    await browser.close();
  }
}
```

## Corresponding template.json

```json
{
  "slug": "basic-login",
  "name": "Basic Login",
  "description": "Login using username and password with optional 2FA.",
  "type": "auth",
  "file": "basic-login.ts",
  "app": "your-app-id",
  "requiredCredentials": ["username_password"],
  "optionalCredentials": ["authenticator"]
}
```
