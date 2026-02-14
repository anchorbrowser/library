import AnchorBrowser from 'anchorbrowser';
import { z } from 'zod';

type Page = any;
type Browser = any;

let _anchorClient: InstanceType<typeof AnchorBrowser> | null = null;
let _config: {
  sessionId: string;
  identityId: string | undefined;
  timeoutMs: number;
} | null = null;

function getConfig() {
  if (!_config) {
    _config = {
      sessionId: process.env['ANCHOR_SESSION_ID'] || '',
      identityId: process.env['ANCHOR_IDENTITY_ID'],
      timeoutMs: parseInt(process.env['ANCHOR_TIMEOUT_MS'] || '60000', 10),
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

async function connectToBrowser(): Promise<Browser> {
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
  console.log('[CHECK] Verifying NetSweet authentication...');

  await page.goto('https://netsweet.co/', { waitUntil: 'domcontentloaded', timeout: getConfig().timeoutMs });
  await page.waitForTimeout(2000);

  const currentUrl = page.url();

  if (currentUrl.includes('/login') || currentUrl.includes('/signin')) {
    console.log('[CHECK] User is NOT authenticated - redirected to login');
    return false;
  }

  console.log('[CHECK] User appears authenticated');
  return true;
}

async function navigateToDataCenter(page: Page): Promise<void> {
  console.log('[STEP 1] Navigating to Data Center...');

  await page.goto('https://netsweet.co/data-center', {
    waitUntil: 'domcontentloaded',
    timeout: getConfig().timeoutMs,
  });

  await page.waitForTimeout(2000);
  console.log('[STEP 1] Data Center page loaded');
}

async function countActiveOnCurrentPage(page: Page): Promise<number> {
  const count = await page.evaluate(() => {
    let activeCount = 0;

    // Strategy 1: Look for table rows with "Active" status
    const tables = document.querySelectorAll('table');
    tables.forEach((table) => {
      const rows = table.querySelectorAll('tbody tr');
      rows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        cells.forEach((cell) => {
          const text = cell.textContent?.trim().toLowerCase();
          if (text === 'active') {
            activeCount++;
          }
        });
      });
    });

    if (activeCount > 0) return activeCount;

    // Strategy 2: Look for status badges/pills with "Active"
    const statusBadges = document.querySelectorAll('.badge, .status, .pill, [data-status], [class*="status"], [class*="badge"]');
    statusBadges.forEach((badge) => {
      const text = badge.textContent?.trim().toLowerCase();
      if (text === 'active') {
        activeCount++;
      }
    });

    if (activeCount > 0) return activeCount;

    // Strategy 3: Look for any element containing exactly "Active" text
    const allElements = document.querySelectorAll('td, span, div, p');
    allElements.forEach((el) => {
      const text = el.textContent?.trim();
      if (text === 'Active' || text === 'active' || text === 'ACTIVE') {
        if (el.children.length === 0 || el.textContent!.length < 20) {
          activeCount++;
        }
      }
    });

    return activeCount;
  });

  return count;
}

async function hasNextPage(page: Page): Promise<boolean> {
  const nextButtonSelectors = [
    'button:has-text("Next")',
    'a:has-text("Next")',
    '[aria-label="Next page"]',
    '[aria-label="Go to next page"]',
    'button[aria-label*="next" i]',
    '.pagination-next:not([disabled])',
    '.next-page:not([disabled])',
    'button:has(svg[class*="chevron-right"])',
    'button:has(svg[class*="arrow-right"])',
    '[data-testid="next-page"]',
    'nav[aria-label="pagination"] button:last-child:not([disabled])',
  ];

  for (const selector of nextButtonSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      const isDisabled = await btn.isDisabled().catch(() => true);
      if (!isDisabled) {
        return true;
      }
    }
  }

  return false;
}

async function clickNextPage(page: Page): Promise<boolean> {
  const nextButtonSelectors = [
    'button:has-text("Next")',
    'a:has-text("Next")',
    '[aria-label="Next page"]',
    '[aria-label="Go to next page"]',
    'button[aria-label*="next" i]',
    '.pagination-next:not([disabled])',
    '.next-page:not([disabled])',
    'button:has(svg[class*="chevron-right"])',
    'button:has(svg[class*="arrow-right"])',
    '[data-testid="next-page"]',
    'nav[aria-label="pagination"] button:last-child:not([disabled])',
  ];

  for (const selector of nextButtonSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      const isDisabled = await btn.isDisabled().catch(() => true);
      if (!isDisabled) {
        await btn.click();
        await page.waitForTimeout(1500);
        return true;
      }
    }
  }

  return false;
}

async function countActiveContracts(page: Page): Promise<number> {
  console.log('[STEP 2] Counting active contracts across all pages...');

  await page.waitForTimeout(1000);

  let totalCount = 0;
  let currentPage = 1;
  const maxPages = 50; // Safety limit

  while (currentPage <= maxPages) {
    const pageCount = await countActiveOnCurrentPage(page);
    console.log(`[STEP 2] Page ${currentPage}: found ${pageCount} active contracts`);
    totalCount += pageCount;

    const hasMore = await hasNextPage(page);
    if (!hasMore) {
      console.log(`[STEP 2] No more pages after page ${currentPage}`);
      break;
    }

    const clicked = await clickNextPage(page);
    if (!clicked) {
      console.log(`[STEP 2] Could not click next page button`);
      break;
    }

    currentPage++;
  }

  console.log(`[STEP 2] Total active contracts across ${currentPage} pages: ${totalCount}`);
  return totalCount;
}

export default async function CountActiveContracts() {
  console.log('\n========================================');
  console.log('  NetSweet Active Contracts Counter');
  console.log('========================================\n');

  const browser = await connectToBrowser();
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('No browser context available');
  }
  const page = context.pages()[0] || (await context.newPage());
  console.log('[BROWSER] Browser ready\n');

  try {
    console.log('--- Starting Count Flow ---\n');

    // Check authentication
    const isLoggedIn = await ensureLoggedIn(page);
    if (!isLoggedIn) {
      const msg = 'User is not authenticated. Please run the authentication task first.';
      console.error(`[ERROR] ${msg}`);
      return { success: false, message: msg, activeContractsCount: 0 };
    }

    // Navigate to Data Center
    await navigateToDataCenter(page);

    // Count active contracts
    const activeCount = await countActiveContracts(page);

    console.log('\n========================================');
    console.log(`[RESULT] Active contracts: ${activeCount}`);
    console.log('========================================\n');

    return {
      success: true,
      message: `Found ${activeCount} active contracts`,
      activeContractsCount: activeCount,
    };
  } catch (error: any) {
    console.error('\n[RESULT] FAILED');
    console.error('Count failed:', error?.message || error);
    return { success: false, message: error?.message || 'Unknown error', activeContractsCount: 0 };
  }
}
