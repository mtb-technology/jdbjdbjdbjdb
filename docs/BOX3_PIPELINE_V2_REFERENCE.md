# Box 3 Pipeline V2 - Complete Reference

> Aangifte-First Architecture met Multimodal Vision + Anchor-Based Extraction

## Overview

De V2 pipeline is een vereenvoudigde 3-stage architectuur die:
- De aangifte als **single source of truth** gebruikt
- **Multimodal processing** (images + text) voor accurate tabelextractie
- **Anchor-based validation** met self-correction

```
┌─────────────────────────────────────────────────────────────────┐
│                         INPUT                                   │
│  • Aangifte IB (PDF) - VEREIST                                 │
│  • Brondocumenten (jaaroverzichten) - OPTIONEEL                │
│  • Klant email/context - OPTIONEEL                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 0: Document Preparation (Hybrid)                         │
│  • PDF text extraction (pdfjs) → voor searchability            │
│  • PDF to images conversion (poppler) → voor visuele structuur │
│  • Document classification (aangifte vs brondoc)               │
│  • No LLM call                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 1: Manifest Extraction (MULTIMODAL)                      │
│  • Gemini ZIET de PDF pagina's als afbeeldingen                │
│  • Anchor-based: eerst totalen, dan items, dan validatie       │
│  • Self-correction bij mismatch                                │
│  • 1 LLM call (Gemini 3 Pro, high thinking, images + text)     │
│  • Output: Box3Manifest                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 2: Enrichment (optional)                                 │
│  • Match manifest items with source documents                  │
│  • Extract actual returns (rente, dividend)                    │
│  • 1 LLM call if brondocumenten OR email context exist         │
│  • Output: Box3EnrichedManifest                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 3: Validation & Calculation                              │
│  • Deterministic validation against anchor_totals              │
│  • Calculate actual returns vs forfaitair                      │
│  • Convert to Blueprint format                                 │
│  • No LLM call (deterministic)                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         OUTPUT                                  │
│  • Box3Manifest (raw extraction + anchor_totals)               │
│  • Box3EnrichedManifest (with actual returns)                  │
│  • Box3Blueprint (backwards compatible format)                 │
│  • Validation results                                          │
│  • Actual return calculations                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## System Dependencies

### Poppler (Required for Vision)

De pipeline converteert PDF pagina's naar images met `pdftoppm` van poppler.

```bash
# macOS
brew install poppler

# Ubuntu/Debian
apt-get install poppler-utils

# Check installation
which pdftoppm
```

**Fallback:** Als poppler niet geïnstalleerd is, valt de pipeline terug op text-only mode (met warning in logs).

---

## Model Configuration

```typescript
{
  model: 'gemini-3-pro-preview',
  provider: 'google',
  temperature: 0.0,
  topP: 0.95,
  topK: 40,
  thinkingLevel: 'high',
  maxOutputTokens: 65536,
  useGrounding: false
}
```

**Waarom deze settings:**
- `temperature: 0.0` - Deterministische output voor consistente extractie
- `thinkingLevel: 'high'` - Model denkt uitgebreid na over complexe fiscale regels
- `maxOutputTokens: 65536` - Ruimte voor complete manifests met veel items
- `useGrounding: false` - Geen web search nodig, alles staat in de documenten

---

## Multimodal Processing (Vision)

### Waarom Vision?

Text-extractie van PDFs geeft problemen met tabellen:
```
# Wat text-extractie ziet:
"Naam","GJ DONCK","Partner naam"
"Saldo","50000","30000"

# Probleem: Welke kolom is van wie?
```

Met vision ZIET het model de tabelstructuur:
```
┌──────────────┬───────────────┐
│  Aangever    │   Partner     │
├──────────────┼───────────────┤
│  €50.000     │   €30.000     │
└──────────────┴───────────────┘
```

### Hybrid Approach

De pipeline stuurt BEIDE naar Gemini:

1. **AFBEELDINGEN** (primair) - voor:
   - Tabelstructuur herkennen (kolommen: Aangever vs Partner)
   - Visuele layout begrijpen
   - Exacte bedragen aflezen

2. **TEKST** (aanvullend) - voor:
   - Doorzoekbaarheid
   - Backup als afbeelding onduidelijk is

### Image Conversion Settings

```typescript
{
  format: 'jpeg',
  dpi: 150,        // Balans kwaliteit vs grootte
  maxPages: 40     // Aangiften kunnen 30+ pagina's zijn
}
```

---

## System Prompt

Het model krijgt de rol van een senior fiscaal specialist:

```
Je bent een senior fiscaal specialist bij een gerenommeerd Nederlands
belastingadvieskantoor, gespecialiseerd in Box 3 vermogensrendementsheffing
en bezwaarprocedures.

