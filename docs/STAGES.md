# Stage Definition Matrix

> **Doel**: Dit document geeft nieuwe developers een compleet overzicht van alle stages in de AI pipeline.
> Geen giswerk meer over "wat doet stage X?" of "wanneer draait stage Y?"

## Quick Reference: Stage Types

De workflow heeft **drie typen stages**:

| Type | Stages | Wat doen ze? | Output |
|------|--------|--------------|--------|
| **Analyzer** | 1a, 1b, 2 | Analyseren input, genereren geen rapport | JSON structured output |
| **Generator** | 3 | Genereert het basis rapport | Markdown rapport tekst |
| **Reviewer** | 4a-4f | Reviewen en geven feedback op rapport | Feedback + changeProposals |
| **Processor** | editor | Past feedback toe op rapport | Gewijzigd rapport |
| **Summarizer** | 6, 7 | Samenvatten van wijzigingen/briefing | Structured output |

---

## Stage Matrix

### Stage 1a: Informatie Analyse (`1a_informatiecheck`)

| Aspect | Details |
|--------|---------|
| **Doel** | Controleren of klant alle benodigde informatie heeft aangeleverd |
| **Input** | `dossierData.rawText` (de ruwe klant tekst) |
| **Output** | JSON: `{ status: "COMPLEET" \| "INCOMPLEET", dossier?: {...}, ontbrekende_info?: [...] }` |
| **Type** | Analyzer |
| **Wanneer draait dit?** | ALTIJD als eerste stage |
| **Blokkeert volgende stages?** | JA, als status = "INCOMPLEET" → workflow stopt |
| **Versioning** | Geen snapshot (produceert geen rapport content) |
| **Prompt builder method** | `buildInformatieCheckData(dossier, previousStageResults)` |

**Let op**:
- `rawText` is ALLEEN nodig in deze stage, niet in latere stages
- Als `status: "INCOMPLEET"`, triggert dit Stage 1b (email generatie)

---

### Stage 1b: Email Generatie (`1b_informatiecheck_email`)

| Aspect | Details |
|--------|---------|
| **Doel** | Genereer een email aan de klant voor ontbrekende informatie |
| **Input** | Output van Stage 1a (ontbrekende_info array) |
| **Output** | JSON: `{ email_subject: "...", email_body: "<html>..." }` |
| **Type** | Analyzer |
| **Wanneer draait dit?** | ALLEEN als Stage 1a status = "INCOMPLEET" |
| **Blokkeert volgende stages?** | Nee (dit is een "doodlopend" pad) |
| **Versioning** | Geen snapshot |
| **Prompt builder method** | `buildInformatieCheckEmailData(previousStageResults)` |

---

### Stage 2: Complexiteits Check (`2_complexiteitscheck`)

| Aspect | Details |
|--------|---------|
| **Doel** | Analyseer de complexiteit en bouw een rapport structuur (bouwplan) |
| **Input** | `dossierData` + Stage 1a output (gestructureerde dossier) |
| **Output** | JSON: `BouwplanData` (kernthemas, risicos, bouwplan_voor_rapport) |
| **Type** | Analyzer |
| **Wanneer draait dit?** | Na Stage 1a (alleen als status = "COMPLEET") |
| **Blokkeert volgende stages?** | Nee |
| **Versioning** | Geen snapshot (produceert structuur, geen rapport tekst) |
| **Prompt builder method** | `buildComplexiteitsCheckData(dossier, previousStageResults)` |

**Nieuw in v2**: Output bevat nu `denkwijze_samenvatting` met AI reasoning.

---

### Stage 3: Basis Rapport Generatie (`3_generatie`)

