/**
 * Box3 Extraction Pipeline - Simplified Single-Call Approach
 *
 * Uses ONE multimodal LLM call with gemini-3-flash-preview for best quality/speed balance.
 * All documents are processed together to extract the complete blueprint.
 */

import { AIModelFactory } from "./ai-models/ai-model-factory";
import { logger } from "./logger";
import type {
  Box3Blueprint,
  Box3SourceDocumentEntry,
  Box3FiscalEntity,
  Box3TaxAuthorityYearData,
  Box3BankSavingsAsset,
  Box3RealEstateAsset,
  Box3YearSummary,
  Box3Debt,
  Box3DocumentExtraction,
  Box3ExtractedClaim,
} from "@shared/schema/box3";

// =============================================================================
// TYPES
// =============================================================================

export interface PipelineDocument {
  id: string;
  filename: string;
  mimeType: string;
  fileData: string; // base64
  extractedText?: string;
}

export interface PipelineProgress {
  step: 'extraction' | 'complete';
  stepNumber: number;
  totalSteps: number;
  message: string;
}

export interface PipelineResult {
  blueprint: Box3Blueprint;
  stepResults: {
    classification: any[];
    persons: Box3FiscalEntity | null;
    taxData: Record<string, Box3TaxAuthorityYearData>;
    assets: {
      bank_savings: Box3BankSavingsAsset[];
      real_estate: Box3RealEstateAsset[];
      debts: Box3Debt[];
    };
  };
  errors: string[];
  /** Debug: full prompt sent to the AI */
  fullPrompt?: string;
  /** Debug: raw AI response before JSON parsing */
  rawAiResponse?: string;
}

// =============================================================================
// MAIN EXTRACTION PROMPT
// =============================================================================

