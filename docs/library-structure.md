# Library Structure

This document describes the structure and conventions of the browser automation library repository.

## Directory Layout

```
src/
├── apps/
│   └── {app-name}/
│       ├── app.json                    # App metadata (required)
│       ├── auth/
│       │   ├── {auth-name}.ts          # Auth script
│       │   └── {auth-name}.template.json
│       └── tool/
│           ├── {tool-name}.ts          # Tool script
│           └── {tool-name}.template.json
├── generic/
│   └── auth/                           # Generic auth utilities
├── sdk/
│   └── index.ts                        # Auto-generated exports
├── types.ts                            # Shared type definitions
└── index.ts                            # Main entry point
```

## File Schemas

### app.json

Every app directory must contain an `app.json` file with these required fields:

```json
{
  "id": "linkedin",
  "name": "LinkedIn",
  "description": "LinkedIn is a professional networking platform.",
  "allowedDomains": ["linkedin.com"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier, used in template.json `app` field |
| `name` | string | Yes | Human-readable name |
| `description` | string | Yes | Brief description of the application |
| `allowedDomains` | string[] | Yes | List of domains this app operates on (non-empty) |

### Auth Template JSON (*.template.json in /auth/)

```json
{
  "slug": "basic-2fa-login",
  "name": "Basic 2FA Login",
  "description": "Login using username/password with optional 2FA.",
  "type": "auth",
  "file": "basic-2fa-login.ts",
  "app": "linkedin",
  "requiredCredentials": ["username_password"],
  "optionalCredentials": ["authenticator"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | string | Yes | Must match filename without `.template.json` |
| `name` | string | Yes | Human-readable name |
| `description` | string | No | What this auth flow does |
| `type` | string | Yes | Must be `"auth"` (matches parent directory) |
| `file` | string | Yes | TypeScript file in same directory |
| `app` | string | Yes | Must match nearest `app.json` id |
| `requiredCredentials` | string[] | No | Required credential types |
| `optionalCredentials` | string[] | No | Optional credential types |

Credential types: `"username_password"`, `"authenticator"`, `"custom"`

### Tool Template JSON (*.template.json in /tool/)

```json
{
  "slug": "send-message-facebook",
  "name": "Send Facebook Message",
  "description": "Send a message to a Facebook user via Messenger.",
  "type": "tool",
  "file": "send-message-facebook.ts",
  "app": "facebook",
  "inputSchema": [
    {
      "display_name": "recipientName",
      "type": "string",
      "required": true,
      "description": "The name of the user to message"
    },
    {
      "display_name": "message",
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
      "description": "Whether the message was sent"
    }
  ],
  "requiredCredentials": [],
  "optionalCredentials": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | string | Yes | Must match filename without `.template.json` |
| `name` | string | Yes | Human-readable name |
| `description` | string | No | What this tool does |
| `type` | string | Yes | Must be `"tool"` (matches parent directory) |
| `file` | string | Yes | TypeScript file in same directory |
| `app` | string | Yes | Must match nearest `app.json` id |
| `inputSchema` | SchemaParameter[] | No | Input parameters for the tool |
| `outputSchema` | SchemaParameter[] | No | Output fields from the tool |

### SchemaParameter

Used in `inputSchema` and `outputSchema`:

```json
{
  "display_name": "recipientName",
  "type": "string",
  "required": true,
  "description": "The name of the user",
  "default_value": "default"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `display_name` | string | Yes | Key name (used in ANCHOR_TOOL_INPUT) |
| `type` | string | Yes | One of: `"string"`, `"number"`, `"boolean"`, `"date"` |
| `required` | boolean | No | Whether this parameter is required |
| `description` | string | No | Human-readable description |
| `default_value` | string | No | Default value if not provided |

## Validation Rules

The build process validates all templates with these rules:

1. **Slug must match filename**: `basic-login.template.json` must have `"slug": "basic-login"`

2. **Type must match directory**: Files in `/auth/` must have `"type": "auth"`, files in `/tool/` must have `"type": "tool"`

3. **App must match app.json**: The `app` field must match the `id` in the nearest ancestor `app.json`

4. **File must exist**: The `file` field must point to an existing `.ts` file in the same directory

5. **Schema types are validated**: `type` must be one of `string`, `number`, `boolean`, `date`

## Task ID Requirements

**CRITICAL**: Task IDs must be valid UUIDs. The session-manager validates this:

```typescript
const uuidResult = z.string().uuid().safeParse(taskId);
if (!uuidResult.success) {
  throw new Error(`Invalid task ID format: ${taskId}`);
}
```

**Never store task names in `task_id` fields** - always use the actual UUID from `tasks.public_id`.

## Naming Conventions

- App directories: lowercase, hyphenated (`comply-advantage`)
- Nested products: subdirectories (`comply-advantage/mesh/`)
- Script files: lowercase, hyphenated, descriptive (`basic-2fa-login.ts`)
- Slugs: match filename exactly without extension
- IDs: lowercase, simple (`linkedin`, `facebook`)

## Build Process

```bash
npm run build
```

This runs:
1. `validate` - Validates all app.json and template.json files
2. `generate:exports` - Auto-generates `src/sdk/index.ts` with all exports
3. `tsdown` - Compiles TypeScript to JavaScript
