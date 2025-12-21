# Box 3 Document Extraction Pipeline

> **Status**: Production
> **Versie**: 3.0 (V2 Aangifte-First Architecture)
> **Laatst bijgewerkt**: December 2025
> **Doel**: Automatisch Nederlandse belastingdocumenten verwerken voor Box 3 bezwaarprocedures

---

## ⭐ V2 Pipeline: Aangifte-First Architecture (NIEUW)

De nieuwe V2 pipeline vervangt de oude 6-stage pipeline met een eenvoudigere, nauwkeurigere aanpak.

### Kernprincipe

**De aangifte is de enige bron van waarheid.** We classificeren niets zelf - we lezen alleen wat er staat.

### Waarom V2?

De oude pipeline had problemen met:
- Duplicaten door reclassificatie
- Schulden die als bezittingen werden gezien
- Inconsistente owner_id toewijzing

V2 lost dit op door de aangifte als "manifest" te gebruiken en alleen aan te vullen met werkelijk rendement data.

### V2 Pipeline Stages

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: MANIFEST EXTRACTION                                               │
│  Model: gemini-3-pro-preview + high thinking                                │
│  System: BOX3_SYSTEM_PROMPT (senior fiscalist persona)                      │
│                                                                             │
│  Input:  Aangifte IB / Definitieve aanslag                                  │
│  Output: Complete vermogensopstelling EXACT zoals in aangifte               │
│                                                                             │
│  - Elke asset krijgt category op basis van POSITIE in aangifte              │
│  - Schulden vs bezittingen bepaald door sectie, niet door naam              │
│  - Eigenaarschap uit aangifte (joint/tp_01/fp_01)                           │
│  - Totalen per categorie voor validatie                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STAGE 2: ENRICHMENT                                                        │
│  Model: gemini-3-pro-preview + high thinking                                │
│                                                                             │
│  Input:  Manifest + Brondocumenten + Klant email                            │
│  Output: Manifest verrijkt met werkelijk rendement                          │
│                                                                             │
│  Per item zoekt de AI:                                                      │
│  - Bank: full_iban, interest_received                                       │
│  - Belegging: dividends_received, costs_paid                                │
│  - Vordering: agreed_interest_rate, interest_received, borrower_name       │
│  - Schuld: interest_paid                                                    │
│                                                                             │
│  KRITIEK: Manifest items worden NOOIT gewijzigd, alleen aangevuld!          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STAGE 3: VALIDATION & CALCULATION                                          │
│  Type: Deterministic (geen LLM)                                             │
│                                                                             │
│  1. Totalen validatie (som items vs aangifte totalen)                       │
│  2. Werkelijk rendement berekening                                          │
│  3. Vergelijking met forfaitair rendement                                   │
│  4. Indicatieve teruggave berekening                                        │
│  5. Is bezwaar zinvol? (drempel: €250)                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### System Prompt: Senior Fiscalist

De V2 pipeline gebruikt een dedicated system instruction die de AI positioneert als:

```
Senior fiscaal specialist bij een gerenommeerd Nederlands belastingadvieskantoor

EXPERTISE:
- 15+ jaar ervaring met Nederlandse IB
- Expert in Hoge Raad arresten (Kerstarrest 2021)
- Specialisatie Box 3 vermogensrendementsheffing
- Ervaring met massaal bezwaar procedures

JURISPRUDENTIE:
- HR 24 december 2021 (Kerstarrest)
- Wet rechtsherstel box 3 (2022)
- Overbruggingswet box 3 (2023-2026)

WERKWIJZE:
- EXTREEM nauwkeurig met getallen
- Aangifte is altijd leidend (ground truth)
- Documenteer alle aannames
- Gestructureerde JSON output
```

### Kernbestanden V2

| Bestand | Doel |
|---------|------|
| [server/services/box3-pipeline-v2.ts](../server/services/box3-pipeline-v2.ts) | **Pipeline orchestratie** |
| [server/services/box3-prompts-v2.ts](../server/services/box3-prompts-v2.ts) | **Prompts + System instruction** |
| [shared/schema/box3-manifest.ts](../shared/schema/box3-manifest.ts) | **Manifest types** |