const EXTRACTION_PROMPT = `Je bent een expert fiscalist gespecialiseerd in Box 3 (vermogensbelasting) voor Nederlandse belastingaangiftes.

Analyseer ALLE bijgevoegde documenten en extraheer de volledige Box 3 data.

## DOCUMENT TYPES die je kunt tegenkomen:
- aangifte_ib: Aangifte inkomstenbelasting (bevat Box 3 sectie met "Inkomen uit sparen en beleggen")
- aanslag_definitief: Definitieve aanslag van Belastingdienst
- aanslag_voorlopig: Voorlopige aanslag van Belastingdienst
- jaaropgave_bank: Jaaroverzicht van bank met saldi en rente per 1 januari
- woz_beschikking: WOZ-beschikking (peildatum 1-1-YYYY geldt voor belastingjaar YYYY+1)
- email_body: E-mail correspondentie
- overig: Ander document

## KRITIEK - OWNERSHIP vs ALLOCATION:
- ownership_percentage: Juridisch eigendom van een asset (bijv. 100% eigenaar van bankrekening)
- allocation_percentage: Fiscale verdeling tussen partners voor Box 3 (standaard 50/50)
Dit zijn TWEE VERSCHILLENDE concepten! Een persoon kan 100% eigenaar zijn van een bankrekening, maar de fiscale verdeling is 50/50 met partner.

## WAT TE EXTRAHEREN:

### 1. PERSONEN
- Belastingplichtige: naam, BSN (gemaskeerd als ****xxxxx), geboortedatum
- Fiscaal partner (indien aanwezig): naam, BSN, geboortedatum

### 2. BELASTINGGEGEVENS per jaar (uit aangifte/aanslag)
- total_assets_gross: "Totaal bezittingen" of "Rendementsgrondslag"
- total_debts: "Schulden"
- total_exempt: "Heffingsvrij vermogen" (2023: €57.000 p.p., 2022: €50.650 p.p.)
- taxable_base: "Grondslag sparen en beleggen"
- deemed_return: "Voordeel uit sparen en beleggen" of "Belastbaar inkomen box 3"
- total_tax_assessed: "Inkomstenbelasting box 3" - DIT IS HET BELANGRIJKSTE BEDRAG!

### 3. VERMOGENSBESTANDDELEN

#### Bankrekeningen (uit jaaropgaves)
- bank_name, account_number (laatste 4 cijfers)
- Per jaar: saldo per 1 januari, ontvangen rente
- ownership_percentage: wie is juridisch eigenaar (100% = alleen deze persoon)

#### Onroerend goed (uit WOZ-beschikkingen)
- adres, WOZ-waarde per jaar
- Let op: WOZ peildatum 1-1-2023 geldt voor belastingjaar 2024!

#### Schulden
- type (hypotheek, consumptief), bedrag per 1 januari

## OUTPUT FORMAT - Geef ALLEEN valid JSON:

{
  "source_documents_registry": [
    {
      "file_id": "doc_1",
      "filename": "bestandsnaam.pdf",
      "detected_type": "aangifte_ib",
      "detected_tax_year": 2023,
      "for_person": "tp_01",
      "is_readable": true,
      "used_for_extraction": true
    }
  ],
  "fiscal_entity": {
    "taxpayer": {
      "id": "tp_01",
      "name": "Volledige Naam",
      "bsn_masked": "****12345",
      "date_of_birth": "1980-01-15"
    },
    "fiscal_partner": {
      "has_partner": true,
      "id": "fp_01",
      "name": "Partner Naam",
      "bsn_masked": "****67890",
      "date_of_birth": null
    },
    "allocation_percentage": {
      "taxpayer": 50,
      "partner": 50
    }
  },
  "tax_authority_data": {
    "2023": {
      "year": "2023",
      "source_document_ids": ["doc_1"],
      "taxpayer": {
        "total_assets_gross": { "value": 150000, "source": "aangifte IB 2023" },
        "total_debts": { "value": 0, "source": "aangifte IB 2023" },
        "total_exempt": { "value": 57000, "source": "aangifte IB 2023" },
        "taxable_base": { "value": 93000, "source": "aangifte IB 2023" },
        "deemed_return": { "value": 5580, "source": "aangifte IB 2023" },
        "total_tax_assessed": { "value": 1785, "source": "aangifte IB 2023" }
      },
      "partner": null
    }
  },
  "assets": {
    "bank_savings": [
      {
        "id": "bank_1",
        "bank_name": "ING",
        "account_number_last4": "1234",
        "account_type": "spaarrekening",
        "owner_id": "tp_01",
        "ownership_percentage": 100,
        "yearly_data": {
          "2023": {
            "balance_jan1": { "value": 50000, "source": "ING jaaroverzicht 2023" },
            "interest_received": { "value": 125, "source": "ING jaaroverzicht 2023" }
          }
        }
      }
    ],
    "investments": [],
    "real_estate": [
      {
        "id": "re_1",
        "address": "Voorbeeldstraat 1, 1234 AB Amsterdam",
        "property_type": "eigen_woning",
        "owner_id": "tp_01",
        "ownership_percentage": 100,
        "yearly_data": {
          "2024": {
            "woz_value": { "value": 450000, "source": "WOZ-beschikking 2024" }
          }
        }
      }
    ],
    "other": []
  },
  "debts": [],
  "year_summaries": {
    "2023": {
      "status": "ready_for_calculation",
      "completeness": {
        "bank_savings": "complete",
        "investments": "not_applicable",
        "real_estate": "not_applicable",
        "debts": "not_applicable",
        "tax_return": "complete"
      },
      "missing_items": []
    }
  },
  "validation_flags": [],
  "manual_overrides": []
}

BELANGRIJK:
- Geef ALLEEN de JSON output, geen uitleg
- Gebruik null voor ontbrekende waarden
- detected_type moet exact een van deze waarden zijn: aangifte_ib, aanslag_definitief, aanslag_voorlopig, jaaropgave_bank, woz_beschikking, email_body, overig
- completeness moet exact een van deze waarden zijn: complete, incomplete, not_applicable
- Zorg dat total_tax_assessed correct wordt geëxtraheerd - dit is cruciaal voor de berekening!`;

// =============================================================================
// SINGLE DOCUMENT EXTRACTION PROMPT (for incremental merge)
// =============================================================================

