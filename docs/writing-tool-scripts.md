# Writing Tool Scripts

This document provides a complete guide to writing tool scripts for the browser automation library.

## Tool Execution Flow

When a tool is executed, this sequence occurs:

1. `runTool` → `runToolWorkflow` → `startAuthenticatedSessionActivity` (creates session with identity)
2. **Auth task runs on new session** (if needed)
3. `runToolTaskActivity` **executes tool task on the authenticated session**
4. **Tool task should verify auth state before proceeding**

Tools always run AFTER authentication. They expect an authenticated browser session.

## Environment Variables

Tool scripts receive these environment variables:

| Variable | Description |
|----------|-------------|
| `ANCHOR_SESSION_ID` | Browser session ID |
| `ANCHOR_IDENTITY_ID` | Identity ID (for auth tasks) |
| `ANCHOR_TOOL_INPUT` | JSON object with tool input parameters |
| `ANCHOR_TOOL_DETAILS` | JSON with applicationUrl, goal, schemas |

## Reading Tool Inputs

**CRITICAL**: Tool inputs are passed via `ANCHOR_TOOL_INPUT` environment variable as JSON. The keys match the `display_name` from your `inputSchema`.

### Exact Code Pattern

```typescript
function getConfig() {
  let toolInput: Record<string, string> = {};
  try {
    const toolInputStr = process.env['ANCHOR_TOOL_INPUT'];
    if (toolInputStr) {
      toolInput = JSON.parse(toolInputStr);
    }
  } catch (e) {
    // Ignore parse errors
  }

  return {
    sessionId: process.env['ANCHOR_SESSION_ID'] || '',
    identityId: process.env['ANCHOR_IDENTITY_ID'],
    // Keys match the display_name from input_schema
    recipientName: toolInput['Recipient Name'] || '',
    message: toolInput['Message Text'] || '',
    maxItems: parseInt(toolInput['maxItems'] || '5', 10),
  };
}
```

### Input Schema Definition

In your `template.json`:

```json
{
  "inputSchema": [
    {
      "display_name": "Recipient Name",
      "type": "string",
      "required": true,
      "description": "The name of the user to message"
    },
    {
      "display_name": "Message Text",
      "type": "string",
      "required": false,
      "description": "The message content",
      "default_value": "Hi!"
    },
    {
      "display_name": "maxItems",
      "type": "number",
      "required": false,
      "description": "Maximum items to process",
      "default_value": "5"
    }
  ]
}
```

**Important**: The `display_name` becomes the key in `ANCHOR_TOOL_INPUT`:
```json
{
  "Recipient Name": "John Doe",
  "Message Text": "Hello!",
  "maxItems": "10"
}
```

## Browser Connection

Tools connect to an existing authenticated session:

```typescript
import AnchorBrowser from 'anchorbrowser';

let _anchorClient: InstanceType<typeof AnchorBrowser> | null = null;

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
```

## Verifying Authentication

**Always verify auth state before proceeding** with tool actions:

```typescript
async function ensureLoggedIn(page: Page): Promise<boolean> {
  console.log('[CHECK] ▶ Verifying authentication...');

  // Navigate to app home
  await page.goto('https://www.example.com/', { 
    waitUntil: 'domcontentloaded', 
    timeout: 30000 
  });

  await page.waitForTimeout(3000);

  const currentUrl = page.url();
  
  // Check for login redirect
  if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
    console.log('[CHECK] ✗ User is NOT authenticated - redirected to login');
    return false;
  }

  // Check for authenticated indicators
  const authIndicators = [
    '[aria-label="Your profile"]',
    '[aria-label="Account"]',
    '[data-testid="user-menu"]',
    'nav[aria-label="Primary Navigation"]',
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
```

## Navigation Rules

**CRITICAL**: Use `domcontentloaded`, NEVER `networkidle`:

```typescript
// CORRECT
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

// WRONG - will timeout on social media sites
await page.goto(url, { waitUntil: 'networkidle' });
```

## Tool Action Patterns

### Navigating to a Page

```typescript
async function navigateToMessaging(page: Page): Promise<void> {
  console.log('[STEP 1] ▶ Navigating to Messaging...');

  await page.goto('https://www.example.com/messages/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Wait for page to load
  await page.waitForTimeout(2000);
  console.log('[STEP 1] ✓ Messaging loaded');
}
```

### Finding and Clicking Elements

```typescript
async function clickElement(page: Page, description: string): Promise<boolean> {
  console.log(`[ACTION] ▶ Clicking ${description}...`);

  const selectors = [
    '[aria-label="New message"]',
    'button:has-text("New message")',
    '[data-testid="new-message-button"]',
  ];

  for (const selector of selectors) {
    const element = page.locator(selector).first();
    if (await element.isVisible({ timeout: 3000 }).catch(() => false)) {
      await element.click();
      console.log(`[ACTION] ✓ Clicked: ${selector}`);
      return true;
    }
  }

  console.log(`[ACTION] ✗ Could not find ${description}`);
  return false;
}
```

### Typing Text