### Model Configuratie

```typescript
MODEL_CONFIG = {
  model: 'gemini-3-pro-preview',
  provider: 'google',
  temperature: 0.0,          // Deterministic
  thinkingLevel: 'high',     // Maximum reasoning
  maxOutputTokens: 65536,    // Large manifest output
  systemInstruction: BOX3_SYSTEM_PROMPT
}
```

### Manifest Extractie Voorbeeld

Input: Aangifte IB sectie "Bankrekeningen en andere bezittingen"

Output:
```json
{
  "schema_version": "3.0",
  "tax_years": ["2024"],
  "asset_items": {
    "bank_savings": [
      {
        "manifest_id": "bank_1",
        "description_from_aangifte": "ING Oranje Spaarrekening NL22INGB****4567",
        "category": "bank_savings",
        "owner_id": "joint",
        "yearly_values": { "2024": { "value_jan_1": 85000 } }
      }
    ],
    "other_assets": [
      {
        "manifest_id": "other_1",
        "description_from_aangifte": "Hypotheek aan zoon WH Vonck",
        "category": "other_assets",
        "asset_type": "loaned_money",
        "yearly_values": { "2024": { "value_jan_1": 600000 } },
        "loan_details": { "borrower_name": "WH Vonck", "is_family_loan": true }
      }
    ]
  }
}
```

### Enrichment Voorbeeld

Input: Klant email met "hypotheek aan mijn zoon €600.000 tegen 3.5%pj, rente €21.000 per jaar"

Output (toegevoegd aan manifest item):
```json
{
  "manifest_id": "other_1",
  "enrichment": {
    "matched_source_doc_id": "email_context",
    "match_confidence": 0.95,
    "agreed_interest_rate": 3.5,
    "interest_received": 21000,
    "borrower_name": "WH Vonck"
  }
}
```

### Kritieke Prompt Instructies

De manifest extractie prompt bevat expliciete instructies om veelgemaakte fouten te voorkomen:

**Schulden vs Bezittingen:**
```
SECTIE 1: "Bankrekeningen en andere bezittingen" (= BEZITTINGEN)
SECTIE 2: "Hypotheken en andere schulden" (= SCHULDEN!)

FOUT: Items uit "Hypotheken en andere schulden" als bezittingen classificeren.
De POSITIE in de aangifte bepaalt de classificatie, niet de naam.
```

**Vorderingen:**
```
"familie hypotheek €60.000" → other_assets, asset_type: "loaned_money"
Let op: dit zijn BEZITTINGEN (geld dat JIJ hebt uitgeleend aan anderen)
Niet verwarren met schulden (geld dat JIJ hebt geleend VAN anderen)
```

**Eigenaarschap:**
```
"Was deze rekening alleen van [naam] en [partner]?"
- "Ja" met beide namen → owner_id: "joint"
- Alleen belastingplichtige → owner_id: "tp_01"
- Alleen partner → owner_id: "fp_01"
```

---

## Legacy: 6-Stage Pipeline

> ⚠️ **Let op**: De onderstaande documentatie beschrijft de oude 6-stage pipeline.
> Nieuwe dossiers gebruiken de V2 Aangifte-First pipeline hierboven.

---

## 1. High-Level Overzicht

De Box 3 extraction pipeline is een **6-stage LLM-powered systeem** dat Nederlandse belastingdocumenten verwerkt om financiele data te extraheren voor Box 3 (vermogensrendementsheffing) bezwaar-dossiers.

### Architectuurprincipes

1. **Ground Truth First** - Belastingdienst-totalen als referentie, niet als harde constraint
2. **Semantic Deduplication** - 4-staps waterval voorkomt duplicaten
3. **Audit Trail** - Elke waarde traceerbaar naar brondocument
4. **Fiscaal Correct** - Ingebouwde checks voor peildatum, eigendomspercentage, uitsluitingen

