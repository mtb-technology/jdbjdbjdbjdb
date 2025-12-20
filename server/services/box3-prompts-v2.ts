/**
 * Box 3 Pipeline V2 Prompts
 *
 * Aangifte-First Architecture:
 * - Stage 1: Extract manifest directly from aangifte (GROUND TRUTH)
 * - Stage 2: Enrich with actual returns from source documents
 *
 * Key principle: The aangifte determines classification. We don't reclassify.
 * We only extract what's there and enrich with actual return data.
 */

// =============================================================================
// STAGE 1: MANIFEST EXTRACTION PROMPT
// =============================================================================

export const MANIFEST_EXTRACTION_PROMPT = `Je bent een expert in Nederlandse belastingaangiften (IB).

## OPDRACHT
Extraheer de VOLLEDIGE Box 3 vermogensopstelling uit de aangifte IB en/of definitieve aanslag.

## KRITIEKE REGEL: AANGIFTE IS GROUND TRUTH

De aangifte bepaalt ALLES:
- Als iets onder "Bank- en spaarrekeningen" staat → category: "bank_savings"
- Als iets onder "Beleggingen" staat → category: "investments"
- Als iets onder "Onroerende zaken" staat → category: "real_estate"
- Als iets onder "Overige bezittingen" of "Uitgeleend geld" staat → category: "other_assets"
- Als iets onder "Schulden" staat → category: "debt"

JE BEPAALT NIETS ZELF. JE LEEST ALLEEN WAT ER STAAT.

## WAT JE MOET EXTRAHEREN

### Fiscale entiteit
- Naam belastingplichtige
- BSN (gemaskeerd: ****1234)
- Geboortedatum
- Fiscaal partner (indien van toepassing)
- Type aangifte: individueel of samen

### Per item in de aangifte:
1. description_from_aangifte: EXACT zoals het er staat
2. category: Bepaald door WAAR het staat in de aangifte
3. value_jan_1: Het bedrag per 1 januari zoals vermeld
4. owner_id: "tp_01" (belastingplichtige), "fp_01" (partner), of "joint"
5. ownership_percentage: 100 tenzij anders vermeld
6. Identificerende gegevens (IBAN, rekeningnummer, adres, etc.)

### Totalen per categorie
Extraheer de totalen zoals vermeld in de aangifte:
- Bankrekeningen in box 3: € ...
- Beleggingen in box 3: € ...
- Overige bezittingen: € ...
- Totaal schulden: € ...

### Belastingdienst gegevens
- Grondslag sparen en beleggen
- Heffingsvrij vermogen
- Forfaitair rendement
- Belasting box 3

## SPECIALE GEVALLEN

### BinckBank / DEGIRO met twee regels
Als je ziet:
- "BinckBank N.V. Normal" onder BANKREKENINGEN met €34.627
- "BinckBank N.V. Normal" onder BELEGGINGEN met €111.280

Dit zijn TWEE APARTE items:
- Bank item: gelddeel (cash saldo)
- Investment item: effectendeel (portefeuille)

Extraheer BEIDE als aparte items in hun respectievelijke categorie.

### Credit Linked Beheer
- Onder "Bank- en spaarrekeningen" met "GEEN NUMMER" → bank_savings (deposito)
- Onder "Beleggingen" met fondsnaam (bijv. "huurwoningen nl fonds") → investments

### Groene beleggingen
Items met "Is het een groene belegging? Ja" → is_green_investment: true

### Vorderingen / Uitgeleend geld
- "familie hypotheek Rick otto €60.000" → other_assets, asset_type: "loaned_money"

## OUTPUT FORMAT

\`\`\`json
{
  "schema_version": "3.0",
  "tax_years": ["2022"],
  "fiscal_entity": {
    "taxpayer": {
      "id": "tp_01",
      "name": "J W OTTO",
      "bsn_masked": "****3776",
      "date_of_birth": "22-04-1953"
    },
    "fiscal_partner": {
      "id": "fp_01",
      "name": "G C OTTO-WORTELBOER",
      "bsn_masked": "****3990",
      "date_of_birth": "23-09-1954"
    },
    "filing_type": "joint"
  },
  "asset_items": {
    "bank_savings": [
      {
        "manifest_id": "bank_1",
        "description_from_aangifte": "ING Oranje Spaarrekening A561 -328 65",
        "category": "bank_savings",
        "owner_id": "joint",
        "ownership_percentage": 100,
        "iban_from_aangifte": "A561 -328 65",
        "bank_name": "ING",
        "yearly_values": {
          "2022": { "value_jan_1": 45962 }
        },
        "is_joint_account": true
      }
    ],
    "investments": [
      {
        "manifest_id": "inv_1",
        "description_from_aangifte": "DEGIRO Beleggingsrekening Janotto",
        "category": "investments",
        "owner_id": "tp_01",
        "ownership_percentage": 100,
        "account_number": "Janotto",
        "institution": "DEGIRO",
        "yearly_values": {
          "2022": { "value_jan_1": 112343 }
        },
        "is_green_investment": false
      }
    ],
    "real_estate": [],
    "other_assets": [
      {
        "manifest_id": "other_1",
        "description_from_aangifte": "familie hypotheek Rick otto",
        "category": "other_assets",
        "asset_type": "loaned_money",
        "owner_id": "joint",
        "ownership_percentage": 100,
        "yearly_values": {
          "2022": { "value_jan_1": 60000 }
        },
        "loan_details": {
          "borrower_name": "Rick Otto",
          "is_family_loan": true
        }
      }
    ]
  },
  "debt_items": [
    {
      "manifest_id": "debt_1",
      "description_from_aangifte": "credit linked beheer, duurzaam woningen fonds",
      "category": "debt",
      "creditor_name": "credit linked beheer",
      "loan_number": "duurzaam woningen fonds",
      "owner_id": "joint",
      "ownership_percentage": 100,
      "yearly_values": {
        "2022": { "value_jan_1": 5147 }
      },
      "is_eigen_woning_schuld": false
    }
  ],
  "category_totals": {
    "bank_savings": 413723,
    "investments": 523199,
    "real_estate": 0,
    "other_assets": 112000,
    "debts": 134936,
    "grand_total": 913986
  },
  "tax_authority": {
    "2022": {
      "grondslag_sparen_beleggen": 812686,
      "heffingsvrij_vermogen": 101300,
      "forfaitair_rendement": 26647,
      "belasting_box3": 8260,
      "rendementsgrondslag": 913986
    }
  },
  "green_investments": {
    "total_value": 39550,
    "exemption_applied": 39550
  }
}
\`\`\`

## VALIDATIE

Na extractie, controleer:
1. Som bank_savings items == category_totals.bank_savings
2. Som investments items == category_totals.investments
3. Som other_assets items == category_totals.other_assets
4. Som debt_items == category_totals.debts

Als de sommen niet kloppen, heb je items gemist. Controleer opnieuw.

GEEF ALLEEN VALIDE JSON TERUG.`;