```typescript
async function typeIntoField(page: Page, text: string): Promise<void> {
  const inputSelectors = [
    '[aria-label="Message"]',
    'div[role="textbox"][contenteditable="true"]',
    'textarea[placeholder*="message" i]',
  ];

  for (const selector of inputSelectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible({ timeout: 5000 }).catch(() => false)) {
      await input.click();
      await input.fill(text);
      console.log(`[ACTION] ✓ Typed text into: ${selector}`);
      return;
    }
  }

  throw new Error('Message input field not found');
}
```

### Extracting Information

```typescript
async function extractConversationInfo(item: any): Promise<{ name: string; preview: string }> {
  const nameSelectors = [
    '.participant-name',
    '[data-testid="conversation-title"]',
    'h3',
  ];

  let name = 'Unknown';
  for (const selector of nameSelectors) {
    const el = item.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      name = (await el.textContent().catch(() => 'Unknown')) || 'Unknown';
      name = name.trim();
      break;
    }
  }

  return { name, preview: '' };
}
```

## Return Value Structure

Tools should return a result object:

```typescript
interface ToolResult {
  success: boolean;
  message: string;
  data?: {
    // Tool-specific output data
    [key: string]: any;
  };
}

// Success with data
return {
  success: true,
  message: 'Successfully sent message to John',
  data: {
    recipient: 'John Doe',
    messageSent: true,
  },
};

// Failure
return {
  success: false,
  message: 'User is not authenticated. Please run the authentication task first.',
};
```

## Output Schema Definition

In your `template.json`:

```json
{
  "outputSchema": [
    {
      "display_name": "messageSent",
      "type": "boolean",
      "required": true,
      "description": "Whether the message was successfully sent"
    },
    {
      "display_name": "conversationId",
      "type": "string",
      "required": false,
      "description": "ID of the conversation"
    }
  ]
}
```

## Complete Tool Script Template

```typescript
import AnchorBrowser from 'anchorbrowser';
import { z } from 'zod';

type Page = any;

let _anchorClient: InstanceType<typeof AnchorBrowser> | null = null;
let _config: {
  sessionId: string;
  identityId: string | undefined;
  recipientName: string;
  message: string;
  timeoutMs: number;
} | null = null;

interface ToolResult {
  success: boolean;
  message: string;
  data?: {
    recipient?: string;
    messageSent?: boolean;
  };
}

function getConfig() {
  if (!_config) {
    // Parse ANCHOR_TOOL_INPUT
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
      // Keys match display_name from inputSchema
      recipientName: toolInput['Recipient Name'] || '',
      message: toolInput['Message Text'] || 'Hi!',
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

// Input validation
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

  if (config.identityId) {
    console.log(`[BROWSER] Creating new session with identity: ${config.identityId}`);
    return await client.browser.create({
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

async function ensureLoggedIn(page: Page): Promise<boolean> {
  console.log('[CHECK] ▶ Verifying authentication...');

  await page.goto('https://www.example.com/', {
    waitUntil: 'domcontentloaded',
    timeout: getConfig().timeoutMs,
  });

  await page.waitForTimeout(3000);

  const currentUrl = page.url();

  if (currentUrl.includes('/login')) {
    console.log('[CHECK] ✗ User is NOT authenticated');
    return false;
  }

  console.log('[CHECK] ✓ User appears authenticated');
  return true;
}

// Add your tool-specific action functions here...

export default async function SendMessage(): Promise<ToolResult> {
  console.log('\n========================================');
  console.log('  Send Message Automation');
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
    console.log('--- Starting Tool Flow ---\n');

    // Check if logged in
    const isLoggedIn = await ensureLoggedIn(page);
    if (!isLoggedIn) {
      const msg = 'User is not authenticated. Please run the authentication task first.';
      console.error(`[ERROR] ${msg}`);
      return { success: false, message: msg };
    }

    // Step 1: Navigate to destination
    // await navigateToMessaging(page);

    // Step 2: Perform action
    // await searchForRecipient(page, config.recipientName);

    // Step 3: Complete action
    // await sendMessage(page, config.message);

    // Step 4: Verify success
    // const sent = await verifyMessageSent(page);

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
        messageSent: true,
      },
    };
  } catch (error: any) {
    console.error('\n[RESULT] ✗ FAILED');
    console.error('Tool failed:', error?.message || error);
    return { success: false, message: error?.message || 'Unknown error' };
  }
}
```

## Corresponding template.json

```json
{
  "slug": "send-message",
  "name": "Send Message",
  "description": "Send a message to a user.",
  "type": "tool",
  "file": "send-message.ts",
  "app": "your-app-id",
  "inputSchema": [
    {
      "display_name": "Recipient Name",
      "type": "string",
      "required": true,
      "description": "The name of the user to message"
    },
    {
      "display_name": "Message Text",
      "type": "string",
      "required": false,
      "description": "The message to send",
      "default_value": "Hi!"
    }
  ],
  "outputSchema": [
    {
      "display_name": "messageSent",
      "type": "boolean",
      "required": true,
      "description": "Whether the message was successfully sent"
    }
  ],
  "requiredCredentials": [],
  "optionalCredentials": []
}
```
