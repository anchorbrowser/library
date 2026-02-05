import AnchorBrowser from 'anchorbrowser';

type Page = any;

let _anchorClient: InstanceType<typeof AnchorBrowser> | null = null;
let _config: {
  sessionId: string;
  identityId: string | undefined;
  maxMessages: number;
  timeoutMs: number;
} | null = null;

interface ConversationInfo {
  senderName: string;
  preview: string;
  timestamp: string;
}

interface ReadMessagesResult {
  success: boolean;
  message: string;
  data?: {
    messagesOpened: number;
    conversations: ConversationInfo[];
  };
}

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

    const maxMessagesInput = toolInput['maxMessages'] || process.env['ANCHOR_MAX_MESSAGES'] || '5';
    const maxMessages = Math.min(5, Math.max(1, parseInt(maxMessagesInput, 10) || 5));

    _config = {
      sessionId: process.env['ANCHOR_SESSION_ID'] || '',
      identityId: process.env['ANCHOR_IDENTITY_ID'],
      maxMessages,
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

async function connectToBrowser() {
  const config = getConfig();
  const client = getAnchorClient();

  console.log('[BROWSER] Connecting to browser session...');

  if (config.sessionId) {
    console.log(`[BROWSER] Using existing session: ${config.sessionId}`);
    return await client.browser.connect(config.sessionId);
  }

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
  console.log('[CHECK] ▶ Verifying LinkedIn authentication...');

  await page.goto('https://www.linkedin.com/feed/', {
    waitUntil: 'domcontentloaded',
    timeout: getConfig().timeoutMs,
  });

  await page.waitForTimeout(3000);

  const currentUrl = page.url();

  if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint') || currentUrl.includes('/uas/login')) {
    console.log('[CHECK] ✗ User is NOT authenticated - redirected to login');
    return false;
  }

  if (currentUrl.includes('/feed')) {
    console.log('[CHECK] ✓ User appears authenticated (on feed)');
    return true;
  }

  const authIndicators = [
    '[data-test-icon="nav-mynetwork-icon"]',
    '[data-test-icon="nav-messaging-icon"]',
    '[data-test-icon="nav-notifications-icon"]',
    'nav[aria-label="Primary Navigation"]',
    '.global-nav__me-photo',
    '#global-nav',
  ];

  for (const selector of authIndicators) {
    if (await page.locator(selector).first().isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`[CHECK] ✓ User is authenticated (found: ${selector})`);
      return true;
    }
  }

  console.log('[CHECK] ⚠ Could not verify auth status');
  return false;
}

async function openMessagingPanel(page: Page): Promise<boolean> {
  console.log('[STEP 1] ▶ Opening messaging panel...');

  // Click the messaging icon in the navigation bar to open the overlay
  const messagingIconSelectors = [
    '[data-test-icon="nav-messaging-icon"]',
    'a[href*="/messaging/"]',
    '.msg-overlay-bubble-header',
    '[aria-label="Messaging"]',
    '.global-nav__icon--messaging',
  ];

  for (const selector of messagingIconSelectors) {
    const icon = page.locator(selector).first();
    if (await icon.isVisible({ timeout: 3000 }).catch(() => false)) {
      await icon.click();
      console.log(`[STEP 1] ✓ Clicked messaging icon: ${selector}`);
      await page.waitForTimeout(2000);
      return true;
    }
  }

  // Fallback: navigate directly to messaging page
  console.log('[STEP 1] ⚠ Messaging icon not found, navigating to messaging page...');
  await page.goto('https://www.linkedin.com/messaging/', {
    waitUntil: 'domcontentloaded',
    timeout: getConfig().timeoutMs,
  });
  await page.waitForTimeout(3000);

  return true;
}

async function findUnreadConversations(page: Page, maxMessages: number): Promise<any[]> {
  console.log(`[STEP 2] ▶ Finding up to ${maxMessages} unread conversations...`);

  // Selectors for unread conversations in both overlay and full messaging page
  const unreadSelectors = [
    // Overlay panel selectors
    '.msg-overlay-list-bubble__convo-card--unread',
    '.msg-conversation-card--unread',
    // Full messaging page selectors
    'li.msg-conversation-listitem:has(.msg-conversation-card__unread-count)',
    '.msg-conversation-listitem--unread',
    // Generic unread indicators
    '[class*="unread"]',
    'li[data-control-id]:has(.notification-badge)',
  ];

  let unreadItems: any[] = [];

  for (const selector of unreadSelectors) {
    const items = page.locator(selector);
    const count = await items.count().catch(() => 0);
    if (count > 0) {
      console.log(`[STEP 2] Found ${count} unread items with selector: ${selector}`);
      for (let i = 0; i < Math.min(count, maxMessages); i++) {
        unreadItems.push(items.nth(i));
      }
      break;
    }
  }

  if (unreadItems.length === 0) {
    console.log('[STEP 2] No unread messages found with unread selectors, checking for badge indicators...');
    
    // Look for conversations with unread badge/count indicators
    const conversationSelectors = [
      '.msg-overlay-list-bubble__convo-card',
      'li.msg-conversation-listitem',
      '.msg-conversation-card',
    ];

    for (const selector of conversationSelectors) {
      const items = page.locator(selector);
      const count = await items.count().catch(() => 0);
      if (count > 0) {
        console.log(`[STEP 2] Found ${count} total conversations, checking for unread badges...`);
        for (let i = 0; i < count && unreadItems.length < maxMessages; i++) {
          const item = items.nth(i);
          const badgeSelectors = [
            '.msg-conversation-card__unread-count',
            '.notification-badge',
            '[data-test-notification-badge]',
            '.msg-overlay-list-bubble__unread-count',
          ];
          
          for (const badgeSel of badgeSelectors) {
            const hasBadge = await item.locator(badgeSel).isVisible().catch(() => false);
            if (hasBadge) {
              unreadItems.push(item);
              break;
            }
          }
        }
        if (unreadItems.length > 0) break;
      }
    }
  }

  console.log(`[STEP 2] ✓ Found ${unreadItems.length} unread conversations`);
  return unreadItems;
}

