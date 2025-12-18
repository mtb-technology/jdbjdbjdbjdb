/**
 * Box3 Extraction Pipeline - Multi-Stage Architecture
 *
 * A robust 5-stage pipeline for extracting Box 3 tax data from Dutch documents.
 *
 * Stages:
 * 1. Classification - Classify each document type and extract metadata
 * 2. Tax Authority - Extract official Belastingdienst data + asset checklist
 * 3. Asset Extraction - Deep extraction per category (parallel)
 * 4. Merge & Reconcile - Combine all extractions, resolve conflicts
 * 5. Validation - Verify totals against official numbers
 */

import { AIModelFactory } from "./ai-models/ai-model-factory";
import { logger } from "./logger";
import { extractPdfTextFromBase64, hasUsableText, type PdfExtractionResult } from "./pdf-text-extractor";
import {
  CLASSIFICATION_PROMPT,
  TAX_AUTHORITY_PROMPT,
  buildBankExtractionPrompt,
  buildInvestmentExtractionPrompt,
  buildRealEstateExtractionPrompt,
  buildOtherAssetsExtractionPrompt,
} from "./box3-prompts";
import type {
  Box3Blueprint,
  Box3SourceDocumentEntry,
  Box3FiscalEntity,
  Box3TaxAuthorityYearData,
  Box3BankSavingsAsset,
  Box3InvestmentAsset,
  Box3RealEstateAsset,
  Box3OtherAsset,
  Box3YearSummary,
  Box3Debt,
  Box3DocumentExtraction,
  Box3ExtractedClaim,
  Box3ClassificationResult,
  Box3AssetReferences,
  Box3TaxAuthorityExtractionResult,
  Box3BankExtractionResult,
  Box3InvestmentExtractionResult,
  Box3RealEstateExtractionResult,
  Box3OtherAssetsExtractionResult,
  Box3ValidationResult,
  Box3ValidationCheck,
  Box3PipelineProgress,
  Box3MultiStageResult,
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
  step: 'classification' | 'tax_authority' | 'assets' | 'merge' | 'validation' | 'complete';
  stepNumber: number;
  totalSteps: number;
  message: string;
  subProgress?: {
    current: number;
    total: number;
    item?: string;
  };
}

export interface PipelineResult {
  blueprint: Box3Blueprint;
  stepResults: {
    classification: Box3ClassificationResult[];
    persons: Box3FiscalEntity | null;
    taxData: Record<string, Box3TaxAuthorityYearData>;
    assets: {
      bank_savings: Box3BankSavingsAsset[];
      investments: Box3InvestmentAsset[];
      real_estate: Box3RealEstateAsset[];
      other_assets: Box3OtherAsset[];
      debts: Box3Debt[];
    };
  };
  validation: Box3ValidationResult;
  errors: string[];
  timing: {
    total_ms: number;
    stage_times: Record<string, number>;
  };
  /** Debug: full prompts sent to the AI */
  debugPrompts?: Record<string, string>;
  /** Debug: raw AI responses */
  debugResponses?: Record<string, string>;
}

// =============================================================================
// PIPELINE CLASS
// =============================================================================

export class Box3ExtractionPipeline {
  private factory: AIModelFactory;
  private onProgress?: (progress: PipelineProgress) => void;
  private readonly MODEL = 'gemini-3-flash-preview';
  private readonly CONCURRENCY = 3;

  constructor(onProgress?: (progress: PipelineProgress) => void) {
    this.factory = AIModelFactory.getInstance();
    this.onProgress = onProgress;
  }

  private reportProgress(progress: PipelineProgress): void {
    if (this.onProgress) {
      this.onProgress(progress);
    }
    logger.info('box3-pipeline', `Stage ${progress.stepNumber}/${progress.totalSteps}: ${progress.message}`);
  }

  // ===========================================================================
  // MAIN ENTRY POINT
  // ===========================================================================