| Aspect | Details |
|--------|---------|
| **Doel** | Genereer het eerste concept rapport |
| **Input** | `dossierData` + `bouwplanData` (van Stage 2) |
| **Output** | Markdown rapport tekst (geen JSON!) |
| **Type** | Generator |
| **Wanneer draait dit?** | Na Stage 2 |
| **Blokkeert volgende stages?** | Nee |
| **Versioning** | `conceptReportVersions["3_generatie"] = { v: 1, content: "..." }` |
| **Prompt builder method** | `buildStage3Data(dossier, bouwplan, previousStageResults)` |

**Belangrijk**:
- Dit is de ENIGE stage die het basis rapport genereert
- Alle volgende stages (4a-4f) reviewen dit rapport
- Timeout is langer (10+ min) vanwege output length

---

### Stage 4a: Bronnen Specialist (`4a_BronnenSpecialist`)

| Aspect | Details |
|--------|---------|
| **Doel** | Review bronverwijzingen en juridische onderbouwing |
| **Input** | Concept rapport + dossier context |
| **Output** | JSON: `{ review: "...", changeProposals: [...] }` |
| **Type** | Reviewer |
| **Wanneer draait dit?** | Na Stage 3 |
| **Kan parallel met?** | Ja, met andere 4x stages (indien geconfigureerd) |
| **Versioning** | Geen eigen snapshot (feedback gaat naar `substepResults`) |
| **Prompt builder method** | `buildReviewerData(conceptReport, dossier, bouwplan)` |
| **Grounding** | Ja (useGrounding: true) - zoekt op internet |

---

### Stage 4b: Fiscaal Technisch Specialist (`4b_FiscaalTechnischSpecialist`)

| Aspect | Details |
|--------|---------|
| **Doel** | Review fiscaal-technische correctheid |
| **Input** | Concept rapport + dossier context |
| **Output** | JSON: `{ review: "...", changeProposals: [...] }` |
| **Type** | Reviewer |
| **Wanneer draait dit?** | Na Stage 3 (of parallel met 4a) |
| **Versioning** | Geen eigen snapshot |
| **Prompt builder method** | `buildReviewerData(conceptReport, dossier, bouwplan)` |
| **Grounding** | Ja (useGrounding: true) |

---

### Stage 4c: Scenario Gaten Analist (`4c_ScenarioGatenAnalist`)

| Aspect | Details |
|--------|---------|
| **Doel** | Identificeer "wat als" scenarios die niet behandeld zijn |
| **Input** | Concept rapport + dossier context |
| **Output** | JSON: `{ review: "...", changeProposals: [...] }` |
| **Type** | Reviewer |
| **Wanneer draait dit?** | Na Stage 3 |
| **Versioning** | Geen eigen snapshot |
| **Prompt builder method** | `buildReviewerData(conceptReport, dossier, bouwplan)` |
| **Grounding** | Ja (useGrounding: true) |

---

### Stage 4e: De Advocaat (`4e_DeAdvocaat`)

| Aspect | Details |
|--------|---------|
| **Doel** | Juridische review, check op claims en risicos |
| **Input** | Concept rapport + dossier context |
| **Output** | JSON: `{ review: "...", changeProposals: [...] }` |
| **Type** | Reviewer |
| **Wanneer draait dit?** | Na Stage 3 |
| **Versioning** | Geen eigen snapshot |
| **Prompt builder method** | `buildReviewerData(conceptReport, dossier, bouwplan)` |
| **Grounding** | Ja (useGrounding: true) |

**Opmerking**: Stage 4d bestaat niet in de huidige workflow (overgeslagen in nummering).

---

### Stage 4f: Hoofd Communicatie (`4f_HoofdCommunicatie`)

| Aspect | Details |
|--------|---------|
| **Doel** | Review leesbaarheid, toon en klantcommunicatie |
| **Input** | Concept rapport + dossier context |
| **Output** | JSON: `{ review: "...", changeProposals: [...] }` |
| **Type** | Reviewer |
| **Wanneer draait dit?** | Na Stage 3 |
| **Versioning** | Geen eigen snapshot |
| **Prompt builder method** | `buildReviewerData(conceptReport, dossier, bouwplan)` |
| **Grounding** | Nee (useGrounding: false) - taal/stijl review |

