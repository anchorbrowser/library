import AnchorBrowser from 'anchorbrowser';
import { z } from 'zod';

type Page = any;
type Browser = any;

let _anchorClient: InstanceType<typeof AnchorBrowser> | null = null;
let _config: {
  sessionId: string;
  identityId: string | undefined;
  reportTypes: string[];
  timeoutMs: number;
} | null = null;

function getConfig() {
  if (!_config) {
    let toolInput: Record<string, any> = {};
    try {
      const toolInputStr = process.env['ANCHOR_TOOL_INPUT'];
      if (toolInputStr) {
        toolInput = JSON.parse(toolInputStr);
      }
    } catch (e) {
      // Ignore parse errors
    }

    const reportTypesRaw = toolInput['Report Types'] || process.env['ANCHOR_REPORT_TYPES'] || '';
    const reportTypes = Array.isArray(reportTypesRaw)
      ? reportTypesRaw.map((t: string) => t.trim().toLowerCase())
      : reportTypesRaw
          .split(',')
          .map((t: string) => t.trim().toLowerCase())
          .filter(Boolean);

    _config = {
      sessionId: process.env['ANCHOR_SESSION_ID'] || '',
      identityId: process.env['ANCHOR_IDENTITY_ID'],
      reportTypes,
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

const InputSchema = z.object({
  reportTypes: z.array(z.string()).min(1, 'At least one report type is required'),
});

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

interface ReportInfo {
  id: string;
  name: string;
  type: string;
  url: string;
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

  // Check for dashboard or authenticated indicators
  const authIndicators = [
    '[data-testid="user-menu"]',
    '[aria-label="User menu"]',
    '[aria-label="Account"]',
    'nav a[href="/reports"]',
    'a[href="/dashboard"]',
    '[data-testid="sidebar"]',
  ];

  for (const selector of authIndicators) {
    if (await page.locator(selector).first().isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`[CHECK] User is authenticated (found: ${selector})`);
      return true;
    }
  }

  // If not on login page and page loaded, assume authenticated
  console.log('[CHECK] Assuming authenticated (not on login page)');
  return true;
}

async function navigateToReports(page: Page): Promise<void> {
  console.log('[STEP 1] Navigating to Reports page...');

  await page.goto('https://netsweet.co/reports', {
    waitUntil: 'networkidle',
    timeout: getConfig().timeoutMs,
  });

  // Wait for React to render the content
  await page.waitForTimeout(3000);

  // Try to wait for actual content indicators
  try {
    await page.waitForSelector('h1, h2, [data-testid*="report"], a[href*="/reports/rpt-"]', { timeout: 5000 });
  } catch {
    // Content may already be loaded, continue
  }

  console.log('[STEP 1] Reports page loaded');
}

async function extractReportsFromPage(page: Page): Promise<ReportInfo[]> {
  console.log('[STEP 2] Extracting reports from page...');

  // Debug: log current URL and page title
  const currentUrl = page.url();
  const title = await page.title();
  console.log(`[DEBUG] Current URL: ${currentUrl}`);
  console.log(`[DEBUG] Page title: ${title}`);

  // Wait for the page content to load - try multiple selectors
  const contentSelectors = [
    'a[href*="/reports/rpt-"]',
    'table',
    '[class*="report"]',
    '[data-testid*="report"]',
    'main table',
    'main tbody tr',
  ];

  let foundSelector = '';
  for (const selector of contentSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 3000 });
      foundSelector = selector;
      console.log(`[DEBUG] Found content with selector: ${selector}`);
      break;
    } catch {
      // Try next selector
    }
  }

  if (!foundSelector) {
    console.log('[DEBUG] No expected content selectors found, will try generic extraction');
  }

  // Additional wait for React to fully render
  await page.waitForTimeout(2000);

  // Debug: dump page structure
  const debugInfo = await page.evaluate(() => {
    const info: string[] = [];
    info.push(`All links on page: ${document.querySelectorAll('a').length}`);
    info.push(`Links with href containing "report": ${document.querySelectorAll('a[href*="report"]').length}`);
    info.push(`Tables: ${document.querySelectorAll('table').length}`);
    info.push(`Table rows: ${document.querySelectorAll('tr').length}`);

    // Sample some links
    const allLinks = document.querySelectorAll('a');
    const sampleLinks: string[] = [];
    allLinks.forEach((a, i) => {
      if (i < 10) {
        sampleLinks.push(`${a.textContent?.trim().substring(0, 30)} -> ${a.getAttribute('href')}`);
      }
    });
    info.push(`Sample links: ${sampleLinks.join(' | ')}`);

    // Check for any elements with "report" in class or id
    const reportElements = document.querySelectorAll('[class*="report" i], [id*="report" i]');
    info.push(`Elements with "report" in class/id: ${reportElements.length}`);

    return info;
  });

  debugInfo.forEach((line: string) => console.log(`[DEBUG] ${line}`));

  const reports = await page.evaluate(() => {
    const results: { id: string; name: string; type: string; url: string }[] = [];
    const knownTypes = ['hr', 'financial', 'operations', 'marketing', 'client services', 'technology'];

    // Strategy 1: Find all links that might be reports
    const allLinks = document.querySelectorAll('a');
    allLinks.forEach((link) => {
      const href = link.getAttribute('href') || '';

      // Check if it's a report link
      const idMatch = href.match(/\/reports\/(rpt-\d+)/);
      if (!idMatch || !idMatch[1]) return;

      const id = idMatch[1];
      const name = link.textContent?.trim() || id;

      // Walk up to find row/container for type
      let container: Element | null = link;
      for (let i = 0; i < 10 && container; i++) {
        const tag = container.tagName;
        if (tag === 'TR' || tag === 'LI' || container.getAttribute('role') === 'row') {
          break;
        }
        // Also check for div that looks like a row
        if (tag === 'DIV' && container.children.length >= 3) {
          break;
        }
        container = container.parentElement;
      }

      let type = 'unknown';
      if (container && container !== link) {
        const containerText = container.textContent?.toLowerCase() || '';
        for (const kt of knownTypes) {
          // Match whole word or as part of compound
          const regex = new RegExp(`\\b${kt}\\b`);
          if (regex.test(containerText)) {
            type = kt;
            break;
          }
        }
      }

      results.push({
        id,
        name: name.substring(0, 100),
        type,
        url: href.startsWith('http') ? href : `https://netsweet.co${href}`,
      });
    });

    // Strategy 2: If no links found, look for table rows with report-like content
    if (results.length === 0) {
      const rows = document.querySelectorAll('table tr, [role="row"]');
      rows.forEach((row, index) => {
        if (index === 0) return; // Skip header row

        const cells = row.querySelectorAll('td, [role="cell"], > div');
        if (cells.length < 2) return;

        const firstCellText = cells[0]?.textContent?.trim() || '';
        const link = row.querySelector('a');
        const href = link?.getAttribute('href') || '';

        // Generate an ID if we can't find one
        const idMatch = href.match(/\/(rpt-\d+)/);
        const id = idMatch?.[1] || `row-${index}`;

        // Find type from cells
        let type = 'unknown';
        const rowText = row.textContent?.toLowerCase() || '';
        for (const kt of knownTypes) {
          const regex = new RegExp(`\\b${kt}\\b`);
          if (regex.test(rowText)) {
            type = kt;
            break;
          }
        }

        if (firstCellText && firstCellText.length > 2) {
          results.push({
            id,
            name: firstCellText.substring(0, 100),
            type,
            url: href.startsWith('http') ? href : href ? `https://netsweet.co${href}` : '',
          });
        }
      });
    }

    return results;
  });

  // Deduplicate by ID
  const uniqueReports = reports.reduce((acc: ReportInfo[], r: ReportInfo) => {
    if (!acc.find((x) => x.id === r.id)) acc.push(r);
    return acc;
  }, []);

  console.log(`[STEP 2] Found ${uniqueReports.length} reports on page`);
  if (uniqueReports.length > 0) {
    console.log('[STEP 2] Report types found:', [...new Set(uniqueReports.map((r: ReportInfo) => r.type))].join(', '));
  }
  return uniqueReports;
}