```
┌─────────────────────────────────────────────────────────────────────┐
│  GEBRUIKER                                                           │
│  Upload: intake email + PDF's (jaaroverzichten, aanslagen)          │
└─────────────────┬───────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (React)                                                    │
│  - useBox3Validation hook (orchestratie)                            │
│  - Job-based processing (background, browser mag sluiten)           │
└─────────────────┬───────────────────────────────────────────────────┘
                  │ POST /api/box3-validator/validate-job
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BACKEND (Express)                                                   │
│  box3-v2-routes.ts → box3-extraction-pipeline.ts                    │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  PIPELINE (6 Stages)                                           │ │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────┐ │ │
│  │  │Stage 1 │→│Stage 2 │→│Stage 3 │→│Stage 4 │→│Stage 4b│→│St.5│ │ │
│  │  │Classif.│ │TaxAuth │ │Assets  │ │ Merge  │ │ Dedup  │ │Val.│ │ │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────┘ │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────┬───────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  DATABASE (PostgreSQL)                                               │
│  - box3_dossiers (metadata)                                         │
│  - box3_documents (uploads + classificatie)                         │
│  - box3_blueprints (geëxtraheerde data, versioned)                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Kernbestanden

| Bestand | Doel |
|---------|------|
| [server/services/box3-extraction-pipeline.ts](../server/services/box3-extraction-pipeline.ts) | **Hoofdlogica** - 6-stage orchestratie |
| [server/services/box3-deduplication.ts](../server/services/box3-deduplication.ts) | **NIEUW** - Semantic fingerprinting & 4-staps dedup |
| [server/services/box3-prompts.ts](../server/services/box3-prompts.ts) | Alle LLM prompts per stage |
| [server/services/box3-merge-engine.ts](../server/services/box3-merge-engine.ts) | Incrementele merge bij aanvullingen |
| [server/routes/box3-v2-routes.ts](../server/routes/box3-v2-routes.ts) | REST API endpoints |
| [shared/schema/box3.ts](../shared/schema/box3.ts) | Database schema + TypeScript types (incl. fingerprint types) |
| [client/src/hooks/useBox3Validation.ts](../client/src/hooks/useBox3Validation.ts) | Frontend orchestratie hook |
| [client/src/constants/box3.constants.ts](../client/src/constants/box3.constants.ts) | Forfaitaire rendementen, tarieven |

---

## 3. De 6 Pipeline Stages

### Stage 1: Document Classification

**Doel**: Elk document categoriseren en relevante metadata detecteren.

**Input**: Ruwe documenten (PDF/images als base64)

**Model**: `gemini-3-flash-preview` (vision-capable)

**Prompt**: `CLASSIFICATION_PROMPT` in box3-prompts.ts

**Output per document**:
```typescript
{
  document_type: 'aangifte_ib' | 'definitieve_aanslag' | 'jaaroverzicht_bank' |
                 'effectenoverzicht' | 'hypotheekoverzicht' | 'woz_beschikking' | ...
  tax_years: ['2022', '2023'],
  detected_persons: ['belastingplichtige', 'fiscaal_partner'],
  asset_hints: ['ABN AMRO', 'Meesman'],
  confidence: 0.95
}
```

**Code locatie**: `classifyDocuments()` methode (regel ~300)

---

### Stage 2: Tax Authority Data Extraction

**Doel**: Officiële Belastingdienst data extraheren als "Ground Truth".

**Input**: Documenten geclassificeerd als `aangifte_ib` of `definitieve_aanslag`

**Model**: `gemini-3-flash-preview`

**Sub-extracties** (3 aparte calls voor betere nauwkeurigheid):

| Sub-stage | Prompt | Output |
|-----------|--------|--------|
| 2a: Personen | `TAX_AUTHORITY_PERSONS_PROMPT` | Belastingplichtige + partner info |
| 2b: Totalen | `TAX_AUTHORITY_TOTALS_PROMPT` | Vermogen, schulden, heffing per jaar |
| 2c: Asset Checklist | `TAX_AUTHORITY_CHECKLIST_PROMPT` | Aantal bankrekeningen, beleggingen, etc. |

**Output structuur**:
```typescript
{
  fiscal_entity: {
    taxpayer: { id: 'tp_01', name: 'J. Jansen', bsn_masked: '****4567' },
    fiscal_partner: { has_partner: true, id: 'fp_01', name: 'S. Jansen' }
  },
  tax_authority_data: {
    '2023': {
      document_type: 'definitieve_aanslag',
      per_person: {
        'tp_01': { total_assets_box3: 280000, deemed_return: 5800, tax_assessed: 1856 }
      }
    }
  },
  asset_references: {
    bank_accounts_count: 3,
    investment_accounts_count: 1,
    real_estate_count: 1
  }
}
```

**Code locatie**: `extractTaxAuthorityData()` methode (regel ~450)

---

### Stage 3: Asset Category Extraction

**Doel**: Alle vermogensbestanddelen extraheren met jaarlijkse waarden.

**Architectuur**: "Ground Truth First" - sequentieel met exclusion context

```
┌─────────────────┐
│ Stage 2 Output  │ (asset checklist als referentie)
└────────┬────────┘
         │
         ▼
