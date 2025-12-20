# Box 3 Pipeline Refactor: Aangifte-First Architecture

> **Status**: Implementatieplan
> **Doel**: Van 9+ LLM calls naar 2-3 calls, 100% classificatie-accuraatheid
> **Geschatte winst**: 50% sneller, 60% goedkoper, geen duplicaten

---

## 1. Waarom Deze Refactor?

### Het Huidige Probleem

```
HUIDIGE PIPELINE (9+ LLM calls):

Stage 1: Classification ────────────────────────────────────────────┐
Stage 2a: Tax Authority Persons ────────────────────────────────────┤
Stage 2b: Tax Authority Totals ─────────────────────────────────────┤ 10 LLM calls
Stage 2c: Tax Authority Checklist ──────────────────────────────────┤
Stage 3a: Bank Extraction ──────────────────────────────────────────┤
Stage 3b: Investment Extraction ────────────────────────────────────┤
Stage 3c: Real Estate Extraction ───────────────────────────────────┤
Stage 3d: Other Assets Extraction ──────────────────────────────────┤
Stage 4a: Smart Classification (FIX voor 3a-3d fouten) ─────────────┤
Stage 5:  Anomaly Detection ────────────────────────────────────────┘
```

**Fundamenteel probleem**: We vragen 4 LLMs parallel om te classificeren, krijgen inconsistente antwoorden, en bouwen dan complexe machinery om dit te repareren.

### De Oplossing

De aangifte IB bevat al:
- **Exacte categorisatie** (staat onder "Bankrekeningen" = IS bankrekening)
- **Exacte bedragen** per 1 januari
- **Exacte aantallen** per categorie
- **Eigendomsverhoudingen**

**Kernprincipe**: De aangifte is de ENIGE bron van waarheid voor classificatie en waarden. Brondocumenten zijn alleen nodig voor werkelijk rendement.

---

## 2. Nieuwe Architectuur

```
NIEUWE PIPELINE (3 LLM calls):

┌─────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: AANGIFTE MANIFEST EXTRACTION (1 LLM call)                     │
│                                                                         │
│  Input: Alleen aangifte_ib + definitieve_aanslag documenten             │
│                                                                         │
│  Output: AssetManifest                                                  │
│  - fiscal_entity (personen, BSN, verdeling)                            │
│  - asset_items[] per categorie met:                                    │
│    • description (exact zoals in aangifte)                             │
│    • value_jan_1 (exact zoals in aangifte)                             │
│    • category (GEGEVEN, niet te bepalen door LLM)                      │
│    • owner_id                                                          │
│  - category_totals (voor validatie)                                    │
│  - tax_assessed (geheven belasting)                                    │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STAGE 2: RENDEMENT ENRICHMENT (1 LLM call)                             │
│                                                                         │
│  Input: AssetManifest + alle brondocumenten (jaaroverzichten etc.)     │
│                                                                         │
│  Voor elk item uit manifest, zoek:                                     │
│  - interest_received (rente)                                           │
│  - dividends_received (dividend)                                       │
│  - costs_paid (kosten)                                                 │
│  - full_iban (voor administratie)                                      │
│                                                                         │
│  REGELS:                                                                │
│  - WIJZIG NIETS aan value_jan_1 (is al correct uit aangifte)          │
│  - VOEG GEEN items toe (alle items staan al in manifest)              │
│  - VERWIJDER NIETS (manifest is compleet)                             │
│                                                                         │
│  Output: EnrichedManifest (manifest + rendement data)                  │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STAGE 3: VALIDATION & CALCULATION (code + 1 optional LLM)              │
│                                                                         │
│  Deterministic (code):                                                  │
│  - Som assets == aangifte totaal? (altijd ja, want uit zelfde bron)   │
│  - Alle items gevonden in brondocs?                                    │
│  - Forfaitair vs werkelijk rendement berekening                        │
│  - Indicatieve teruggave                                               │
│                                                                         │
│  Optional LLM (alleen bij anomalieën):                                 │
│  - Onverklaarbare afwijkingen                                          │
│  - Missende brondocumenten                                             │
│  - Complexe fiscale situaties                                          │
│                                                                         │
│  Output: Box3Blueprint (finaal)                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Structuren

### 3.1 AssetManifest (nieuw)

```typescript
// shared/schema/box3-manifest.ts