  /**
   * Main entry point - Multi-stage extraction
   */
  async run(
    documents: PipelineDocument[],
    emailText: string | null,
    existingPersons?: Box3FiscalEntity
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const stageTimes: Record<string, number> = {};
    const debugPrompts: Record<string, string> = {};
    const debugResponses: Record<string, string> = {};
    const totalSteps = 5;

    // Prepare documents with text extraction
    const preparedDocs = await this.prepareDocuments(documents);

    // =========================================================================
    // STAGE 1: Document Classification
    // =========================================================================
    this.reportProgress({
      step: 'classification',
      stepNumber: 1,
      totalSteps,
      message: `Documenten classificeren (${documents.length} stuks)...`
    });

    const stage1Start = Date.now();
    const classificationResults = await this.classifyDocuments(preparedDocs, debugPrompts, debugResponses);
    stageTimes['classification'] = Date.now() - stage1Start;

    // Build document registry from classification
    const sourceDocRegistry: Box3SourceDocumentEntry[] = classificationResults.map((result, i) => ({
      file_id: result.document_id,
      filename: documents[i]?.filename || `doc_${i + 1}`,
      detected_type: result.detected_type,
      detected_tax_year: result.detected_tax_years[0] || null,
      for_person: null,
      is_readable: true,
      used_for_extraction: true,
    }));

    // =========================================================================
    // STAGE 2: Tax Authority Data Extraction
    // =========================================================================
    this.reportProgress({
      step: 'tax_authority',
      stepNumber: 2,
      totalSteps,
      message: 'Belastingdienst gegevens extraheren...'
    });

    const stage2Start = Date.now();
    const taxAuthorityDocs = preparedDocs.filter((doc, i) => {
      const type = classificationResults[i]?.detected_type;
      return type === 'aangifte_ib' || type === 'aanslag_definitief' || type === 'aanslag_voorlopig';
    });

    let taxAuthorityResult: Box3TaxAuthorityExtractionResult | null = null;
    if (taxAuthorityDocs.length > 0) {
      taxAuthorityResult = await this.extractTaxAuthorityData(taxAuthorityDocs, debugPrompts, debugResponses);
    } else {
      errors.push('Geen aangifte of aanslag gevonden - kan geen totalen extraheren');
    }
    stageTimes['tax_authority'] = Date.now() - stage2Start;

    // Build asset checklist from tax authority data
    const assetReferences: Box3AssetReferences = taxAuthorityResult?.asset_references || {
      bank_count: 0,
      bank_descriptions: [],
      investment_count: 0,
      investment_descriptions: [],
      real_estate_count: 0,
      real_estate_descriptions: [],
      other_assets_count: 0,
      other_descriptions: [],
    };

    // =========================================================================
    // STAGE 3: Asset Category Extraction (parallel)
    // =========================================================================
    this.reportProgress({
      step: 'assets',
      stepNumber: 3,
      totalSteps,
      message: 'Vermogensbestanddelen extraheren (4 categorieën parallel)...'
    });

    const stage3Start = Date.now();

    // Run all 4 asset extractions in parallel
    const [bankResult, investmentResult, realEstateResult, otherResult] = await Promise.all([
      this.extractBankAccounts(preparedDocs, assetReferences, debugPrompts, debugResponses),
      this.extractInvestments(preparedDocs, assetReferences, debugPrompts, debugResponses),
      this.extractRealEstate(preparedDocs, assetReferences, debugPrompts, debugResponses),
      this.extractOtherAssets(preparedDocs, assetReferences, debugPrompts, debugResponses),
    ]);

    stageTimes['assets'] = Date.now() - stage3Start;

    // Collect extraction warnings
    if (bankResult?.extraction_notes.missing.length) {
      errors.push(`Ontbrekende bankrekeningen: ${bankResult.extraction_notes.missing.join(', ')}`);
    }
    if (realEstateResult?.extraction_notes.missing.length) {
      errors.push(`Ontbrekende onroerende zaken: ${realEstateResult.extraction_notes.missing.join(', ')}`);
    }

    // =========================================================================
    // STAGE 4: Merge & Reconcile
    // =========================================================================
    this.reportProgress({
      step: 'merge',
      stepNumber: 4,
      totalSteps,
      message: 'Gegevens samenvoegen en conflicten oplossen...'
    });

    const stage4Start = Date.now();
    const blueprint = this.mergeResults(
      sourceDocRegistry,
      taxAuthorityResult,
      bankResult,
      investmentResult,
      realEstateResult,
      otherResult
    );
    stageTimes['merge'] = Date.now() - stage4Start;

    // =========================================================================
    // STAGE 5: Validation
    // =========================================================================
    this.reportProgress({
      step: 'validation',
      stepNumber: 5,
      totalSteps,
      message: 'Extractie valideren tegen Belastingdienst totalen...'
    });

    const stage5Start = Date.now();
    const validation = this.validateExtraction(blueprint, assetReferences);
    stageTimes['validation'] = Date.now() - stage5Start;

    // Add validation errors/warnings to the errors list
    for (const check of validation.checks) {
      if (!check.passed && check.severity === 'error') {
        errors.push(check.message);
      }
    }

    // Store validation flags in blueprint
    blueprint.validation_flags = validation.checks
      .filter(c => !c.passed)
      .map((check, i) => ({
        id: `validation_${i}`,
        field_path: check.details?.field || 'general',
        type: check.severity === 'error' ? 'requires_validation' : 'low_confidence' as const,
        message: check.message,
        severity: check.severity === 'error' ? 'high' : 'medium' as const,
        created_at: new Date().toISOString(),
      }));

    // =========================================================================
    // COMPLETE
    // =========================================================================
    this.reportProgress({
      step: 'complete',
      stepNumber: 5,
      totalSteps,
      message: 'Extractie voltooid'
    });

    const totalTime = Date.now() - startTime;
    stageTimes['total'] = totalTime;

    logger.info('box3-pipeline', 'Multi-stage extraction complete', {
      totalTime,
      stages: stageTimes,
      documentsProcessed: documents.length,
      errorsCount: errors.length,
      validationPassed: validation.is_valid,
    });

    return {
      blueprint,
      stepResults: {
        classification: classificationResults,
        persons: taxAuthorityResult?.fiscal_entity || null,
        taxData: taxAuthorityResult?.tax_authority_data || {},
        assets: {
          bank_savings: bankResult?.bank_savings || [],
          investments: investmentResult?.investments || [],
          real_estate: realEstateResult?.real_estate || [],
          other_assets: otherResult?.other_assets || [],
          debts: otherResult?.debts || [],
        },
      },
      validation,
      errors,
      timing: {
        total_ms: totalTime,
        stage_times: stageTimes,
      },
      debugPrompts,
      debugResponses,
    };
  }

  // ===========================================================================
  // DOCUMENT PREPARATION
  // ===========================================================================