## JOUW EXPERTISE

### Fiscale achtergrond
- 15+ jaar ervaring met Nederlandse inkomstenbelasting (IB)
- Diepgaande kennis van Box 3 regelgeving sinds 2001
- Expert in de Hoge Raad arresten over Box 3 (Kerstarrest 2021, etc.)
- Ervaring met massaal bezwaar procedures en individuele bezwaarschriften

### Box 3 specialisatie
- Vermogensrendementsheffing en forfaitair rendement
- Werkelijk rendement vs. fictief rendement berekeningen
- Categorieën: banktegoeden, beleggingen, onroerend goed, overige bezittingen, schulden
- Heffingsvrij vermogen en partnerverdeling
- Groene beleggingen en vrijstellingen

### Relevante jurisprudentie
- HR 24 december 2021 (Kerstarrest): forfaitair stelsel in strijd met EVRM
- Wet rechtsherstel box 3 (2022): nieuwe forfaitaire percentages
- Overbruggingswet box 3 (2023-2026): verfijnd forfaitair stelsel
- Wet werkelijk rendement box 3 (gepland 2027)

## WERKWIJZE

- Wees EXTREEM nauwkeurig met getallen en classificaties
- De aangifte is altijd leidend voor classificatie (ground truth)
- Documenteer alle aannames en onzekerheden
- Geef altijd gestructureerde JSON output zoals gevraagd
- Bij twijfel: vraag om verduidelijking of markeer als onzeker
```

---

## Stage 1: Manifest Extraction

### Multimodal Instruction

Wanneer images beschikbaar zijn, krijgt het model deze instructie:

```
## MULTIMODAL VERWERKING

Je ontvangt de aangifte op TWEE manieren:
1. **AFBEELDINGEN** van elke pagina (als bijlage) - GEBRUIK DEZE PRIMAIR voor:
   - Tabelstructuur herkennen (kolommen: Aangever vs Partner)
   - Visuele layout begrijpen
   - Exacte bedragen aflezen

2. **TEKST** (hieronder) - Als aanvulling voor:
   - Doorzoekbaarheid
   - Backup als afbeelding onduidelijk is

BELANGRIJK BIJ FISCALE PARTNERS:
- Kijk GOED naar de kolomkoppen in tabellen
- "Aangever" kolom = owner_id: "tp_01"
- "Partner" kolom = owner_id: "fp_01"
- Gezamenlijk = owner_id: "joint"

De visuele layout is KRITIEK - vertrouw op wat je ZIET in de afbeeldingen.
```

### Anchor-Based Extraction

De extractie volgt een "top-down" strategie:

```
## EXTRACTIE VOLGORDE - ANCHOR-BASED

### STAP 1: VIND DE ANCHORS (EERST!)
Zoek de pagina "Overzicht Belasting en Premies" (meestal pag 8-15).
Dit is de HEILIGE GRAAL met de officiele totalen.

Extraheer ANCHOR TOTALEN:
- "Bankrekeningen in box 3": €... → anchor_bank_savings
- "Beleggingen in box 3": €... → anchor_investments
- "Overige bezittingen": €... → anchor_other_assets
- "Schulden in box 3": €... → anchor_debts

### STAP 2: EXTRAHEER INDIVIDUELE ITEMS
Ga door de aangifte en extraheer elk item.
Houd per categorie een lopend totaal bij.

### STAP 3: SELF-VALIDATION
Vergelijk SUM(items) met anchors per categorie.

