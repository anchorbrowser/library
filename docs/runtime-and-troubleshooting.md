# Runtime and Troubleshooting

This document covers the runtime behavior of auth and tool tasks, database relationships, and common issues with their fixes.

## Database Relationships

Understanding the database schema helps debug issues:

```
tools.task_id                              → tasks.public_id (UUID)
connection_auth_options.authentication_task_id → tasks.public_id (UUID)
identities.connection_auth_option_id       → connection_auth_options.internal_id
```

### Key Tables

| Table | Purpose |
|-------|---------|
| `tasks` | Stores all task definitions (auth and tool scripts) |
| `tools` | Links tools to their task definitions |
| `connection_auth_options` | Defines auth methods for connections |
| `identities` | User credentials linked to auth options |
| `connections` | App connections (LinkedIn, Facebook, etc.) |

### Relationship Flow

```
Identity
  └── connection_auth_option_id → ConnectionAuthOption
                                      └── authentication_task_id → Task (auth script)
                                      └── connection_id → Connection
                                                             └── Tool
                                                                  └── task_id → Task (tool script)
```

## Task ID Requirements

**CRITICAL**: Task IDs must be valid UUIDs. The session-manager validates this before execution:

```typescript
const uuidResult = z.string().uuid().safeParse(taskId);
if (!uuidResult.success) {
  throw new Error(`Invalid task ID format: ${taskId}`);
}
```

**Never store task names in `task_id` fields** - always use the actual UUID from `tasks.public_id`.

## Auth Task Execution Flow

```
1. Session created with identity
   └── triggers executeAuthenticationTasks()
   
2. executeAuthenticationTasks()
   └── looks up identity.connection_auth_option_id
   └── gets authentication_task_id from connection_auth_options
   └── fetches task from tasks table by public_id (UUID)
   
3. Auth task runs
   └── calls client.identities.retrieveCredentials(identityId)
   └── performs login automation
   └── returns { success: boolean, message: string }
   
4. Session is now authenticated
   └── subsequent tool tasks can use this session
```

## Tool Execution Flow

```
1. runTool() called
   └── runToolWorkflow()
   
2. runToolWorkflow()
   └── startAuthenticatedSessionActivity()
   └── creates session with identity
   
3. startAuthenticatedSessionActivity()
   └── triggers auth task (see auth flow above)
   
4. runToolTaskActivity()
   └── looks up tool.task_id
   └── fetches task from tasks table by public_id (UUID)
   └── executes tool script on authenticated session
   
5. Tool task runs
   └── verifies auth state
   └── performs automation
   └── returns { success: boolean, message: string, data?: {} }
```

## Common Issues & Fixes

### "Invalid task ID format"

**Cause**: The `task_id` field contains a task name instead of a UUID.

**Example of the problem**:
```sql
-- Wrong: task_id contains name
SELECT * FROM tools WHERE task_id = 'send-message-facebook';

-- Correct: task_id should be UUID
SELECT * FROM tools WHERE task_id = '123e4567-e89b-12d3-a456-426614174000';
```

**Fix**: Update the record with the correct UUID from `tasks.public_id`:

```sql
-- Find the task UUID
SELECT public_id, name FROM tasks WHERE name = 'send-message-facebook';

-- Update the tool with correct UUID
UPDATE tools SET task_id = '123e4567-e89b-12d3-a456-426614174000' WHERE name = 'Send Message';
```

### "User is not authenticated"

**Cause 1**: Identity is linked to the wrong `connection_auth_option_id`.

**Cause 2**: Auth option has the wrong `authentication_task_id`.

**Debugging**:
```sql
-- Check identity's auth option chain
SELECT 
  i.public_id as identity_id,
  i.name as identity_name,
  i.connection_auth_option_id,
  cao.authentication_task_id,
  t.name as auth_task_name
FROM identities i
JOIN connection_auth_options cao ON i.connection_auth_option_id = cao.internal_id
LEFT JOIN tasks t ON cao.authentication_task_id = t.public_id
WHERE i.public_id = 'your-identity-id';
```

