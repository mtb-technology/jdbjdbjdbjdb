/**
 * Box3 Extraction Pipeline
 *
 * Multi-step extraction process for Box 3 documents:
 * 1. Document Classification - Identify document types and tax years
 * 2. Person Extraction - Extract taxpayer and partner info
 * 3. Tax Authority Data - Extract from aangifte/aanslag
 * 4. Assets Extraction - Extract from jaaropgaves, WOZ, etc.
 * 5. Merge & Validate - Combine into final Blueprint
 */

import { AIModelFactory } from "./ai-models/ai-model-factory";
import type {
  Box3Blueprint,
  Box3SourceDocumentEntry,
  Box3FiscalEntity,
  Box3TaxAuthorityYearData,
  Box3BankSavingsAsset,
  Box3RealEstateAsset,
  Box3YearSummary,
  Box3ValidationFlag,
  Box3Debt,
} from "@shared/schema";

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
  step: 'classification' | 'persons' | 'tax_data' | 'assets' | 'merge';
  stepNumber: number;
  totalSteps: number;
  message: string;
  documentId?: string;
}

export interface ClassifiedDocument extends PipelineDocument {
  classification: {
    type: 'aangifte_ib' | 'definitieve_aanslag' | 'voorlopige_aanslag' |
          'jaaropgave_bank' | 'woz_beschikking' | 'kostenoverzicht' |
          'email' | 'overig';
    taxYear: number | null;
    forPerson: 'tp_01' | 'fp_01' | 'both' | null;
    confidence: 'high' | 'medium' | 'low';
    summary: string;
  };
}

export interface PipelineResult {
  blueprint: Box3Blueprint;
  stepResults: {
    classification: ClassifiedDocument[];
    persons: Box3FiscalEntity | null;
    taxData: Record<string, Box3TaxAuthorityYearData>;
    assets: {
      bank_savings: Box3BankSavingsAsset[];
      real_estate: Box3RealEstateAsset[];
      debts: Box3Debt[];
    };
  };
  errors: string[];
}

// =============================================================================
// PROMPTS - Focused, single-purpose prompts
// =============================================================================

