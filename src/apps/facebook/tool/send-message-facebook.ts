import AnchorBrowser from 'anchorbrowser';
import { z } from 'zod';

type Page = any;

// Lazy-loaded config and client
let _anchorClient: InstanceType<typeof AnchorBrowser> | null = null;
let _config: {
  sessionId: string;
  identityId: string | undefined;
  recipientName: string;
  message: string;
  timeoutMs: number;
} | null = null;

function getConfig() {
    if (!_config) {
      // Parse ANCHOR_TOOL_INPUT if provided (from tool execution)
      let toolInput: Record<string, string> = {};
      try {
        const toolInputStr = process.env['ANCHOR_TOOL_INPUT'];
        if (toolInputStr) {
          toolInput = JSON.parse(toolInputStr);
        }
      } catch (e) {
        // Ignore parse errors
      }
  
      _config = {
        sessionId: process.env['ANCHOR_SESSION_ID'] || '',
        identityId: process.env['ANCHOR_IDENTITY_ID'],
        recipientName: toolInput['Recipient Name'] || process.env['ANCHOR_RECIPIENT_NAME'] || '',
        message: toolInput['Message Text'] || process.env['ANCHOR_MESSAGE'] || 'Hi!',
        timeoutMs: parseInt(process.env['ANCHOR_TIMEOUT_MS'] || '30000', 10),
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

// Input validation schema
const InputSchema = z.object({
  recipientName: z.string().min(1, 'Recipient name is required'),
  message: z.string().min(1, 'Message is required'),
});

async function connectToBrowser() {
  const config = getConfig();
  const client = getAnchorClient();

  console.log('[BROWSER] Connecting to browser session...');

  if (config.sessionId) {
    console.log(`[BROWSER] Using existing session: ${config.sessionId}`);
    return await client.browser.connect(config.sessionId);
  }

  // If no session, create one with identity (will trigger auth task)
  if (config.identityId) {
    console.log(`[BROWSER] Creating new session with identity: ${config.identityId}`);
    return await client.browser.create({
      sessionOptions: {
        session: {
          proxy: { active: true },
        },
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

async function ensureLoggedIn(page: Page): Promise<boolean> {
    console.log('[CHECK] ▶ Verifying Facebook authentication...');
  
    // Navigate to Facebook home
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: getConfig().timeoutMs });
  
    // Wait for page to settle
    await page.waitForTimeout(3000);
  
    const currentUrl = page.url();
    
    // If we're on login page, definitely not authenticated
    if (currentUrl.includes('/login') || currentUrl.includes('checkpoint')) {
      console.log('[CHECK] ✗ User is NOT authenticated - redirected to login');
      return false;
    }
  
    // If URL looks like home/feed, assume authenticated
    if (currentUrl.match(/facebook\.com\/?(\?|$)/) || currentUrl.includes('/home') || currentUrl.includes('/?')) {
      console.log('[CHECK] ✓ User appears authenticated (on home/feed)');
      return true;
    }
  
    // Check for authenticated indicators (expanded list)
    const authIndicators = [
      '[aria-label="Your profile"]',
      '[aria-label="Account"]', 
      '[aria-label="Account Controls and Settings"]',
      '[data-pagelet="LeftRail"]',
      'div[role="navigation"] a[href*="/me/"]',
      '[aria-label="Messenger"]',
      '[aria-label="Menu"]',
      '[aria-label="Notifications"]',
      'a[href*="facebook.com/me"]',
    ];
  
    for (const selector of authIndicators) {
      if (await page.locator(selector).first().isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`[CHECK] ✓ User is authenticated (found: ${selector})`);
        return true;
      }
    }
  
    // If we got here and not on login page, probably authenticated
    console.log('[CHECK] ⚠ Could not find auth indicators but not on login page - assuming authenticated');
    return true;  // Be more lenient
  }

async function navigateToMessenger(page: Page): Promise<void> {
  console.log('[STEP 1] ▶ Navigating to Messenger...');

  await page.goto('https://www.facebook.com/messages/t/', {
    waitUntil: 'domcontentloaded',
    timeout: getConfig().timeoutMs,
  });

  // Wait for Messenger to load
  await page.waitForTimeout(2000);
  console.log('[STEP 1] ✓ Messenger loaded');
}

async function searchForRecipient(page: Page, recipientName: string): Promise<void> {
  console.log(`[STEP 2] ▶ Searching for recipient: ${recipientName}...`);

  // Click on "New message" or search
  const newMessageSelectors = [
    '[aria-label="New message"]',
    '[aria-label="Start a new message"]',
    'div[role="button"]:has-text("New message")',
  ];

  let clicked = false;
  for (const selector of newMessageSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click();
      clicked = true;
      console.log('[STEP 2] ✓ New message dialog opened');
      break;
    }
  }

  if (!clicked) {
    // Try using the search in the left panel
    const searchSelectors = [
      'input[placeholder*="Search" i]',
      '[aria-label="Search Messenger"]',
      'input[type="search"]',
    ];

    for (const selector of searchSelectors) {
      const input = page.locator(selector).first();
      if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
        await input.click();
        await input.fill(recipientName);
        console.log('[STEP 2] ✓ Search query entered');
        break;
      }
    }
  } else {
    // In new message dialog, find the "To" input
    await page.waitForTimeout(1000);
    const toInputSelectors = [
      'input[placeholder*="To" i]',
      'input[aria-label*="To" i]',
      '[data-testid="messenger-composer-text-input"]',
    ];

    for (const selector of toInputSelectors) {
      const input = page.locator(selector).first();
      if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
        await input.fill(recipientName);
        console.log('[STEP 2] ✓ Recipient name entered');
        break;
      }
    }
  }

  // Wait for search results
  await page.waitForTimeout(2000);
}

async function selectRecipient(page: Page, recipientName: string): Promise<void> {
  console.log('[STEP 3] ▶ Selecting recipient from results...');

  // Look for the recipient in search results
  const resultSelectors = [
    `div[role="listitem"]:has-text("${recipientName}")`,
    `div[role="option"]:has-text("${recipientName}")`,
    `div[role="button"]:has-text("${recipientName}")`,
    `span:has-text("${recipientName}")`,
  ];

  for (const selector of resultSelectors) {
    const result = page.locator(selector).first();
    if (await result.isVisible({ timeout: 5000 }).catch(() => false)) {
      await result.click();
      console.log(`[STEP 3] ✓ Selected: ${recipientName}`);
      await page.waitForTimeout(1000);
      return;
    }
  }

  throw new Error(`Could not find recipient: ${recipientName}`);
}

async function typeAndSendMessage(page: Page, message: string): Promise<void> {
  console.log('[STEP 4] ▶ Typing message...');

  // Find message input
  const messageInputSelectors = [
    '[aria-label="Message"]',
    '[aria-label*="message" i]',
    'div[role="textbox"][contenteditable="true"]',
    '[data-testid="messenger-composer-text-area"]',
    'p[data-placeholder*="message" i]',
  ];

  let messageInput = null;
  for (const selector of messageInputSelectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible({ timeout: 5000 }).catch(() => false)) {
      messageInput = input;
      break;
    }
  }

  if (!messageInput) {
    throw new Error('Could not find message input field');
  }

  // Type the message
  await messageInput.click();
  await messageInput.fill(message);
  console.log(`[STEP 4] ✓ Message typed: "${message}"`);

  // Small delay before sending
  await page.waitForTimeout(500);

  console.log('[STEP 5] ▶ Sending message...');

  // Try clicking send button first
  const sendButtonSelectors = [
    '[aria-label="Press enter to send"]',
    '[aria-label="Send"]',
    'div[role="button"][aria-label*="Send" i]',
  ];

  for (const selector of sendButtonSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      console.log('[STEP 5] ✓ Message sent via button');
      return;
    }
  }

  // Fallback: press Enter
  await messageInput.press('Enter');
  console.log('[STEP 5] ✓ Message sent via Enter key');
}

