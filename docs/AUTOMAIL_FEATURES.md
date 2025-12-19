# Automail Integration Features

This document describes the Automail integration features implemented in De Fiscale Analist.

## Overview

Automail integration allows:
1. **Incoming webhooks** - Automatically create reports from Automail conversations
2. **Draft creation** - Create draft replies in Automail from the application
3. **Case lookup** - Find reports associated with an Automail conversation

---

## Architecture

```
server/
├── config/index.ts                    # AUTOMAIL_CONFIG definition
├── services/
│   └── automail-api.ts                # API client for Automail
├── routes/
│   ├── automail-routes.ts             # Frontend API endpoints
│   └── automail-webhook-routes.ts     # Incoming webhook handler
shared/
└── schema/automail.ts                 # Zod schemas for validation

client/
└── src/components/workflow/
    └── InformatieCheckViewer.tsx      # "Maak Draft in Automail" button
```

---

## 1. Configuration (`server/config/index.ts`)

Environment variables:
```env
AUTOMAIL_WEBHOOK_SECRET=<min 16 chars>   # Secret for authenticating incoming webhooks
AUTOMAIL_API_KEY=<automail-api-key>      # API key for outgoing requests
AUTOMAIL_USER_ID=1                        # Default user ID for drafts
AUTOMAIL_BASE_URL=https://automail.jandebelastingman.nl
```

Config object:
```typescript
export const AUTOMAIL_CONFIG = {
  baseUrl: env.AUTOMAIL_BASE_URL,
  apiKey: env.AUTOMAIL_API_KEY,
  userId: env.AUTOMAIL_USER_ID,
  webhookSecret: env.AUTOMAIL_WEBHOOK_SECRET,
  isConfigured: !!env.AUTOMAIL_API_KEY,
  isWebhookEnabled: !!env.AUTOMAIL_WEBHOOK_SECRET,
} as const;
```

---

## 2. Shared Schema (`shared/schema/automail.ts`)

Zod schemas for:
- `automailWebhookPayloadSchema` - Validates incoming webhook payloads
- `automailCreateDraftRequestSchema` - Validates draft creation requests
- Nested schemas for users, customers, threads, attachments, etc.

---

## 3. API Service (`server/services/automail-api.ts`)

### Functions:

```typescript
// Check if Automail is configured
isAutomailConfigured(): boolean

// Create a draft reply in a conversation
createDraft(params: CreateDraftParams): Promise<CreateDraftResponse>

// Parse Stage 1b email output and create draft
createDraftFromEmailOutput(conversationId: number, emailOutput: string): Promise<CreateDraftResponse | null>
```

### Types:
```typescript
interface CreateDraftParams {
  conversationId: number;
  body: string;
  userId?: number;
}

interface CreateDraftResponse {
  threadId: number;
  conversationId: number;
}
```

---

## 4. Webhook Routes (`server/routes/automail-webhook-routes.ts`)

### `POST /api/webhooks/automail`

Receives webhook from Automail when a new conversation is created.

**Headers:**
- `X-Automail-API-Key`: Must match `AUTOMAIL_WEBHOOK_SECRET`

**Payload:** Automail conversation data including:
- Customer info (name, email)
- Subject
- Threads with message bodies
- Attachments with extracted text

**Actions:**
1. Validates API key (timing-safe comparison)
2. Parses and validates payload
3. Creates a new report with:
   - `dossierData.rawText` = formatted threads + attachment text
   - `dossierData.automail` = metadata (conversationId, conversationNumber, subject, etc.)
4. Creates attachment records for each document

**Response:**
```json
{
  "success": true,
  "data": {
    "reportId": "uuid",
    "dossierNumber": 123,
    "clientName": "John Doe",
    "attachments": { "received": 3, "created": 3, "ids": [...] }
  }
}
```

---

## 5. API Routes (`server/routes/automail-routes.ts`)

### `POST /api/reports/:reportId/automail/draft`

Creates a draft reply in the Automail conversation associated with the report.

**Body:**
```json
{
  "text": "<p>HTML content for the draft</p>"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "threadId": 456,
    "conversationId": 123
  }
}
```

### `GET /api/automail/status`

Check if Automail API is configured.

**Response:**
```json
{
  "success": true,
  "data": { "configured": true }
}
```