  private async prepareDocuments(documents: PipelineDocument[]): Promise<PipelineDocument[]> {
    const prepared: PipelineDocument[] = [];

    for (const doc of documents) {
      if (doc.mimeType === 'application/pdf') {
        try {
          const result = await extractPdfTextFromBase64(doc.fileData, doc.filename);
          if (hasUsableText(result, 200)) {
            prepared.push({
              ...doc,
              extractedText: result.text,
            });
            logger.info('box3-pipeline', `✅ Text extracted from ${doc.filename}`, {
              charCount: result.charCount,
              avgCharsPerPage: result.avgCharsPerPage,
            });
          } else {
            // Low text yield - will use vision
            prepared.push(doc);
            logger.warn('box3-pipeline', `⚠️ Low text yield from ${doc.filename}, using vision`, {
              charCount: result.charCount,
              avgCharsPerPage: result.avgCharsPerPage,
            });
          }
        } catch (err: any) {
          logger.error('box3-pipeline', `Failed text extraction for ${doc.filename}`, { error: err.message });
          prepared.push(doc);
        }
      } else {
        // Images always use vision
        prepared.push(doc);
      }
    }

    return prepared;
  }

  // ===========================================================================
  // STAGE 1: DOCUMENT CLASSIFICATION
  // ===========================================================================

  private async classifyDocuments(
    documents: PipelineDocument[],
    debugPrompts: Record<string, string>,
    debugResponses: Record<string, string>
  ): Promise<Box3ClassificationResult[]> {
    const results: Box3ClassificationResult[] = [];

    // Process in parallel batches
    for (let i = 0; i < documents.length; i += this.CONCURRENCY) {
      const batch = documents.slice(i, i + this.CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((doc, batchIndex) => this.classifySingleDocument(doc, i + batchIndex, debugPrompts, debugResponses))
      );
      results.push(...batchResults);
    }

    return results;
  }

  private async classifySingleDocument(
    doc: PipelineDocument,
    index: number,
    debugPrompts: Record<string, string>,
    debugResponses: Record<string, string>
  ): Promise<Box3ClassificationResult> {
    const promptKey = `classification_${index}`;

    // Build prompt with document content
    const docContent = doc.extractedText
      ? `## DOCUMENT TEKST:\n\`\`\`\n${doc.extractedText.substring(0, 10000)}\n\`\`\``
      : `## DOCUMENT: ${doc.filename}\n(Zie bijgevoegde afbeelding/PDF)`;

    const prompt = `${CLASSIFICATION_PROMPT}\n\n${docContent}\n\nAnalyseer dit document en geef de JSON classificatie.`;
    debugPrompts[promptKey] = prompt;

    // Prepare vision attachment if needed
    const visionAttachments = !doc.extractedText ? [{
      mimeType: doc.mimeType,
      data: doc.fileData,
      filename: doc.filename,
    }] : undefined;

    try {
      const result = await this.factory.callModel(
        {
          model: this.MODEL,
          provider: 'google',
          temperature: 0.0,
          maxOutputTokens: 4096,
        },
        prompt,
        visionAttachments ? { visionAttachments } : undefined
      );

      debugResponses[promptKey] = result.content;
      const json = this.parseJSON(result.content);

      if (json) {
        return {
          document_id: doc.id,
          detected_type: this.normalizeDocumentType(json.detected_type),
          detected_tax_years: json.detected_tax_years || [],
          detected_persons: json.detected_persons || [],
          asset_hints: json.asset_hints || { bank_accounts: [], properties: [], investments: [] },
          confidence: json.confidence || 0.5,
          notes: json.notes,
        };
      }
    } catch (err: any) {
      logger.error('box3-pipeline', `Classification failed for ${doc.filename}`, { error: err.message });
    }

    // Return fallback classification
    return {
      document_id: doc.id,
      detected_type: 'overig',
      detected_tax_years: [],
      detected_persons: [],
      asset_hints: { bank_accounts: [], properties: [], investments: [] },
      confidence: 0.1,
      notes: 'Classificatie mislukt',
    };
  }

  // ===========================================================================
  // STAGE 2: TAX AUTHORITY DATA EXTRACTION
  // ===========================================================================

  private async extractTaxAuthorityData(
    documents: PipelineDocument[],
    debugPrompts: Record<string, string>,
    debugResponses: Record<string, string>
  ): Promise<Box3TaxAuthorityExtractionResult | null> {
    // Combine all tax authority documents
    const docSections = documents.map((doc, i) => {
      if (doc.extractedText) {
        return `### Document ${i + 1}: ${doc.filename}\n\`\`\`\n${doc.extractedText}\n\`\`\``;
      }
      return `### Document ${i + 1}: ${doc.filename}\n(Zie bijgevoegde afbeelding/PDF)`;
    });

    const prompt = `${TAX_AUTHORITY_PROMPT}\n\n## DOCUMENTEN:\n${docSections.join('\n\n')}\n\nExtraheer nu de belastingdienst gegevens en asset referenties.`;
    debugPrompts['tax_authority'] = prompt;

    // Prepare vision attachments for docs without text
    const visionAttachments = documents
      .filter(doc => !doc.extractedText)
      .map(doc => ({
        mimeType: doc.mimeType,
        data: doc.fileData,
        filename: doc.filename,
      }));

    try {
      const result = await this.factory.callModel(
        {
          model: this.MODEL,
          provider: 'google',
          temperature: 0.0,
          maxOutputTokens: 16384,
        },
        prompt,
        visionAttachments.length > 0 ? { visionAttachments } : undefined
      );

      debugResponses['tax_authority'] = result.content;
      const json = this.parseJSON(result.content);

      if (json) {
        return {
          fiscal_entity: json.fiscal_entity || {
            taxpayer: { id: 'tp_01', name: null, bsn_masked: null, date_of_birth: null },
            fiscal_partner: { has_partner: false },
          },
          tax_authority_data: this.normalizeTaxAuthorityData(json.tax_authority_data || {}),
          asset_references: {
            bank_count: json.asset_references?.bank_count || 0,
            bank_descriptions: json.asset_references?.bank_descriptions || [],
            investment_count: json.asset_references?.investment_count || 0,
            investment_descriptions: json.asset_references?.investment_descriptions || [],
            real_estate_count: json.asset_references?.real_estate_count || 0,
            real_estate_descriptions: json.asset_references?.real_estate_descriptions || [],
            other_assets_count: json.asset_references?.other_assets_count || 0,
            other_descriptions: json.asset_references?.other_descriptions || [],
          },
        };
      }
    } catch (err: any) {
      logger.error('box3-pipeline', 'Tax authority extraction failed', { error: err.message });
    }

    return null;
  }