const SINGLE_DOC_EXTRACTION_PROMPT = `Je bent een expert fiscalist gespecialiseerd in Box 3 (vermogensbelasting).

Analyseer het bijgevoegde document en extraheer alle relevante Box 3 data als "claims".

## DOCUMENT CLASSIFICATIE
Bepaal eerst wat voor type document dit is:
- aangifte_ib: Aangifte inkomstenbelasting
- aanslag_definitief: Definitieve aanslag van Belastingdienst
- aanslag_voorlopig: Voorlopige aanslag van Belastingdienst
- jaaropgave_bank: Jaaroverzicht van bank met saldi en rente
- woz_beschikking: WOZ-beschikking
- email_body: E-mail correspondentie
- overig: Ander document

## EXTRACTIE INSTRUCTIES

Voor elk datapunt dat je vindt, maak een "claim" met:
- path: Het pad waar deze waarde thuishoort in de blueprint
- value: De geëxtraheerde waarde
- confidence: Hoe zeker je bent (0.0-1.0)
- source_snippet: Korte tekst uit document die dit bewijst

### PATH VOORBEELDEN:
- "assets.bank_savings[NEW].bank_name" → voor nieuwe bankrekening
- "assets.bank_savings[MATCH:****1234].yearly_data.2023.value_jan_1" → voor bestaande rekening (match op laatste 4 cijfers)
- "assets.real_estate[MATCH:1234AB].yearly_data.2024.woz_value" → voor bestaand pand (match op postcode)
- "tax_authority_data.2023.household_totals.total_tax_assessed" → voor belastingdata
- "fiscal_entity.taxpayer.name" → voor persoonsgegevens

### ASSET IDENTIFICATIE (CRUCIAAL!)
Voor bankrekeningen, geef ALTIJD:
- account_last4: laatste 4 cijfers van rekeningnummer
- iban_pattern: eerste deel van IBAN (bijv. "NL91INGB")
- bank_name: naam van de bank

Voor onroerend goed, geef ALTIJD:
- address: volledig adres
- postcode: postcode (4 cijfers + 2 letters)

## OUTPUT FORMAT - Geef ALLEEN valid JSON:

{
  "document_classification": {
    "detected_type": "jaaropgave_bank",
    "detected_tax_years": ["2023"],
    "detected_person": "taxpayer",
    "confidence": 0.95
  },
  "asset_identifiers": {
    "bank_accounts": [
      { "account_last4": "1234", "bank_name": "ING", "iban_pattern": "NL91INGB" }
    ],
    "real_estate": [],
    "investments": []
  },
  "claims": [
    {
      "path": "assets.bank_savings[MATCH:****1234].bank_name",
      "value": "ING",
      "confidence": 0.99,
      "source_snippet": "ING Bank N.V."
    },
    {
      "path": "assets.bank_savings[MATCH:****1234].account_masked",
      "value": "NL91INGB****1234",
      "confidence": 0.99,
      "source_snippet": "Rekeningnummer: NL91INGB0001231234"
    },
    {
      "path": "assets.bank_savings[MATCH:****1234].yearly_data.2023.value_jan_1",
      "value": 45000.00,
      "confidence": 0.95,
      "source_snippet": "Saldo per 1-1-2023: € 45.000,00"
    },
    {
      "path": "assets.bank_savings[MATCH:****1234].yearly_data.2023.interest_received",
      "value": 625.50,
      "confidence": 0.90,
      "source_snippet": "Ontvangen rente 2023: € 625,50"
    }
  ]
}

BELANGRIJK:
- Geef ALLEEN JSON output, geen uitleg
- Gebruik [MATCH:identifier] voor bestaande assets, [NEW] voor nieuwe
- Elke claim moet een source_snippet hebben als bewijs
- confidence moet realistisch zijn (0.5-1.0)`;

export interface SingleDocExtractionResult {
  extraction: Box3DocumentExtraction;
  rawResponse: string;
  error?: string;
}

// =============================================================================
// PIPELINE CLASS
// =============================================================================

export class Box3ExtractionPipeline {
  private factory: AIModelFactory;
  private onProgress?: (progress: PipelineProgress) => void;

