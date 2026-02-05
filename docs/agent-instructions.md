# Agent Instructions

This document provides meta-instructions for AI agents to generate browser automation scripts from mitmproxy recordings.

## Overview

You are generating browser automation code for the Anchor browser automation library. Given a mitmproxy `.mitm` recording and a description of the desired automation, you will produce:

1. A TypeScript script (`.ts`) that performs the automation
2. A template JSON file (`.template.json`) with metadata

## Workflow

### Step 1: Analyze the Recording

Extract information from the mitmproxy recording:

```bash
# Find the target domain
strings flows.mitm | grep -i "linkedin.com\|facebook.com" | head -10

# Find API endpoints
strings flows.mitm | grep -iE "api|graphql|voyager" | head -50

# Find action-related calls
strings flows.mitm | grep -iE "message|login|send|post" | head -50
```

Identify:
- **Target URLs**: Where did the user navigate?
- **API calls**: What data was fetched/submitted?
- **Action sequence**: What was the order of operations?
- **Request bodies**: What data was sent?

### Step 2: Determine Script Type

| If the user... | Create a... |
|----------------|-------------|
| Logs in to an app | Auth script |
| Performs an action (send message, read data, etc.) | Tool script |

### Step 3: Map API Calls to UI Actions

| API Pattern | UI Action Needed |
|-------------|------------------|
| GET /feed | Navigate to feed |
| GET /messaging | Navigate to messages |
| POST with credentials | Fill and submit login form |
| POST with message content | Type and send message |
| PATCH with read:true | Click/open message to mark as read |
| GET conversations | Open messaging panel |

### Step 4: Identify Required Selectors

From the API calls, identify what UI elements need selectors:
- Navigation elements (messaging icon, profile menu)
- Input fields (username, password, message box)
- Buttons (submit, send)
- List items (conversations, messages)
- Status indicators (unread badges)

### Step 5: Generate the Code

Use the templates from this documentation:
- `writing-auth-scripts.md` for auth scripts
- `writing-tool-scripts.md` for tool scripts
- `patterns-and-selectors.md` for selector patterns

## Decision Rules

### When to Navigate vs Use UI

**Navigate directly when:**
- Going to a main page (/feed, /messaging, /profile)
- The URL is stable and known
- Speed is important

**Use UI interaction when:**
- Opening modals or overlays
- The action involves clicking through menus
- The target isn't a direct URL

### When to Use Which Selector Type

1. **ARIA labels first**: `[aria-label="Send"]` - most stable
2. **Data-test attributes**: `[data-testid="send-btn"]` - explicitly for testing
3. **Role + text**: `button:has-text("Send")` - semantic
4. **Classes last**: `.btn-send` - least stable

### Input Schema Decisions

| Parameter Type | When to Use |
|----------------|-------------|
| `string` | Names, messages, IDs |
| `number` | Counts, limits, amounts |
| `boolean` | Flags, toggles |
| `date` | Dates, timestamps |

Mark as `required: true` if the tool cannot function without it.

## Validation Checklist

Before outputting code, verify:

### Template JSON

- [ ] `slug` matches filename (without `.template.json`)
- [ ] `type` matches parent directory (`auth` or `tool`)
- [ ] `app` matches nearest `app.json` id
- [ ] `file` points to existing `.ts` file
- [ ] `inputSchema` uses valid types (string, number, boolean, date)
- [ ] `display_name` fields are clear and consistent

### TypeScript Code

- [ ] Uses `domcontentloaded`, NOT `networkidle`
- [ ] Auth scripts fetch credentials via `client.identities.retrieveCredentials()`
- [ ] Tool scripts parse `ANCHOR_TOOL_INPUT` for inputs
- [ ] Input keys match `display_name` from inputSchema
- [ ] Returns `{ success: boolean, message: string }`
- [ ] Has proper error handling with try/catch
- [ ] Includes logging with step indicators
- [ ] Verifies auth state before tool actions

## Common Pitfalls to Avoid

### 1. Using networkidle

```typescript
// ❌ WRONG - will timeout
await page.goto(url, { waitUntil: 'networkidle' });

// ✅ CORRECT
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
```

### 2. Hardcoding credentials

```typescript
// ❌ WRONG - never hardcode
const password = 'secret123';

// ✅ CORRECT - fetch from API
const creds = await client.identities.retrieveCredentials(identityId);
```

### 3. Wrong input key names