// =============================================================================
// STAGE 2: ENRICHMENT PROMPT
// =============================================================================

export const ENRICHMENT_PROMPT = `Je bent een expert in Nederlandse financiële documenten.

## OPDRACHT
Je krijgt een MANIFEST met items uit de belastingaangifte.
Zoek in de BRONDOCUMENTEN (jaaroverzichten, etc.) de AANVULLENDE informatie per item.

## KRITIEKE REGELS

1. **WIJZIG NIETS aan de manifest items**
   - De value_jan_1 is al correct (uit aangifte)
   - De category is al correct (uit aangifte)
   - De description is al correct (uit aangifte)

2. **VOEG GEEN nieuwe items toe**
   - Alle items staan al in het manifest
   - Als je iets vindt dat niet in manifest staat → negeer het

3. **VERWIJDER NIETS**
   - Elk manifest item blijft bestaan
   - Ook als je geen brondocument vindt

## WAT JE WEL DOET

Per manifest item, zoek in brondocumenten:

### Voor bankrekeningen:
- full_iban: Volledige IBAN
- interest_received: Ontvangen rente over het jaar

### Voor beleggingen:
- dividends_received: Ontvangen dividend
- costs_paid: Transactiekosten, beheerkosten
- capital_gains_realized: Gerealiseerde koerswinst (optioneel)

### Voor vorderingen (uitgeleend geld):
- interest_received: Ontvangen rente op de lening

### Voor schulden:
- interest_paid: Betaalde rente (indien niet Box 1)

### Altijd:
- matched_source_doc_id: ID van het brondocument
- match_confidence: Hoe zeker ben je (0.0-1.0)

## MATCHING STRATEGIE

Match manifest items met brondocumenten op:
1. IBAN (laatste 4 cijfers matchen)
2. Banknaam / Institutie naam
3. Rekeningnummer
4. Bedrag per 1 januari (moet exact of zeer dicht bij manifest waarde)

### Voorbeeld matching:

Manifest item:
\`\`\`
manifest_id: "bank_5"
description: "BinckBank N.V. Normal NL07 BICK 0807 8039 36"
value_jan_1: 34627
\`\`\`

Brondocument "Jaaroverzicht BinckBank 2022":
\`\`\`
Rekeningnummer: NL07BICK0807803936
Saldo 1 januari 2022: €34.627,00
Ontvangen rente: €12,50
\`\`\`

→ Match! confidence: 0.99, interest_received: 12.50

## OUTPUT FORMAT

\`\`\`json
{
  "enriched_items": [
    {
      "manifest_id": "bank_1",
      "enrichment": {
        "matched_source_doc_id": "doc_003",
        "match_confidence": 0.95,
        "full_iban": "NL31INGB0002861835",
        "interest_received": 45.23
      }
    },
    {
      "manifest_id": "inv_1",
      "enrichment": {
        "matched_source_doc_id": "doc_007",
        "match_confidence": 0.90,
        "dividends_received": 1250.00,
        "costs_paid": 89.50
      }
    },
    {
      "manifest_id": "bank_15",
      "enrichment": null,
      "note": "Geen jaaroverzicht gevonden voor Credit Linked Beheer deposito"
    }
  ],
  "unmatched_source_docs": [
    {
      "doc_id": "doc_012",
      "doc_type": "jaaroverzicht_bank",
      "reason": "IBAN NL99XXXX0009999999 komt niet voor in manifest"
    }
  ],
  "enrichment_summary": {
    "total_interest_received": 523.45,
    "total_dividends_received": 3850.00,
    "total_costs_paid": 245.00,
    "items_fully_matched": 12,
    "items_partially_matched": 3,
    "items_unmatched": 2
  }
}
\`\`\`

## BELANGRIJK

- Als een manifest item geen match heeft: enrichment: null + note met uitleg
- Als een brondocument geen manifest item matcht: voeg toe aan unmatched_source_docs
- Wees conservatief met matching: liever geen match dan een verkeerde match

GEEF ALLEEN VALIDE JSON TERUG.`;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build the manifest extraction prompt with document content
 */
