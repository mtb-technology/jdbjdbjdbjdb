/**
 * Box 3 Multi-Stage Extraction Prompts
 *
 * Stage-specific prompts for the multi-stage extraction pipeline.
 * Each prompt is focused on a single task for better accuracy.
 */

// =============================================================================
// STAGE 1: DOCUMENT CLASSIFICATION PROMPT
// =============================================================================

export const CLASSIFICATION_PROMPT = `Je bent een expert in Nederlandse belastingdocumenten.

Analyseer dit document en bepaal:
1. Welk TYPE document is dit?
2. Welk BELASTINGJAAR betreft het?
3. Welke PERSONEN worden genoemd?
4. Welke VERMOGENSBESTANDDELEN worden vermeld (hints voor later)?

## DOCUMENT TYPES (kies precies één):
- aangifte_ib: Aangifte inkomstenbelasting (bevat "Box 3" sectie)
- aanslag_definitief: Definitieve aanslag van Belastingdienst
- aanslag_voorlopig: Voorlopige aanslag van Belastingdienst
- jaaropgave_bank: Jaaroverzicht van bank (saldi, rente)
- woz_beschikking: WOZ-waardebeschikking gemeente
- effectenoverzicht: Beleggingsoverzicht (aandelen, fondsen)
- email_body: E-mail correspondentie
- overig: Ander document

## OUTPUT FORMAT (alleen JSON):
{
  "detected_type": "aangifte_ib",
  "detected_tax_years": [2023],
  "detected_persons": [
    { "name": "J. de Vries", "bsn_last4": "1234", "role": "taxpayer" },
    { "name": "A. de Vries", "bsn_last4": "5678", "role": "partner" }
  ],
  "asset_hints": {
    "bank_accounts": [
      { "bank_name": "ING", "account_last4": "1234" },
      { "bank_name": "Rabobank", "account_last4": null }
    ],
    "properties": [
      { "address": "Voorbeeldstraat 1", "postcode": "1234AB" }
    ],
    "investments": [
      { "institution": "DEGIRO" }
    ]
  },
  "confidence": 0.95,
  "notes": "Aangifte 2023 met fiscaal partner"
}

BELANGRIJK:
- Geef ALLEEN JSON output
- Bij twijfel over type: kies "overig"
- asset_hints zijn HINTS, geen complete extractie
- Let op BSN: maskeer als ****XXXX (laatste 4 cijfers)`;

// =============================================================================
// STAGE 2: TAX AUTHORITY DATA EXTRACTION PROMPT
// =============================================================================