interface AssetManifest {
  schema_version: '3.0';
  source_document_id: string;  // ID van aangifte/aanslag
  tax_years: string[];

  fiscal_entity: {
    taxpayer: {
      id: string;
      name: string;
      bsn_masked: string;
    };
    fiscal_partner?: {
      id: string;
      name: string;
      bsn_masked: string;
    };
  };

  // Items EXACT zoals ze in de aangifte staan
  asset_items: {
    bank_savings: ManifestItem[];
    investments: ManifestItem[];
    real_estate: ManifestItem[];
    other_assets: ManifestItem[];
  };

  debt_items: ManifestItem[];

  // Totalen uit aangifte (voor validatie)
  category_totals: {
    bank_savings: number;
    investments: number;
    real_estate: number;
    other_assets: number;
    debts: number;
    grand_total: number;
  };

  // Belastingdienst data
  tax_authority: {
    [year: string]: {
      grondslag_sparen_beleggen: number;
      forfaitair_rendement: number;
      belasting_box3: number;
    };
  };
}

interface ManifestItem {
  // Identificatie
  manifest_id: string;              // Unieke ID binnen manifest
  description_from_aangifte: string; // EXACT zoals in aangifte

  // Classificatie (GEGEVEN, niet bepaald door LLM)
  category: 'bank_savings' | 'investments' | 'real_estate' | 'other_assets' | 'debt';

  // Eigendom
  owner_id: string;                 // 'tp_01', 'fp_01', 'joint'
  ownership_percentage: number;

  // Waarden (uit aangifte)
  yearly_values: {
    [year: string]: {
      value_jan_1: number;          // Peildatum waarde
      value_dec_31?: number;        // Optioneel
    };
  };

  // Voor matching met brondocumenten
  identifier_hints?: {
    iban_partial?: string;          // "****1234" als in aangifte zichtbaar
    institution?: string;           // "ING", "Rabobank", etc.
    address?: string;               // Voor vastgoed
  };

  // Na enrichment (Stage 2)
  enrichment?: {
    matched_source_doc_id?: string;
    full_iban?: string;
    interest_received?: number;
    dividends_received?: number;
    rental_income?: number;
    costs_paid?: number;
    match_confidence: number;       // 0.0 - 1.0
  };
}
```

### 3.2 Mapping naar bestaande Blueprint

Na Stage 2 wordt de EnrichedManifest omgezet naar het bestaande `Box3Blueprint` formaat voor backwards compatibility:

```typescript
function manifestToBlueprint(manifest: AssetManifest): Box3Blueprint {
  return {
    schema_version: '2.0',
    source_documents_registry: [...],
    fiscal_entity: manifest.fiscal_entity,
    assets: {
      bank_savings: manifest.asset_items.bank_savings.map(item => ({
        id: `bank_${item.manifest_id}`,
        owner_id: item.owner_id,
        description: item.description_from_aangifte,
        bank_name: item.identifier_hints?.institution,
        account_masked: item.enrichment?.full_iban || item.identifier_hints?.iban_partial,
        yearly_data: mapYearlyData(item),
        // ... rest van mapping
      })),
      // ... andere categorieën
    },
    // ... rest van blueprint
  };
}
```

---

## 4. Nieuwe Prompts

### 4.1 MANIFEST_EXTRACTION_PROMPT (Stage 1)

```typescript
// server/services/box3-prompts-v2.ts