async function filterReportsByType(reports: ReportInfo[], targetTypes: string[]): Promise<ReportInfo[]> {
  console.log(`[STEP 3] Filtering reports by types: ${targetTypes.join(', ')}`);

  // If no specific types, return all
  if (targetTypes.length === 0 || (targetTypes.length === 1 && targetTypes[0] === '')) {
    console.log('[STEP 3] No type filter - returning all reports');
    return reports;
  }

  const filtered = reports.filter((r) => {
    const reportType = r.type.toLowerCase();
    return targetTypes.some((t) => reportType.includes(t) || t.includes(reportType) || reportType === t);
  });

  console.log(`[STEP 3] ${filtered.length} reports match the specified types`);
  return filtered;
}

async function downloadReport(page: Page, report: ReportInfo): Promise<boolean> {
  console.log(`[DOWNLOAD] Processing report: ${report.name} (${report.id})`);

  try {
    // Navigate to report detail page
    await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: getConfig().timeoutMs });
    await page.waitForTimeout(1500);

    // Look for download button/link
    const downloadSelectors = [
      'button:has-text("Download")',
      'a:has-text("Download")',
      '[data-testid="download-button"]',
      '[aria-label*="download" i]',
      '[aria-label*="Download" i]',
      'button:has-text("Export")',
      'a:has-text("Export")',
      '.download-btn',
      '.export-btn',
      'button[title*="Download" i]',
      'a[download]',
      '[data-action="download"]',
    ];

    for (const selector of downloadSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`[DOWNLOAD] Found download control: ${selector}`);
        await btn.click();
        console.log(`[DOWNLOAD] Clicked download for ${report.id}`);
        await page.waitForTimeout(2000);
        return true;
      }
    }

    console.log(`[DOWNLOAD] No download button found for ${report.id}`);
    return false;
  } catch (error: any) {
    console.error(`[DOWNLOAD] Error downloading ${report.id}:`, error?.message);
    return false;
  }
}