export const TAX_AUTHORITY_PROMPT = `Je bent een expert fiscalist gespecialiseerd in Box 3 (vermogensbelasting).

Analyseer de AANGIFTE en/of AANSLAG documenten en extraheer:
1. PERSOONGEGEVENS (belastingplichtige + eventuele partner)
2. BELASTINGDIENST TOTALEN per jaar
3. ASSET REFERENTIES (wat vermelden ze? Dit wordt checklist voor volgende stap)

## TE EXTRAHEREN VELDEN:

### Personen
- Naam, BSN (gemaskeerd ****XXXX), geboortedatum
- Heeft fiscaal partner? Zo ja, dezelfde gegevens

### Belastingdata per jaar (KRITIEK!)
Zoek naar deze velden in Box 3 sectie:
- total_assets_gross: "Totaal bezittingen" of "Rendementsgrondslag"
- total_debts: "Schulden"
- total_exempt: "Heffingsvrij vermogen" (2024: €57.000 p.p., 2023: €57.000, 2022: €50.650)
- taxable_base: "Grondslag sparen en beleggen"
- deemed_return: "Voordeel uit sparen en beleggen" = forfaitair rendement
- total_tax_assessed: "Inkomstenbelasting box 3" - DIT IS HET BELANGRIJKSTE!

### Asset Referenties (voor completeness check)
Tel en beschrijf ALLE vermogensbestanddelen die in de aangifte staan:
- Hoeveel bankrekeningen? Welke banken?
- Hoeveel beleggingsrekeningen?
- Hoeveel onroerende zaken? (kijk naar "Woningen en andere onroerende zaken" totaal)
- Overige bezittingen?

### Totaalbedragen per categorie (BELANGRIJK!)
Zoek in Box 3 sectie naar deze subtotalen:
- Banktegoeden totaal
- Aandelen, obligaties totaal
- Woningen en andere onroerende zaken totaal (dit is CRUCIAAL!)
- Overige bezittingen totaal
- Schulden totaal

LET OP: Als "Woningen en andere onroerende zaken" > 0, dan IS er onroerend goed in Box 3!
Dit kan een vakantiewoning, verhuurpand, grond, of buitenlands vastgoed zijn.

## OUTPUT FORMAT:
{
  "fiscal_entity": {
    "taxpayer": {
      "id": "tp_01",
      "name": "Jan de Vries",
      "bsn_masked": "****1234",
      "date_of_birth": "1975-03-15"
    },
    "fiscal_partner": {
      "has_partner": true,
      "id": "fp_01",
      "name": "Anna de Vries",
      "bsn_masked": "****5678",
      "date_of_birth": "1978-06-20"
    },
    "allocation_percentage": {
      "taxpayer": 50,
      "partner": 50
    }
  },
  "tax_authority_data": {
    "2023": {
      "source_doc_id": "doc_1",
      "document_type": "aangifte",
      "household_totals": {
        "total_assets_gross": 450000,
        "total_debts": 0,
        "net_assets": 450000,
        "total_exempt": 114000,
        "taxable_base": 336000,
        "deemed_return": 18480,
        "total_tax_assessed": 5914
      },
      "per_person": {
        "tp_01": {
          "allocation_percentage": 50,
          "total_assets_box3": 225000,
          "exempt_amount": 57000,
          "taxable_base": 168000,
          "deemed_return": 9240,
          "tax_assessed": 2957
        },
        "fp_01": {
          "allocation_percentage": 50,
          "total_assets_box3": 225000,
          "exempt_amount": 57000,
          "taxable_base": 168000,
          "deemed_return": 9240,
          "tax_assessed": 2957
        }
      }
    }
  },
  "asset_references": {
    "bank_count": 5,
    "bank_descriptions": [
      "ING Betaalrekening ****1234",
      "ING Spaarrekening ****5678",
      "Rabobank Spaarrekening ****9012",
      "ABN AMRO Spaarrekening ****3456",
      "ASN Groenrekening ****7890"
    ],
    "investment_count": 1,
    "investment_descriptions": [
      "DEGIRO Beleggingsrekening"
    ],
    "real_estate_count": 1,
    "real_estate_descriptions": [
      "Vakantiewoning 2142GD Cruquius"
    ],
    "other_assets_count": 2,
    "other_descriptions": [
      "Premiedepot pensioenverzekering",
      "Kapitaalverzekering"
    ]
  },
  "category_totals": {
    "2023": {
      "bank_savings_total": 125000,
      "investments_total": 75000,
      "real_estate_total": 245000,
      "other_assets_total": 5000,
      "debts_total": 0
    }
  }
}

BELANGRIJK:
- total_tax_assessed is CRUCIAAL voor teruggave berekening
- asset_references wordt checklist: in volgende stap moeten we ALLE vermelde assets vinden
- category_totals bevat de SUBTOTALEN per categorie uit de aangifte - gebruik dit voor validatie!
- Als "real_estate_total" > 0: er IS onroerend goed, zoek naar WOZ waarden of adressen
- Als partner niet aanwezig: "has_partner": false`;

// =============================================================================
// STAGE 3a: BANK ACCOUNT EXTRACTION PROMPT
// =============================================================================