const PROMPTS = {
  classification: `Je bent een document classifier voor Nederlandse belastingdocumenten.

Analyseer dit document en bepaal:
1. Type document
2. Belastingjaar (indien van toepassing)
3. Voor welke persoon (belastingplichtige, partner, of beiden)

DOCUMENT TYPES:
- aangifte_ib: Aangifte inkomstenbelasting (heeft "Inkomen uit sparen en beleggen (box3)")
- definitieve_aanslag: Definitieve aanslag van Belastingdienst
- voorlopige_aanslag: Voorlopige aanslag
- jaaropgave_bank: Jaaroverzicht van bank met saldo en rente
- woz_beschikking: WOZ-beschikking gemeente (let op: peildatum 1-1-YYYY geldt voor belastingjaar YYYY+1)
- kostenoverzicht: VvE afrekening, onderhoudskosten vastgoed
- email: E-mail correspondentie
- overig: Ander document

OUTPUT alleen JSON:
{
  "type": "aangifte_ib",
  "taxYear": 2023,
  "forPerson": "both",
  "confidence": "high",
  "summary": "Aangifte IB 2023 voor echtpaar, bevat Box 3 sectie"
}`,

  persons: `Extraheer de personen uit dit belastingdocument.

Zoek naar:
- Naam belastingplichtige
- BSN (gemaskeerd als ****xxxxx)
- Geboortedatum indien zichtbaar
- Fiscaal partner (naam, BSN)

OUTPUT alleen JSON:
{
  "taxpayer": {
    "id": "tp_01",
    "name": "Volledige naam",
    "bsn_masked": "****12345",
    "date_of_birth": "1980-01-15"
  },
  "fiscal_partner": {
    "has_partner": true,
    "id": "fp_01",
    "name": "Partner naam",
    "bsn_masked": "****67890",
    "date_of_birth": null
  }
}

Als geen partner: "has_partner": false`,

  taxAuthorityData: `Extraheer de BOX 3 belastinggegevens uit deze aangifte/aanslag.

ZOEK SPECIFIEK NAAR DEZE BEDRAGEN in de Box 3 sectie:
- "Totaal bezittingen" of "Rendementsgrondslag" → total_assets_gross
- "Schulden" → total_debts
- "Heffingsvrij vermogen" → total_exempt (2023: €57.000 p.p., 2022: €50.650 p.p.)
- "Grondslag sparen en beleggen" → taxable_base
- "Voordeel uit sparen en beleggen" of "Belastbaar inkomen box 3" → deemed_return
- "Inkomstenbelasting box 3" (het eindbedrag!) → total_tax_assessed

PER PERSOON (als er een partner is):
- allocation_percentage: Hoe de grondslag verdeeld is (standaard 50/50 bij partners!)
- tax_assessed: Belasting per persoon
- deemed_return: Inkomen per persoon

BELANGRIJK: allocation_percentage is de BELASTING verdeling, NIET eigendom van assets!
Bij partners is dit meestal 50/50 tenzij expliciet anders aangegeven.

OUTPUT alleen JSON:
{
  "year": "2023",
  "document_type": "aangifte",
  "per_person": {
    "tp_01": {
      "allocation_percentage": 50,
      "total_assets_box3": 70345,
      "total_debts_box3": 0,
      "exempt_amount": 57000,
      "taxable_base": 13345,
      "deemed_return": 820,
      "tax_assessed": 262
    },
    "fp_01": {
      "allocation_percentage": 50,
      "total_assets_box3": 70345,
      "total_debts_box3": 0,
      "exempt_amount": 57000,
      "taxable_base": 13345,
      "deemed_return": 819,
      "tax_assessed": 262
    }
  },
  "household_totals": {
    "total_assets_gross": 140690,
    "total_debts": 0,
    "net_assets": 140690,
    "total_exempt": 114000,
    "taxable_base": 26690,
    "deemed_return": 1639,
    "total_tax_assessed": 524
  }
}`,

  bankAsset: `Extraheer bankgegevens uit deze jaaropgave.

ZOEK NAAR:
- Saldo per 1 januari (peildatum box 3)
- Saldo per 31 december (optioneel)
- Ontvangen rente over het jaar (CRUCIAAL voor werkelijk rendement!)
- Rekeningnummer (gemaskeerd)
- Banknaam
- Eigenaar (als vermeld)

OUTPUT alleen JSON:
{
  "year": "2023",
  "bank_name": "ING",
  "account_masked": "NL**INGB****1234",
  "owner_id": "tp_01",
  "ownership_percentage": 100,
  "country": "NL",
  "value_jan_1": 45000.00,
  "value_dec_31": 47500.00,
  "interest_received": 125.50
}`,

  realEstateAsset: `Extraheer vastgoedgegevens uit dit document (WOZ-beschikking of kostenoverzicht).

VOOR WOZ:
- WOZ-waarde
- Peildatum (1-1-YYYY = geldt voor belastingjaar YYYY+1!)
- Adres
- Type (recreatiewoning, verhuurde woning, etc.)

VOOR KOSTENOVERZICHT:
- Onderhoudskosten
- VvE bijdrage
- Verzekering
- Overige kosten

OUTPUT alleen JSON:
{
  "year": "2023",
  "address": "Strandweg 123",
  "type": "vacation_home",
  "owner_id": "tp_01",
  "ownership_percentage": 100,
  "woz_value": 285000,
  "woz_reference_date": "2022-01-01",
  "maintenance_costs": 1500,
  "insurance": 450,
  "other_costs": 800
}`,
};

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

  private reportProgress(progress: PipelineProgress) {
    if (this.onProgress) {
      this.onProgress(progress);
    }
    console.log(`📋 [Pipeline] Step ${progress.stepNumber}/${progress.totalSteps}: ${progress.message}`);
  }

  /**
   * Run the full extraction pipeline
   */
  async run(
    documents: PipelineDocument[],
    emailText: string | null,
    existingPersons?: Box3FiscalEntity
  ): Promise<PipelineResult> {
    const errors: string[] = [];
    const totalSteps = 5;

    // Step 1: Classify all documents
    this.reportProgress({ step: 'classification', stepNumber: 1, totalSteps, message: 'Documenten classificeren...' });
    const classifiedDocs = await this.classifyDocuments(documents, emailText);

    // Step 2: Extract persons (if not provided)
    this.reportProgress({ step: 'persons', stepNumber: 2, totalSteps, message: 'Personen identificeren...' });
    let persons = existingPersons || null;
    if (!persons) {
      const personDoc = classifiedDocs.find(d =>
        d.classification.type === 'aangifte_ib' ||
        d.classification.type === 'definitieve_aanslag'
      );
      if (personDoc) {
        persons = await this.extractPersons(personDoc);
      }
    }

    // Step 3: Extract tax authority data from aangifte/aanslag
    this.reportProgress({ step: 'tax_data', stepNumber: 3, totalSteps, message: 'Belastinggegevens extraheren...' });
    const taxDocs = classifiedDocs.filter(d =>
      ['aangifte_ib', 'definitieve_aanslag', 'voorlopige_aanslag'].includes(d.classification.type)
    );
    const taxData: Record<string, Box3TaxAuthorityYearData> = {};
    for (const doc of taxDocs) {
      try {
        const data = await this.extractTaxAuthorityData(doc, persons);
        if (data && data.year) {
          taxData[data.year] = data.data;
        }
      } catch (err: any) {
        errors.push(`Tax data extraction failed for ${doc.filename}: ${err.message}`);
      }
    }

    // Step 4: Extract assets from jaaropgaves, WOZ, etc.
    this.reportProgress({ step: 'assets', stepNumber: 4, totalSteps, message: 'Vermogensbestanddelen extraheren...' });
    const bankDocs = classifiedDocs.filter(d => d.classification.type === 'jaaropgave_bank');
    const realEstateDocs = classifiedDocs.filter(d =>
      ['woz_beschikking', 'kostenoverzicht'].includes(d.classification.type)
    );

    const bankAssets: Box3BankSavingsAsset[] = [];
    const realEstateAssets: Box3RealEstateAsset[] = [];
    const debts: Box3Debt[] = [];

    for (const doc of bankDocs) {
      try {
        const asset = await this.extractBankAsset(doc);
        if (asset) bankAssets.push(asset);
      } catch (err: any) {
        errors.push(`Bank extraction failed for ${doc.filename}: ${err.message}`);
      }
    }

    for (const doc of realEstateDocs) {
      try {
        const asset = await this.extractRealEstateAsset(doc);
        if (asset) realEstateAssets.push(asset);
      } catch (err: any) {
        errors.push(`Real estate extraction failed for ${doc.filename}: ${err.message}`);
      }
    }

    // Step 5: Merge into Blueprint
    this.reportProgress({ step: 'merge', stepNumber: 5, totalSteps, message: 'Blueprint samenstellen...' });
    const blueprint = this.mergeIntoBlueprint(
      classifiedDocs,
      persons,
      taxData,
      { bank_savings: bankAssets, real_estate: realEstateAssets, debts }
    );

    return {
      blueprint,
      stepResults: {
        classification: classifiedDocs,
        persons,
        taxData,
        assets: { bank_savings: bankAssets, real_estate: realEstateAssets, debts },
      },
      errors,
    };
  }

  /**
   * Step 1: Classify documents
   */
  private async classifyDocuments(
    documents: PipelineDocument[],
    emailText: string | null
  ): Promise<ClassifiedDocument[]> {
    const classified: ClassifiedDocument[] = [];

    for (const doc of documents) {
      try {
        const prompt = `${PROMPTS.classification}\n\nDOCUMENT: ${doc.filename}\n\n${doc.extractedText || '(Zie afbeelding)'}`;

        const visionAttachments = doc.mimeType.startsWith('image/') || doc.mimeType === 'application/pdf'
          ? [{ mimeType: doc.mimeType, data: doc.fileData, filename: doc.filename }]
          : undefined;

        const result = await this.factory.callModel(
          {
            model: 'gemini-2.5-flash',
            provider: 'google',
            temperature: 0.1,
            maxOutputTokens: 1024,
            thinkingLevel: 'none' as const,
          },
          prompt,
          { visionAttachments }
        );

        const json = this.parseJSON(result.content);
        if (json) {
          classified.push({
            ...doc,
            classification: {
              type: json.type || 'overig',
              taxYear: json.taxYear || null,
              forPerson: json.forPerson || null,
              confidence: json.confidence || 'low',
              summary: json.summary || '',
            },
          });
        } else {
          classified.push({
            ...doc,
            classification: {
              type: 'overig',
              taxYear: null,
              forPerson: null,
              confidence: 'low',
              summary: 'Classificatie mislukt',
            },
          });
        }
      } catch (err: any) {
        console.error(`Classification failed for ${doc.filename}:`, err.message);
        classified.push({
          ...doc,
          classification: {
            type: 'overig',
            taxYear: null,
            forPerson: null,
            confidence: 'low',
            summary: `Error: ${err.message}`,
          },
        });
      }
    }

    return classified;
  }

  /**
   * Step 2: Extract persons
   */
  private async extractPersons(doc: ClassifiedDocument): Promise<Box3FiscalEntity | null> {
    try {
      const prompt = `${PROMPTS.persons}\n\nDOCUMENT: ${doc.filename}\n\n${doc.extractedText || '(Zie afbeelding)'}`;

      const visionAttachments = doc.mimeType.startsWith('image/') || doc.mimeType === 'application/pdf'
        ? [{ mimeType: doc.mimeType, data: doc.fileData, filename: doc.filename }]
        : undefined;

      const result = await this.factory.callModel(
        {
          model: 'gemini-2.5-flash',
          provider: 'google',
          temperature: 0.1,
          maxOutputTokens: 1024,
          thinkingLevel: 'none' as const,
        },
        prompt,
        { visionAttachments }
      );

      const json = this.parseJSON(result.content);
      if (json?.taxpayer) {
        return {
          taxpayer: {
            id: json.taxpayer.id || 'tp_01',
            name: json.taxpayer.name || null,
            bsn_masked: json.taxpayer.bsn_masked || null,
            date_of_birth: json.taxpayer.date_of_birth || null,
          },
          fiscal_partner: {
            has_partner: json.fiscal_partner?.has_partner || false,
            id: json.fiscal_partner?.id || 'fp_01',
            name: json.fiscal_partner?.name || null,
            bsn_masked: json.fiscal_partner?.bsn_masked || null,
            date_of_birth: json.fiscal_partner?.date_of_birth || null,
          },
        };
      }
    } catch (err: any) {
      console.error('Person extraction failed:', err.message);
    }
    return null;
  }

  /**
   * Step 3: Extract tax authority data
   */
  private async extractTaxAuthorityData(
    doc: ClassifiedDocument,
    persons: Box3FiscalEntity | null
  ): Promise<{ year: string; data: Box3TaxAuthorityYearData } | null> {
    try {
      let contextInfo = '';
      if (persons) {
        contextInfo = `\n\nBEKENDE PERSONEN:\n- Belastingplichtige (tp_01): ${persons.taxpayer.name || 'onbekend'}\n`;
        if (persons.fiscal_partner.has_partner) {
          contextInfo += `- Partner (fp_01): ${persons.fiscal_partner.name || 'onbekend'}\n`;
        }
      }

      const prompt = `${PROMPTS.taxAuthorityData}${contextInfo}\n\nDOCUMENT: ${doc.filename}\n\n${doc.extractedText || '(Zie afbeelding)'}`;

      const visionAttachments = doc.mimeType.startsWith('image/') || doc.mimeType === 'application/pdf'
        ? [{ mimeType: doc.mimeType, data: doc.fileData, filename: doc.filename }]
        : undefined;

      // Use high thinking for complex tax extraction
      const result = await this.factory.callModel(
        {
          model: 'gemini-2.5-flash',
          provider: 'google',
          temperature: 0.1,
          maxOutputTokens: 4096,
          thinkingLevel: 'low' as const,
        },
        prompt,
        { visionAttachments }
      );

      const json = this.parseJSON(result.content);
      if (json?.year && json?.household_totals) {
        return {
          year: String(json.year),
          data: {
            source_doc_id: doc.id,
            document_type: json.document_type || 'aangifte',
            per_person: json.per_person || {},
            household_totals: {
              total_assets_gross: json.household_totals.total_assets_gross || 0,
              total_debts: json.household_totals.total_debts || 0,
              net_assets: json.household_totals.net_assets || 0,
              total_exempt: json.household_totals.total_exempt || 0,
              taxable_base: json.household_totals.taxable_base || 0,
              deemed_return: json.household_totals.deemed_return || 0,
              total_tax_assessed: json.household_totals.total_tax_assessed || 0,
            },
          },
        };
      }
    } catch (err: any) {
      console.error('Tax authority data extraction failed:', err.message);
    }
    return null;
  }

  /**
   * Step 4a: Extract bank asset
   */
  private async extractBankAsset(doc: ClassifiedDocument): Promise<Box3BankSavingsAsset | null> {
    try {
      const prompt = `${PROMPTS.bankAsset}\n\nDOCUMENT: ${doc.filename}\n\n${doc.extractedText || '(Zie afbeelding)'}`;

      const visionAttachments = doc.mimeType.startsWith('image/') || doc.mimeType === 'application/pdf'
        ? [{ mimeType: doc.mimeType, data: doc.fileData, filename: doc.filename }]
        : undefined;

      const result = await this.factory.callModel(
        {
          model: 'gemini-2.5-flash',
          provider: 'google',
          temperature: 0.1,
          maxOutputTokens: 2048,
          thinkingLevel: 'none' as const,
        },
        prompt,
        { visionAttachments }
      );

      const json = this.parseJSON(result.content);
      if (json?.year) {
        const year = String(json.year);
        return {
          id: `bank_${doc.id}`,
          owner_id: json.owner_id || 'tp_01',
          description: json.bank_name || 'Bankrekening',
          account_masked: json.account_masked,
          bank_name: json.bank_name,
          country: json.country || 'NL',
          is_joint_account: false,
          ownership_percentage: json.ownership_percentage || 100,
          is_green_investment: false,
          yearly_data: {
            [year]: {
              value_jan_1: json.value_jan_1 ? { amount: json.value_jan_1 } : undefined,
              value_dec_31: json.value_dec_31 ? { amount: json.value_dec_31 } : undefined,
              interest_received: json.interest_received ? { amount: json.interest_received } : undefined,
            },
          },
        };
      }
    } catch (err: any) {
      console.error('Bank asset extraction failed:', err.message);
    }
    return null;
  }

  /**
   * Step 4b: Extract real estate asset
   */
  private async extractRealEstateAsset(doc: ClassifiedDocument): Promise<Box3RealEstateAsset | null> {
    try {
      const prompt = `${PROMPTS.realEstateAsset}\n\nDOCUMENT: ${doc.filename}\n\n${doc.extractedText || '(Zie afbeelding)'}`;

      const visionAttachments = doc.mimeType.startsWith('image/') || doc.mimeType === 'application/pdf'
        ? [{ mimeType: doc.mimeType, data: doc.fileData, filename: doc.filename }]
        : undefined;

      const result = await this.factory.callModel(
        {
          model: 'gemini-2.5-flash',
          provider: 'google',
          temperature: 0.1,
          maxOutputTokens: 2048,
          thinkingLevel: 'none' as const,
        },
        prompt,
        { visionAttachments }
      );

      const json = this.parseJSON(result.content);
      if (json?.year) {
        const year = String(json.year);
        return {
          id: `realestate_${doc.id}`,
          owner_id: json.owner_id || 'tp_01',
          description: json.address || 'Onroerend goed',
          address: json.address || '',
          country: json.country || 'NL',
          type: json.type || 'vacation_home',
          ownership_percentage: json.ownership_percentage || 100,
          yearly_data: {
            [year]: {
              woz_value: json.woz_value ? {
                amount: json.woz_value,
                reference_date: json.woz_reference_date,
              } : undefined,
              maintenance_costs: json.maintenance_costs ? { amount: json.maintenance_costs } : undefined,
              insurance: json.insurance ? { amount: json.insurance } : undefined,
              other_costs: json.other_costs ? { amount: json.other_costs } : undefined,
            },
          },
        };
      }
    } catch (err: any) {
      console.error('Real estate extraction failed:', err.message);
    }
    return null;
  }

  /**
   * Step 5: Merge all extracted data into Blueprint
   */
  private mergeIntoBlueprint(
    classifiedDocs: ClassifiedDocument[],
    persons: Box3FiscalEntity | null,
    taxData: Record<string, Box3TaxAuthorityYearData>,
    assets: {
      bank_savings: Box3BankSavingsAsset[];
      real_estate: Box3RealEstateAsset[];
      debts: Box3Debt[];
    }
  ): Box3Blueprint {
    // Build source_documents_registry
    const sourceDocsRegistry: Box3SourceDocumentEntry[] = classifiedDocs.map(doc => ({
      file_id: doc.id,
      filename: doc.filename,
      detected_type: this.mapClassificationToDetectedType(doc.classification.type),
      detected_tax_year: doc.classification.taxYear,
      for_person: doc.classification.forPerson,
      is_readable: true,
      used_for_extraction: true,
    }));

    // Collect all years
    const allYears = new Set<string>();
    Object.keys(taxData).forEach(y => allYears.add(y));
    assets.bank_savings.forEach(a => Object.keys(a.yearly_data).forEach(y => allYears.add(y)));
    assets.real_estate.forEach(a => Object.keys(a.yearly_data).forEach(y => allYears.add(y)));
    classifiedDocs.forEach(d => {
      if (d.classification.taxYear) allYears.add(String(d.classification.taxYear));
    });

    // Build year_summaries
    const yearSummaries: Record<string, Box3YearSummary> = {};
    for (const year of allYears) {
      const hasTaxData = !!taxData[year];
      const hasBankData = assets.bank_savings.some(a => a.yearly_data[year]);
      const hasRealEstateData = assets.real_estate.some(a => a.yearly_data[year]);

      const missingItems: Box3YearSummary['missing_items'] = [];

      if (!hasTaxData) {
        missingItems.push({
          field: 'tax_authority_data',
          description: `Aangifte of aanslag ${year}`,
          severity: 'high',
          action: 'ask_client',
        });
      }

      // Check if we have bank data with interest for werkelijk rendement
      const bankAssetsForYear = assets.bank_savings.filter(a => a.yearly_data[year]);
      const hasInterestData = bankAssetsForYear.some(a => a.yearly_data[year]?.interest_received);
      if (!hasInterestData && bankAssetsForYear.length > 0) {
        missingItems.push({
          field: 'assets.bank_savings.interest_received',
          description: `Jaaropgave bank ${year} met ontvangen rente`,
          severity: 'medium',
          action: 'ask_client',
        });
      }

      yearSummaries[year] = {
        status: missingItems.some(m => m.severity === 'high') ? 'incomplete' : 'ready_for_calculation',
        completeness: {
          bank_savings: hasBankData ? 'complete' : 'incomplete',
          investments: 'not_applicable',
          real_estate: hasRealEstateData ? 'complete' : 'not_applicable',
          debts: 'complete',
          tax_return: hasTaxData ? 'complete' : 'incomplete',
        },
        missing_items: missingItems,
        calculated_totals: this.calculateTotals(year, taxData[year], assets),
      };
    }

    // Build validation flags
    const validationFlags: Box3ValidationFlag[] = [];

    // Check for allocation issues
    for (const [year, data] of Object.entries(taxData)) {
      const allocations = Object.values(data.per_person || {}).map(p => p.allocation_percentage);
      if (allocations.length >= 2) {
        const sum = allocations.reduce((s, a) => s + (a || 0), 0);
        if (Math.abs(sum - 100) > 5) {
          validationFlags.push({
            id: `alloc_${year}`,
            field_path: `tax_authority_data.${year}.per_person`,
            type: 'inconsistency',
            message: `Allocation percentages voor ${year} tellen niet op tot 100% (${sum}%)`,
            severity: 'high',
            created_at: new Date().toISOString(),
          });
        }
      }
    }

    return {
      schema_version: '3.0',
      source_documents_registry: sourceDocsRegistry,
      fiscal_entity: persons || {
        taxpayer: { id: 'tp_01', name: null, bsn_masked: null, date_of_birth: null },
        fiscal_partner: { has_partner: false },
      },
      assets: {
        bank_savings: assets.bank_savings,
        investments: [],
        real_estate: assets.real_estate,
        other_assets: [],
      },
      debts: assets.debts,
      tax_authority_data: taxData,
      year_summaries: yearSummaries,
      validation_flags: validationFlags,
      manual_overrides: [],
    };
  }

  /**
   * Calculate totals for year summary
   */
  private calculateTotals(
    year: string,
    taxData: Box3TaxAuthorityYearData | undefined,
    assets: { bank_savings: Box3BankSavingsAsset[]; real_estate: Box3RealEstateAsset[]; debts: Box3Debt[] }
  ): Box3YearSummary['calculated_totals'] {
    // Sum actual returns from assets
    let bankInterest = 0;
    for (const bank of assets.bank_savings) {
      const yearData = bank.yearly_data[year];
      if (yearData?.interest_received) {
        bankInterest += yearData.interest_received.amount;
      }
    }

    const deemedReturn = taxData?.household_totals?.deemed_return || 0;
    const totalTaxAssessed = taxData?.household_totals?.total_tax_assessed || 0;
    const actualReturn = bankInterest; // Could add more asset types

    const difference = deemedReturn - actualReturn;
    const taxRate = 0.32; // Simplified, actual rate depends on year
    const indicativeRefund = difference > 0 ? difference * taxRate : 0;

    return {
      total_assets_jan_1: taxData?.household_totals?.total_assets_gross || 0,
      actual_return: {
        bank_interest: bankInterest,
        investment_gain: 0,
        dividends: 0,
        rental_income_net: 0,
        debt_interest_paid: 0,
        total: actualReturn,
      },
      deemed_return_from_tax_authority: deemedReturn,
      difference: difference,
      indicative_refund: indicativeRefund,
      is_profitable: indicativeRefund > 100,
    };
  }

  /**
   * Map classification type to detected_type enum
   */
  private mapClassificationToDetectedType(type: string): Box3SourceDocumentEntry['detected_type'] {
    const mapping: Record<string, Box3SourceDocumentEntry['detected_type']> = {
      'aangifte_ib': 'aangifte_ib',
      'definitieve_aanslag': 'aanslag_definitief',
      'voorlopige_aanslag': 'aanslag_voorlopig',
      'jaaropgave_bank': 'jaaropgave_bank',
      'woz_beschikking': 'woz_beschikking',
      'email': 'email_body',
    };
    return mapping[type] || 'overig';
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
      console.error('JSON parse error:', err);
    }
    return null;
  }
}