export function buildManifestExtractionPrompt(
  documentContents: Array<{ doc_id: string; doc_type: string; content: string }>
): string {
  const aangifteDocuments = documentContents.filter(
    (d) => d.doc_type === 'aangifte_ib' || d.doc_type === 'definitieve_aanslag' || d.doc_type === 'voorlopige_aanslag'
  );

  if (aangifteDocuments.length === 0) {
    throw new Error('Geen aangifte of aanslag document gevonden. Manifest extractie vereist een aangifte.');
  }

  const documentText = aangifteDocuments
    .map((d) => `=== Document: ${d.doc_id} (${d.doc_type}) ===\n${d.content}`)
    .join('\n\n');

  return `${MANIFEST_EXTRACTION_PROMPT}

## TE VERWERKEN DOCUMENTEN:

${documentText}

Extraheer het volledige Box 3 manifest uit bovenstaande aangifte(n).`;
}

/**
 * Build the enrichment prompt with manifest and source documents
 */
export function buildEnrichmentPrompt(
  manifest: any,
  sourceDocuments: Array<{ doc_id: string; doc_type: string; content: string }>
): string {
  // Filter out aangifte documents - we only need source docs for enrichment
  const enrichmentDocs = sourceDocuments.filter(
    (d) =>
      d.doc_type !== 'aangifte_ib' && d.doc_type !== 'definitieve_aanslag' && d.doc_type !== 'voorlopige_aanslag'
  );

  if (enrichmentDocs.length === 0) {
    // No source documents to enrich with - return early
    return '';
  }

  const documentText = enrichmentDocs
    .map((d) => `=== Document: ${d.doc_id} (${d.doc_type}) ===\n${d.content}`)
    .join('\n\n');

  // Create a summary of manifest items to match
  const manifestSummary = {
    bank_savings: manifest.asset_items.bank_savings.map((b: any) => ({
      manifest_id: b.manifest_id,
      description: b.description_from_aangifte,
      value_jan_1: Object.values(b.yearly_values)[0],
      iban_hint: b.iban_from_aangifte,
      bank: b.bank_name,
    })),
    investments: manifest.asset_items.investments.map((i: any) => ({
      manifest_id: i.manifest_id,
      description: i.description_from_aangifte,
      value_jan_1: Object.values(i.yearly_values)[0],
      account: i.account_number,
      institution: i.institution,
    })),
    other_assets: manifest.asset_items.other_assets.map((o: any) => ({
      manifest_id: o.manifest_id,
      description: o.description_from_aangifte,
      value_jan_1: Object.values(o.yearly_values)[0],
      type: o.asset_type,
    })),
    debts: manifest.debt_items.map((d: any) => ({
      manifest_id: d.manifest_id,
      description: d.description_from_aangifte,
      value_jan_1: Object.values(d.yearly_values)[0],
      creditor: d.creditor_name,
    })),
  };

  return `${ENRICHMENT_PROMPT}

## MANIFEST ITEMS OM TE MATCHEN:

\`\`\`json
${JSON.stringify(manifestSummary, null, 2)}
\`\`\`

## BRONDOCUMENTEN:

${documentText}

Zoek per manifest item de aanvullende informatie in de brondocumenten.`;
}