**Fix**: Ensure the chain is correct:
1. Identity → correct auth option
2. Auth option → correct auth task UUID
3. Auth task exists and works

### "Tool not asking for input parameters"

**Cause**: The `tools.input_schema` is empty `[]` or null.

**Debugging**:
```sql
SELECT internal_id, name, task_id, input_schema 
FROM tools 
WHERE connection_id = 'your-connection-id';
```

**Fix**: Update with the correct schema:

```sql
UPDATE tools 
SET input_schema = '[
  {"type": "string", "required": true, "display_name": "Recipient Name"},
  {"type": "string", "required": false, "display_name": "Message Text", "default_value": "Hi!"}
]'
WHERE name = 'Send Message';
```

### "Duplicates on library import"

**Cause**: Library service "get or create" logic fails when IDs don't match expected format.

**Fix**: 
1. Delete duplicate entries
2. Ensure library service stores UUIDs, not names
3. Verify task.public_id is used consistently

## Debugging Queries

### Check tool configuration

```sql
SELECT 
  internal_id,
  name,
  task_id,
  input_schema,
  output_schema
FROM tools 
WHERE connection_id = ?;
```

### Check auth options for a connection

```sql
SELECT 
  internal_id,
  authentication_task_id,
  methods,
  required_credentials,
  optional_credentials
FROM connection_auth_options 
WHERE connection_id = ?;
```

### Check identity's auth option

```sql
SELECT 
  i.public_id,
  i.name,
  i.connection_auth_option_id,
  cao.authentication_task_id,
  t.name as task_name,
  t.public_id as task_uuid
FROM identities i
JOIN connection_auth_options cao ON i.connection_auth_option_id = cao.internal_id
LEFT JOIN tasks t ON cao.authentication_task_id = t.public_id
WHERE i.public_id = ?;
```

### Verify task exists

```sql
SELECT 
  public_id,
  name,
  type,
  created_at
FROM tasks 
WHERE public_id = ?;
```

### Full chain verification

```sql
-- Verify entire auth chain for an identity
SELECT 
  i.name as identity_name,
  c.name as connection_name,
  cao.methods as auth_methods,
  t_auth.name as auth_task_name,
  t_auth.public_id as auth_task_id,
  tool.name as tool_name,
  t_tool.name as tool_task_name,
  t_tool.public_id as tool_task_id
FROM identities i
JOIN connection_auth_options cao ON i.connection_auth_option_id = cao.internal_id
JOIN connections c ON cao.connection_id = c.internal_id
LEFT JOIN tasks t_auth ON cao.authentication_task_id = t_auth.public_id
LEFT JOIN tools tool ON tool.connection_id = c.internal_id
LEFT JOIN tasks t_tool ON tool.task_id = t_tool.public_id
WHERE i.public_id = 'your-identity-id';
```

## Environment Variable Reference

| Variable | Used By | Description |
|----------|---------|-------------|
| `ANCHOR_SESSION_ID` | Auth, Tool | Browser session ID to connect to |
| `ANCHOR_IDENTITY_ID` | Auth, Tool | Identity ID for credential lookup |
| `ANCHOR_TOOL_INPUT` | Tool only | JSON with input parameters |
| `ANCHOR_TOOL_DETAILS` | Tool only | JSON with app URL, goal, schemas |
| `ANCHOR_TIMEOUT_MS` | Auth, Tool | Operation timeout (optional) |

## Logging Best Practices

Use consistent logging to aid debugging:

```typescript
// Step indicators
console.log('[STEP 1] ▶ Starting action...');
console.log('[STEP 1] ✓ Action completed');
console.log('[STEP 1] ⚠ Warning message');
console.log('[STEP 1] ✗ Action failed');

// Category prefixes
console.log('[BROWSER] Connecting...');
console.log('[CREDENTIALS] Fetching...');
console.log('[CHECK] Verifying...');
console.log('[VALIDATE] Input validated');
console.log('[ERROR] Something failed');
console.log('[RESULT] ✓ SUCCESS!');
console.log('[RESULT] ✗ FAILED');
```
