# Patterns and Selectors

This document covers common UI automation patterns, selector strategies, and platform-specific examples.

## Critical Navigation Rule

**NEVER use `networkidle` for social media sites.**

Social media platforms (Facebook, LinkedIn, Twitter, etc.) have constant background activity (WebSocket connections, polling, analytics) and will NEVER reach the "networkidle" state.

```typescript
// ✅ CORRECT - Always use this
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

// ❌ WRONG - Will timeout on social media
await page.goto(url, { waitUntil: 'networkidle' });
await page.goto(url, { waitUntil: 'networkidle0' });
await page.goto(url, { waitUntil: 'networkidle2' });
```

## Selector Strategies

### Priority Order

Use selectors in this order of preference:

1. **ARIA labels** - Most stable, accessibility-focused
2. **Data-test attributes** - Explicitly for testing
3. **Role + text** - Semantic and readable
4. **ID selectors** - If stable and not auto-generated
5. **Class patterns** - Less stable, use as fallback

### ARIA Label Selectors

```typescript
// Best practice - accessibility labels are stable
'[aria-label="Send message"]'
'[aria-label="Your profile"]'
'[aria-label="Messaging"]'
'[aria-label="New message"]'
```

### Data-Test Selectors

```typescript
// Good - explicitly for testing
'[data-testid="send-button"]'
'[data-test-id="conversation-list"]'
'[data-test-icon="nav-messaging-icon"]'
```

### Role + Text Selectors

```typescript
// Good - semantic and readable
'button:has-text("Send")'
'div[role="button"]:has-text("Submit")'
'a[role="link"]:has-text("Messages")'
```

### Multiple Fallback Selectors

Always provide multiple selector options:

```typescript
async function findElement(page: Page, description: string): Promise<any> {
  const selectors = [
    '[aria-label="Send message"]',           // Preferred
    '[data-testid="send-button"]',           // Test attribute
    'button:has-text("Send")',               // Role + text
    '.msg-form__send-button',                // Class fallback
  ];

  for (const selector of selectors) {
    const element = page.locator(selector).first();
    if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
      return element;
    }
  }

  throw new Error(`Could not find ${description}`);
}
```

## Waiting Strategies

### Wait for Selector

```typescript
// Wait for element to be visible
await page.waitForSelector('[aria-label="Messages"]', { 
  state: 'visible', 
  timeout: 10000 
});

// Wait for element to be attached (even if not visible)
await page.waitForSelector('.loading-spinner', { 
  state: 'attached', 
  timeout: 5000 
});

// Wait for element to disappear
await page.waitForSelector('.loading-spinner', { 
  state: 'hidden', 
  timeout: 30000 
});
```

### Wait for URL

```typescript
// Wait for navigation to complete
await page.waitForURL('**/feed/**', { timeout: 30000 });

// With pattern matching
await page.waitForURL(/linkedin\.com\/feed\//, { timeout: 30000 });
```

### Wait for Timeout

Use sparingly - only when no better option exists:

```typescript
// Wait for dynamic content to settle
await page.waitForTimeout(2000);

// Short wait between actions
await page.waitForTimeout(500);
```

### Wait for Network

```typescript
// Wait for specific API response
await page.waitForResponse(
  response => response.url().includes('/api/messages') && response.status() === 200,
  { timeout: 10000 }
);
```

## Error Handling Patterns

### Safe Element Check

```typescript
async function isElementVisible(page: Page, selector: string, timeout = 3000): Promise<boolean> {
  return await page.locator(selector).first()
    .isVisible({ timeout })
    .catch(() => false);
}
```

### Safe Click

```typescript
async function safeClick(page: Page, selector: string): Promise<boolean> {
  try {
    const element = page.locator(selector).first();
    if (await element.isVisible({ timeout: 3000 })) {
      await element.click();
      return true;
    }
  } catch {
    // Element not found or not clickable
  }
  return false;
}
```

### Safe Text Extraction

```typescript
async function safeGetText(element: any): Promise<string> {
  try {
    const text = await element.textContent();
    return text?.trim() || '';
  } catch {
    return '';
  }
}
```

## Retry Patterns

### Simple Retry

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.log(`Attempt ${attempt} failed: ${lastError.message}`);
      
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  throw lastError;
}

// Usage
const element = await withRetry(() => findElement(page, 'Send button'));
```

## Extracting Text Content

```typescript
async function extractText(item: any, selectors: string[]): Promise<string> {
  for (const selector of selectors) {
    const el = item.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      const text = await el.textContent().catch(() => null);
      if (text) {
        return text.trim();
      }
    }
  }
  return '';
}