---

### Editor Stage (`editor`)

| Aspect | Details |
|--------|---------|
| **Doel** | Verwerk goedgekeurde changeProposals in het rapport |
| **Input** | Concept rapport + changeProposals van reviewer |
| **Output** | Gewijzigd rapport tekst |
| **Type** | Processor |
| **Wanneer draait dit?** | Na "Process Feedback" actie op een reviewer stage |
| **Versioning** | `conceptReportVersions["<stageId>"] = { v: N+1, content: "...", from: "..." }` |
| **Prompt builder method** | `buildEditorData(previousStageResults, conceptVersions)` |

**Let op**:
- "editor" staat NIET in `STAGE_ORDER` - het is een helper stage
- Wordt aangeroepen via `/api/reports/:id/stage/:stageId/process-feedback`

---

### Stage 6: Change Summary (`6_change_summary`)

| Aspect | Details |
|--------|---------|
| **Doel** | Samenvatten van alle wijzigingen door reviewers |
| **Input** | Alle stageResults + conceptVersions history |
| **Output** | Structured summary van wijzigingen |
| **Type** | Summarizer |
| **Wanneer draait dit?** | Na alle reviewer stages |
| **Versioning** | Geen snapshot |
| **Prompt builder method** | `buildChangeSummaryData(previousStageResults, conceptVersions)` |

---

### Stage 7: Fiscale Briefing (`7_fiscale_briefing`)

| Aspect | Details |
|--------|---------|
| **Doel** | Executive summary voor fiscalist die case oppakt |
| **Input** | Volledig rapport + alle stage results |
| **Output** | JSON: `FiscaleBriefing` (zie schema.ts) |
| **Type** | Summarizer |
| **Wanneer draait dit?** | Als laatste stage (optioneel) |
| **Versioning** | `conceptReportVersions["7_fiscale_briefing"]` (apart van rapport) |
| **Prompt builder method** | Custom (niet via standaard builder) |

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         STAGE DATA FLOW                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  rawText (klant input)                                                  │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────┐                                                        │
│  │ Stage 1a    │──► stageResults["1a_informatiecheck"]                 │
│  │ Info Check  │    { status, dossier?, ontbrekende_info? }            │
│  └─────────────┘                                                        │
│       │                                                                 │
│       ├── INCOMPLEET ──► Stage 1b (Email) ──► STOP                     │
│       │                                                                 │
│       ▼ COMPLEET                                                        │
│  ┌─────────────┐                                                        │
│  │ Stage 2     │──► bouwplanData (stored on report)                    │
│  │ Complexiteit│    { kernthemas, risicos, bouwplan_voor_rapport }     │
│  └─────────────┘                                                        │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────┐                                                        │
│  │ Stage 3     │──► conceptReportVersions["3_generatie"]               │
│  │ Generatie   │    { v: 1, content: "rapport tekst..." }              │
│  └─────────────┘                                                        │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────┐               │
│  │              REVIEWER STAGES (4a-4f)                 │               │
│  │                                                      │               │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐             │               │
│  │  │ 4a      │  │ 4b      │  │ 4c      │  ...        │               │
│  │  │ Bronnen │  │ Fiscaal │  │ Scenario│             │               │
│  │  └────┬────┘  └────┬────┘  └────┬────┘             │               │
│  │       │            │            │                   │               │
│  │       ▼            ▼            ▼                   │               │
│  │  substepResults[stageId] = {                        │               │
│  │    review: "...",                                   │               │
│  │    changeProposals: [...]                           │               │
│  │  }                                                  │               │
│  └─────────────────────────────────────────────────────┘               │
│       │                                                                 │
│       │ (user clicks "Process Feedback")                               │
│       ▼                                                                 │
│  ┌─────────────┐                                                        │
│  │ Editor      │──► conceptReportVersions["<stageId>"]                 │
│  │ (hidden)    │    { v: N+1, content: "...", from: "previous" }       │
│  └─────────────┘                                                        │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────┐                                                        │
│  │ Stage 6     │──► stageResults["6_change_summary"]                   │
│  │ Summary     │    (overzicht van alle wijzigingen)                   │
│  └─────────────┘                                                        │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────┐                                                        │
│  │ Stage 7     │──► conceptReportVersions["7_fiscale_briefing"]        │
│  │ Briefing    │    (executive summary voor fiscalist)                 │
│  └─────────────┘                                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ConceptReportVersions Structuur