export default async function DownloadNetSweetReports() {
  console.log('\n========================================');
  console.log('  NetSweet Reports Download Tool');
  console.log('========================================\n');

  const config = getConfig();

  // Validate inputs
  const inputValidation = InputSchema.safeParse({
    reportTypes: config.reportTypes,
  });

  if (!inputValidation.success) {
    const errors = inputValidation.error.errors.map((e) => e.message).join(', ');
    console.error(`[ERROR] Invalid inputs: ${errors}`);
    return { success: false, message: `Invalid inputs: ${errors}`, downloadedCount: 0 };
  }

  console.log('[CONFIG] Report types filter:', config.reportTypes.length > 0 ? config.reportTypes.join(', ') : 'all');

  // Connect to browser
  const browser = await connectToBrowser();
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('No browser context available');
  }
  const page = context.pages()[0] || (await context.newPage());
  console.log('[BROWSER] Browser ready\n');

  try {
    console.log('--- Starting Download Flow ---\n');

    // Check authentication
    const isLoggedIn = await ensureLoggedIn(page);
    if (!isLoggedIn) {
      const msg = 'User is not authenticated. Please run the authentication task first.';
      console.error(`[ERROR] ${msg}`);
      return { success: false, message: msg, downloadedCount: 0 };
    }

    // Navigate to reports
    await navigateToReports(page);

    // Extract reports
    const allReports = await extractReportsFromPage(page);

    if (allReports.length === 0) {
      const msg = 'No reports found on the page';
      console.log(`[RESULT] ${msg}`);
      return { success: true, message: msg, downloadedCount: 0 };
    }

    // Filter by type
    const filteredReports = await filterReportsByType(allReports, config.reportTypes);

    if (filteredReports.length === 0) {
      const msg = `No reports found matching types: ${config.reportTypes.join(', ')}`;
      console.log(`[RESULT] ${msg}`);
      return { success: true, message: msg, downloadedCount: 0 };
    }

    // Download each report
    console.log(`\n[STEP 4] Downloading ${filteredReports.length} reports...\n`);

    let downloadedCount = 0;

    for (const report of filteredReports) {
      const success = await downloadReport(page, report);
      if (success) {
        downloadedCount++;
      }
      // Small delay between downloads
      await page.waitForTimeout(500);
    }

    console.log('\n========================================');
    console.log(`[RESULT] Downloaded: ${downloadedCount}/${filteredReports.length}`);
    console.log('========================================\n');

    return {
      success: downloadedCount > 0,
      message: `Downloaded ${downloadedCount} of ${filteredReports.length} reports`,
      downloadedCount,
    };
  } catch (error: any) {
    console.error('\n[RESULT] FAILED');
    console.error('Download process failed:', error?.message || error);
    return { success: false, message: error?.message || 'Unknown error', downloadedCount: 0 };
  }
}