// Usage
const name = await extractText(conversationItem, [
  '.participant-name',
  '[data-testid="conversation-title"]',
  'h3',
]);
```

## Platform-Specific Selectors

### LinkedIn

```typescript
// Navigation
const linkedinNav = {
  messagingIcon: '[data-test-icon="nav-messaging-icon"]',
  notificationsIcon: '[data-test-icon="nav-notifications-icon"]',
  profileMenu: '.global-nav__me-photo',
  searchBar: 'input[aria-label="Search"]',
};

// Messaging
const linkedinMessaging = {
  conversationList: '.msg-conversations-container',
  conversationItem: 'li.msg-conversation-listitem',
  unreadBadge: '.msg-conversation-card__unread-count',
  messageList: '.msg-s-message-list',
  messageInput: '.msg-form__contenteditable',
  sendButton: '.msg-form__send-button',
  participantName: '.msg-conversation-card__participant-names',
  messageSnippet: '.msg-conversation-card__message-snippet',
  timestamp: '.msg-conversation-card__time-stamp',
};

// Login
const linkedinLogin = {
  usernameInput: 'input#username[name="session_key"]',
  passwordInput: 'input#password[name="session_password"]',
  submitButton: 'button[type="submit"]',
  otpInput: 'input[name="pin"]',
};

// Overlay (messaging panel on feed)
const linkedinOverlay = {
  messagingBubble: '.msg-overlay-bubble-header',
  conversationCard: '.msg-overlay-list-bubble__convo-card',
  unreadCard: '.msg-overlay-list-bubble__convo-card--unread',
};
```

### Facebook

```typescript
// Navigation
const facebookNav = {
  messengerIcon: '[aria-label="Messenger"]',
  notificationsIcon: '[aria-label="Notifications"]',
  profileMenu: '[aria-label="Account"]',
  searchBar: '[aria-label="Search Facebook"]',
};

// Messenger
const facebookMessenger = {
  conversationList: '[data-pagelet="MWThreadList"]',
  newMessageButton: '[aria-label="New message"]',
  messageInput: '[aria-label="Message"]',
  sendButton: '[aria-label="Press enter to send"]',
  searchInput: 'input[placeholder*="Search" i]',
};

// Login
const facebookLogin = {
  emailInput: 'input#email',
  passwordInput: 'input#pass',
  loginButton: 'button[name="login"]',
};

// Auth indicators
const facebookAuth = {
  profileLink: '[aria-label="Your profile"]',
  accountMenu: '[aria-label="Account Controls and Settings"]',
  leftRail: '[data-pagelet="LeftRail"]',
};
```

## Form Interaction Patterns

### Input Fields

```typescript
async function fillInput(page: Page, selector: string, value: string): Promise<void> {
  const input = page.locator(selector).first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.click();
  await input.fill(''); // Clear first
  await input.fill(value);
}
```

### Contenteditable Divs

Many modern apps use contenteditable divs instead of inputs:

```typescript
async function fillContentEditable(page: Page, selector: string, text: string): Promise<void> {
  const element = page.locator(selector).first();
  await element.waitFor({ state: 'visible', timeout: 5000 });
  await element.click();
  await element.fill(text);
  // Or for more complex cases:
  // await element.pressSequentially(text, { delay: 50 });
}
```

### Dropdowns/Selects

```typescript
async function selectOption(page: Page, selector: string, value: string): Promise<void> {
  await page.selectOption(selector, value);
  // Or for custom dropdowns:
  await page.locator(selector).click();
  await page.locator(`[role="option"]:has-text("${value}")`).click();
}
```

## Scrolling Patterns

### Scroll to Element

```typescript
async function scrollToElement(page: Page, selector: string): Promise<void> {
  const element = page.locator(selector).first();
  await element.scrollIntoViewIfNeeded();
}
```

### Scroll to Load More

```typescript
async function scrollToLoadMore(page: Page, containerSelector: string, maxScrolls = 5): Promise<void> {
  const container = page.locator(containerSelector);
  
  for (let i = 0; i < maxScrolls; i++) {
    await container.evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(1000);
  }
}
```

## Keyboard Navigation

```typescript
// Tab through elements
await element.press('Tab');

// Submit form
await element.press('Enter');

// Keyboard shortcuts
await page.keyboard.press('Control+Enter'); // Send in some apps
await page.keyboard.press('Escape'); // Close modal

// Type with delays (for apps that need it)
await element.pressSequentially('Hello', { delay: 100 });
```