### STAP 4: SELF-CORRECTION (BIJ MISMATCH)
Als SUM ≠ anchor:
1. Bereken verschil (bijv. €50k anchor - €48k gevonden = €2k ontbreekt)
2. Zoek ontbrekend item in aangifte
3. Documenteer in self_correction_log
```

**Voordeel:** Als de Belastingdienst zegt €50.000 en jij vindt €48.000, weet je 100% zeker dat je €2.000 mist. Geen gokwerk.

### Core Principle: Aangifte is Ground Truth

```
De aangifte bepaalt ALLES:
- Als iets onder "Bank- en spaarrekeningen" staat → category: "bank_savings"
- Als iets onder "Beleggingen" staat → category: "investments"
- Als iets onder "Onroerende zaken" staat → category: "real_estate"
- Als iets onder "Overige bezittingen" of "Uitgeleend geld" staat → category: "other_assets"
- Als iets onder "Schulden" of "Hypotheken en andere schulden" staat → category: "debt"

JE BEPAALT NIETS ZELF. JE LEEST ALLEEN WAT ER STAAT.
```

### Aangifte Structuur

```
De aangifte IB heeft TWEE APARTE HOOFDSECTIES voor Box 3:

### SECTIE 1: "Bankrekeningen en andere bezittingen" (= BEZITTINGEN)
- "Bank- en spaarrekeningen" → bank_savings
- "Beleggingen" → investments
- "Andere bezittingen" → other_assets

### SECTIE 2: "Hypotheken en andere schulden"
- Alle schulden → debt_items
- Bij elke schuld: check "Gaat het om een schuld voor uw ... woning (hoofdverblijf)?"
- Antwoord "Ja" → is_eigen_woning_schuld: true (Box 1, niet Box 3)
- Antwoord "Nee" → is_eigen_woning_schuld: false (Box 3)
```

### Speciale Gevallen

#### BinckBank / DEGIRO met twee regels
```
Als je ziet:
- "BinckBank N.V. Normal" onder BANKREKENINGEN met €34.627
- "BinckBank N.V. Normal" onder BELEGGINGEN met €111.280

Dit zijn TWEE APARTE items:
- Bank item: gelddeel (cash saldo)
- Investment item: effectendeel (portefeuille)
```

#### Groene beleggingen
```
In de aangifte staan groene beleggingen APART onder "Groene beleggingen".
- Extraheer als item in investments array met is_green_investment: true
- category_totals.investments uit aangifte is EXCLUSIEF groene beleggingen
- Zet waarde ook in green_investments.total_value
```

#### Eigen woning schulden (Box 1 vs Box 3)
```
Bij elke schuld staat de vraag:
"Gaat het om een schuld voor uw ... woning (hoofdverblijf)?"

Het antwoord ("Ja" of "Nee") staat direct onder deze vraag.

- "Ja" → is_eigen_woning_schuld: true (Box 1, niet Box 3)
- "Nee" → is_eigen_woning_schuld: false (Box 3)
```

### Output Format (Manifest)

```json
{
  "schema_version": "3.0",
  "tax_years": ["2022"],
  "anchor_totals": {
    "source_page": "Overzicht Belasting en Premies (pagina 12)",
    "bank_savings": 50000,
    "investments": 100000,
    "other_assets": 60000,
    "debts": 25000,
    "green_investments": 40000
  },
  "self_correction_log": [
    {
      "category": "bank_savings",
      "issue": "Initieel €48.000 gevonden, anchor was €50.000",
      "resolution": "Credit Linked Beheer deposito €2.000 gemist op pagina 5",
      "corrected": true
    }
  ],
  "fiscal_entity": {
    "taxpayer": {
      "id": "tp_01",
      "name": "[Naam]",
      "bsn_masked": "****1234"
    },
    "fiscal_partner": {
      "id": "fp_01",
      "name": "[Partner]",
      "bsn_masked": "****5678"
    },
    "filing_type": "joint"
  },
  "asset_items": {
    "bank_savings": [...],
    "investments": [...],
    "real_estate": [],
    "other_assets": [...]
  },
  "debt_items": [...],
  "category_totals": {
    "bank_savings": 50000,
    "investments": 100000,
    "other_assets": 60000,
    "debts": 25000
  },
  "tax_authority": {
    "2022": {
      "grondslag_sparen_beleggen": 83700,
      "forfaitair_rendement": 2500,
      "belasting_box3": 775
    }
  },
  "green_investments": {
    "total_value": 40000,
    "exemption_applied": 40000
  }
}
```

---

## Stage 2: Enrichment

### Core Rules

```
1. WIJZIG NIETS aan de manifest items
   - De value_jan_1 is al correct (uit aangifte)
   - De category is al correct (uit aangifte)

