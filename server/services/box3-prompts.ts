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
  INCLUSIEF: premiedepots, kapitaalverzekeringen, en beleggingsrekeningen met alleen een saldo (geen aandelen/fondsen detail)
  Bijvoorbeeld: "Binck €1.050" zonder portefeuille detail = bankrekening, "Premiedepot Aegon" = bankrekening
- Hoeveel beleggingsrekeningen MET portefeuille/aandelen details?
- Hoeveel onroerende zaken? (kijk naar "Woningen en andere onroerende zaken" totaal)
- Overige bezittingen? (alleen zaken die NIET onder bovenstaande vallen)

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
    // KRITIEK: taxpayer + partner MOET ALTIJD optellen tot 100%!
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
    "bank_count": 7,
    "bank_descriptions": [
      "ING Betaalrekening ****1234",
      "ING Spaarrekening ****5678",
      "Rabobank Spaarrekening ****9012",
      "ABN AMRO Spaarrekening ****3456",
      "ASN Groenrekening ****7890",
      "Premiedepot pensioenverzekering",
      "Binck saldo (geen portefeuille details)"
    ],
    "investment_count": 1,
    "investment_descriptions": [
      "DEGIRO Beleggingsrekening (met portefeuille details)"
    ],
    "real_estate_count": 1,
    "real_estate_descriptions": [
      "Vakantiewoning 2142GD Cruquius"
    ],
    "other_assets_count": 1,
    "other_descriptions": [
      "Kapitaalverzekering eigen woning"
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
// STAGE 2a: FISCAL ENTITY EXTRACTION (NEW - focused sub-stage)
// =============================================================================

export const TAX_AUTHORITY_PERSONS_PROMPT = `Je bent een expert fiscalist. Extraheer ALLEEN de fiscale entiteit (personen) uit dit document.

## OPDRACHT
Identificeer de belastingplichtige en eventuele fiscaal partner.

## TE EXTRAHEREN VELDEN

### Belastingplichtige (verplicht)
- Naam (volledige naam zoals vermeld)
- BSN (gemaskeerd als ****XXXX - alleen laatste 4 cijfers)
- Geboortedatum (YYYY-MM-DD formaat)

### Fiscaal Partner (indien aanwezig)
- Heeft deze aangifte een fiscaal partner? (ja/nee)
- Zo ja: naam, BSN (gemaskeerd), geboortedatum

### Verdeling (allocation)
- Hoe is het Box 3 vermogen verdeeld? (standaard 50/50)
- Kijk naar "verdeling" of "toerekening" in de aangifte
- KRITIEK: De som van alle allocation_percentages MOET ALTIJD 100% zijn!
  * Als 2 partners: bijv. 50/50, 60/40, 70/30 - maar ALTIJD optellend tot 100
  * Als 1 persoon (geen partner): allocation = 100
  * Als je geen expliciete verdeling vindt, gebruik 50/50 als default

## OUTPUT FORMAT (alleen JSON):
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
  }
}

BELANGRIJK:
- Focus ALLEEN op personen, niet op bedragen
- Als geen partner: "has_partner": false
- BSN altijd maskeren als ****XXXX`;

// =============================================================================
// STAGE 2b: OFFICIAL TOTALS EXTRACTION (NEW - focused sub-stage)
// =============================================================================

export const TAX_AUTHORITY_TOTALS_PROMPT = `Je bent een expert fiscalist. Extraheer ALLEEN de officiële Box 3 cijfers.

## OPDRACHT
Haal de Belastingdienst totalen uit de aangifte/aanslag per belastingjaar.

## KRITIEK: TYPE AANSLAG
Bepaal of dit een VOORLOPIGE of DEFINITIEVE aanslag is!
- "Voorlopige aanslag" = voorlopig (claim nog niet mogelijk)
- "Definitieve aanslag" = definitief (claim WEL mogelijk)
- Aangifte zonder aanslag = alleen aangifte

## TE EXTRAHEREN VELDEN PER JAAR

Zoek naar deze velden in de Box 3 sectie:
- total_assets_gross: "Totaal bezittingen" of "Rendementsgrondslag"
- total_debts: "Schulden"
- total_exempt: "Heffingsvrij vermogen" (2024: €57.000 p.p.)
- taxable_base: "Grondslag sparen en beleggen"
- deemed_return: "Voordeel uit sparen en beleggen" (forfaitair rendement)
- total_tax_assessed: "Inkomstenbelasting box 3" - CRUCIAAL!

## AANSLAG IDENTIFICATIE
Extraheer ook:
- assessment_number: Aanslagbiljetnummer (vaak 12 cijfers)
- assessment_date: Dagtekening van de aanslag
- is_final_assessment: Is dit een DEFINITIEVE aanslag?

## OUTPUT FORMAT (alleen JSON):
{
  "tax_authority_data": {
    "2023": {
      "source_doc_id": "doc_1",
      "document_type": "definitieve_aanslag",
      "assessment_number": "123456789012",
      "assessment_date": "2024-03-15",
      "is_final_assessment": true,
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
        }
      }
    }
  }
}

BELANGRIJK:
- total_tax_assessed is CRUCIAAL voor teruggave berekening
- is_final_assessment bepaalt of claim mogelijk is
- Focus ALLEEN op cijfers, niet op asset details
- KRITIEK: De som van alle allocation_percentage waarden in per_person MOET ALTIJD 100% zijn!
  Als je geen expliciete verdeling vindt, gebruik 50/50 als default bij 2 personen.`;

// =============================================================================
// STAGE 2c: ASSET REFERENCES EXTRACTION (NEW - focused sub-stage)
// =============================================================================

export const TAX_AUTHORITY_CHECKLIST_PROMPT = `Je bent een expert fiscalist. Maak een inventarisatie van alle vermogensbestanddelen.

## OPDRACHT
Tel en beschrijf ALLE vermogensbestanddelen die in de aangifte worden genoemd.
Dit wordt de checklist voor latere extractie.

## TE INVENTARISEREN

### Bankrekeningen
Tel ALLE bankrekeningen, inclusief:
- Gewone spaarrekeningen
- Premiedepots
- Kapitaalverzekeringen
- Beleggingsrekeningen met ALLEEN een saldo (geen portefeuille details)
  Bijv: "BinckBank €1.050" zonder aandelen detail = bankrekening

### Beleggingen
Alleen rekeningen MET portefeuille/aandelen details.
Een saldo zonder details is GEEN belegging!

### Onroerend goed
Kijk naar "Woningen en andere onroerende zaken" totaal.
Als dit > 0: er IS onroerend goed in Box 3!
- Vakantiewoningen
- Verhuurde woningen
- Tweede woningen
- Grond
- Buitenlands vastgoed

LET OP: Eigen woning (hoofdverblijf) = Box 1, NIET meetellen!

### Overige bezittingen
- VvE reserves
- Uitgeleend geld
- Contant geld > €560
- Overige

### Schulden
- Hypotheek op Box 3 pand
- Consumptief krediet
- Persoonlijke leningen

LET OP: Studieschuld telt NIET mee voor Box 3!

## CATEGORIE TOTALEN (BELANGRIJK!)
Zoek naar subtotalen per categorie:
- Banktegoeden totaal
- Aandelen, obligaties totaal
- Woningen en andere onroerende zaken totaal
- Overige bezittingen totaal
- Schulden totaal

## OUTPUT FORMAT (alleen JSON):
{
  "asset_references": {
    "bank_count": 7,
    "bank_descriptions": [
      "ING Betaalrekening ****1234",
      "ING Spaarrekening ****5678",
      "Rabobank Spaarrekening",
      "ASN Groenrekening",
      "Premiedepot Aegon",
      "Binck saldo (geen portefeuille)"
    ],
    "investment_count": 1,
    "investment_descriptions": [
      "DEGIRO Beleggingsrekening (met portefeuille)"
    ],
    "real_estate_count": 1,
    "real_estate_descriptions": [
      "Vakantiewoning 2142GD Cruquius"
    ],
    "other_assets_count": 0,
    "other_descriptions": [],
    "debts_count": 1,
    "debts_descriptions": [
      "Hypotheek vakantiewoning Rabobank"
    ]
  },
  "category_totals": {
    "2023": {
      "bank_savings_total": 125000,
      "investments_total": 75000,
      "real_estate_total": 245000,
      "other_assets_total": 0,
      "debts_total": 150000
    }
  },
  "extraction_notes": {
    "has_real_estate": true,
    "has_green_investments": true,
    "has_foreign_assets": false
  }
}

BELANGRIJK:
- Dit wordt de CHECKLIST: in volgende stappen moeten we ALLE items vinden
- Als "real_estate_total" > 0: er IS onroerend goed, zoek naar WOZ/adressen
- Let op groene beleggingen (ASN, Triodos) - deze hebben vrijstelling`;

// =============================================================================
// STAGE 5c: LLM-ASSISTED ANOMALY DETECTION (NEW)
// =============================================================================

export const ANOMALY_DETECTION_PROMPT = `Je bent een senior fiscalist die een kwaliteitscontrole uitvoert op geëxtraheerde Box 3 data.

## OPDRACHT
Beoordeel de volgende extractie op plausibiliteit en mogelijke fouten.

## EXTRACTIE DATA
{EXTRACTED_DATA}

## EMAIL CONTEXT VAN KLANT
{EMAIL_CONTEXT}

BELANGRIJK: De email van de klant kan extra informatie bevatten die de extractie context geeft.
Als de klant in de email bijvoorbeeld rente-inkomsten, rentepercentages, of andere details vermeldt,
MOET je die informatie meenemen in je beoordeling. Een vordering ZONDER rente in de extractie maar
MET rente vermeld in de email is GEEN anomalie - de informatie is gewoon in de email vermeld.

## TE CONTROLEREN

### 1. Rente Plausibiliteit
- Is de rente realistisch voor het type rekening?
- Spaarrente 2023: ~1-3% was normaal
- Spaarrente 2024: ~2-4% was normaal
- > 5% is verdacht, > 10% is vrijwel zeker fout

### 2. Vermogensconsistentie
- Past de omvang van het vermogen bij elkaar?
- Een vakantiewoning van €500k zonder hypotheek is ongebruikelijk
- Grote crypto-posities zonder andere beleggingen is verdacht

### 3. Classificatie Fouten
- Staat er iets in Box 3 dat er niet hoort?
  - Kapitaalverzekering Eigen Woning (KEW) = Box 1!
  - Lijfrente = Box 1!
  - Studieschuld = NIET aftrekbaar in Box 3!
  - Eigen woning = Box 1!

### 4. Ontbrekende Data
- Is er logisch ontbrekende informatie?
- Beleggingen zonder dividend is ongebruikelijk
- Verhuurpand zonder huurinkomsten is verdacht

### 5. Dubbele Entries
- Staat hetzelfde vermogen dubbel?
- BinckBank als bank EN als belegging?

## OUTPUT FORMAT (alleen JSON):
{
  "anomalies": [
    {
      "type": "interest_implausible",
      "severity": "error",
      "asset_id": "bank_1",
      "message": "15% rente op spaarrekening is niet plausibel",
      "suggestion": "Controleer of dit dividend is ipv rente"
    },
    {
      "type": "classification_error",
      "severity": "warning",
      "asset_id": "oa_2",
      "message": "Lijfrente hoort in Box 1, niet Box 3",
      "suggestion": "Verwijder uit Box 3 extractie"
    }
  ],
  "overall_quality": "needs_review",
  "confidence": 0.7
}

Severity levels:
- "error": Vrijwel zeker fout, moet gecorrigeerd
- "warning": Mogelijk fout, controleren
- "info": Opvallend maar mogelijk correct`;

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

### Eigendom - KRITIEK: Bepaal eigenaar uit document!
- owner_id: BEPAAL UIT DE TENAAMSTELLING in het document:
  * Als naam belastingplichtige ({TAXPAYER_NAME}) in tenaamstelling → "tp_01"
  * Als naam partner ({PARTNER_NAME}) in tenaamstelling → "fp_01"
  * Als BEIDE namen of "en/of" in tenaamstelling → "joint"
  * Zoek naar: "Ten name van:", "Rekeninghouder:", naam bovenaan jaaroverzicht
- is_joint_account: true als "en/of" in naam rekeninghouder staat
- ownership_percentage: Percentage eigendom van de fiscale eenheid (huishouden)
  * 100 = rekening volledig van dit huishouden
  * 50 = rekening gedeeld met iemand BUITEN het huishouden (bijv. broer/zus)
  * Let op: Bij fiscaal partnerschap hoort het VOLLEDIGE saldo in de aangifte -
    verdeling tussen partners is allocatie, geen ownership wijziging!

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
      "ownership_percentage": 100,  // 100 = volledig eigendom huishouden, 50 = gedeeld buiten huishouden
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
6. ownership_percentage = 100 bij volledig eigendom huishouden, lager bij externe mede-eigenaren
   Bij gezamenlijke rekeningen BINNEN huishouden: is_joint_account = true, owner_id = "joint", ownership = 100
7. BinckBank, DEGIRO etc. met alleen een saldo (geen beleggingsdetails) → extraheer als bankrekening
8. Premiedepot, kapitaalverzekering → extraheer als bankrekening (tenzij apart vermeld in aangifte)
9. BELANGRIJK: Items ZONDER rekeningnummer (bijv. "GEEN NUMMER") zijn OOK geldig!
   - Fondsaanbieders (Credit Linked Beheer) melden vaak deposito's zonder IBAN
   - Als item in checklist staat met "GEEN NUMMER" → extraheer met account_masked: "GEENNUMMER"
10. Credit Linked Beheer ZONDER fondsnaam = bankrekening/deposito (niet investment!)`;

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

### Eigendom - KRITIEK: Bepaal eigenaar uit document!
- owner_id: BEPAAL UIT DE TENAAMSTELLING in het document:
  * Als naam belastingplichtige ({TAXPAYER_NAME}) in tenaamstelling → "tp_01"
  * Als naam partner ({PARTNER_NAME}) in tenaamstelling → "fp_01"
  * Als BEIDE namen of "en/of" in tenaamstelling → "joint"
  * Zoek naar: "Ten name van:", "Rekeninghouder:", naam bovenaan jaaroverzicht
- ownership_percentage: Percentage eigendom van de fiscale eenheid (huishouden)
  * 100 = volledig eigendom huishouden
  * 50 = gedeeld met iemand BUITEN het huishouden

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

### Eigendom - KRITIEK: Bepaal eigenaar uit document!
- owner_id: BEPAAL UIT KADASTER/EIGENDOMSBEWIJS:
  * Als naam belastingplichtige ({TAXPAYER_NAME}) als eigenaar → "tp_01"
  * Als naam partner ({PARTNER_NAME}) als eigenaar → "fp_01"
  * Als BEIDE namen of gemeenschappelijk eigendom → "joint"
- ownership_percentage: Percentage eigendom (uit kadaster)
  * 100 = volledig eigendom
  * 50 = half eigendom (bijv. bij scheiding of erfenis)

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
- loaned_money: Uitgeleend geld (hypotheek aan familie, familielening, etc.)
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

## KRITIEK: VOOR LENINGEN/VORDERINGEN (type: loaned_money of claims)
Bij uitgeleend geld of vorderingen is het ESSENTIEEL om te extraheren:
1. agreed_interest_rate: Het AFGESPROKEN rentepercentage (bijv. 4.0 voor 4%)
2. interest_received: De WERKELIJK ONTVANGEN rente in het jaar
3. borrower_name: Aan wie is het geld uitgeleend (naam zoon, dochter, etc.)
4. is_family_loan: true als het een familielening betreft

Dit is KRITIEK voor de Box 3 bezwaarberekening omdat:
- Forfaitair rendement (6.04% in 2024) vaak HOGER is dan werkelijk rendement
- Het verschil = de belastingschade voor de cliënt

## OUTPUT FORMAT:
{
  "other_assets": [
    {
      "id": "oa_1",
      "owner_id": "tp_01",
      "description": "Vordering hypotheek aan zoon (W.H. Vonck)",
      "type": "loaned_money",
      "country": "NL",
      "borrower_name": "W.H. Vonck (zoon)",
      "is_family_loan": true,
      "agreed_interest_rate": 4.0,
      "loan_start_date": "2020-01-01",
      "yearly_data": {
        "2024": {
          "value_jan_1": { "amount": 600000, "source_doc_id": "doc_1", "confidence": 0.95 },
          "interest_received": { "amount": 24000, "source_doc_id": "doc_1", "confidence": 0.90 }
        }
      }
    },
    {
      "id": "oa_2",
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
    "other_assets_found": 2,
    "debts_found": 1,
    "expected_from_checklist": 3,
    "missing": [],
    "warnings": ["Rentepercentage voor oa_1 geschat op basis van beschrijving"]
  }
}

KRITIEKE REGELS:
1. Schulden verlagen de Box 3 grondslag
2. Betaalde rente is onderdeel van "werkelijk rendement" (negatief)
3. Studieschuld telt NIET mee voor Box 3 (uitzondering)
4. Contant geld alleen als >€560
5. Premiedepot/kapitaalverzekering die in aangifte onder "bankrekeningen" staat → NIET hier extraheren
6. Voor leningen/vorderingen: ALTIJD proberen rentepercentage en ontvangen rente te extraheren
7. Als rentepercentage niet expliciet vermeld, zoek naar aanwijzingen in de tekst (bijv. "4% rente", "tegen 3,5%", etc.)`;

// =============================================================================
// HELPER FUNCTION: Build prompt with checklist
// =============================================================================

export function buildBankExtractionPrompt(checklist: {
  bank_count: number;
  bank_descriptions: string[];
}, fiscalEntity?: { taxpayerName?: string; partnerName?: string }): string {
  const checklistText = checklist.bank_descriptions.length > 0
    ? `De aangifte vermeldt ${checklist.bank_count} bankrekening(en):
${checklist.bank_descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

VIND AL DEZE REKENINGEN!`
    : 'Geen specifieke checklist beschikbaar. Extraheer alle bankrekeningen die je vindt.';

  return BANK_EXTRACTION_PROMPT
    .replace('{BANK_CHECKLIST}', checklistText)
    .replace('{TAXPAYER_NAME}', fiscalEntity?.taxpayerName || 'belastingplichtige')
    .replace('{PARTNER_NAME}', fiscalEntity?.partnerName || 'partner');
}

export function buildInvestmentExtractionPrompt(checklist: {
  investment_count: number;
  investment_descriptions: string[];
}, fiscalEntity?: { taxpayerName?: string; partnerName?: string }): string {
  const checklistText = checklist.investment_descriptions.length > 0
    ? `De aangifte vermeldt ${checklist.investment_count} beleggingsrekening(en):
${checklist.investment_descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

VIND AL DEZE REKENINGEN!`
    : 'Geen specifieke checklist beschikbaar. Extraheer alle beleggingen die je vindt.';

  return INVESTMENT_EXTRACTION_PROMPT
    .replace('{INVESTMENT_CHECKLIST}', checklistText)
    .replace('{TAXPAYER_NAME}', fiscalEntity?.taxpayerName || 'belastingplichtige')
    .replace('{PARTNER_NAME}', fiscalEntity?.partnerName || 'partner');
}

export function buildRealEstateExtractionPrompt(checklist: {
  real_estate_count: number;
  real_estate_descriptions: string[];
}, fiscalEntity?: { taxpayerName?: string; partnerName?: string }): string {
  const checklistText = checklist.real_estate_descriptions.length > 0
    ? `De aangifte vermeldt ${checklist.real_estate_count} onroerende za(a)k(en) in Box 3:
${checklist.real_estate_descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

VIND AL DEZE PANDEN! Let op: eigen woning (Box 1) niet meetellen.`
    : 'Geen specifieke checklist beschikbaar. Extraheer alle Box 3 onroerende zaken die je vindt.';

  return REAL_ESTATE_EXTRACTION_PROMPT
    .replace('{REAL_ESTATE_CHECKLIST}', checklistText)
    .replace('{TAXPAYER_NAME}', fiscalEntity?.taxpayerName || 'belastingplichtige')
    .replace('{PARTNER_NAME}', fiscalEntity?.partnerName || 'partner');
}

export function buildOtherAssetsExtractionPrompt(checklist: {
  other_assets_count: number;
  other_descriptions: string[];
}, fiscalEntity?: { taxpayerName?: string; partnerName?: string }): string {
  const checklistText = checklist.other_descriptions.length > 0
    ? `De aangifte vermeldt ${checklist.other_assets_count} overige bezitting(en)/schuld(en):
${checklist.other_descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

VIND AL DEZE ITEMS!`
    : 'Geen specifieke checklist beschikbaar. Extraheer alle overige bezittingen en schulden die je vindt.';

  return OTHER_ASSETS_EXTRACTION_PROMPT
    .replace('{OTHER_CHECKLIST}', checklistText)
    .replace('{TAXPAYER_NAME}', fiscalEntity?.taxpayerName || 'belastingplichtige')
    .replace('{PARTNER_NAME}', fiscalEntity?.partnerName || 'partner');
}

// =============================================================================
// STAGE 4a: SMART CLASSIFICATION & DEDUPLICATION PROMPT
// =============================================================================

/**
 * This prompt runs AFTER all extraction stages and BEFORE final merge.
 * It receives ALL extracted items from bank, investment, and other_assets stages
 * and must:
 * 1. Identify duplicates across categories
 * 2. Assign each item to the correct category
 * 3. Remove duplicates, keeping only one instance
 */
export const SMART_CLASSIFICATION_PROMPT = `Je bent een senior fiscalist die Box 3 vermogensbestanddelen dedupliceert.

## JOUW TAAK
Je krijgt geëxtraheerde items uit verschillende extractie-stages. Deze stages werkten onafhankelijk,
waardoor DEZELFDE items soms in MEERDERE categorieën kunnen staan.

Jouw taak is ALLEEN:
1. IDENTIFICEER echte duplicaten (zelfde item in meerdere categorieën)
2. VERWIJDER duplicaten - elk item mag maar in ÉÉN categorie staan
3. BEHOUD de originele categorie waar mogelijk

## KRITIEKE REGEL: AANGIFTE IS GROUND TRUTH

De items komen uit de AANGIFTE van de belastingplichtige. De aangifte bepaalt de categorie:
- Items uit "from_bank_extraction" ZIJN bankrekeningen (want zo staat het in de aangifte)
- Items uit "from_investment_extraction" ZIJN beleggingen (want zo staat het in de aangifte)
- Items uit "from_other_extraction" ZIJN overige bezittingen (want zo staat het in de aangifte)

JE MAG ITEMS NIET HERCLASSIFICEREN tenzij ze DUBBEL staan!

## DUPLICAAT HERKENNING

Twee items zijn HETZELFDE als:
1. Zelfde bedrag (binnen 1% marge) EN zelfde/vergelijkbare beschrijving
2. OF: Zelfde IBAN/rekeningnummer

Bij duplicaten: behoud het item in de categorie waar het in de aangifte staat.

## NIET-DUPLICATEN (LAAT STAAN!)

BinckBank/DEGIRO met VERSCHILLENDE bedragen in bank en investment:
- Bank: "BinckBank €34.627" = gelddeel (cash saldo)
- Investment: "BinckBank €111.280" = effectendeel (portefeuille)
Dit zijn TWEE APARTE items, GEEN duplicaat! Beide behouden.

## WAT JE MOET DOEN

1. Zoek items met ZELFDE bedrag in meerdere categorieën
2. Als zelfde bedrag + zelfde beschrijving → duplicaat → verwijder uit verkeerde categorie
3. Als VERSCHILLENDE bedragen → GEEN duplicaat → beide behouden

## INPUT FORMAT
{
  "from_bank_extraction": [...],      // Items gevonden door bank extraction
  "from_investment_extraction": [...], // Items gevonden door investment extraction
  "from_other_extraction": [...]       // Items gevonden door other assets extraction
}

## OUTPUT FORMAT (alleen JSON)
{
  "bank_savings": [
    // ALLE items uit from_bank_extraction (behoud originele id)
    // MINUS items die duplicaat zijn van een investment/other item
  ],
  "investments": [
    // ALLE items uit from_investment_extraction (behoud originele id)
    // MINUS items die duplicaat zijn van een bank/other item
  ],
  "other_assets": [
    // ALLE items uit from_other_extraction (behoud originele id)
    // MINUS items die duplicaat zijn van een bank/investment item
  ],
  "removed_duplicates": [
    {
      "removed_id": "inv_14",
      "kept_id": "oa_1",
      "reason": "Zelfde bedrag €60.000 en beschrijving 'Vordering Rick' - behouden in originele categorie"
    }
  ],
  "reclassifications": []  // LEEG - we herclassificeren NIET meer
}

GEEF ALLEEN VALIDE JSON TERUG.`;

/**
 * Build the smart classification prompt with actual extracted data
 */
export function buildSmartClassificationPrompt(
  bankItems: any[],
  investmentItems: any[],
  otherItems: any[]
): string {
  const inputData = {
    from_bank_extraction: bankItems.map(b => ({
      id: b.id,
      description: b.description || b.bank_name,
      bank_name: b.bank_name,
      account_masked: b.account_masked,
      amount_2022: b.yearly_data?.['2022']?.value_jan_1?.amount || b.yearly_data?.['2022']?.value_jan_1 || 0,
      amount_2023: b.yearly_data?.['2023']?.value_jan_1?.amount || b.yearly_data?.['2023']?.value_jan_1 || 0,
    })),
    from_investment_extraction: investmentItems.map(i => ({
      id: i.id,
      description: i.description || i.institution,
      institution: i.institution,
      type: i.type,
      amount_2022: i.yearly_data?.['2022']?.value_jan_1?.amount || i.yearly_data?.['2022']?.value_jan_1 || 0,
      amount_2023: i.yearly_data?.['2023']?.value_jan_1?.amount || i.yearly_data?.['2023']?.value_jan_1 || 0,
    })),
    from_other_extraction: otherItems.map(o => ({
      id: o.id,
      description: o.description,
      type: o.type,
      amount_2022: o.yearly_data?.['2022']?.value_jan_1?.amount || o.yearly_data?.['2022']?.value_jan_1 || 0,
      amount_2023: o.yearly_data?.['2023']?.value_jan_1?.amount || o.yearly_data?.['2023']?.value_jan_1 || 0,
    })),
  };

  return `${SMART_CLASSIFICATION_PROMPT}

## TE CLASSIFICEREN ITEMS:
\`\`\`json
${JSON.stringify(inputData, null, 2)}
\`\`\`

Analyseer deze items, identificeer duplicaten, en geef de definitieve classificatie terug.`;
}