Dit is het **meest complexe data model** in de codebase. Hier is hoe het werkt:

```typescript
// Na Stage 3:
conceptReportVersions = {
  "3_generatie": { v: 1, content: "Basis rapport...", createdAt: "..." },
  latest: { pointer: "3_generatie", v: 1 }
}

// Na Stage 4a feedback processing:
conceptReportVersions = {
  "3_generatie": { v: 1, content: "Basis rapport...", createdAt: "..." },
  "4a_BronnenSpecialist": {
    v: 2,
    content: "Rapport met bronnen...",
    from: "3_generatie",      // ← Traceert origin
    processedFeedback: "..."
  },
  latest: { pointer: "4a_BronnenSpecialist", v: 2 },  // ← Updated!
  history: [
    { stageId: "3_generatie", v: 1, timestamp: "..." },
    { stageId: "4a_BronnenSpecialist", v: 2, timestamp: "..." }
  ]
}
```

### Invarianten (ALTIJD waar):

1. `latest.pointer` wijst naar een bestaande stage key
2. `latest.v` is de hoogste versie nummer
3. Elke snapshot heeft `from` die naar de vorige stage wijst (behalve "3_generatie")
4. `history` array is chronologisch gesorteerd

### Helper functie:

```typescript
import { getLatestConceptText } from "@shared/constants";

// Gebruik dit om de nieuwste rapport tekst te krijgen:
const latestText = getLatestConceptText(report.conceptReportVersions);
```

---

## Waar Vind Je Wat?

| Wat zoek je? | Bestand |
|--------------|---------|
| Stage namen (UI) | `shared/constants.ts` → `STAGE_NAMES` |
| Stage volgorde | `shared/constants.ts` → `STAGE_ORDER` |
| Stage type definitions | `shared/schema.ts` → `stageIdSchema` |
| Stage execution logic | `server/services/report-generator.ts` → `executeStage()` |
| Prompt building | `server/services/prompt-builder.ts` |
| Reviewer stage list | `shared/constants.ts` → `REVIEW_STAGES` |
| Stage timeouts | `server/config/index.ts` → `REPORT_CONFIG.stages` |
| Stage prompt configs | Database → `prompt_configs` tabel |

---

## Veelgemaakte Fouten

### 1. Stage toevoegen zonder alle locaties

Als je een nieuwe stage toevoegt, update ALLE van deze:

- [ ] `shared/constants.ts` → `STAGE_NAMES`
- [ ] `shared/constants.ts` → `STAGE_ORDER` (indien in workflow)
- [ ] `shared/schema.ts` → `stageIdSchema`
- [ ] `shared/schema.ts` → `promptConfigSchema`
- [ ] `server/services/report-generator.ts` → switch statement in `executeStage()`
- [ ] `server/services/prompt-builder.ts` → data builder method

### 2. Editor stage verwachten in STAGE_ORDER

`editor` is een **helper stage**, geen workflow stage. Het staat NIET in `STAGE_ORDER`.

### 3. rawText verwachten in reviewer stages

`rawText` wordt gefilterd in `buildReviewerData()`. Dit is intentioneel - reviewers hebben de originele klant tekst niet nodig.

### 4. Reviewer output als rapport tekst behandelen

Reviewers produceren **feedback JSON**, niet rapport tekst. Het "editor" stage past de feedback toe.