┌─────────────────┐    exclusion context
│ 3a: Bankrek.    │ ──────────────────────┐
└────────┬────────┘                       │
         │                                ▼
         ▼                     ┌─────────────────┐
┌─────────────────┐            │ "Skip: ABN AMRO │
│ 3b: Beleggingen │ ◄──────────│  al geëxtraheerd│
└────────┬────────┘            │  als bank"      │
         │                     └─────────────────┘
         ▼
┌─────────────────┐
│ 3c: Vastgoed    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3d: Overig +    │
│     Schulden    │
└─────────────────┘
```

**Waarom sequentieel?** Voorkomt dat dezelfde asset in meerdere categorieën belandt (bijv. een "ABN AMRO beleggingsrekening" kan zowel bank als belegging lijken).

**Per categorie**:

| Stage | Prompt Builder | Output Type |
|-------|----------------|-------------|
| 3a | `buildBankExtractionPrompt()` | `Box3BankSavingsAsset[]` |
| 3b | `buildInvestmentExtractionPrompt()` | `Box3InvestmentAsset[]` |
| 3c | `buildRealEstateExtractionPrompt()` | `Box3RealEstateAsset[]` |
| 3d | `buildOtherAssetsExtractionPrompt()` | `Box3OtherAsset[]` + `Box3Debt[]` |

**Asset output voorbeeld** (bankrekening):
```typescript
{
  id: 'asset_bank_01',
  owner_id: 'tp_01',
  description: 'ABN AMRO Spaarrekening',
  account_masked: 'NL22ABNA****99',
  bank_name: 'ABN AMRO',
  yearly_data: {
    '2023': {
      value_jan_1: { amount: 45000, source_doc_id: 'doc_001', confidence: 1.0 },
      value_dec_31: { amount: 47500, source_doc_id: 'doc_001', confidence: 1.0 },
      interest_received: { amount: 625.50, source_doc_id: 'doc_002', confidence: 0.95 }
    }
  }
}
```

**Code locatie**: `extractBankAccounts()`, `extractInvestments()`, etc. (regel ~600-900)

---

### Stage 4: Merge & Reconcile

**Doel**: Alle stage outputs combineren tot één coherente Blueprint.

**Proces**:
1. Initialiseer lege Blueprint structuur
2. Voeg fiscal_entity toe (uit Stage 2)
3. Voeg tax_authority_data toe (uit Stage 2)
4. Voeg assets per categorie toe (uit Stage 3)
5. Bouw source_documents_registry (alle bronverwijzingen)
6. Initialiseer validation_flags en manual_overrides als leeg

**Code locatie**: `mergeResults()` methode (regel ~950)

---

### Stage 4b: Semantic Deduplication (NIEUW)

**Doel**: Duplicaten detecteren en samenvoegen op basis van semantische gelijkheid.

**Waarom nodig?** Dezelfde bankrekening kan in meerdere documenten voorkomen met licht verschillende beschrijvingen ("ING Spaarrekening" vs "ING Bank Sparen"). String-matching mist deze duplicaten.

**4-Staps Waterval**:

```
┌─────────────────────────────────────────────────────────────────────┐
│  STAP 1: EXACT MATCH                                                │
│  Criteria: Identieke IBAN + identiek eigendomspercentage           │
│  Actie: ✅ Automatisch samenvoegen                                  │
└────────────────────────────┬────────────────────────────────────────┘
                             │ Niet exact?
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAP 2: HIGH PROBABILITY                                           │
│  Criteria: Zelfde instelling + laatste 4 cijfers + bedrag <1%      │
│  Actie: ✅ Samenvoegen met logging                                  │
└────────────────────────────┬────────────────────────────────────────┘
                             │ Niet high?
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAP 3: POSSIBLE MATCH                                             │
│  Criteria: Zelfde instelling + partial identifier match            │
│  Actie: ⚠️ Flag voor menselijke review                              │
└────────────────────────────┬────────────────────────────────────────┘
                             │ Niet possible?
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAP 4: UNCERTAIN                                                  │
│  Criteria: Enige overlap maar niet genoeg                          │
│  Actie: ❌ NOOIT automatisch samenvoegen                            │
└─────────────────────────────────────────────────────────────────────┘
```

**Fiscale regels ingebouwd**:
- **Volledige IBAN** is primaire sleutel (niet alleen laatste 4 cijfers)
- **Eigendomspercentage MOET matchen** - 50% vs 100% = NOOIT samenvoegen
- **Bij twijfel: NIET samenvoegen** - beter een duplicaat dan een gemiste asset

**Fingerprint structuur**:
```typescript
interface Box3AssetFingerprint {
  iban_full?: string;              // Volledige IBAN (primaire sleutel)
  institution_normalized: string;   // "ING", "RABO", "ABNAMRO"
  account_last4?: string;          // Laatste 4 cijfers
  ownership_percentage: number;     // KRITIEK voor samenvoeging
  amounts_by_year: Record<string, number>;
  fingerprint_hash: string;        // MD5 voor snelle vergelijking
}
```

**Cross-category detectie**: Detecteert ook duplicaten tussen categorieën (bijv. zelfde rekening in bank_savings én investments).

**Code locatie**: [server/services/box3-deduplication.ts](../server/services/box3-deduplication.ts)

---

### Stage 5: Validation & Anomaly Detection

**Doel**: Kwaliteitscontrole en indicatieve berekening.

**5a: Rule-Based Validation**

Deterministische checks zonder LLM:

| Check | Beschrijving |
|-------|--------------|
| `asset_totals_match` | Som assets ≈ Belastingdienst totaal (tolerantie: max €5.000 of 1%) |
| `asset_counts_match` | Aantal assets ≈ checklist uit Stage 2 |
| `interest_plausibility` | Rente niet > 10% van vermogen |
| `missing_required_docs` | Definitieve aanslag aanwezig? |
| `duplicate_detection` | Geen dubbele rekeningnummers |
| `fiscal_exclusions` | KEW/lijfrente/studieschuld correct uitgesloten |
| `green_investment_exemption` | **NIEUW** - Waarschuwt bij groene beleggingen (handmatige vrijstelling) |
| `peildatum_warning` | **NIEUW** - Waarschuwt als alleen 31-12 waarde gevonden (moet 1 jan zijn) |
| `ownership_inconsistency` | **NIEUW** - Detecteert verschillende % voor zelfde rekening |
| `joint_account_validation` | **NIEUW** - Valideert is_joint_account + owner_id combinatie |

**Ground Truth Tolerantie** (conform fiscale praktijk):
```
Tolerantie = max(€5.000, 1% van totaal)