  // ===========================================================================
  // STAGE 3a: BANK ACCOUNT EXTRACTION
  // ===========================================================================

  private async extractBankAccounts(
    documents: PipelineDocument[],
    checklist: Box3AssetReferences,
    debugPrompts: Record<string, string>,
    debugResponses: Record<string, string>
  ): Promise<Box3BankExtractionResult | null> {
    const prompt = buildBankExtractionPrompt({
      bank_count: checklist.bank_count,
      bank_descriptions: checklist.bank_descriptions,
    });

    const docSections = documents.map((doc, i) => {
      if (doc.extractedText) {
        return `### Document ${i + 1}: ${doc.filename}\n\`\`\`\n${doc.extractedText}\n\`\`\``;
      }
      return `### Document ${i + 1}: ${doc.filename}\n(Zie bijgevoegde afbeelding/PDF)`;
    });

    const fullPrompt = `${prompt}\n\n## DOCUMENTEN:\n${docSections.join('\n\n')}\n\nExtraheer nu ALLE bankrekeningen.`;
    debugPrompts['bank_extraction'] = fullPrompt;

    const visionAttachments = documents
      .filter(doc => !doc.extractedText)
      .map(doc => ({
        mimeType: doc.mimeType,
        data: doc.fileData,
        filename: doc.filename,
      }));

    try {
      const result = await this.factory.callModel(
        {
          model: this.MODEL,
          provider: 'google',
          temperature: 0.0,
          maxOutputTokens: 32768,
        },
        fullPrompt,
        visionAttachments.length > 0 ? { visionAttachments } : undefined
      );

      debugResponses['bank_extraction'] = result.content;
      const json = this.parseJSON(result.content);

      if (json) {
        return {
          bank_savings: (json.bank_savings || []).map((bank: any, i: number) => ({
            id: bank.id || `bank_${i + 1}`,
            owner_id: bank.owner_id || 'tp_01',
            description: bank.description || '',
            account_masked: bank.account_masked,
            bank_name: bank.bank_name,
            country: bank.country || 'NL',
            is_joint_account: bank.is_joint_account || false,
            ownership_percentage: bank.ownership_percentage || 100,
            is_green_investment: bank.is_green_investment || false,
            yearly_data: bank.yearly_data || {},
          })),
          extraction_notes: json.extraction_notes || {
            total_found: json.bank_savings?.length || 0,
            expected_from_checklist: checklist.bank_count,
            missing: [],
            warnings: [],
          },
        };
      }
    } catch (err: any) {
      logger.error('box3-pipeline', 'Bank extraction failed', { error: err.message });
    }

    return null;
  }

  // ===========================================================================
  // STAGE 3b: INVESTMENT EXTRACTION
  // ===========================================================================

  private async extractInvestments(
    documents: PipelineDocument[],
    checklist: Box3AssetReferences,
    debugPrompts: Record<string, string>,
    debugResponses: Record<string, string>
  ): Promise<Box3InvestmentExtractionResult | null> {
    const prompt = buildInvestmentExtractionPrompt({
      investment_count: checklist.investment_count,
      investment_descriptions: checklist.investment_descriptions,
    });

    const docSections = documents.map((doc, i) => {
      if (doc.extractedText) {
        return `### Document ${i + 1}: ${doc.filename}\n\`\`\`\n${doc.extractedText}\n\`\`\``;
      }
      return `### Document ${i + 1}: ${doc.filename}\n(Zie bijgevoegde afbeelding/PDF)`;
    });

    const fullPrompt = `${prompt}\n\n## DOCUMENTEN:\n${docSections.join('\n\n')}\n\nExtraheer nu ALLE beleggingen.`;
    debugPrompts['investment_extraction'] = fullPrompt;

    const visionAttachments = documents
      .filter(doc => !doc.extractedText)
      .map(doc => ({
        mimeType: doc.mimeType,
        data: doc.fileData,
        filename: doc.filename,
      }));

    try {
      const result = await this.factory.callModel(
        {
          model: this.MODEL,
          provider: 'google',
          temperature: 0.0,
          maxOutputTokens: 16384,
        },
        fullPrompt,
        visionAttachments.length > 0 ? { visionAttachments } : undefined
      );

      debugResponses['investment_extraction'] = result.content;
      const json = this.parseJSON(result.content);

      if (json) {
        return {
          investments: (json.investments || []).map((inv: any, i: number) => ({
            id: inv.id || `inv_${i + 1}`,
            owner_id: inv.owner_id || 'tp_01',
            description: inv.description || '',
            institution: inv.institution,
            account_masked: inv.account_masked,
            country: inv.country || 'NL',
            type: inv.type || 'other',
            ownership_percentage: inv.ownership_percentage || 100,
            yearly_data: inv.yearly_data || {},
          })),
          extraction_notes: json.extraction_notes || {
            total_found: json.investments?.length || 0,
            expected_from_checklist: checklist.investment_count,
            missing: [],
            warnings: [],
          },
        };
      }
    } catch (err: any) {
      logger.error('box3-pipeline', 'Investment extraction failed', { error: err.message });
    }

    return null;
  }

