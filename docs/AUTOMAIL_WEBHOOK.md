# Automail Webhook Integratie

> **Status**: Production
> **Doel**: Automatisch rapporten aanmaken vanuit inkomende emails via Automail/FreeScout

---

## 1. Overzicht

De Automail webhook integratie ontvangt email conversaties van een extern ticketing systeem en maakt automatisch fiscale onderzoeksrapporten aan.

```
┌─────────────────────────────────────────────────────────────────────┐
│  AUTOMAIL WEBHOOK FLOW                                              │
│                                                                     │
│  Automail/FreeScout                                                │
│  (Email Ticketing)                                                 │
│       │                                                             │
│       │ POST /api/webhooks/automail                                │
│       │ X-Automail-API-Key: secret                                 │
│       ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Webhook Handler                                             │   │
│  │                                                              │   │
│  │  1. Valideer API key                                        │   │
│  │  2. Parse payload (Zod schema)                              │   │
│  │  3. Extract: klant, threads, attachments                    │   │
│  │  4. Bouw rawText (email + bijlagen)                         │   │
│  │  5. Maak Report record                                      │   │
│  │  6. Maak Attachment records                                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
│       │                                                             │
│       ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Database                                                    │   │
│  │                                                              │   │
│  │  reports: Nieuw rapport met status "processing"             │   │
│  │  attachments: Bijlagen met extractedText + externalUrl      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│       │                                                             │
│       ▼                                                             │
│  Stage 1a: Informatiecheck (AI valideert completeness)            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Kernbestanden

| Bestand | Doel |
|---------|------|
| [server/routes/automail-webhook-routes.ts](../server/routes/automail-webhook-routes.ts) | Webhook handler |
| [server/routes.ts](../server/routes.ts) | Route registratie |
| [server/config/index.ts](../server/config/index.ts) | Environment config |
| [shared/schema.ts](../shared/schema.ts) | Reports & attachments schema |

---

## 3. API Endpoint

### `POST /api/webhooks/automail`

**Authenticatie**: API Key via header

```http
X-Automail-API-Key: your-secret-key-here
```

**Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "reportId": "uuid-123",
    "dossierNumber": 42,
    "clientName": "Jan de Vries",
    "title": "Jan de Vries",
    "attachments": {
      "received": 3,
      "created": 3,
      "ids": ["att-1", "att-2", "att-3"]
    }
  },
  "message": "Rapport succesvol aangemaakt vanuit Automail met 3 bijlage(s)"
}
```

**Error Responses**:
- `400`: Invalid payload structure
- `401`: Invalid/missing API key
- `500`: Server error

---

## 4. Webhook Payload

### Hoofdstructuur

```typescript
{
  // Conversatie metadata
  id: number,                    // Conversatie ID
  number: number,                // Conversatie nummer
  subject: string,               // Onderwerp
  type: "email",
  status: "pending" | "active" | "closed",

  // Klant info
  customer: {
    firstName: string,
    lastName: string,
    email: string,
    phone?: string,
    company?: string
  },

  // Custom fields (bijv. Lead ID)
  customFields: [
    { name: "Lead id", value: "12345" }
  ],

  // Email threads
  _embedded: {
    threads: Thread[]
  },

  // Pre-formatted tekst (optioneel)
  formattedThreads?: string
}
```

### Thread Structuur

```typescript
interface Thread {
  id: number,
  type: "note" | "message" | "customer" | "lineitem",
  body: string,                  // Email tekst
  createdAt: string,

  // Bijlagen
  _embedded: {
    attachments: Attachment[]
  }
}
```

### Attachment Structuur

```typescript
interface Attachment {
  id: number,
  fileName: string,
  fileUrl: string,               // URL in Automail
  mimeType: string,
  size: number,

  // Pre-extracted tekst
  extractedText?: string,
  extractionSuccess?: boolean,
  extractionCached?: boolean
}
```

---

## 5. Data Processing

### Klant Naam Extractie

```typescript
const clientName = `${payload.customer.firstName} ${payload.customer.lastName}`.trim();
```

### Lead ID Extractie

```typescript
const leadId = payload.customFields?.find(f => f.name === "Lead id")?.value;
```

### Raw Text Constructie

```typescript
let rawText = payload.formattedThreads || "";

// Voeg bijlage tekst toe
for (const attachment of attachments) {
  if (attachment.extractedText) {
    rawText += `\n\n========================================\n`;
    rawText += `--- DOCUMENT: ${attachment.fileName} ---\n`;
    rawText += `========================================\n\n`;
    rawText += attachment.extractedText;
  }
}
```

---

## 6. Database Records

### Report Creatie

```typescript
const report = await storage.createReport({
  title: clientName,
  clientName: clientName,
  dossierData: {
    rawText: rawText,
    klant: {
      naam: clientName,
      situatie: '',
    },
    fiscale_gegevens: {
      vermogen: 0,
      inkomsten: 0,
    },
    automail: {
      conversationId: payload.id,
      conversationNumber: payload.number,
      subject: payload.subject,
      customerEmail: payload.customer.email,
      customerPhone: payload.customer.phone,
      leadId: leadId,
      receivedAt: new Date().toISOString(),
    }
  },
  currentStage: "1a_informatiecheck",
  status: "processing"
});
```