Afwijking < tolerantie     → ✅ Info (groen)
Afwijking 1-5%             → ⚠️ Warning (geel)
Afwijking 5-20%            → ⚠️ Warning + "REVIEW VEREIST"
Afwijking > 20%            → ❌ Error (rood) - vermoedelijk data-issue
```

**5b: Indicatieve Berekening**

```typescript
{
  total_assets_jan_1: 500000,
  actual_return: {
    bank_interest: 625,
    dividends: 2400,
    rental_income_net: 8000,
    debt_interest_paid: -3500,
    total: 7525
  },
  deemed_return_from_tax_authority: 28000,  // Wat Belastingdienst rekent
  difference: -20475,                        // Werkelijk - Forfaitair
  indicative_refund: 6552,                   // Als verschil negatief
  is_profitable: true                        // > €250 drempel
}
```

**5c: LLM Anomaly Detection**

Gebruikt `ANOMALY_DETECTION_PROMPT` met high reasoning effort om patronen te vinden:
- Ongewoon hoge renteclaims
- Missende assets die wel in aangifte staan
- Tegenstrijdige waarden tussen documenten

**Code locatie**: `validateExtraction()`, `detectAnomaliesWithLLM()` (regel ~1050)

---

## 4. Data Model: De Blueprint

De "Blueprint" is het centrale datamodel waar alle geëxtraheerde data naartoe gaat.

### Structuur Overzicht

```typescript
interface Box3Blueprint {
  schema_version: "2.0",