export const MANIFEST_EXTRACTION_PROMPT = `Je bent een expert in Nederlandse belastingaangiften.

## OPDRACHT
Extraheer de VOLLEDIGE vermogensopstelling uit de aangifte IB en/of definitieve aanslag.

## KRITIEKE REGEL: AANGIFTE IS GROUND TRUTH

De aangifte bepaalt ALLES:
- Als iets onder "Banktegoeden" staat → category: "bank_savings"
- Als iets onder "Aandelen en obligaties" staat → category: "investments"
- Als iets onder "Onroerende zaken" staat → category: "real_estate"
- Als iets onder "Overige bezittingen" staat → category: "other_assets"
- Als iets onder "Schulden" staat → category: "debt"

JE BEPAALT NIETS ZELF. JE LEEST ALLEEN WAT ER STAAT.

## WAT JE MOET EXTRAHEREN

Per item in de aangifte:
1. description_from_aangifte: EXACT zoals het er staat (bijv. "ING Bank N.V. NL12INGB****3456")
2. category: Bepaald door WAAR het staat in de aangifte
3. value_jan_1: Het bedrag per 1 januari zoals vermeld
4. owner_id: "tp_01" (belastingplichtige), "fp_01" (partner), of "joint"
5. ownership_percentage: Meestal 100, tenzij anders vermeld

## OUTPUT FORMAT

{
  "tax_years": ["2022", "2023"],
  "fiscal_entity": {
    "taxpayer": { "id": "tp_01", "name": "...", "bsn_masked": "****1234" },
    "fiscal_partner": { "id": "fp_01", "name": "...", "bsn_masked": "****5678" } // of null
  },
  "asset_items": {
    "bank_savings": [
      {
        "manifest_id": "bank_1",
        "description_from_aangifte": "ING Bank N.V. NL12INGB****3456",
        "category": "bank_savings",
        "owner_id": "tp_01",
        "ownership_percentage": 100,
        "yearly_values": {
          "2022": { "value_jan_1": 45000 }
        },
        "identifier_hints": {
          "iban_partial": "****3456",
          "institution": "ING"
        }
      }
    ],
    "investments": [...],
    "real_estate": [...],
    "other_assets": [...]
  },
  "debt_items": [...],
  "category_totals": {
    "bank_savings": 125000,
    "investments": 186280,
    "real_estate": 245000,
    "other_assets": 12000,
    "debts": 150000,
    "grand_total": 418280
  },
  "tax_authority": {
    "2022": {
      "grondslag_sparen_beleggen": 418280,
      "forfaitair_rendement": 25831,
      "belasting_box3": 8015
    }
  }
}

GEEF ALLEEN VALIDE JSON TERUG.`;
```

### 4.2 ENRICHMENT_PROMPT (Stage 2)

```typescript
export const ENRICHMENT_PROMPT = `Je bent een expert in Nederlandse financiële documenten.

## OPDRACHT
Je krijgt een MANIFEST met items uit de belastingaangifte.
Zoek in de BRONDOCUMENTEN (jaaroverzichten, etc.) de AANVULLENDE informatie per item.

## KRITIEKE REGELS

1. WIJZIG NIETS aan de manifest items
   - De value_jan_1 is al correct (uit aangifte)
   - De category is al correct (uit aangifte)
   - De description is al correct (uit aangifte)

2. VOEG GEEN nieuwe items toe
   - Alle items staan al in het manifest
   - Als je iets vindt dat niet in manifest staat → negeer het

3. VERWIJDER NIETS
   - Elk manifest item blijft bestaan
   - Ook als je geen brondocument vindt

## WAT JE WEL DOET

Per manifest item, zoek in brondocumenten:
- full_iban: Volledige IBAN (voor administratie)
- interest_received: Ontvangen rente over het jaar
- dividends_received: Ontvangen dividend
- rental_income: Huurinkomsten (netto)
- costs_paid: Betaalde kosten (beheerkosten, transactiekosten)
- match_confidence: Hoe zeker ben je dat dit het juiste brondoc is (0.0-1.0)

## MATCHING STRATEGIE

Match manifest items met brondocumenten op:
1. IBAN (laatste 4 cijfers)
2. Banknaam / Institutie
3. Bedrag per 1 januari (moet exact of zeer dicht bij manifest waarde liggen)

## INPUT

{
  "manifest": { ... },
  "source_documents": [
    { "doc_id": "doc_001", "type": "jaaroverzicht_bank", "content": "..." },
    { "doc_id": "doc_002", "type": "effectenoverzicht", "content": "..." }
  ]
}

## OUTPUT

{
  "enriched_items": [
    {
      "manifest_id": "bank_1",
      "enrichment": {
        "matched_source_doc_id": "doc_001",
        "full_iban": "NL12INGB0001233456",
        "interest_received": 562.50,
        "match_confidence": 0.95
      }
    },
    {
      "manifest_id": "inv_1",
      "enrichment": {
        "matched_source_doc_id": "doc_002",
        "dividends_received": 2400.00,
        "costs_paid": 125.00,
        "match_confidence": 0.90
      }
    },
    {
      "manifest_id": "bank_5",
      "enrichment": null,  // Geen brondocument gevonden
      "note": "Geen jaaroverzicht gevonden voor Rabobank ****7890"
    }
  ],
  "unmatched_source_docs": [
    {
      "doc_id": "doc_003",
      "reason": "IBAN NL99ABNA0009999999 komt niet voor in manifest"
    }
  ]
}

GEEF ALLEEN VALIDE JSON TERUG.`;
```

---

## 5. Implementatie Stappenplan

### Fase 1: Nieuwe Types & Prompts (1 dag)

**Files aan te maken:**
- [ ] `shared/schema/box3-manifest.ts` - Nieuwe types
- [ ] `server/services/box3-prompts-v2.ts` - Nieuwe prompts

**Taken:**
1. Definieer `AssetManifest` en `ManifestItem` types
2. Schrijf `MANIFEST_EXTRACTION_PROMPT`
3. Schrijf `ENRICHMENT_PROMPT`
4. Schrijf `manifestToBlueprint()` converter

### Fase 2: Nieuwe Pipeline Class (2 dagen)

**Files aan te maken:**
- [ ] `server/services/box3-pipeline-v2.ts` - Nieuwe pipeline

**Taken:**
1. Maak `Box3PipelineV2` class met 3 stages
2. Implementeer `extractManifest()` - Stage 1
3. Implementeer `enrichManifest()` - Stage 2
4. Implementeer `validateAndCalculate()` - Stage 3
5. Gebruik bestaande `manifestToBlueprint()` voor output

### Fase 3: Route & Feature Flag (0.5 dag)

**Files te wijzigen:**
- [ ] `server/routes/box3-v2-routes.ts` - Nieuwe route toevoegen

**Taken:**
1. Voeg `/api/box3-validator/validate-job-v2` endpoint toe
2. Feature flag: `USE_PIPELINE_V2=true` in env
3. Fallback naar oude pipeline als V2 faalt

### Fase 4: A/B Testing (1-2 dagen)

**Taken:**
1. Run beide pipelines parallel op 10 bestaande dossiers
2. Vergelijk:
   - Classificatie-accuraatheid
   - Totalen match met aangifte
   - Doorlooptijd
   - Kosten (API calls)
3. Document resultaten

### Fase 5: Migratie (1 dag)

**Taken:**
1. Zet V2 als default
2. Deprecate V1 pipeline
3. Update documentatie
4. Monitor productie

---

## 6. Risico's & Mitigatie

| Risico | Impact | Mitigatie |
|--------|--------|-----------|
| Manifest extractie mist items | Hoog | Valideer item count tegen aangifte totaal |
| Enrichment matcht verkeerd | Medium | Confidence threshold (< 0.7 = flag voor review) |
| Edge cases niet gedekt | Medium | Fallback naar V1 pipeline |
| Breaking change voor UI | Laag | Output is zelfde Blueprint formaat |

---

## 7. Verwachte Resultaten

| Metric | V1 (huidig) | V2 (nieuw) | Verbetering |
|--------|-------------|------------|-------------|
| LLM calls | 9-10 | 2-3 | -70% |
| Doorlooptijd | 60-120s | 20-40s | -60% |
| Cost/dossier | ~€0.20 | ~€0.08 | -60% |
| Classificatie-accuracy | ~85% | 100% | +15% |
| Duplicaten | Frequent | 0 | -100% |
| Dedup stages nodig | 2 | 0 | -100% |

---

## 8. Rollback Plan

Als V2 niet werkt:

1. Zet `USE_PIPELINE_V2=false`
2. Alle requests gaan weer naar V1
3. Geen data migratie nodig (zelfde Blueprint output)

---

## 9. Definition of Done

- [ ] Alle Fase 1-5 taken afgerond
- [ ] 0% verschil tussen manifest totalen en aangifte totalen
- [ ] A/B test toont verbeteringen zoals verwacht
- [ ] Documentatie bijgewerkt
- [ ] Code review passed
- [ ] Productie monitoring opgezet