  // ===========================================================================
  // STAGE 3c: REAL ESTATE EXTRACTION
  // ===========================================================================

  private async extractRealEstate(
    documents: PipelineDocument[],
    checklist: Box3AssetReferences,
    debugPrompts: Record<string, string>,
    debugResponses: Record<string, string>
  ): Promise<Box3RealEstateExtractionResult | null> {
    const prompt = buildRealEstateExtractionPrompt({
      real_estate_count: checklist.real_estate_count,
      real_estate_descriptions: checklist.real_estate_descriptions,
    });

    const docSections = documents.map((doc, i) => {
      if (doc.extractedText) {
        return `### Document ${i + 1}: ${doc.filename}\n\`\`\`\n${doc.extractedText}\n\`\`\``;
      }
      return `### Document ${i + 1}: ${doc.filename}\n(Zie bijgevoegde afbeelding/PDF)`;
    });

    const fullPrompt = `${prompt}\n\n## DOCUMENTEN:\n${docSections.join('\n\n')}\n\nExtraheer nu ALLE onroerende zaken in Box 3.`;
    debugPrompts['real_estate_extraction'] = fullPrompt;

    const visionAttachments = documents
      .filter(doc => !doc.extractedText)
      .map(doc => ({
        mimeType: doc.mimeType,
        data: doc.fileData,
        filename: doc.filename,
      }));

    try {
      const result = await this.factory.callModel(
        {
          model: this.MODEL,
          provider: 'google',
          temperature: 0.0,
          maxOutputTokens: 16384,
        },
        fullPrompt,
        visionAttachments.length > 0 ? { visionAttachments } : undefined
      );

      debugResponses['real_estate_extraction'] = result.content;
      const json = this.parseJSON(result.content);

      if (json) {
        return {
          real_estate: (json.real_estate || []).map((re: any, i: number) => ({
            id: re.id || `re_${i + 1}`,
            owner_id: re.owner_id || 'tp_01',
            description: re.description || '',
            address: re.address || '',
            postcode: re.postcode,
            country: re.country || 'NL',
            type: re.type || 'other',
            ownership_percentage: re.ownership_percentage || 100,
            yearly_data: re.yearly_data || {},
          })),
          extraction_notes: {
            ...(json.extraction_notes || {
              total_found: json.real_estate?.length || 0,
              expected_from_checklist: checklist.real_estate_count,
              missing: [],
              warnings: [],
            }),
            peildatum_mappings: json.extraction_notes?.peildatum_mappings,
          },
        };
      }
    } catch (err: any) {
      logger.error('box3-pipeline', 'Real estate extraction failed', { error: err.message });
    }

    return null;
  }

  // ===========================================================================
  // STAGE 3d: OTHER ASSETS & DEBTS EXTRACTION
  // ===========================================================================

  private async extractOtherAssets(
    documents: PipelineDocument[],
    checklist: Box3AssetReferences,
    debugPrompts: Record<string, string>,
    debugResponses: Record<string, string>
  ): Promise<Box3OtherAssetsExtractionResult | null> {
    const prompt = buildOtherAssetsExtractionPrompt({
      other_assets_count: checklist.other_assets_count,
      other_descriptions: checklist.other_descriptions,
    });

    const docSections = documents.map((doc, i) => {
      if (doc.extractedText) {
        return `### Document ${i + 1}: ${doc.filename}\n\`\`\`\n${doc.extractedText}\n\`\`\``;
      }
      return `### Document ${i + 1}: ${doc.filename}\n(Zie bijgevoegde afbeelding/PDF)`;
    });

    const fullPrompt = `${prompt}\n\n## DOCUMENTEN:\n${docSections.join('\n\n')}\n\nExtraheer nu ALLE overige bezittingen en schulden.`;
    debugPrompts['other_extraction'] = fullPrompt;

    const visionAttachments = documents
      .filter(doc => !doc.extractedText)
      .map(doc => ({
        mimeType: doc.mimeType,
        data: doc.fileData,
        filename: doc.filename,
      }));

    try {
      const result = await this.factory.callModel(
        {
          model: this.MODEL,
          provider: 'google',
          temperature: 0.0,
          maxOutputTokens: 16384,
        },
        fullPrompt,
        visionAttachments.length > 0 ? { visionAttachments } : undefined
      );

      debugResponses['other_extraction'] = result.content;
      const json = this.parseJSON(result.content);

      if (json) {
        return {
          other_assets: (json.other_assets || []).map((oa: any, i: number) => ({
            id: oa.id || `oa_${i + 1}`,
            owner_id: oa.owner_id || 'tp_01',
            description: oa.description || '',
            type: oa.type || 'other',
            country: oa.country || 'NL',
            yearly_data: oa.yearly_data || {},
          })),
          debts: (json.debts || []).map((debt: any, i: number) => ({
            id: debt.id || `debt_${i + 1}`,
            owner_id: debt.owner_id || 'tp_01',
            description: debt.description || '',
            lender: debt.lender,
            linked_asset_id: debt.linked_asset_id,
            ownership_percentage: debt.ownership_percentage || 100,
            debt_type: debt.debt_type || 'other',
            country: debt.country || 'NL',
            yearly_data: debt.yearly_data || {},
          })),
          extraction_notes: json.extraction_notes || {
            total_found: (json.other_assets?.length || 0) + (json.debts?.length || 0),
            expected_from_checklist: checklist.other_assets_count,
            missing: [],
            warnings: [],
          },
        };
      }
    } catch (err: any) {
      logger.error('box3-pipeline', 'Other assets extraction failed', { error: err.message });
    }

    return null;
  }