// =============================================================================
// VALIDATION PROMPT (Stage 3 - optional, for anomalies only)
// =============================================================================

export const ANOMALY_DETECTION_PROMPT_V2 = `Je bent een senior fiscalist die Box 3 extracties controleert.

## OPDRACHT
Analyseer het geëxtraheerde manifest en de enrichment data op anomalieën.

## WAT JE CONTROLEERT

1. **Ontbrekende items**
   - Zijn er items in het manifest zonder enrichment die er wel zouden moeten zijn?
   - Zijn er brondocumenten die nergens bij passen?

2. **Onwaarschijnlijke rendementen**
   - Rente > 5% van saldo is verdacht
   - Dividend > 10% van waarde is verdacht
   - Geen enkel rendement bij beleggingen is verdacht

3. **Peildatum issues**
   - Waarden die van 31 december lijken ipv 1 januari
   - Grote verschillen tussen manifest en brondoc waarden

4. **Fiscale bijzonderheden**
   - Groene beleggingen zonder vrijstelling
   - Vorderingen zonder renteafspraak
   - Box 1 hypotheken die ook in Box 3 staan

## OUTPUT FORMAT

\`\`\`json
{
  "anomalies": [
    {
      "severity": "warning",
      "category": "missing_enrichment",
      "manifest_id": "bank_15",
      "description": "Geen jaaroverzicht voor Credit Linked Beheer €12.855 - vraag klant om dit document",
      "suggested_action": "request_document"
    },
    {
      "severity": "info",
      "category": "high_interest",
      "manifest_id": "other_1",
      "description": "Familie hypotheek €60.000 zonder renteafspraak - controleer of 6% zakelijke rente is afgesproken",
      "suggested_action": "verify_with_client"
    }
  ],
  "overall_confidence": 0.85,
  "recommendation": "Extractie is grotendeels compleet. Vraag klant om ontbrekende jaaroverzichten."
}
\`\`\`

GEEF ALLEEN VALIDE JSON TERUG.`;
