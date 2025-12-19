# Export System - PDF, DOCX & JSON

> **Status**: Production
> **Doel**: Rapporten exporteren naar professionele documenten

---

## 1. Overzicht

Het Export System ondersteunt drie formaten:

| Formaat | Methode | Gebruik |
|---------|---------|---------|
| **PDF** | Playwright/Chromium HTML rendering | Klant deliverable |
| **DOCX** | HTML → Word conversie | Google Docs compatible |
| **JSON** | Serialisatie | Dev/prod sync, backup |

```
┌─────────────────────────────────────────────────────────────────────┐
│  EXPORT FLOW                                                        │
│                                                                     │
│  Report (Database)                                                  │
│       │                                                             │
│       ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Content Extraction                                          │   │
│  │  • conceptReportVersions.latest (prioriteit)                │   │
│  │  • generatedContent (fallback)                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│       │                                                             │
│       ├──────────────────┬──────────────────┬───────────────────┐  │
│       ▼                  ▼                  ▼                   │  │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐              │  │
│  │   PDF    │      │   DOCX   │      │   JSON   │              │  │
│  │          │      │          │      │          │              │  │
│  │ Markdown │      │ Markdown │      │ Serialize│              │  │
│  │    ↓     │      │    ↓     │      │ report + │              │  │
│  │  HTML    │      │  HTML    │      │ metadata │              │  │
│  │    ↓     │      │    ↓     │      │          │              │  │
│  │Playwright│      │html-docx │      │          │              │  │
│  │    ↓     │      │    ↓     │      │          │              │  │
│  │  .pdf    │      │  .docx   │      │  .json   │              │  │
│  └──────────┘      └──────────┘      └──────────┘              │  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Kernbestanden

| Bestand | Doel |
|---------|------|
| [server/services/html-pdf-generator.ts](../server/services/html-pdf-generator.ts) | **HTML → PDF** via Playwright |
| [server/services/pdf-generator.ts](../server/services/pdf-generator.ts) | Legacy jsPDF generator |
| [server/services/docx-generator.ts](../server/services/docx-generator.ts) | HTML → DOCX conversie |
| [server/services/pdf-fonts.ts](../server/services/pdf-fonts.ts) | Font loading |
| [server/routes/report-routes/export.ts](../server/routes/report-routes/export.ts) | Export API endpoints |
| [server/templates/pdf/fiscaal-memo.html](../server/templates/pdf/fiscaal-memo.html) | HTML template |
| [client/src/components/export/ExportDialog.tsx](../client/src/components/export/ExportDialog.tsx) | Frontend UI |

---

## 3. API Endpoints

### PDF Export

```http
GET /api/reports/:id/export-pdf
```

**Response**: PDF buffer met attachment headers

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="JDB-2024-00042-JanJansen.pdf"
```

### DOCX Export

```http
GET /api/reports/:id/export-docx
```

**Response**: DOCX buffer met attachment headers

```http
Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
Content-Disposition: attachment; filename="JDB-2024-00042-Jan Jansen-Fiscaal Memorandum.docx"
```

### JSON Export

```http
GET /api/reports/:id/export-json
```

**Response**: Complete rapport data als JSON download

```typescript
{
  // Alle rapport velden
  id, dossierNumber, title, clientName,
  dossierData, bouwplanData, stageResults,
  conceptReportVersions, ...

  // Export metadata
  _exportMetadata: {
    originalId: "uuid",
    source: "portal-jdb",
    exportedAt: "2024-01-15T10:30:00Z"
  },

  // Attachments (indien aanwezig)
  attachments: [...]
}
```

### JSON Import

```http
POST /api/reports/import-json
Content-Type: application/json

{body: exported JSON}
```

**Response**:
```json
{
  "success": true,
  "dossierNumber": 43,
  "reportId": "new-uuid"
}
```

### HTML Preview (Debug)

```http
GET /api/reports/:id/preview-pdf
```

**Response**: Raw HTML (opens in browser)

---

## 4. PDF Generator (Playwright)

### Architectuur

```typescript
// Singleton pattern
class HtmlPdfGenerator {
  private static instance: HtmlPdfGenerator;
  private browser: Browser | null;

  static getInstance(): HtmlPdfGenerator;

  // Lazy browser initialization
  private async ensureBrowser(): Promise<Browser>;

  // Main methods
  async generateHTMLPreview(report): Promise<string>;
  async generatePDF(report): Promise<Buffer>;

  // Cleanup
  async close(): Promise<void>;
}
```

