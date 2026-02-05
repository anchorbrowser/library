import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';

const PLATFORM_URL = 'https://platform.openai.com/';
const BILLING_URL = 'https://platform.openai.com/settings/organization/billing/overview';

interface ToolResult {
  success: boolean;
  message: string;
  data?: {
    invoices?: string;
    totalAmount?: number;
  };
}

let _anchorClient: Anchorbrowser | null = null;
let _config: {
  sessionId: string;
  identityId: string | undefined;
  startDate: string;
  endDate: string;
  timeoutMs: number;
} | null = null;

function getConfig() {
  if (!_config) {
    let toolInput: Record<string, string> = {};
    try {
      const toolInputStr = process.env['ANCHOR_TOOL_INPUT'];
      if (toolInputStr) {
        toolInput = JSON.parse(toolInputStr);
      }
    } catch {
      // Ignore parse errors
    }

    _config = {
      sessionId: process.env['ANCHOR_SESSION_ID'] || '',
      identityId: process.env['ANCHOR_IDENTITY_ID'],
      startDate: toolInput['startDate'] || '',
      endDate: toolInput['endDate'] || '',
      timeoutMs: parseInt(process.env['ANCHOR_TIMEOUT_MS'] || '60000', 10),
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

async function connectToBrowser() {
  const config = getConfig();
  const client = getAnchorClient();

  console.log('[BROWSER] Connecting to browser session...');

  if (config.sessionId) {
    console.log(`[BROWSER] Using existing session: ${config.sessionId}`);
    return client.browser.connect(config.sessionId);
  }

  if (config.identityId) {
    console.log(`[BROWSER] Creating new session with identity: ${config.identityId}`);
    return client.browser.create({
      sessionOptions: {
        session: { proxy: { active: true } },
        browser: {
          captcha_solver: { active: true },
          extra_stealth: { active: true },
        },
        identities: [{ id: config.identityId }],
      },
    });
  }

  throw new Error('Either ANCHOR_SESSION_ID or ANCHOR_IDENTITY_ID is required');
}

async function ensureLoggedIn(page: any): Promise<boolean> {
  console.log('[CHECK] ▶ Verifying OpenAI authentication...');

  await page.goto(PLATFORM_URL, { waitUntil: 'domcontentloaded', timeout: getConfig().timeoutMs });
  await page.waitForTimeout(3000);

  const currentUrl = page.url();

  if (currentUrl.includes('auth.openai.com') || currentUrl.includes('/login')) {
    console.log('[CHECK] ✗ User is NOT authenticated - redirected to login');
    return false;
  }

  const authIndicators = [
    '[data-testid="user-menu"]',
    '[aria-label="Open settings"]',
    'nav[aria-label]',
    'a[href*="/settings"]',
    '[aria-label="Account"]',
  ];

  for (const selector of authIndicators) {
    if (await page.locator(selector).first().isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`[CHECK] ✓ User is authenticated (found: ${selector})`);
      return true;
    }
  }

  // If not on login page, assume authenticated
  if (!currentUrl.includes('auth.openai.com')) {
    console.log('[CHECK] ✓ User appears authenticated (on platform)');
    return true;
  }

  return false;
}

function buildInvoicePrompt(startDate: string, endDate: string): string {
  const dateRange = endDate
    ? `from ${startDate} to ${endDate}`
    : `starting from ${startDate}`;

  return `You are on the OpenAI platform. Your task is to find and extract invoice/billing information ${dateRange}.

Follow these steps:
1. Navigate to the billing section: Settings > Organization > Billing (or similar navigation)
2. Look for invoices, billing history, or usage charges
3. Find any invoices or charges within the specified date range
4. Extract the invoice details including: date, amount, status, and invoice ID if available

Return a JSON object with this exact structure:
{
  "invoices": [
    {
      "date": "YYYY-MM-DD",
      "amount": 0.00,
      "status": "paid/pending/etc",
      "invoiceId": "optional-id"
    }
  ],
  "totalAmount": 0.00,
  "currency": "USD"
}

If no invoices are found in the date range, return:
{
  "invoices": [],
  "totalAmount": 0,
  "currency": "USD",
  "message": "No invoices found for the specified period"
}

IMPORTANT:
- Navigate through the billing UI to find the information
- Do NOT make API calls directly
- Extract only real data visible on the page
- Return valid JSON only`;
}

export default async function GetOpenAIInvoices(): Promise<ToolResult> {
  console.log('\n========================================');
  console.log('  OpenAI Get Invoices Tool');
  console.log('========================================\n');

  const config = getConfig();

  if (!config.startDate) {
    return {
      success: false,
      message: 'startDate is required',
    };
  }

  console.log('[VALIDATE] ✓ Inputs validated');
  console.log(`[VALIDATE] Start Date: ${config.startDate}`);
  console.log(`[VALIDATE] End Date: ${config.endDate || '(not specified)'}`);

  let browser;
  try {
    browser = await connectToBrowser();
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error('No browser context available');
    }
    const page = context.pages()[0] || (await context.newPage());
    console.log('[BROWSER] ✓ Browser ready\n');

    console.log('--- Starting Invoice Retrieval ---\n');

    // Check authentication
    const isLoggedIn = await ensureLoggedIn(page);
    if (!isLoggedIn) {
      return {
        success: false,
        message: 'User is not authenticated. Please run the authentication task first.',
      };
    }

    // Navigate to billing page first
    console.log('[STEP 1] ▶ Navigating to billing page...');
    await page.goto(BILLING_URL, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
    await page.waitForTimeout(3000);
    console.log('[STEP 1] ✓ Billing page loaded');

    // Use agent to extract invoice data
    console.log('[STEP 2] ▶ Extracting invoice data via agent...');
    const client = getAnchorClient();
    const prompt = buildInvoicePrompt(config.startDate, config.endDate);

    const result = await client.agent.task(prompt, {
      sessionId: config.sessionId,
      taskOptions: {
        url: BILLING_URL,
        maxSteps: 30,
      },
    });

    console.log('[STEP 2] ✓ Agent task completed');

    // Parse the result
    let invoiceData: { invoices?: unknown[]; totalAmount?: number; message?: string };
    try {
      if (typeof result === 'string') {
        // Try to extract JSON from the response
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          invoiceData = JSON.parse(jsonMatch[0]);
        } else {
          invoiceData = { invoices: [], totalAmount: 0, message: result };
        }
      } else if (result && typeof result === 'object') {
        invoiceData = result as typeof invoiceData;
      } else {
        invoiceData = { invoices: [], totalAmount: 0, message: 'No data extracted' };
      }
    } catch {
      invoiceData = { invoices: [], totalAmount: 0, message: String(result) };
    }

    const successMsg = `Retrieved invoice data for period starting ${config.startDate}`;
    console.log('\n========================================');
    console.log('[RESULT] ✓ SUCCESS!');
    console.log(successMsg);
    console.log('========================================\n');

    return {
      success: true,
      message: successMsg,
      data: {
        invoices: JSON.stringify(invoiceData.invoices || []),
        totalAmount: invoiceData.totalAmount || 0,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('\n[RESULT] ✗ FAILED');
    console.error('Get invoices failed:', errorMessage);
    return {
      success: false,
      message: errorMessage,
    };
  }
}