2. VOEG GEEN nieuwe items toe
   - Alle items staan al in het manifest

3. VERWIJDER NIETS
   - Elk manifest item blijft bestaan
```

### Enrichment Data per Category

```
Per manifest item, zoek in brondocumenten:

### Voor bankrekeningen:
- interest_received: Ontvangen rente over het jaar

### Voor beleggingen:
- dividends_received: Ontvangen dividend
- costs_paid: Transactiekosten, beheerkosten

### Voor vorderingen (uitgeleend geld):
- agreed_interest_rate: Afgesproken rentepercentage
- interest_received: Ontvangen rente op de lening

### Altijd:
- matched_source_doc_id: ID van het brondocument
- match_confidence: 0.0-1.0
```

---

## Stage 3: Validation & Calculation

Stage 3 is **volledig deterministisch** (geen LLM call).

### Actual Return Calculation

```typescript
const actualReturns = {
  bank_interest: sum(bank enrichment.interest_received),
  dividends: sum(investment enrichment.dividends_received),
  total_actual_return: bank_interest + dividends + other_income,

  forfaitair_rendement: tax_authority[year].forfaitair_rendement,
  difference: total_actual_return - forfaitair_rendement,

  // Refund capped at actually paid tax
  indicative_refund: min(
    abs(difference) * TAX_RATES[year],
    tax_authority[year].belasting_box3
  ),

  is_claim_profitable: difference < -250
};
```

### Tax Rates per Year

```typescript
{
  "2017": 0.30,
  "2018": 0.30,
  "2019": 0.30,
  "2020": 0.30,
  "2021": 0.31,
  "2022": 0.31,
  "2023": 0.32,
  "2024": 0.36
}
```

---

## Files

| File | Purpose |
|------|---------|
| `server/services/box3-pipeline-v2.ts` | Pipeline class en orchestration |
| `server/services/box3-prompts-v2.ts` | System prompt en stage prompts |
| `server/services/pdf-to-images.ts` | PDF to JPEG conversion (poppler) |
| `server/services/pdf-text-extractor.ts` | PDF text extraction (pdfjs) |
| `shared/schema/box3-manifest.ts` | TypeScript types voor Manifest |
| `shared/schema/box3.ts` | TypeScript types voor Blueprint |
| `shared/constants.ts` | Tax rates, savings rates |

---

## Debugging

### Debug Output

```typescript
{
  debugPrompts: {
    manifest: "...",      // Full prompt sent to LLM
    enrichment: "..."     // Full prompt sent to LLM
  },
  debugResponses: {
    manifest: "...",      // Raw LLM response
    enrichment: "..."     // Raw LLM response
  }
}
```

### Logging

```typescript
// Stage 0: Document preparation
logger.info('box3-pipeline-v2', 'Converted doc.pdf to 38 images', { totalSizeKB: 4500 });

// Stage 1: Multimodal extraction
logger.info('box3-pipeline-v2', 'Stage 1: Multimodal extraction', {
  textDocs: 1,
  visionPages: 38,
  totalImageSizeKB: 4500
});

// Stage 3: Refund calculation
logger.info('box3-pipeline-v2', 'Refund calculation', {
  taxYear: "2022",
  deemedReturn: 2500,
  totalActualReturn: 150,
  difference: -2350,
  indicativeRefund: 728
});
```

---

## Error Handling

### Poppler Not Installed

```
⚠️ poppler not installed - falling back to text-only mode
   Install with: brew install poppler
```

### JSON Repair

De pipeline probeert corrupte JSON te repareren:
- Trailing commas
- Missing commas between properties
- Control characters

### Required Fields Validation

```typescript
if (!parsed.fiscal_entity || !parsed.asset_items) {
  throw new Error('Manifest missing required fields');
}
```