### Flow

```
1. Report ophalen
   ↓
2. Content extracten (conceptReportVersions.latest)
   ↓
3. Markdown → HTML (marked library)
   ↓
4. Handlebars template laden
   ↓
5. Context bouwen:
   - clientName
   - date (dd MMMM yyyy)
   - subject (fiscale kernthemas)
   - referenceNumber (JDB-YYYY-NNNNN)
   - contentHtml
   ↓
6. Template renderen
   ↓
7. Chromium browser starten (lazy)
   ↓
8. HTML in page laden
   ↓
9. page.pdf() met settings:
   - Format: A4
   - Margins: 25mm
   - Header/footer templates
   ↓
10. PDF buffer returnen
```

### Template Structuur

```html
<!-- server/templates/pdf/fiscaal-memo.html -->

<head>
  <style>
    /* Print-optimized CSS */
    /* Proxima Nova font fallback */
    /* Color scheme: #4f46e5, #21468b */
  </style>
</head>

<body>
  <!-- Header -->
  <div class="header">
    <h1>FISCAAL MEMORANDUM</h1>
    <p>Jan de Belastingman · Fiscaal Adviesbureau</p>
  </div>

  <!-- Metadata block -->
  <div class="meta-block">
    <p>Aan: {{clientName}}</p>
    <p>Van: Jan de Belastingman</p>
    <p>Datum: {{date}}</p>
    <p>Betreft: {{subject}}</p>
    <p>Kenmerk: {{referenceNumber}}</p>
  </div>

  <!-- Content -->
  <div class="content">
    {{{contentHtml}}}  <!-- Triple braces = unescaped HTML -->
  </div>

  <!-- Disclaimer -->
  <div class="disclaimer">
    <p>Dit document is AI-gegenereerd...</p>
  </div>
</body>
```

---

## 5. DOCX Generator

### Architectuur

```typescript
class DocxGenerator {
  private static instance: DocxGenerator;

  static getInstance(): DocxGenerator;

  async generateDocx(report): Promise<Buffer>;
}
```

### Flow

```
1. HtmlPdfGenerator.generateHTMLPreview() aanroepen
   ↓
2. html-to-docx library gebruiken:
   - Font: Calibri
   - Font size: 22 (11pt)
   - Margins: 1 inch
   - Table styling: cantSplit
   - Footer enabled
   ↓
3. DOCX buffer returnen
```

### Configuratie

```typescript
const options = {
  font: 'Calibri',
  fontSize: 22,           // 11pt in half-points
  table: { cantSplit: true },
  footer: true,
  pageNumber: true,
  margins: {
    top: 1440,            // 1 inch in twips
    right: 1440,
    bottom: 1440,
    left: 1440
  }
};
```

---

## 6. Legacy PDF Generator (jsPDF)

Direct PDF generatie zonder browser rendering.

### Kenmerken

- Pure JavaScript PDF creatie
- TipTap JSON editor content support
- Recursieve node rendering
- Eigen pagination logica
- Minder styling mogelijkheden

### Wanneer Gebruiken

- Als Playwright niet beschikbaar is
- Voor programmatische PDF manipulatie
- Als fallback

---

## 7. Font Handling

### Font Loader

```typescript
// server/services/pdf-fonts.ts

class PDFFontLoader {
  private static instance: PDFFontLoader;
  private fonts: Map<string, Buffer>;

  // Laad fonts van disk
  async loadFonts(): Promise<void>;

  // Get font buffer
  getFont(name: string): Buffer | null;
}
```

### Fonts Locatie

```
server/assets/fonts/
├── ProximaNova-Regular.ttf
├── ProximaNova-Bold.ttf
├── ProximaNova-Italic.ttf      (optioneel)
└── ProximaNova-BoldItalic.ttf  (optioneel)
```

### Fallback

Als fonts niet gevonden worden:
- Log warning naar console
- Gebruik Helvetica (ingebouwd in PDF)

---

## 8. Frontend Export Dialog

### UI Componenten