async function extractConversationInfo(item: any): Promise<ConversationInfo> {
  const nameSelectors = [
    '.msg-conversation-card__participant-names',
    '.msg-conversation-listitem__participant-names',
    '.msg-overlay-list-bubble__convo-card-content-title',
    '.msg-conversation-card__title',
    'h3',
  ];

  const previewSelectors = [
    '.msg-conversation-card__message-snippet',
    '.msg-conversation-listitem__message-snippet',
    '.msg-overlay-list-bubble__message-snippet',
    '.msg-conversation-card__content-snippet',
    'p',
  ];

  const timestampSelectors = [
    '.msg-conversation-card__time-stamp',
    '.msg-conversation-listitem__time-stamp',
    '.msg-overlay-list-bubble__time-stamp',
    'time',
  ];

  let senderName = 'Unknown';
  let preview = '';
  let timestamp = '';

  for (const selector of nameSelectors) {
    const el = item.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      senderName = (await el.textContent().catch(() => 'Unknown')) || 'Unknown';
      senderName = senderName.trim();
      break;
    }
  }

  for (const selector of previewSelectors) {
    const el = item.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      preview = (await el.textContent().catch(() => '')) || '';
      preview = preview.trim();
      break;
    }
  }

  for (const selector of timestampSelectors) {
    const el = item.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      timestamp = (await el.textContent().catch(() => '')) || '';
      timestamp = timestamp.trim();
      break;
    }
  }

  return { senderName, preview, timestamp };
}

async function openConversations(page: Page, items: any[]): Promise<ConversationInfo[]> {
  console.log(`[STEP 3] ▶ Opening ${items.length} conversations...`);

  const conversations: ConversationInfo[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.log(`[STEP 3] Opening conversation ${i + 1}/${items.length}...`);

    const info = await extractConversationInfo(item);
    
    await item.click().catch(() => {
      console.log(`[STEP 3] ⚠ Could not click conversation ${i + 1}`);
    });

    await page.waitForTimeout(2000);

    // Check if conversation thread loaded (works for both overlay and full page)
    const messageThreadSelectors = [
      '.msg-s-message-list',
      '.msg-thread',
      '.msg-overlay-conversation-bubble',
      '[data-test-id="message-list"]',
      '.msg-s-event-listitem',
    ];

    let threadLoaded = false;
    for (const selector of messageThreadSelectors) {
      if (await page.locator(selector).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        threadLoaded = true;
        break;
      }
    }

    if (threadLoaded) {
      console.log(`[STEP 3] ✓ Opened conversation with: ${info.senderName}`);
      conversations.push(info);
    } else {
      console.log(`[STEP 3] ⚠ Conversation ${i + 1} may not have fully loaded`);
      conversations.push(info);
    }

    // Wait a bit before opening next conversation
    if (i < items.length - 1) {
      await page.waitForTimeout(1000);
    }
  }

  console.log(`[STEP 3] ✓ Opened ${conversations.length} conversations`);
  return conversations;
}

export default async function ReadPendingMessages(): Promise<ReadMessagesResult> {
  console.log('\n========================================');
  console.log('  LinkedIn Read Pending Messages');
  console.log('========================================\n');

  const config = getConfig();

  console.log(`[CONFIG] Max messages to open: ${config.maxMessages}`);

  const browser = await connectToBrowser();
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('No browser context available');
  }
  const page = context.pages()[0] || (await context.newPage());
  console.log('[BROWSER] ✓ Browser ready\n');

  try {
    console.log('--- Starting Read Messages Flow ---\n');

    const isLoggedIn = await ensureLoggedIn(page);
    if (!isLoggedIn) {
      const msg = 'User is not authenticated. Please run the authentication task first.';
      console.error(`[ERROR] ${msg}`);
      return { success: false, message: msg };
    }

    await openMessagingPanel(page);

    const unreadItems = await findUnreadConversations(page, config.maxMessages);

    if (unreadItems.length === 0) {
      const msg = 'No pending messages found';
      console.log(`\n[RESULT] ℹ ${msg}`);
      return {
        success: true,
        message: msg,
        data: {
          messagesOpened: 0,
          conversations: [],
        },
      };
    }

    const conversations = await openConversations(page, unreadItems);

    const successMsg = `Opened ${conversations.length} pending message(s)`;
    console.log('\n========================================');
    console.log('[RESULT] ✓ SUCCESS!');
    console.log(successMsg);
    console.log('========================================\n');

    return {
      success: true,
      message: successMsg,
      data: {
        messagesOpened: conversations.length,
        conversations,
      },
    };
  } catch (error: any) {
    console.error('\n[RESULT] ✗ FAILED');
    console.error('Read pending messages failed:', error?.message || error);
    return { success: false, message: error?.message || 'Unknown error reading messages' };
  }
}