### `GET /api/automail/conversations/:conversationId/cases`

Find all reports associated with an Automail conversation.

**Response:**
```json
{
  "success": true,
  "data": {
    "conversationId": 123,
    "cases": [{ "id": "...", "dossierNumber": 1, ... }],
    "count": 1
  }
}
```

---

## 6. Storage Method (`server/storage.ts`)

```typescript
// Get reports by Automail conversation ID (JSONB query)
getReportsByAutomailConversation(conversationId: number): Promise<Report[]>
```

Uses PostgreSQL JSONB path filtering:
```sql
SELECT * FROM reports
WHERE (dossier_data->'automail'->>'conversationId')::integer = $1
```

---

## 7. Job Processor Integration (`server/services/job-processor.ts`)

When Stage 1b (email generation) completes for INCOMPLEET status:

```typescript
private async createAutomailDraft(report: any, emailOutput: string): Promise<void>
```

- Checks if Automail is configured
- Gets `conversationId` from `report.dossierData.automail.conversationId`
- Calls `createDraftFromEmailOutput()` to create draft
- Non-blocking: failures are logged but don't fail the stage

---

## 8. Frontend Button (`client/src/components/workflow/InformatieCheckViewer.tsx`)

Added "Maak Draft in Automail" button next to "Kopieer Email":

```tsx
{reportId && (
  <Button
    onClick={() => createDraftInAutomail(cleanedEmail)}
    variant="default"
    disabled={isCreatingDraft || draftCreated}
  >
    {isCreatingDraft ? "Aanmaken..." : draftCreated ? "Draft Aangemaakt!" : "Maak Draft in Automail"}
  </Button>
)}
```

**Features:**
- Only shows when `reportId` is available
- Loading state with spinner
- Success feedback (3 seconds)
- Error message display

**API Call:**
```typescript
const createDraftInAutomail = async (htmlText: string) => {
  const response = await fetch(`/api/reports/${reportId}/automail/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: htmlText }),
  });
  // Handle response...
};
```

---

## 9. Report Data Structure

Reports created from Automail have this structure in `dossierData`:

```typescript
{
  rawText: "...",  // Formatted threads + attachment text
  klant: { naam: "...", situatie: "" },
  fiscale_gegevens: { vermogen: 0, inkomsten: 0 },
  automail: {
    conversationId: 123,        // Automail conversation ID
    conversationNumber: 456,    // Human-readable number
    subject: "Tax question",
    customerEmail: "john@example.com",
    customerPhone: "+31...",
    leadId: "lead-123",         // From custom field
    receivedAt: "2025-01-01T12:00:00Z"
  }
}
```

---

## Template Variables (for email templates)

Available variables for use in API thread bodies:

**Customer:**
- `{%customer.fullName%}`
- `{%customer.firstName%}`
- `{%customer.lastName%}`
- `{%customer.email%}`
- `{%customer.phone%}`

**Conversation:**
- `{%conversation.number%}`
- `{%conversation.subject%}`
- `{%conversation.status%}`

**Mailbox:**
- `{%mailbox.name%}`
- `{%mailbox.email%}`

**User:**
- `{%user.firstName%}`
- `{%user.lastName%}`
- `{%user.email%}`

---

## Files Changed Summary

| File | Purpose |
|------|---------|
| `server/config/index.ts` | Added `AUTOMAIL_CONFIG` |
| `server/services/automail-api.ts` | NEW - API client |
| `server/routes/automail-routes.ts` | NEW - Frontend API routes |
| `server/routes/automail-webhook-routes.ts` | NEW - Webhook handler |
| `server/routes.ts` | Register automail routes |
| `server/storage.ts` | Added `getReportsByAutomailConversation` |
| `server/services/job-processor.ts` | Added `createAutomailDraft` |
| `shared/schema/automail.ts` | NEW - Zod schemas |
| `client/.../InformatieCheckViewer.tsx` | Added draft button |
| `client/.../StageOutputSection.tsx` | Pass `reportId` to viewer |

---

## Testing

1. **Webhook:** POST to `/api/webhooks/automail` with valid payload and API key
2. **Draft creation:** Use the button in Stage 1a output or call API directly
3. **Status check:** GET `/api/automail/status`
4. **Case lookup:** GET `/api/automail/conversations/:id/cases`