  // ===========================================================================
  // STAGE 4: MERGE & RECONCILE
  // ===========================================================================

  private mergeResults(
    sourceDocRegistry: Box3SourceDocumentEntry[],
    taxAuthorityResult: Box3TaxAuthorityExtractionResult | null,
    bankResult: Box3BankExtractionResult | null,
    investmentResult: Box3InvestmentExtractionResult | null,
    realEstateResult: Box3RealEstateExtractionResult | null,
    otherResult: Box3OtherAssetsExtractionResult | null
  ): Box3Blueprint {
    // Determine tax years from all sources
    const taxYears = new Set<string>();
    if (taxAuthorityResult?.tax_authority_data) {
      Object.keys(taxAuthorityResult.tax_authority_data).forEach(y => taxYears.add(y));
    }

    // Create year summaries
    const yearSummaries: Record<string, Box3YearSummary> = {};
    for (const year of taxYears) {
      yearSummaries[year] = {
        status: 'incomplete',
        completeness: {
          bank_savings: bankResult ? 'complete' : 'incomplete',
          investments: investmentResult ? 'complete' : 'not_applicable',
          real_estate: realEstateResult ? 'complete' : 'not_applicable',
          debts: 'not_applicable',
          tax_return: taxAuthorityResult ? 'complete' : 'incomplete',
        },
        missing_items: [],
      };
    }

    const blueprint: Box3Blueprint = {
      schema_version: '2.0',
      source_documents_registry: sourceDocRegistry,
      fiscal_entity: taxAuthorityResult?.fiscal_entity || {
        taxpayer: { id: 'tp_01', name: null, bsn_masked: null, date_of_birth: null },
        fiscal_partner: { has_partner: false },
      },
      assets: {
        bank_savings: bankResult?.bank_savings || [],
        investments: investmentResult?.investments || [],
        real_estate: realEstateResult?.real_estate || [],
        other_assets: otherResult?.other_assets || [],
      },
      debts: otherResult?.debts || [],
      tax_authority_data: taxAuthorityResult?.tax_authority_data || {},
      year_summaries: yearSummaries,
      validation_flags: [],
      manual_overrides: [],
    };

    // Calculate totals for each year
    this.calculateYearTotals(blueprint);

    return blueprint;
  }

  // ===========================================================================
  // STAGE 5: VALIDATION
  // ===========================================================================