```typescript
// client/src/components/export/ExportDialog.tsx

<Dialog>
  {/* Format selectie */}
  <FormatButtons>
    <Button>PDF</Button>
    <Button>Word</Button>
    <Button>HTML</Button>
    <Button>JSON</Button>
  </FormatButtons>

  {/* Export opties (PDF/Word/HTML) */}
  <ExportOptions>
    <Checkbox>Inhoudsopgave</Checkbox>
    <Checkbox>Bronnenlijst</Checkbox>
    <Checkbox>Footer met contact</Checkbox>
    <Checkbox>Bedrijfsbranding</Checkbox>
  </ExportOptions>

  {/* Download knoppen */}
  <DownloadButtons>
    <Button>Download voor Klant</Button>
    <Button>Download Werkversie</Button>
  </DownloadButtons>

  {/* JSON info */}
  <JSONInfo>
    Gebruik JSON voor dev/prod synchronisatie...
  </JSONInfo>
</Dialog>
```

### Export Functionaliteit

```typescript
// PDF export
const exportPDF = async () => {
  const response = await fetch(`/api/reports/${reportId}/export-pdf`);
  const blob = await response.blob();
  downloadBlob(blob, filename);
};

// DOCX export
const exportDOCX = async () => {
  const response = await fetch(`/api/reports/${reportId}/export-docx`);
  const blob = await response.blob();
  downloadBlob(blob, filename);
};

// JSON export
const exportJSON = async () => {
  const response = await fetch(`/api/reports/${reportId}/export-json`);
  const blob = await response.blob();
  downloadBlob(blob, filename);
};

// Preview (PDF)
const preview = () => {
  window.open(`/api/reports/${reportId}/preview-pdf`, '_blank');
};
```

---

## 9. Bestandsnamen

### Formaat

| Type | Patroon | Voorbeeld |
|------|---------|-----------|
| PDF | `JDB-{dossierNumber}-{clientName}.pdf` | `JDB-00042-JanJansen.pdf` |
| DOCX | `JDB-{year}-{number}-{name}-Fiscaal Memorandum.docx` | `JDB-2024-00042-Jan Jansen-Fiscaal Memorandum.docx` |
| JSON | `dossier-D{number}-{clientName}.json` | `dossier-D00042-JanJansen.json` |

### Sanitization

```typescript
// Verwijder speciale karakters
const sanitize = (name: string) =>
  name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
```

---

## 10. Content Extractie

### Prioriteit

```typescript
function getExportContent(report): string {
  // 1. Probeer latest concept version
  if (report.conceptReportVersions?.latest) {
    const pointer = report.conceptReportVersions.latest.pointer;
    return report.conceptReportVersions[pointer]?.content;
  }

  // 2. Fallback naar generated content
  return report.generatedContent;
}
```

### Subject Extractie

```typescript
function getSubject(report): string {
  // Uit bouwplanData.fiscale_kernthemas
  const kernthemas = report.bouwplanData?.fiscale_kernthemas;

  if (Array.isArray(kernthemas)) {
    return kernthemas.join(', ');
  }

  return 'Fiscaal Advies';
}
```

---

## 11. Google Docs Optimalisatie

### Header Kleuren

```css
/* Rood voor headers - herkend door Google Docs */
h1, h2, h3 {
  color: #ff0000;
}
```

### Post-Processing

```typescript
// Transform heading levels voor betere hierarchie
html = html
  .replace(/<h2/g, '<h1')
  .replace(/<h3/g, '<h2');
```

### Line Height

```css
body {
  line-height: 1.5;  /* Consistentie met Docs */
}
```

---

## 12. Deployment

### Playwright/Chromium

```dockerfile
# Dockerfile
RUN npx playwright install chromium
RUN npx playwright install-deps chromium
```

### Font Assets

```dockerfile
COPY server/assets/fonts /app/server/assets/fonts
```

### Memory

PDF rendering kan geheugenintensief zijn:
- Chromium instance wordt hergebruikt (singleton)
- Browser blijft open voor meerdere exports
- Overweeg timeout/cleanup bij idle

---

## 13. Debugging Tips

### Preview Gebruiken

```
GET /api/reports/:id/preview-pdf
```

Opent HTML in browser - handig voor styling issues.

### Common Issues

| Probleem | Oorzaak | Oplossing |
|----------|---------|-----------|
| Lege PDF | Geen content gevonden | Check conceptReportVersions |
| Fonts missen | Font files niet gevonden | Check server/assets/fonts/ |
| Timeout | Chromium start traag | Eerste request duurt langer |
| Styling broken | CSS niet geladen | Check template path |
| DOCX corrupt | HTML parsing error | Check generated HTML |

### Logs

```bash
# Export errors
grep "export" logs/server.log

# PDF generation
grep "HtmlPdfGenerator" logs/server.log
```