  // Brondocumenten registry
  source_documents_registry: Box3SourceDocumentEntry[],

  // Personen
  fiscal_entity: {
    taxpayer: { id, name, bsn_masked, date_of_birth, email },
    fiscal_partner: { has_partner, id?, name?, ... }
  },

  // Vermogen (per categorie)
  assets: {
    bank_savings: Box3BankSavingsAsset[],
    investments: Box3InvestmentAsset[],
    real_estate: Box3RealEstateAsset[],
    other_assets: Box3OtherAsset[]
  },

  // Schulden
  debts: Box3Debt[],

  // Officiële Belastingdienst data (per jaar)
  tax_authority_data: Record<string, Box3TaxAuthorityYearData>,

  // Status per jaar (berekeningen)
  year_summaries: Record<string, Box3YearSummary>,

  // Quality tracking
  validation_flags: Box3ValidationFlag[],
  audit_checks: Box3AuditCheck[],
  manual_overrides: Box3ManualOverrideV2[],

  // Merge tracking (V3)
  document_contributions?: Box3DocumentContribution[],
  merge_conflicts?: Box3MergeConflict[]
}
```

### DataPoint: Elke Waarde Met Herkomst

Elk bedrag in de blueprint heeft een `DataPoint` wrapper:

```typescript
interface Box3DataPoint<T = number> {
  amount: T,
  source_doc_id?: string,        // Verwijzing naar document
  source_type?: 'document' | 'email' | 'client_estimate' | 'calculation',
  source_snippet?: string,       // Exacte tekst uit document
  confidence?: number,           // 0.0 - 1.0
  requires_validation?: boolean,
  validation_note?: string
}
```

**Waarom?** Audit trail - elke waarde is terug te voeren naar het brondocument.

---

## 5. API Endpoints

### Nieuwe dossier + validatie starten

```http
POST /api/box3-validator/validate-job
Content-Type: multipart/form-data

clientName: "J. Jansen"
inputText: "[intake email tekst]"
files[]: [PDF uploads]
```

**Response** (immediate):
```json
{
  "dossierId": "uuid-123",
  "jobId": "job-456",
  "clientName": "J. Jansen"
}
```

### Job status checken

```http
GET /api/jobs/:jobId
```

**Response**:
```json
{
  "id": "job-456",
  "status": "processing",
  "progress": 60,
  "currentStep": "Extracting investments...",
  "result": null
}
```

### Dossier ophalen met blueprint

```http
GET /api/box3-validator/dossiers/:id
```

### Documenten toevoegen (incrementele merge)

```http
POST /api/box3-validator/dossiers/:id/documents
Content-Type: multipart/form-data