export const BANK_EXTRACTION_PROMPT = `Je bent een expert in Nederlandse bankdocumenten en belastingaangiftes.

OPDRACHT: Extraheer ALLE bankrekeningen uit de documenten.

## CHECKLIST UIT AANGIFTE:
{BANK_CHECKLIST}

Je MOET alle rekeningen uit de checklist vinden! Als een rekening ontbreekt, meld dit.

## TE EXTRAHEREN PER REKENING:

### Identificatie
- bank_name: ING, Rabobank, ABN AMRO, SNS, ASN, Triodos, Knab, bunq, etc.
- account_masked: IBAN met middelste cijfers gemaskeerd (NL91INGB****1234)
- description: Korte beschrijving ("ING Spaarrekening")

### Per jaar
- value_jan_1: Saldo per 1 januari (KRITIEK voor Box 3!)
- value_dec_31: Saldo per 31 december (indien beschikbaar)
- interest_received: Ontvangen rente over het jaar

### Eigendom
- owner_id: "tp_01" (belastingplichtige) of "fp_01" (partner) of "joint" (gezamenlijk)
- is_joint_account: true als "en/of" in naam rekeninghouder staat
- ownership_percentage: ALTIJD 100 - het VOLLEDIGE saldo wordt opgegeven in de aangifte
  (De verdeling tussen partners gebeurt via allocatie, niet via ownership!)

### Bijzonder
- is_green_investment: true als het een groene spaarrekening is (ASN, Triodos groen)
- country: "NL" voor Nederlandse rekeningen

## OUTPUT FORMAT:
{
  "bank_savings": [
    {
      "id": "bank_1",
      "owner_id": "tp_01",
      "description": "ING Spaarrekening",
      "bank_name": "ING",
      "account_masked": "NL91INGB****1234",
      "country": "NL",
      "is_joint_account": false,
      "ownership_percentage": 100,  // Altijd 100! Volledige saldo in aangifte
      "is_green_investment": false,
      "yearly_data": {
        "2023": {
          "value_jan_1": { "amount": 45000, "source_doc_id": "doc_2", "confidence": 0.95, "source_snippet": "Saldo 01-01-2023: EUR 45.000,00" },
          "interest_received": { "amount": 562.50, "source_doc_id": "doc_2", "confidence": 0.90, "source_snippet": "Creditrente 2023: EUR 562,50" }
        }
      }
    }
  ],
  "extraction_notes": {
    "total_found": 5,
    "expected_from_checklist": 5,
    "missing": [],
    "warnings": []
  }
}

KRITIEKE REGELS:
1. Extraheer ELKE rekening, ook met €0 saldo
2. Saldo per 1 JANUARI is wat telt voor Box 3, niet 31 december
3. Zoek naar: "Saldo per 1-1", "Openingssaldo", "Stand per 1 januari"
4. Rente staat vaak apart: "Creditrente", "Ontvangen rente", "Spaarrente"
5. IBAN formaat: NL + 2 cijfers + 4 letters (bank) + 10 cijfers
6. ownership_percentage is ALTIJD 100! De aangifte toont het volledige saldo.
   Bij gezamenlijke rekeningen: is_joint_account = true, owner_id = "joint"
7. BinckBank, DEGIRO etc. met alleen een saldo (geen beleggingsdetails) → extraheer als bankrekening
8. Premiedepot, kapitaalverzekering → extraheer als bankrekening (tenzij apart vermeld in aangifte)`;

// =============================================================================
// STAGE 3b: INVESTMENT EXTRACTION PROMPT
// =============================================================================

export const INVESTMENT_EXTRACTION_PROMPT = `Je bent een expert in Nederlandse beleggingsdocumenten.

OPDRACHT: Extraheer ALLE beleggingsrekeningen uit de documenten.

## CHECKLIST UIT AANGIFTE:
{INVESTMENT_CHECKLIST}

## TE EXTRAHEREN PER BELEGGINGSREKENING:

### Identificatie
- institution: DEGIRO, ING, Rabobank, ABN AMRO, Binck, Saxo, etc.
- account_masked: Rekeningnummer (indien beschikbaar)
- type: "stocks" | "bonds" | "funds" | "crypto" | "other"

### Per jaar
- value_jan_1: Totale waarde per 1 januari
- dividend_received: Ontvangen dividend
- realized_gains: Gerealiseerde winst (verkopen - aankopen)
- transaction_costs: Transactiekosten

### Eigendom
- owner_id: "tp_01" of "fp_01" of "joint"
- ownership_percentage: ALTIJD 100! Volledige waarde in aangifte
  (Verdeling tussen partners is allocatie, niet ownership)

## OUTPUT FORMAT:
{
  "investments": [
    {
      "id": "inv_1",
      "owner_id": "tp_01",
      "description": "DEGIRO Beleggingsrekening",
      "institution": "DEGIRO",
      "account_masked": "****5678",
      "country": "NL",
      "type": "funds",
      "ownership_percentage": 100,
      "yearly_data": {
        "2023": {
          "value_jan_1": { "amount": 75000, "source_doc_id": "doc_3", "confidence": 0.95 },
          "dividend_received": { "amount": 1250, "source_doc_id": "doc_3", "confidence": 0.85 },
          "realized_gains": { "amount": 3500, "source_doc_id": "doc_3", "confidence": 0.80 }
        }
      }
    }
  ],
  "extraction_notes": {
    "total_found": 1,
    "expected_from_checklist": 1,
    "missing": [],
    "warnings": []
  }
}

KRITIEKE REGELS:
1. Waarde per 1 JANUARI telt voor Box 3
2. Dividend is onderdeel van "werkelijk rendement"
3. Gerealiseerde winst ook onderdeel van werkelijk rendement
4. Let op cryptovaluta - valt ook onder beleggingen
5. Extraheer ALLEEN als er duidelijk sprake is van aandelen, obligaties, fondsen of crypto
6. Een saldo zonder beleggingsdetails (BinckBank €1.050) is GEEN belegging maar banktegoed`;