### Attachment Creatie

```typescript
for (const attachment of attachments) {
  await storage.createAttachment({
    reportId: report.id,
    filename: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSize: String(attachment.size),
    fileData: "",                    // Geen base64 - externe URL
    extractedText: attachment.extractedText,
    externalUrl: attachment.fileUrl,  // Link naar Automail
    needsVisionOCR: false             // Al geëxtraheerd
  });
}
```

---

## 7. Authenticatie

### API Key Validatie

```typescript
// Timing-safe comparison (voorkomt timing attacks)
const apiKey = req.headers['x-automail-api-key'];
const expected = process.env.AUTOMAIL_WEBHOOK_SECRET;

if (!timingSafeEqual(apiKey, expected)) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### Nginx Bypass

De webhook route bypassed HTTP basic auth:

```nginx
# docker-entrypoint.sh
location ^~ /api/webhooks/ {
    proxy_pass http://localhost:5000;
    # Geen auth_basic hier
}
```

---

## 8. Environment Configuratie

```bash
# .env

# Verplicht voor webhook authenticatie (min 16 karakters)
AUTOMAIL_WEBHOOK_SECRET=your-very-secure-secret-key-here
```

### Config Validatie

```typescript
// server/config/index.ts
AUTOMAIL_WEBHOOK_SECRET: z.string().min(16).optional()
```

---

## 9. Frontend Integratie

### Attachments Tab

Automail bijlagen worden weergegeven in de case detail view:

```typescript
// client/src/components/case-detail/AttachmentsTab.tsx

{attachment.externalUrl ? (
  // Externe file - openen in Automail
  <Button onClick={() => window.open(attachment.externalUrl, "_blank")}>
    <ExternalLink /> Openen in Automail
  </Button>
) : (
  // Lokale file - downloaden
  <Button onClick={() => download(attachment.id)}>
    <Download /> Downloaden
  </Button>
)}
```

### Status Badges

```typescript
// Tekst al geëxtraheerd door Automail
<Badge>Tekst geëxtraheerd</Badge>

// Vision OCR nodig (scans)
<Badge>Vision OCR</Badge>
```

---

## 10. Workflow Na Creatie

```
1. Webhook ontvangt conversatie
   ↓
2. Report aangemaakt (status: "processing")
   ↓
3. Attachments opgeslagen (met extractedText)
   ↓
4. Stage 1a: Informatiecheck
   • AI analyseert rawText + bijlagen
   • Bepaalt of info compleet is
   ↓
5a. COMPLEET → Stage 2+ (normale workflow)
   ↓
5b. INCOMPLEET → Stage 1b (email naar klant)
```

---

## 11. Automail Metadata

Alle Automail-specifieke data wordt opgeslagen in `dossierData.automail`:

```typescript
{
  conversationId: 12345,
  conversationNumber: 42,
  subject: "Vraag over Box 3",
  customerEmail: "klant@example.com",
  customerPhone: "+31612345678",
  leadId: "CRM-98765",
  receivedAt: "2024-01-15T10:30:00Z"
}
```

Dit maakt tracering en debugging mogelijk.

---

## 12. Debugging Tips

### Webhook Testen

```bash
curl -X POST https://your-domain/api/webhooks/automail \
  -H "Content-Type: application/json" \
  -H "X-Automail-API-Key: your-secret" \
  -d '{
    "id": 1,
    "number": 1,
    "subject": "Test",
    "customer": {
      "firstName": "Test",
      "lastName": "User",
      "email": "test@example.com"
    },
    "_embedded": {
      "threads": []
    }
  }'
```

### Logs Bekijken

```bash
# Webhook requests
grep "webhooks/automail" logs/server.log

# Automail specifiek
grep "automail" logs/server.log
```

### Common Issues

| Probleem | Oorzaak | Oplossing |
|----------|---------|-----------|
| 401 Unauthorized | Verkeerde API key | Check AUTOMAIL_WEBHOOK_SECRET |
| 400 Validation Error | Payload structuur fout | Check Zod schema |
| Lege rawText | formattedThreads ontbreekt | Automail config checken |
| Bijlagen niet zichtbaar | externalUrl niet toegankelijk | Automail permissions |

---

## 13. Automail Configuratie

### Webhook Setup in Automail

1. Ga naar Automail → Settings → Webhooks
2. Voeg nieuwe webhook toe:
   - URL: `https://your-domain/api/webhooks/automail`
   - Events: Conversation created, Message received
3. Voeg header toe:
   - Name: `X-Automail-API-Key`
   - Value: `your-secret-key`

### Text Extraction

Automail kan tekst uit bijlagen extraheren voordat de webhook wordt gestuurd:
- PDF: Automatische tekst extractie
- Images: OCR (indien geconfigureerd)
- Resultaat in `extractedText` field