files[]: [nieuwe PDF's]
uploadedVia: "aanvulling"
```

### Hervalidatie starten

```http
POST /api/box3-validator/dossiers/:id/revalidate-job
```

---

## 6. Frontend Hook: useBox3Validation

De belangrijkste hook voor Box 3 validatie:

```typescript
const {
  // State
  isValidating,
  blueprint,
  currentDossierId,
  pipelineProgress,
  activeJobId,

  // Actions
  startValidationJob,      // Nieuwe dossier starten
  startRevalidationJob,    // Bestaand dossier hervalideren
  loadDossier,             // Dossier laden
  cancelRevalidationJob,   // Job annuleren

  // Debug
  debugInfo                // Prompts + responses
} = useBox3Validation();
```

### Typische flow

```typescript
// 1. Start validatie
const { dossierId, jobId } = await startValidationJob(
  clientName,
  intakeText,
  files
);

// 2. Navigate naar dossier pagina
navigate(`/box3-validator/${dossierId}`);

// 3. Hook pollt automatisch job status
// pipelineProgress wordt realtime bijgewerkt

// 4. Als job klaar is, is blueprint beschikbaar
if (blueprint) {
  // Toon geëxtraheerde data
}
```

---

## 7. Document Authority Ranking

Bij conflicten (zelfde asset, verschillende waarden) wint de bron met hogere authority:

```typescript
const DOCUMENT_AUTHORITY = {
  'definitieve_aanslag': 100,    // Officiële aanslag - hoogste
  'jaaroverzicht_bank': 95,      // Bank jaaroverzicht
  'woz_beschikking': 95,         // WOZ beschikking
  'hypotheekoverzicht': 85,
  'aangifte_ib': 80,             // Eigen aangifte
  'dividendnota': 80,
  'email_body': 30,              // Email - laagste
  'client_estimate': 20,
  'overig': 10
};
```

---

## 8. Incrementele Merge (Aanvullingen)

Wanneer nieuwe documenten worden toegevoegd aan een bestaand dossier:

```
┌─────────────────┐     ┌─────────────────┐
│ Bestaande       │     │ Nieuwe          │
│ Blueprint v1    │     │ Documenten      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────┐
│         Box3MergeEngine                 │
│                                         │
│  1. Run pipeline op nieuwe docs         │
│  2. Match assets op unique keys:        │
│     - account_masked (bank)             │
│     - address (vastgoed)                │
│     - institution + description (beleg) │
│  3. Merge yearly_data per asset         │
│  4. Track conflicts voor review         │
│  5. Preserve manual_overrides           │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│ Blueprint v2 (merged)                   │
│ + merge_conflicts[]                     │
│ + document_contributions[]              │
└─────────────────────────────────────────┘
```

**Code**: [server/services/box3-merge-engine.ts](../server/services/box3-merge-engine.ts)

---

## 9. Debugging Tips

### Pipeline logs bekijken

De pipeline logt naar console met prefix `[Box3Pipeline]`:

```
[Box3Pipeline] Stage 1: Classifying 5 documents...
[Box3Pipeline] Stage 2: Extracting tax authority data...
[Box3Pipeline] Stage 3a: Extracting bank accounts (exclusion context: [])
```

### Debug info in frontend

```typescript
const { debugInfo } = useBox3Validation();

// debugInfo bevat:
{
  prompts: {
    classification: "...",
    tax_authority_persons: "...",
    // etc.
  },
  responses: {
    classification: "{ raw LLM response }",
    // etc.
  },
  timestamps: {
    stage1_start: "2025-01-15T10:30:00Z",
    // etc.
  }
}
```

### Common issues

| Probleem | Oorzaak | Oplossing |
|----------|---------|-----------|
| Dubbele assets | Exclusion context niet doorgegeven | Stage 4b dedup vangt dit nu op |
| Cross-category duplicaat | Bijv. ING in bank én investments | Stage 4b detecteert dit automatisch |
| Lage confidence | Slechte PDF kwaliteit | Vraag klant om originele digitale docs |
| Missing tax data | Geen aangifte/aanslag geüpload | Stage 2 kan niet runnen |
| Merge conflicts | Zelfde asset, andere waarden | Review in UI, kies juiste bron |
| Ownership mismatch | 50% vs 100% voor zelfde rekening | Stage 4b flagged dit voor review |
| Peildatum fout | Alleen 31-12 waarde gevonden | Stage 5 waarschuwt, vraag 1-jan waarde |
| Groene belegging | Vrijstelling niet automatisch | Stage 5 waarschuwt, handmatig toepassen |

---

## 10. Tarieven en Forfaitaire Rendementen

In [client/src/constants/box3.constants.ts](../client/src/constants/box3.constants.ts):

### Box 3 Tarieven

```typescript
export const BOX3_TARIEVEN = {
  '2017': 0.30,
  '2018': 0.30,
  '2019': 0.30,
  '2020': 0.30,
  '2021': 0.31,
  '2022': 0.31,
  '2023': 0.32,
  '2024': 0.36,
  '2025': 0.36
};
```

### Forfaitaire Rendementen

```typescript
export const FORFAITAIRE_RENDEMENTEN = {
  '2023': {
    spaargeld: 0.0092,           // 0.92%
    beleggingen: 0.0617,         // 6.17%
    schulden: 0.0246             // 2.46%
  },
  // etc.
};
```

---

## 11. Uitbreiden van de Pipeline

### Nieuwe document type toevoegen

1. **Voeg toe aan classification prompt** in `box3-prompts.ts`:
   ```typescript
   document_type: '...' | 'nieuw_type'
   ```

2. **Voeg handling toe** in relevante Stage 3 substage

3. **Update authority ranking** als nodig

### Nieuwe asset categorie toevoegen

1. **Voeg type toe** aan `shared/schema/box3.ts`:
   ```typescript
   interface Box3NewAsset {
     id: string;
     owner_id: string;
     // ...
   }
   ```

2. **Voeg prompt builder toe** in `box3-prompts.ts`

3. **Voeg extractie methode toe** aan pipeline class

4. **Update merge logic** in `mergeResults()`

5. **Update Stage 3 sequentie** met exclusion context

---

## 12. Testing

### Unit tests

```bash
npm test -- --grep "box3"
```

### Handmatig testen

1. Upload test documenten via UI (`/box3-validator/new`)
2. Check pipeline progress in realtime
3. Vergelijk blueprint output met verwachte waarden
4. Test incrementele merge door docs toe te voegen

### Test documenten

Gebruik realistische test documenten:
- Jaaroverzicht bank (PDF)
- Definitieve aanslag IB (PDF)
- Effectenoverzicht (PDF)
- WOZ beschikking (PDF)

---

## Toekomstige Verbeteringen

### Model Upgrade naar Pro voor Kritieke Stages

**Status**: Genoteerd voor evaluatie bij aanhoudende extractie-issues

Als we problemen blijven zien met extractie-kwaliteit, overweeg Pro modellen voor kritieke stages:

```
┌─────────────────────────────────────────────────────────┐
│  HYBRIDE MODEL STRATEGIE (OPTIONEEL)                    │
│                                                         │
│  Stage 1 (Classification):     Flash  ← Simpel, snel   │
│  Stage 2 (Tax Authority):      PRO    ← Kritiek!       │
│  Stage 3a-d (Asset Extraction): Flash ← Volume         │
│  Stage 4b (Deduplication):     CODE   ← Deterministic  │
│  Stage 5 (Validation):         CODE   ← Fiscale regels │
│  Stage 5c (Anomaly):           PRO    ← Reasoning      │
└─────────────────────────────────────────────────────────┘
```

**Waarom Pro voor Stage 2?**
- Tax Authority data is de "ground truth" voor validatie
- Fouten hier propageren door de hele pipeline
- Bedragen en aantallen moeten 100% correct zijn

**Waarom Pro voor Stage 5c (Anomaly)?**
- Vereist reasoning over complexe fiscale situaties
- o3-mini of gemini-2.5-pro hebben betere reasoning capabilities

**Impact:**
- Hogere kosten per extractie (~3-5x voor Pro stages)
- Langere doorlooptijd (~2x voor Pro stages)
- Verwachte kwaliteitsverbetering: 85% → 95%+ accuracy

**Implementatie:**
Wijzig `EXTRACTION_CONFIG` in `box3-extraction-pipeline.ts`:
```typescript
// Stage 2: Tax Authority - gebruik Pro
const TAX_AUTHORITY_CONFIG = {
  model: 'gemini-2.5-pro',  // Was: gemini-2.5-flash
  thinkingLevel: 'medium',
  maxOutputTokens: 16384,
};
```

---

## Appendix A: Volledige Type Definities

Zie [shared/schema/box3.ts](../shared/schema/box3.ts) voor alle TypeScript interfaces.

## Appendix B: Prompt Templates

Zie [server/services/box3-prompts.ts](../server/services/box3-prompts.ts) voor alle LLM prompts.