```typescript
// ❌ WRONG - key doesn't match inputSchema
const recipient = toolInput['recipient'];

// ✅ CORRECT - matches "display_name": "Recipient Name"
const recipient = toolInput['Recipient Name'];
```

### 4. Missing auth verification in tools

```typescript
// ❌ WRONG - proceeds without checking auth
async function doTool() {
  await navigateToMessages(page);
  // ...
}

// ✅ CORRECT - verify auth first
async function doTool() {
  const isLoggedIn = await ensureLoggedIn(page);
  if (!isLoggedIn) {
    return { success: false, message: 'Not authenticated' };
  }
  await navigateToMessages(page);
  // ...
}
```

### 5. Single selector without fallbacks

```typescript
// ❌ WRONG - single selector may break
const btn = page.locator('.send-btn');

// ✅ CORRECT - multiple fallbacks
const selectors = [
  '[aria-label="Send"]',
  '[data-testid="send-button"]',
  'button:has-text("Send")',
  '.send-btn',
];
for (const sel of selectors) {
  if (await page.locator(sel).isVisible().catch(() => false)) {
    return page.locator(sel);
  }
}
```

### 6. Not handling task ID as UUID

```typescript
// ❌ WRONG - using name as ID
task_id: "send-message"

// ✅ CORRECT - must be UUID
task_id: "123e4567-e89b-12d3-a456-426614174000"
```

## Output Format

### For Auth Scripts

Generate two files:

**`{name}.ts`**:
```typescript
import AnchorBrowser, { type Anchorbrowser } from 'anchorbrowser';
import { z } from 'zod';
import type { Browser, Page } from 'playwright';

// ... (use template from writing-auth-scripts.md)

export default async function LoginToApp(): Promise<LoginResult> {
  // ...
}
```

**`{name}.template.json`**:
```json
{
  "slug": "{name}",
  "name": "Human Readable Name",
  "description": "What this auth flow does.",
  "type": "auth",
  "file": "{name}.ts",
  "app": "{app-id}",
  "requiredCredentials": ["username_password"],
  "optionalCredentials": ["authenticator"]
}
```

### For Tool Scripts

Generate two files:

**`{name}.ts`**:
```typescript
import AnchorBrowser from 'anchorbrowser';
import { z } from 'zod';

// ... (use template from writing-tool-scripts.md)

export default async function ToolName(): Promise<ToolResult> {
  // ...
}
```

**`{name}.template.json`**:
```json
{
  "slug": "{name}",
  "name": "Human Readable Name",
  "description": "What this tool does.",
  "type": "tool",
  "file": "{name}.ts",
  "app": "{app-id}",
  "inputSchema": [
    {
      "display_name": "Parameter Name",
      "type": "string",
      "required": true,
      "description": "What this parameter is for"
    }
  ],
  "outputSchema": [
    {
      "display_name": "result",
      "type": "boolean",
      "required": true,
      "description": "Whether the action succeeded"
    }
  ],
  "requiredCredentials": [],
  "optionalCredentials": []
}
```

## File Placement

Place files in the correct location:

```
src/apps/{app-id}/
├── app.json           # Must exist
├── auth/
│   ├── {name}.ts
│   └── {name}.template.json
└── tool/
    ├── {name}.ts
    └── {name}.template.json
```

## Example: From Recording to Code

### Given Recording Shows:

```
GET https://www.linkedin.com/feed/
GET https://www.linkedin.com/voyager/api/messengerConversations?category=PRIMARY_INBOX
POST https://www.linkedin.com/voyager/api/messengerConversations/{id}?patch=read:true
```

### Analysis:

1. User went to LinkedIn feed
2. Opened messaging (fetched conversations)
3. Clicked on conversations to read them

### Decision:

This is a **tool** (not auth) - it performs an action on an authenticated session.

### Generated Output:

1. Create `src/apps/linkedin/tool/read-pending-messages.ts`
2. Create `src/apps/linkedin/tool/read-pending-messages.template.json`
3. Template has `type: "tool"` and `app: "linkedin"`
4. Script navigates to messaging, finds unread conversations, clicks to open them
5. Script verifies auth state before proceeding
6. Script uses `domcontentloaded` for navigation

## Summary

1. **Analyze** the mitmproxy recording to understand what the user did
2. **Determine** if this is an auth or tool script
3. **Map** API calls to UI actions
4. **Generate** TypeScript with proper patterns (auth fetching, input parsing, selectors)
5. **Generate** template.json with correct metadata
6. **Validate** against the checklist before outputting