// =============================================================================
// STAGE 3c: REAL ESTATE EXTRACTION PROMPT
// =============================================================================

export const REAL_ESTATE_EXTRACTION_PROMPT = `Je bent een expert in Nederlandse WOZ-beschikkingen en onroerend goed.

OPDRACHT: Extraheer ALLE onroerende zaken die in Box 3 vallen.

## CHECKLIST UIT AANGIFTE:
{REAL_ESTATE_CHECKLIST}

## BELANGRIJK: BOX 1 vs BOX 3
- EIGEN WONING (hoofdverblijf) = Box 1, NIET extraheren
- Verhuurde woningen = Box 3 ✓
- Vakantiewoningen = Box 3 ✓
- Tweede woningen = Box 3 ✓
- Commercieel vastgoed = Box 3 ✓
- Grond = Box 3 ✓

## WOZ PEILDATUM REGEL (KRITIEK!)
WOZ-waarde met peildatum 1-1-YYYY geldt voor belastingjaar YYYY+1!

Voorbeelden:
- Peildatum 1-1-2022 → Gebruik voor Box 3 jaar 2023
- Peildatum 1-1-2023 → Gebruik voor Box 3 jaar 2024

## TE EXTRAHEREN PER PAND:

### Identificatie
- address: Volledig adres of "postcode huisnummer" (bijv. "2142GD 5")
- postcode: 4 cijfers + 2 letters
- type: "rented_residential" | "vacation_home" | "second_home" | "rented_commercial" | "land" | "foreign_property"

### Per jaar (let op peildatum!)
- woz_value: WOZ-waarde
- reference_date: Peildatum (bijv. "2023-01-01")
- applicable_tax_year: Belastingjaar waarvoor deze waarde geldt

### Huurinkomsten (indien van toepassing)
- rental_income_gross: Bruto huurinkomsten
- maintenance_costs: Onderhoudskosten
- property_tax: OZB/gemeentelijke heffingen
- insurance: Opstalverzekering

### Eigendom
- owner_id: "tp_01" of "fp_01" of "joint"
- ownership_percentage: Percentage eigendom

## OUTPUT FORMAT:
{
  "real_estate": [
    {
      "id": "re_1",
      "owner_id": "tp_01",
      "description": "Vakantiewoning Cruquius",
      "address": "Hoofdweg 5, 2142GD Cruquius",
      "postcode": "2142GD",
      "country": "NL",
      "type": "vacation_home",
      "ownership_percentage": 100,
      "yearly_data": {
        "2024": {
          "woz_value": {
            "amount": 385000,
            "source_doc_id": "doc_4",
            "confidence": 0.99,
            "source_snippet": "WOZ-waarde: € 385.000",
            "reference_date": "2023-01-01"
          }
        }
      }
    }
  ],
  "extraction_notes": {
    "total_found": 1,
    "expected_from_checklist": 1,
    "missing": [],
    "peildatum_mappings": [
      { "peildatum": "2023-01-01", "applies_to_tax_year": 2024 }
    ]
  }
}

KRITIEKE REGELS:
1. WOZ peildatum 1-1-YYYY → belastingjaar YYYY+1
2. Eigen woning NIET extraheren (is Box 1)
3. Bij verhuur: huurinkomsten zijn onderdeel van werkelijk rendement
4. Let op buitenlands onroerend goed (andere regels)`;

// =============================================================================
// STAGE 3d: OTHER ASSETS & DEBTS EXTRACTION PROMPT
// =============================================================================