  private validateExtraction(
    blueprint: Box3Blueprint,
    assetReferences: Box3AssetReferences
  ): Box3ValidationResult {
    const checks: Box3ValidationCheck[] = [];

    // Get all years
    const years = Object.keys(blueprint.tax_authority_data);

    for (const year of years) {
      const taxData = blueprint.tax_authority_data[year];
      if (!taxData?.household_totals) continue;

      // Check 1: Asset Total Comparison
      const authorityTotal = taxData.household_totals.total_assets_gross || 0;
      const extractedTotal = this.sumAllAssets(blueprint, year);
      const difference = Math.abs(authorityTotal - extractedTotal);

      checks.push({
        check_type: 'asset_total',
        year,
        passed: difference <= 1000,
        severity: difference > 5000 ? 'error' : difference > 1000 ? 'warning' : 'info',
        message: difference <= 1000
          ? `${year}: Totalen komen overeen (verschil €${difference.toFixed(0)})`
          : `${year}: Verschil €${difference.toFixed(0)} tussen aangifte (€${authorityTotal}) en extractie (€${extractedTotal.toFixed(0)})`,
        details: {
          expected: authorityTotal,
          actual: extractedTotal,
          difference,
          field: 'total_assets',
        },
      });
    }

    // Check 2: Bank Account Count
    const extractedBankCount = blueprint.assets.bank_savings.length;
    const expectedBankCount = assetReferences.bank_count;

    if (expectedBankCount > 0) {
      checks.push({
        check_type: 'asset_count',
        passed: extractedBankCount >= expectedBankCount,
        severity: extractedBankCount < expectedBankCount ? 'error' : 'info',
        message: extractedBankCount >= expectedBankCount
          ? `Alle ${expectedBankCount} bankrekeningen gevonden`
          : `${expectedBankCount - extractedBankCount} van ${expectedBankCount} bankrekeningen niet gevonden`,
        details: {
          expected: expectedBankCount,
          actual: extractedBankCount,
          field: 'bank_count',
        },
      });
    }

    // Check 3: Interest Plausibility (max 10% of balance)
    for (const bank of blueprint.assets.bank_savings) {
      for (const [year, data] of Object.entries(bank.yearly_data)) {
        const balance = this.getAmount(data.value_jan_1);
        const interest = this.getAmount(data.interest_received);

        if (balance > 0 && interest > balance * 0.10) {
          checks.push({
            check_type: 'interest_plausibility',
            year,
            passed: false,
            severity: 'warning',
            message: `${bank.description || bank.bank_name}: €${interest.toFixed(0)} rente op €${balance.toFixed(0)} saldo (>${(interest / balance * 100).toFixed(1)}%)`,
            details: {
              expected: balance * 0.10,
              actual: interest,
              field: `bank_savings.${bank.id}.interest`,
            },
          });
        }
      }
    }

    // Check 4: Tax Assessed Present
    for (const year of years) {
      const taxAssessed = blueprint.tax_authority_data[year]?.household_totals?.total_tax_assessed;
      checks.push({
        check_type: 'missing_data',
        year,
        passed: taxAssessed !== undefined && taxAssessed > 0,
        severity: !taxAssessed ? 'error' : 'info',
        message: taxAssessed
          ? `${year}: Box 3 belasting gevonden (€${taxAssessed})`
          : `${year}: Geen Box 3 belasting geëxtraheerd`,
        details: {
          field: 'total_tax_assessed',
          actual: taxAssessed || 0,
        },
      });
    }

    // Calculate summary
    const passed = checks.filter(c => c.passed).length;
    const warnings = checks.filter(c => !c.passed && c.severity === 'warning').length;
    const errors = checks.filter(c => !c.passed && c.severity === 'error').length;

    return {
      is_valid: errors === 0,
      checks,
      summary: {
        total_checks: checks.length,
        passed,
        warnings,
        errors,
      },
    };
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private sumAllAssets(blueprint: Box3Blueprint, year: string): number {
    let total = 0;

    // Bank savings
    for (const bank of blueprint.assets.bank_savings || []) {
      const value = this.getAmount(bank.yearly_data?.[year]?.value_jan_1);
      total += value * ((bank.ownership_percentage || 100) / 100);
    }

    // Investments
    for (const inv of blueprint.assets.investments || []) {
      const value = this.getAmount(inv.yearly_data?.[year]?.value_jan_1);
      total += value * ((inv.ownership_percentage || 100) / 100);
    }

    // Real estate
    for (const re of blueprint.assets.real_estate || []) {
      const value = this.getAmount(re.yearly_data?.[year]?.woz_value);
      total += value * ((re.ownership_percentage || 100) / 100);
    }

    // Other assets
    for (const oa of blueprint.assets.other_assets || []) {
      const value = this.getAmount(oa.yearly_data?.[year]?.value_jan_1);
      total += value;
    }

    return total;
  }

  private getAmount(field: any): number {
    if (field === null || field === undefined) return 0;
    if (typeof field === 'number') return field;
    if (typeof field === 'object') {
      return field.amount ?? field.value ?? 0;
    }
    return 0;
  }

  private calculateYearTotals(blueprint: Box3Blueprint): void {
    const years = Object.keys(blueprint.tax_authority_data || {});

    for (const year of years) {
      const taxData = blueprint.tax_authority_data[year];
      if (!taxData) continue;

      // Calculate actual return components
      let totalBankInterest = 0;
      let totalDividends = 0;
      let totalRentalIncomeNet = 0;
      let totalInvestmentGain = 0;
      let totalDebtInterestPaid = 0;

      // Bank interest
      for (const bank of blueprint.assets?.bank_savings || []) {
        const yearData = bank.yearly_data?.[year];
        if (yearData) {
          totalBankInterest += this.getAmount(yearData.interest_received) * ((bank.ownership_percentage || 100) / 100);
        }
      }

      // Investment dividends & gains
      for (const inv of blueprint.assets?.investments || []) {
        const yearData = inv.yearly_data?.[year];
        if (yearData) {
          totalDividends += this.getAmount(yearData.dividend_received) * ((inv.ownership_percentage || 100) / 100);
          totalInvestmentGain += this.getAmount(yearData.realized_gains) * ((inv.ownership_percentage || 100) / 100);
        }
      }

      // Rental income
      for (const re of blueprint.assets?.real_estate || []) {
        const yearData = re.yearly_data?.[year];
        if (yearData) {
          const rentalGross = this.getAmount(yearData.rental_income_gross);
          const costs = this.getAmount(yearData.maintenance_costs) +
            this.getAmount(yearData.property_tax) +
            this.getAmount(yearData.insurance) +
            this.getAmount(yearData.other_costs);
          totalRentalIncomeNet += (rentalGross - costs) * ((re.ownership_percentage || 100) / 100);
        }
      }

      // Debt interest
      for (const debt of blueprint.debts || []) {
        const yearData = debt.yearly_data?.[year];
        if (yearData) {
          totalDebtInterestPaid += this.getAmount(yearData.interest_paid) * ((debt.ownership_percentage || 100) / 100);
        }
      }

      const actualReturnTotal = totalBankInterest + totalDividends + totalInvestmentGain + totalRentalIncomeNet - totalDebtInterestPaid;

      // Get deemed return from tax authority
      const deemedReturn = taxData.household_totals?.deemed_return || 0;
      const box3TaxPaid = taxData.household_totals?.total_tax_assessed || 0;

      // Tax rate per year
      const taxRate = year === '2024' ? 0.36 : year === '2023' ? 0.32 : 0.31;

      // Calculate indicative refund
      const hasActualReturnData = totalBankInterest > 0 || totalDividends > 0 || totalRentalIncomeNet > 0;
      let theoreticalRefund: number;

      if (hasActualReturnData) {
        const difference = deemedReturn - actualReturnTotal;
        theoreticalRefund = difference > 0 ? difference * taxRate : 0;
      } else {
        theoreticalRefund = deemedReturn > 0 ? deemedReturn * taxRate : 0;
      }

      const indicativeRefund = Math.min(theoreticalRefund, box3TaxPaid);
      const difference = deemedReturn - actualReturnTotal;

      // Update year summary
      if (!blueprint.year_summaries[year]) {
        blueprint.year_summaries[year] = {
          status: 'incomplete',
          completeness: {
            bank_savings: 'incomplete',
            investments: 'incomplete',
            real_estate: 'incomplete',
            debts: 'incomplete',
            tax_return: 'incomplete',
          },
          missing_items: [],
        };
      }

      blueprint.year_summaries[year].calculated_totals = {
        total_assets_jan_1: Math.round(this.sumAllAssets(blueprint, year) * 100) / 100,
        actual_return: {
          bank_interest: Math.round(totalBankInterest * 100) / 100,
          investment_gain: Math.round(totalInvestmentGain * 100) / 100,
          dividends: Math.round(totalDividends * 100) / 100,
          rental_income_net: Math.round(totalRentalIncomeNet * 100) / 100,
          debt_interest_paid: Math.round(totalDebtInterestPaid * 100) / 100,
          total: Math.round(actualReturnTotal * 100) / 100,
        },
        deemed_return_from_tax_authority: deemedReturn,
        difference: Math.round(difference * 100) / 100,
        indicative_refund: Math.round(indicativeRefund * 100) / 100,
        is_profitable: indicativeRefund > 0,
      };

      // Update status
      if (taxData.household_totals?.total_tax_assessed) {
        blueprint.year_summaries[year].status = indicativeRefund > 0 ? 'complete' : 'ready_for_calculation';
      }
    }
  }

  private normalizeTaxAuthorityData(data: Record<string, any>): Record<string, Box3TaxAuthorityYearData> {
    const result: Record<string, Box3TaxAuthorityYearData> = {};

    for (const [year, yearData] of Object.entries(data)) {
      const getValue = (obj: any): number => {
        if (obj === null || obj === undefined) return 0;
        if (typeof obj === 'number') return obj;
        if (typeof obj === 'object' && 'value' in obj) return obj.value || 0;
        if (typeof obj === 'object' && 'amount' in obj) return obj.amount || 0;
        return 0;
      };

      const householdTotals = yearData.household_totals || {};

      result[year] = {
        source_doc_id: yearData.source_doc_id || `doc_${year}`,
        document_type: yearData.document_type || 'aangifte',
        household_totals: {
          total_assets_gross: getValue(householdTotals.total_assets_gross),
          total_debts: getValue(householdTotals.total_debts),
          net_assets: getValue(householdTotals.net_assets) ||
            (getValue(householdTotals.total_assets_gross) - getValue(householdTotals.total_debts)),
          total_exempt: getValue(householdTotals.total_exempt),
          taxable_base: getValue(householdTotals.taxable_base),
          deemed_return: getValue(householdTotals.deemed_return),
          total_tax_assessed: getValue(householdTotals.total_tax_assessed),
        },
        per_person: yearData.per_person || {},
      };
    }

    return result;
  }

  private normalizeDocumentType(type: string): Box3SourceDocumentEntry['detected_type'] {
    const mapping: Record<string, Box3SourceDocumentEntry['detected_type']> = {
      'aangifte_ib': 'aangifte_ib',
      'aanslag_definitief': 'aanslag_definitief',
      'aanslag_voorlopig': 'aanslag_voorlopig',
      'jaaropgave_bank': 'jaaropgave_bank',
      'woz_beschikking': 'woz_beschikking',
      'email_body': 'email_body',
      'overig': 'overig',
      // Fallbacks
      'definitieve_aanslag': 'aanslag_definitief',
      'voorlopige_aanslag': 'aanslag_voorlopig',
      'email': 'email_body',
      'effectenoverzicht': 'overig',
    };
    return mapping[type] || 'overig';
  }

  private parseJSON(content: string): any {
    try {
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
  // SINGLE DOCUMENT EXTRACTION (for incremental merge - legacy support)
  // ===========================================================================

  async extractSingleDocument(document: PipelineDocument): Promise<{
    extraction: Box3DocumentExtraction;
    rawResponse: string;
    error?: string;
  }> {
    // Use classification + minimal extraction for single docs
    const debugPrompts: Record<string, string> = {};
    const debugResponses: Record<string, string> = {};

    const classification = await this.classifySingleDocument(document, 0, debugPrompts, debugResponses);

    return {
      extraction: {
        document_id: document.id,
        extraction_version: 1,
        extracted_at: new Date().toISOString(),
        model_used: this.MODEL,
        detected_type: classification.detected_type,
        detected_tax_years: classification.detected_tax_years.map(String),
        detected_person: classification.detected_persons[0]?.role || null,
        claims: [],
        asset_identifiers: {
          bank_accounts: classification.asset_hints.bank_accounts,
          real_estate: classification.asset_hints.properties,
          investments: classification.asset_hints.investments.map(i => ({
            account_number: '',
            institution: i.institution || '',
          })),
        },
      },
      rawResponse: debugResponses['classification_0'] || '',
    };
  }
}