  constructor(onProgress?: (progress: PipelineProgress) => void) {
    this.factory = AIModelFactory.getInstance();
    this.onProgress = onProgress;
  }

  private reportProgress(progress: PipelineProgress): void {
    if (this.onProgress) {
      this.onProgress(progress);
    }
    logger.info('box3-pipeline', `Step ${progress.stepNumber}/${progress.totalSteps}: ${progress.message}`);
  }

  /**
   * Main entry point - Single call extraction
   */
  async run(
    documents: PipelineDocument[],
    emailText: string | null,
    existingPersons?: Box3FiscalEntity
  ): Promise<PipelineResult> {
    const errors: string[] = [];
    const totalSteps = 2;

    // Step 1: Extract everything in one call
    this.reportProgress({
      step: 'extraction',
      stepNumber: 1,
      totalSteps,
      message: `Alle ${documents.length} documenten analyseren...`
    });

    // Prepare vision attachments for all documents
    const visionAttachments = documents
      .filter(doc => doc.mimeType.startsWith('image/') || doc.mimeType === 'application/pdf')
      .map((doc, index) => ({
        mimeType: doc.mimeType,
        data: doc.fileData,
        filename: `doc_${index + 1}_${doc.filename}`,
      }));

    // Build document list for prompt
    const docList = documents.map((doc, index) =>
      `Document ${index + 1}: ${doc.filename} (${doc.mimeType})`
    ).join('\n');

    const prompt = `${EXTRACTION_PROMPT}

## DOCUMENTEN OM TE ANALYSEREN:
${docList}

${emailText ? `## AANVULLENDE EMAIL TEKST:\n${emailText}` : ''}

Analyseer nu alle bijgevoegde documenten en geef de complete JSON output.`;

    let blueprint: Box3Blueprint;
    let rawAiResponse: string | undefined;

    try {
      const result = await this.factory.callModel(
        {
          model: 'gemini-3-flash-preview',
          provider: 'google',
          temperature: 1.0, // Gemini 3 recommends keeping at 1.0
          maxOutputTokens: 65536, // Gemini 3 has 64K output limit
        },
        prompt,
        { visionAttachments }
      );

      // Store raw response for debugging
      rawAiResponse = result.content;

      const json = this.parseJSON(result.content);
      if (!json) {
        throw new Error('Kon JSON niet parsen uit LLM response');
      }

      // Validate and normalize the response
      blueprint = this.normalizeBlueprint(json, documents);

    } catch (err: any) {
      logger.error('box3-pipeline', 'Pipeline extraction failed', { message: err.message });
      errors.push(`Extractie mislukt: ${err.message}`);

      // Return empty blueprint on failure
      blueprint = this.createEmptyBlueprint(documents);
    }

    // Step 2: Complete
    this.reportProgress({
      step: 'complete',
      stepNumber: 2,
      totalSteps,
      message: 'Extractie voltooid'
    });

    return {
      blueprint,
      stepResults: {
        classification: [],
        persons: blueprint.fiscal_entity || null,
        taxData: blueprint.tax_authority_data || {},
        assets: {
          bank_savings: blueprint.assets?.bank_savings || [],
          real_estate: blueprint.assets?.real_estate || [],
          debts: blueprint.debts || [],
        },
      },
      errors,
      fullPrompt: prompt,
      rawAiResponse,
    };
  }

  /**
   * Normalize and validate the LLM response
   */
  private normalizeBlueprint(json: any, documents: PipelineDocument[]): Box3Blueprint {
    // Ensure source_documents_registry has valid types
    const sourceDocRegistry = (json.source_documents_registry || []).map((doc: any, index: number) => ({
      file_id: doc.file_id || `doc_${index + 1}`,
      filename: doc.filename || documents[index]?.filename || 'unknown',
      detected_type: this.normalizeDocumentType(doc.detected_type),
      detected_tax_year: doc.detected_tax_year || null,
      for_person: doc.for_person || null,
      is_readable: doc.is_readable !== false,
      used_for_extraction: doc.used_for_extraction !== false,
      notes: doc.notes || undefined,
    }));

    // Normalize year_summaries completeness values
    const yearSummaries: Record<string, Box3YearSummary> = {};
    if (json.year_summaries) {
      for (const [year, summary] of Object.entries(json.year_summaries as Record<string, any>)) {
        yearSummaries[year] = {
          status: summary.status || 'incomplete',
          completeness: {
            bank_savings: this.normalizeCompleteness(summary.completeness?.bank_savings),
            investments: this.normalizeCompleteness(summary.completeness?.investments),
            real_estate: this.normalizeCompleteness(summary.completeness?.real_estate),
            debts: this.normalizeCompleteness(summary.completeness?.debts),
            tax_return: this.normalizeCompleteness(summary.completeness?.tax_return),
          },
          missing_items: summary.missing_items || [],
          calculated_totals: summary.calculated_totals || undefined,
        };
      }
    }

    // Normalize tax_authority_data - ensure household_totals exists
    const taxAuthorityData: Record<string, Box3TaxAuthorityYearData> = {};
    if (json.tax_authority_data) {
      for (const [year, yearData] of Object.entries(json.tax_authority_data as Record<string, any>)) {
        const taxpayer = yearData.taxpayer || {};
        const partner = yearData.partner || {};

        // Helper to extract numeric value from either {value: X} or X format
        const getValue = (obj: any): number => {
          if (obj === null || obj === undefined) return 0;
          if (typeof obj === 'number') return obj;
          if (typeof obj === 'object' && 'value' in obj) return obj.value || 0;
          return 0;
        };

        // Build household_totals by aggregating taxpayer + partner data
        // For most fields, we use the taxpayer's value as it represents the household total
        // (in Dutch tax returns, one person files for both)
        const householdTotals = yearData.household_totals || {
          total_assets_gross: getValue(taxpayer.total_assets_gross) || getValue(partner.total_assets_gross),
          total_debts: getValue(taxpayer.total_debts) || getValue(partner.total_debts),
          total_exempt: getValue(taxpayer.total_exempt) || getValue(partner.total_exempt),
          taxable_base: getValue(taxpayer.taxable_base) + getValue(partner.taxable_base),
          deemed_return: getValue(taxpayer.deemed_return) + getValue(partner.deemed_return),
          total_tax_assessed: getValue(taxpayer.total_tax_assessed) + getValue(partner.total_tax_assessed),
        };

        // Build per_person data for frontend
        const perPerson: Record<string, any> = {};
        if (taxpayer && Object.keys(taxpayer).length > 0) {
          perPerson['tp_01'] = {
            allocation_percentage: 50, // Default to 50/50
            total_assets_box3: getValue(taxpayer.total_assets_gross),
            total_debts_box3: getValue(taxpayer.total_debts),
            exempt_amount: getValue(taxpayer.total_exempt),
            taxable_base: getValue(taxpayer.taxable_base),
            deemed_return: getValue(taxpayer.deemed_return),
            tax_assessed: getValue(taxpayer.total_tax_assessed),
          };
        }
        if (partner && Object.keys(partner).length > 0) {
          perPerson['fp_01'] = {
            allocation_percentage: 50,
            total_assets_box3: getValue(partner.total_assets_gross),
            total_debts_box3: getValue(partner.total_debts),
            exempt_amount: getValue(partner.total_exempt),
            taxable_base: getValue(partner.taxable_base),
            deemed_return: getValue(partner.deemed_return),
            tax_assessed: getValue(partner.total_tax_assessed),
          };
        }

        taxAuthorityData[year] = {
          source_doc_id: yearData.source_document_ids?.[0] || `doc_${year}`,
          document_type: yearData.document_type || 'aangifte',
          household_totals: {
            ...householdTotals,
            net_assets: (householdTotals.total_assets_gross || 0) - (householdTotals.total_debts || 0),
          },
          per_person: perPerson,
        } as Box3TaxAuthorityYearData;
      }
    }

    return {
      schema_version: '2.0',
      source_documents_registry: sourceDocRegistry,
      fiscal_entity: json.fiscal_entity || {
        taxpayer: { id: 'tp_01', name: null, bsn_masked: null, date_of_birth: null },
        fiscal_partner: { has_partner: false },
      },
      assets: {
        bank_savings: json.assets?.bank_savings || [],
        investments: json.assets?.investments || [],
        real_estate: json.assets?.real_estate || [],
        other_assets: json.assets?.other_assets || json.assets?.other || [],
      },
      debts: json.debts || [],
      tax_authority_data: taxAuthorityData,
      year_summaries: yearSummaries,
      validation_flags: json.validation_flags || [],
      manual_overrides: json.manual_overrides || [],
    };
  }

  /**
   * Normalize document type to valid enum
   */
  private normalizeDocumentType(type: string): Box3SourceDocumentEntry['detected_type'] {
    const mapping: Record<string, Box3SourceDocumentEntry['detected_type']> = {
      'aangifte_ib': 'aangifte_ib',
      'aanslag_definitief': 'aanslag_definitief',
      'aanslag_voorlopig': 'aanslag_voorlopig',
      'jaaropgave_bank': 'jaaropgave_bank',
      'woz_beschikking': 'woz_beschikking',
      'email_body': 'email_body',
      'overig': 'overig',
      // Fallbacks for LLM variations
      'definitieve_aanslag': 'aanslag_definitief',
      'voorlopige_aanslag': 'aanslag_voorlopig',
      'voorlopige_aanslag_ib': 'aanslag_voorlopig',
      'aanslag_ib': 'aanslag_definitief',
      'email': 'email_body',
      'kostenoverzicht': 'overig',
    };
    return mapping[type] || 'overig';
  }

  /**
   * Normalize completeness status to valid enum
   */
  private normalizeCompleteness(status: string | undefined): 'complete' | 'incomplete' | 'not_applicable' {
    if (status === 'complete' || status === 'incomplete' || status === 'not_applicable') {
      return status;
    }
    // Map any other value to not_applicable
    return 'not_applicable';
  }

  /**
   * Create empty blueprint for error cases
   */
  private createEmptyBlueprint(documents: PipelineDocument[]): Box3Blueprint {
    return {
      schema_version: '2.0',
      source_documents_registry: documents.map((doc, i) => ({
        file_id: `doc_${i + 1}`,
        filename: doc.filename,
        detected_type: 'overig' as const,
        detected_tax_year: null,
        for_person: null,
        is_readable: true,
        used_for_extraction: false,
      })),
      fiscal_entity: {
        taxpayer: { id: 'tp_01', name: null, bsn_masked: null, date_of_birth: null },
        fiscal_partner: { has_partner: false },
      },
      assets: {
        bank_savings: [],
        investments: [],
        real_estate: [],
        other_assets: [],
      },
      debts: [],
      tax_authority_data: {},
      year_summaries: {},
      validation_flags: [{
        id: 'extraction_failed',
        field_path: 'pipeline',
        type: 'requires_validation',
        message: 'Automatische extractie mislukt - handmatige controle vereist',
        severity: 'high',
        created_at: new Date().toISOString(),
      }],
      manual_overrides: [],
    };
  }

  /**
   * Parse JSON from LLM response
   */
  private parseJSON(content: string): any {
    try {
      // Try to find JSON in markdown code block
      let jsonText = content.match(/```json\s*([\s\S]*?)\s*```/)?.[1];
      if (!jsonText) {
        jsonText = content.match(/```\s*([\s\S]*?)\s*```/)?.[1];
      }
      if (!jsonText) {
        jsonText = content.match(/\{[\s\S]*\}/)?.[0];
      }
      if (!jsonText && content.trim().startsWith('{')) {
        jsonText = content.trim();
      }

      if (jsonText) {
        return JSON.parse(jsonText);
      }
    } catch (err) {
      logger.error('box3-pipeline', 'JSON parse error', {}, err instanceof Error ? err : undefined);
    }
    return null;
  }

  // ===========================================================================
  // SINGLE DOCUMENT EXTRACTION (for incremental merge)
  // ===========================================================================

  /**
   * Extract claims from a single document for incremental merge
   * This is used when adding documents to an existing dossier
   */
  async extractSingleDocument(document: PipelineDocument): Promise<SingleDocExtractionResult> {
    logger.info('box3-pipeline', `Single document extraction: ${document.filename}`);

    // Prepare vision attachment
    const visionAttachments = [];
    if (document.mimeType.startsWith('image/') || document.mimeType === 'application/pdf') {
      visionAttachments.push({
        mimeType: document.mimeType,
        data: document.fileData,
        filename: document.filename,
      });
    }

    const prompt = `${SINGLE_DOC_EXTRACTION_PROMPT}

## DOCUMENT OM TE ANALYSEREN:
Bestandsnaam: ${document.filename}
Type: ${document.mimeType}
${document.extractedText ? `\nGeëxtraheerde tekst:\n${document.extractedText.substring(0, 5000)}` : ''}

Analyseer dit document en geef de claims JSON output.`;

    try {
      const result = await this.factory.callModel(
        {
          model: 'gemini-3-flash-preview', // Gemini 3 Flash: Pro-level intelligence at Flash speed
          provider: 'google',
          temperature: 1.0, // Gemini 3 recommends keeping at 1.0
          maxOutputTokens: 16384,
        },
        prompt,
        { visionAttachments }
      );

      const json = this.parseJSON(result.content);
      if (!json) {
        throw new Error('Kon JSON niet parsen uit LLM response');
      }

      // Transform the response into Box3DocumentExtraction format
      const extraction = this.transformToDocumentExtraction(json, document);

      logger.info('box3-pipeline', `Extracted ${extraction.claims.length} claims from ${document.filename}`);

      return {
        extraction,
        rawResponse: result.content,
      };

    } catch (err: any) {
      logger.error('box3-pipeline', 'Single document extraction failed', {
        filename: document.filename,
        error: err.message
      });

      // Return empty extraction with error
      return {
        extraction: {
          document_id: document.id,
          extraction_version: 1,
          extracted_at: new Date().toISOString(),
          model_used: 'gemini-3-flash-preview',
          detected_type: 'overig',
          detected_tax_years: [],
          detected_person: null,
          claims: [],
        },
        rawResponse: '',
        error: err.message,
      };
    }
  }

  /**
   * Transform LLM response to Box3DocumentExtraction
   */
  private transformToDocumentExtraction(
    json: any,
    document: PipelineDocument
  ): Box3DocumentExtraction {
    const classification = json.document_classification || {};

    // Normalize the detected_type
    const detectedType = this.normalizeDocumentType(classification.detected_type || 'overig');

    // Transform claims - resolve [MATCH:x] and [NEW] patterns
    const claims: Box3ExtractedClaim[] = (json.claims || []).map((claim: any) => {
      let path = claim.path || '';

      // Normalize path - replace [MATCH:xxx] with placeholder for merge engine
      // The merge engine will handle actual matching
      path = path.replace(/\[MATCH:([^\]]+)\]/g, '[?]');
      path = path.replace(/\[NEW\]/g, '[?]');

      return {
        path,
        value: claim.value,
        confidence: typeof claim.confidence === 'number' ? claim.confidence : 0.5,
        source_snippet: claim.source_snippet,
      };
    });

    return {
      document_id: document.id,
      extraction_version: 1,
      extracted_at: new Date().toISOString(),
      model_used: 'gemini-2.5-flash',
      detected_type: detectedType,
      detected_tax_years: classification.detected_tax_years || [],
      detected_person: classification.detected_person || null,
      claims,
      asset_identifiers: json.asset_identifiers || undefined,
    };
  }

  /**
   * Batch extract multiple documents (parallel for speed)
   */
  async extractMultipleDocuments(
    documents: PipelineDocument[]
  ): Promise<SingleDocExtractionResult[]> {
    logger.info('box3-pipeline', `Batch extracting ${documents.length} documents`);

    // Process in parallel with a concurrency limit
    const CONCURRENCY = 3;
    const results: SingleDocExtractionResult[] = [];

    for (let i = 0; i < documents.length; i += CONCURRENCY) {
      const batch = documents.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(doc => this.extractSingleDocument(doc))
      );
      results.push(...batchResults);
    }

    return results;
  }
}