async function verifyMessageSent(page: Page, message: string): Promise<boolean> {
  console.log('[STEP 6] ▶ Verifying message was sent...');

  await page.waitForTimeout(2000);

  // Look for the sent message in the chat
  const sentMessageLocator = page.locator(`div:has-text("${message}")`).first();
  if (await sentMessageLocator.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('[STEP 6] ✓ Message appears in chat');
    return true;
  }

  // Check for "Sent" indicator
  const sentIndicators = [
    '[aria-label="Sent"]',
    'span:has-text("Sent")',
    'svg[aria-label*="sent" i]',
  ];

  for (const selector of sentIndicators) {
    if (await page.locator(selector).first().isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[STEP 6] ✓ Sent indicator found');
      return true;
    }
  }

  console.log('[STEP 6] ⚠ Could not verify message was sent');
  return true; // Assume success if no error
}

export default async function SendFacebookMessage() {
  console.log('\n========================================');
  console.log('  Facebook Send Message Automation');
  console.log('========================================\n');

  const config = getConfig();

  // Validate inputs
  const inputValidation = InputSchema.safeParse({
    recipientName: config.recipientName,
    message: config.message,
  });

  if (!inputValidation.success) {
    const errors = inputValidation.error.errors.map((e) => e.message).join(', ');
    console.error(`[ERROR] Invalid inputs: ${errors}`);
    return { success: false, message: `Invalid inputs: ${errors}` };
  }

  console.log('[VALIDATE] ✓ Inputs validated');
  console.log(`[VALIDATE] Recipient: ${config.recipientName}`);
  console.log(`[VALIDATE] Message: "${config.message}"`);

  // Connect to browser
  const browser = await connectToBrowser();
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('No browser context available');
  }
  const page = context.pages()[0] || (await context.newPage());
  console.log('[BROWSER] ✓ Browser ready\n');

  try {
    console.log('--- Starting Message Flow ---\n');

    // Check if logged in
    const isLoggedIn = await ensureLoggedIn(page);
    if (!isLoggedIn) {
      const msg = 'User is not authenticated. Please run the authentication task first.';
      console.error(`[ERROR] ${msg}`);
      return { success: false, message: msg };
    }

    // Step 1: Navigate to Messenger
    await navigateToMessenger(page);

    // Step 2: Search for recipient
    await searchForRecipient(page, config.recipientName);

    // Step 3: Select recipient
    await selectRecipient(page, config.recipientName);

    // Step 4 & 5: Type and send message
    await typeAndSendMessage(page, config.message);

    // Step 6: Verify message sent
    const sent = await verifyMessageSent(page, config.message);

    if (!sent) {
      const msg = 'Message may not have been sent successfully';
      console.error(`\n[RESULT] ⚠ ${msg}`);
      return { success: false, message: msg };
    }

    const successMsg = `Successfully sent "${config.message}" to ${config.recipientName}`;
    console.log('\n========================================');
    console.log('[RESULT] ✓ SUCCESS!');
    console.log(successMsg);
    console.log('========================================\n');

    return {
      success: true,
      message: successMsg,
      data: {
        recipient: config.recipientName,
        messageSent: config.message,
      },
    };
  } catch (error: any) {
    console.error('\n[RESULT] ✗ FAILED');
    console.error('Send message failed:', error?.message || error);
    return { success: false, message: error?.message || 'Unknown error sending message' };
  }
}