export const OTHER_ASSETS_EXTRACTION_PROMPT = `Je bent een expert in Nederlandse vermogensbestanddelen.

OPDRACHT: Extraheer ALLE overige bezittingen en schulden.

## CHECKLIST UIT AANGIFTE:
{OTHER_CHECKLIST}

## TYPES OVERIGE BEZITTINGEN:
- premiedepot: Premiedepot pensioenverzekering
- capital_insurance: Kapitaalverzekering
- vve_share: VvE reserve
- claims: Vorderingen op derden
- loaned_money: Uitgeleend geld
- cash: Contant geld (>€560)
- periodic_benefits: Periodieke uitkeringen
- crypto: Cryptovaluta (als apart, niet bij beleggingen)
- other: Overige

## TYPES SCHULDEN:
- mortgage_box3: Hypotheek op Box 3 pand
- consumer_credit: Consumptief krediet
- personal_loan: Persoonlijke lening
- study_loan: Studieschuld (niet aftrekbaar in Box 3)
- tax_debt: Belastingschuld
- other: Overige schulden

## OUTPUT FORMAT:
{
  "other_assets": [
    {
      "id": "oa_1",
      "owner_id": "tp_01",
      "description": "Premiedepot Aegon",
      "type": "premiedepot",
      "country": "NL",
      "yearly_data": {
        "2023": {
          "value_jan_1": { "amount": 14862, "source_doc_id": "doc_1", "confidence": 0.90 }
        }
      }
    }
  ],
  "debts": [
    {
      "id": "debt_1",
      "owner_id": "tp_01",
      "description": "Hypotheek vakantiewoning",
      "debt_type": "mortgage_box3",
      "lender": "Rabobank",
      "linked_asset_id": "re_1",
      "ownership_percentage": 100,
      "yearly_data": {
        "2023": {
          "value_jan_1": { "amount": 150000, "source_doc_id": "doc_5", "confidence": 0.95 },
          "interest_paid": { "amount": 4500, "source_doc_id": "doc_5", "confidence": 0.90 }
        }
      }
    }
  ],
  "extraction_notes": {
    "other_assets_found": 1,
    "debts_found": 1,
    "expected_from_checklist": 2,
    "missing": [],
    "warnings": []
  }
}

KRITIEKE REGELS:
1. Schulden verlagen de Box 3 grondslag
2. Betaalde rente is onderdeel van "werkelijk rendement" (negatief)
3. Studieschuld telt NIET mee voor Box 3 (uitzondering)
4. Contant geld alleen als >€560
5. Premiedepot/kapitaalverzekering die in aangifte onder "bankrekeningen" staat → NIET hier extraheren`;

// =============================================================================
// HELPER FUNCTION: Build prompt with checklist
// =============================================================================

export function buildBankExtractionPrompt(checklist: {
  bank_count: number;
  bank_descriptions: string[];
}): string {
  const checklistText = checklist.bank_descriptions.length > 0
    ? `De aangifte vermeldt ${checklist.bank_count} bankrekening(en):
${checklist.bank_descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

VIND AL DEZE REKENINGEN!`
    : 'Geen specifieke checklist beschikbaar. Extraheer alle bankrekeningen die je vindt.';

  return BANK_EXTRACTION_PROMPT.replace('{BANK_CHECKLIST}', checklistText);
}

export function buildInvestmentExtractionPrompt(checklist: {
  investment_count: number;
  investment_descriptions: string[];
}): string {
  const checklistText = checklist.investment_descriptions.length > 0
    ? `De aangifte vermeldt ${checklist.investment_count} beleggingsrekening(en):
${checklist.investment_descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

VIND AL DEZE REKENINGEN!`
    : 'Geen specifieke checklist beschikbaar. Extraheer alle beleggingen die je vindt.';

  return INVESTMENT_EXTRACTION_PROMPT.replace('{INVESTMENT_CHECKLIST}', checklistText);
}

export function buildRealEstateExtractionPrompt(checklist: {
  real_estate_count: number;
  real_estate_descriptions: string[];
}): string {
  const checklistText = checklist.real_estate_descriptions.length > 0
    ? `De aangifte vermeldt ${checklist.real_estate_count} onroerende za(a)k(en) in Box 3:
${checklist.real_estate_descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

VIND AL DEZE PANDEN! Let op: eigen woning (Box 1) niet meetellen.`
    : 'Geen specifieke checklist beschikbaar. Extraheer alle Box 3 onroerende zaken die je vindt.';

  return REAL_ESTATE_EXTRACTION_PROMPT.replace('{REAL_ESTATE_CHECKLIST}', checklistText);
}

export function buildOtherAssetsExtractionPrompt(checklist: {
  other_assets_count: number;
  other_descriptions: string[];
}): string {
  const checklistText = checklist.other_descriptions.length > 0
    ? `De aangifte vermeldt ${checklist.other_assets_count} overige bezitting(en)/schuld(en):
${checklist.other_descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

VIND AL DEZE ITEMS!`
    : 'Geen specifieke checklist beschikbaar. Extraheer alle overige bezittingen en schulden die je vindt.';

  return OTHER_ASSETS_EXTRACTION_PROMPT.replace('{OTHER_CHECKLIST}', checklistText);
}
