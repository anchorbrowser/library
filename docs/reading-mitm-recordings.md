# Reading mitmproxy Recordings

This document explains how to extract useful information from mitmproxy `.mitm` flow files to understand what actions a user performed during a recorded session.

## File Format

mitmproxy `.mitm` files are binary files containing HTTP/HTTPS traffic. They include:
- HTTP requests (method, path, headers, body)
- HTTP responses (status, headers, body)
- WebSocket messages
- Timestamps for each event
- TLS/SSL certificate information

While binary, the files contain extractable text content that reveals the user's actions.

## Extracting Content

### Using strings command

The simplest way to extract readable content:

```bash
# Extract all readable strings
strings flows.mitm | head -1000

# Search for specific domain
strings flows.mitm | grep -i "linkedin.com" | head -50

# Find API endpoints
strings flows.mitm | grep -iE "(api|graphql|voyager)" | head -100

# Find messaging-related calls
strings flows.mitm | grep -iE "(message|inbox|conversation)" | head -100
```

### Using xxd for header inspection

```bash
# View raw bytes to understand structure
head -c 500 flows.mitm | xxd | head -30
```

## Key Patterns to Extract

### 1. API Endpoints

Look for URL paths that reveal what actions were performed:

```
/voyager/api/voyagerMessagingDashMessengerConversations
/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerMessages
/api/messaging/conversations
/messages/t/
```

**What to look for:**
- REST API paths (`/api/...`)
- GraphQL endpoints (`/graphql?queryId=...`)
- Navigation URLs (`/feed/`, `/messaging/`, `/profile/`)

### 2. HTTP Methods

Identify action types:
- `GET` - Reading/fetching data
- `POST` - Creating/submitting (login, send message, etc.)
- `PATCH` - Updating (mark as read, edit)
- `DELETE` - Removing

### 3. Request Bodies

JSON payloads reveal exactly what data was sent:

```json
{"entities":{"urn:li:msg_conversation:(...)":{"patch":{"$set":{"read":true}}}}}
```

This shows a message being marked as read.

```json
{"messageUrns":["urn:li:msg_message:(...)"],"deliveryMechanism":"SYNC"}
```

This shows message delivery acknowledgement.

### 4. Headers

Important headers to identify:

| Header | Purpose |
|--------|---------|
| `referer` | Page user was on when making request |
| `x-li-page-instance` | LinkedIn page context |
| `csrf-token` | CSRF protection token |
| `x-li-track` | Client tracking info (version, device) |
| `cookie` | Session/auth cookies |

### 5. Timestamps

Requests include timestamps that help sequence events:

```
timestamp_start;18:1770217344.3669887
timestamp_end;17:1770217344.367574
```

Sort by timestamp to understand the order of operations.

## Identifying User Actions

### Login Flow

Look for:
```
POST /uas/login
POST /checkpoint/challenge
/feed/  (redirect after successful login)
```

Request body patterns:
```
session_key=email@example.com
session_password=...
```

### Messaging Flow

Look for:
```
GET /messaging/
GET /voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerConversations
POST /voyager/api/voyagerMessagingDashMessagingBadge?action=markAllMessagesAsSeen
GET /voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerMessages
```

### Common LinkedIn API Patterns

| Pattern | Action |
|---------|--------|
| `messengerConversations` | List conversations |
| `messengerMessages` | Get messages in conversation |
| `markAllMessagesAsSeen` | Mark messages as read |
| `sendDeliveryAcknowledgement` | Acknowledge message received |
| `presenceStatuses` | Get online status |

### Common Facebook API Patterns

| Pattern | Action |
|---------|--------|
| `/messages/t/` | Messenger thread |
| `/ajax/mercury/` | Messaging AJAX calls |
| `/webgraphql/mutation` | GraphQL mutations |

## Mapping API Calls to UI Actions

When you see these API calls, the user likely performed these UI actions:

| API Pattern | UI Action |
|-------------|-----------|
| `GET /feed/` | Navigated to home feed |
| `GET /messaging/` | Opened messaging |
| `messengerConversations` query | Viewed conversation list |
| `messengerMessages` query | Clicked on a conversation |
| `markAllMessagesAsSeen` | Opened/viewed messages |
| `sendDeliveryAcknowledgement` | Message displayed on screen |
| POST with message content | Sent a message |

## Example: Extracting a Messaging Session

Given a recording where user read pending messages:

```bash
# Find messaging-related API calls
strings flows.mitm | grep -i "messenger" | head -20
```

Output might show:
```
/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerConversations...
...category:PRIMARY_INBOX...
...conversationUrn:urn:li:msg_conversation...
/voyager/api/voyagerMessagingDashMessengerConversations?ids=List(urn%3Ali%3Amsg_conversation...)
...{"patch":{"$set":{"read":true}}}...
```

This tells us:
1. User queried conversations from PRIMARY_INBOX
2. User selected specific conversation(s)
3. User marked conversation(s) as read

## Reconstructing the Action Sequence

1. **Find navigation URLs** - Where did the user go?
2. **Find API queries** - What data was fetched?
3. **Find mutations/POSTs** - What actions were taken?
4. **Order by timestamp** - What was the sequence?
5. **Identify UI triggers** - What clicks/inputs caused these calls?

## Using Extracted Information

Once you understand what the user did, you can:

1. **Identify the target page** - Navigation URLs show where to go
2. **Find UI selectors** - API calls often include element IDs or URNs
3. **Understand the flow** - Timestamps show the sequence
4. **Determine success criteria** - Response codes and bodies show expected results

This information feeds into writing automation scripts that replicate the user's actions through UI automation (Playwright) rather than direct API calls.
