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
  TAX_AUTHORITY_PERSONS_PROMPT,
  TAX_AUTHORITY_TOTALS_PROMPT,
  TAX_AUTHORITY_CHECKLIST_PROMPT,
  ANOMALY_DETECTION_PROMPT,
  buildBankExtractionPrompt,
  buildInvestmentExtractionPrompt,
  buildRealEstateExtractionPrompt,
  buildOtherAssetsExtractionPrompt,
} from "./box3-prompts";
import { BOX3_CONSTANTS } from "@shared/constants";
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
  Box3MissingItem,
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
  /** Debug: full prompts sent to the AI (legacy compatibility) */
  fullPrompt?: string;
  /** Debug: raw AI response (legacy compatibility) */
  rawAiResponse?: string;
  /** Debug: full prompts sent to the AI */
  debugPrompts?: Record<string, string>;
  /** Debug: raw AI responses */
  debugResponses?: Record<string, string>;
}

/**
 * Exclusion context passed between sequential extraction stages.
 * Each stage adds its extracted items to prevent duplicates in later stages.
 */
export interface ExclusionContext {
  /** Descriptions of already-extracted assets (normalized) */
  extractedDescriptions: string[];
  /** Account numbers already extracted (masked format) */
  extractedAccountNumbers: string[];
  /** Addresses already extracted (for real estate) */
  extractedAddresses: string[];
}

// =============================================================================
// PIPELINE CLASS
// =============================================================================

export class Box3ExtractionPipeline {
  private factory: AIModelFactory;
  private onProgress?: (progress: PipelineProgress) => void;
  private readonly MODEL = 'gemini-3-flash-preview';
  private readonly CONCURRENCY = 3;

  // Default model config - BASE (without thinking level, set per-task)
  private readonly MODEL_CONFIG_BASE = {
    model: 'gemini-3-flash-preview',
    provider: 'google' as const,
    temperature: 0.0,
    topP: 0.95,
    topK: 40,
  };

  // EXTRACTION config: Low thinking = more output tokens for large JSON
  // Extraction is "find and format", not complex reasoning
  private readonly EXTRACTION_CONFIG = {
    ...this.MODEL_CONFIG_BASE,
    thinkingLevel: 'low' as const,
    maxOutputTokens: 65536,  // Max output for large extractions
  };

  // REASONING config: High thinking for validation/anomaly detection
  // Here we WANT the LLM to reason about plausibility
  private readonly REASONING_CONFIG = {
    ...this.MODEL_CONFIG_BASE,
    thinkingLevel: 'high' as const,
    maxOutputTokens: 8192,  // Smaller output, more thinking
  };

  // Batch threshold: split extraction if more than this many items
  private readonly BATCH_THRESHOLD = 12;

  // Vision-first mode by document type for better quality on scanned documents
  private readonly VISION_FIRST_BY_DOCTYPE: Record<string, 'text' | 'vision' | 'hybrid'> = {
    'aangifte_ib': 'text',
    'aanslag_definitief': 'text',
    'aanslag_voorlopig': 'text',
    'jaaropgave_bank': 'vision',      // Often scanned, tables matter
    'effectenoverzicht': 'vision',    // Complex tables, columns
    'woz_beschikking': 'hybrid',      // Text for address, vision for value
    'email_body': 'text',
    'overig': 'text',
  };

  // Feature flag for using new sub-stage extraction (can be toggled for A/B testing)
  private readonly USE_SUBSTAGE_EXTRACTION = true;

  // Legacy config reference (for backwards compatibility)
  private readonly MODEL_CONFIG = this.MODEL_CONFIG_BASE;

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

    // Log asset references for debugging
    logger.info('box3-pipeline', 'Asset references from tax authority', {
      bank_count: assetReferences.bank_count,
      bank_descriptions: assetReferences.bank_descriptions.slice(0, 5),
      investment_count: assetReferences.investment_count,
      real_estate_count: assetReferences.real_estate_count,
      real_estate_descriptions: assetReferences.real_estate_descriptions,
      other_assets_count: assetReferences.other_assets_count,
    });

    // =========================================================================
    // STAGE 3: Asset Category Extraction (SEQUENTIAL with exclusion IDs)
    // Ground Truth First: Each stage passes extracted IDs to next stage
    // Order: Bank → Investment → Real Estate → Other
    // =========================================================================
    this.reportProgress({
      step: 'assets',
      stepNumber: 3,
      totalSteps,
      message: 'Vermogensbestanddelen extraheren (sequentieel met exclusie)...'
    });

    const stage3Start = Date.now();

    // Build exclusion context that accumulates as we extract
    const exclusionContext: ExclusionContext = {
      extractedDescriptions: [],
      extractedAccountNumbers: [],
      extractedAddresses: [],
    };

    // 3a: Bank accounts FIRST (highest priority for bank-like items)
    this.reportProgress({
      step: 'assets',
      stepNumber: 3,
      totalSteps,
      message: 'Bankrekeningen extraheren (1/4)...',
      subProgress: { current: 1, total: 4, item: 'bank_savings' },
    });
    const bankResult = await this.extractBankAccounts(preparedDocs, assetReferences, debugPrompts, debugResponses, exclusionContext);

    // Add extracted bank accounts to exclusion list
    if (bankResult?.bank_savings) {
      for (const bank of bankResult.bank_savings) {
        if (bank.description) exclusionContext.extractedDescriptions.push(bank.description);
        if (bank.account_masked) exclusionContext.extractedAccountNumbers.push(bank.account_masked);
        if (bank.bank_name) exclusionContext.extractedDescriptions.push(bank.bank_name);
      }
    }

    // 3b: Investments SECOND
    this.reportProgress({
      step: 'assets',
      stepNumber: 3,
      totalSteps,
      message: 'Beleggingen extraheren (2/4)...',
      subProgress: { current: 2, total: 4, item: 'investments' },
    });
    const investmentResult = await this.extractInvestments(preparedDocs, assetReferences, debugPrompts, debugResponses, exclusionContext);

    // Add extracted investments to exclusion list
    if (investmentResult?.investments) {
      for (const inv of investmentResult.investments) {
        if (inv.description) exclusionContext.extractedDescriptions.push(inv.description);
        if (inv.account_masked) exclusionContext.extractedAccountNumbers.push(inv.account_masked);
        if (inv.institution) exclusionContext.extractedDescriptions.push(inv.institution);
      }
    }

    // 3c: Real Estate THIRD
    this.reportProgress({
      step: 'assets',
      stepNumber: 3,
      totalSteps,
      message: 'Onroerend goed extraheren (3/4)...',
      subProgress: { current: 3, total: 4, item: 'real_estate' },
    });
    const realEstateResult = await this.extractRealEstate(preparedDocs, assetReferences, debugPrompts, debugResponses, exclusionContext);

    // Add extracted real estate to exclusion list
    if (realEstateResult?.real_estate) {
      for (const re of realEstateResult.real_estate) {
        if (re.description) exclusionContext.extractedDescriptions.push(re.description);
        if (re.address) exclusionContext.extractedAddresses.push(re.address);
      }
    }

    // 3d: Other Assets LAST (catches everything else)
    this.reportProgress({
      step: 'assets',
      stepNumber: 3,
      totalSteps,
      message: 'Overige bezittingen extraheren (4/4)...',
      subProgress: { current: 4, total: 4, item: 'other_assets' },
    });
    const otherResult = await this.extractOtherAssets(preparedDocs, assetReferences, debugPrompts, debugResponses, exclusionContext);

    stageTimes['assets'] = Date.now() - stage3Start;

    // Collect extraction warnings
    if (bankResult?.extraction_notes.missing.length) {
      errors.push(`Ontbrekende bankrekeningen: ${bankResult.extraction_notes.missing.join(', ')}`);
    }
    if (bankResult?.extraction_notes.warnings?.length) {
      for (const warning of bankResult.extraction_notes.warnings) {
        errors.push(warning);
      }
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

    // Stage 5c: LLM-assisted anomaly detection (runs in parallel with rule-based checks conceptually)
    // Uses REASONING_CONFIG for high-quality analysis
    this.reportProgress({
      step: 'validation',
      stepNumber: 5,
      totalSteps,
      message: 'LLM anomalie detectie uitvoeren...',
      subProgress: { current: 2, total: 2, item: 'anomaly_detection' },
    });

    const anomalyChecks = await this.detectAnomaliesWithLLM(blueprint, debugPrompts, debugResponses);

    // Merge anomaly checks into validation
    validation.checks.push(...anomalyChecks);

    // Recalculate summary with anomaly checks included
    const passedCount = validation.checks.filter(c => c.passed).length;
    const warningCount = validation.checks.filter(c => !c.passed && c.severity === 'warning').length;
    const errorCount = validation.checks.filter(c => !c.passed && c.severity === 'error').length;
    validation.summary = {
      total_checks: validation.checks.length,
      passed: passedCount,
      warnings: warningCount,
      errors: errorCount,
    };
    validation.is_valid = errorCount === 0;

    stageTimes['validation'] = Date.now() - stage5Start;

    // Add validation errors/warnings to the errors list
    for (const check of validation.checks) {
      if (!check.passed && check.severity === 'error') {
        errors.push(check.message);
      }
    }

    // Store validation flags in blueprint (only failed checks for warnings UI)
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

    // Store ALL checks in audit_checks for audit trail (both passed and failed)
    blueprint.audit_checks = validation.checks.map((check, i) => ({
      id: `audit_${i}`,
      check_type: check.check_type,
      passed: check.passed,
      message: check.message,
      year: check.year,
      details: check.details ? {
        expected: check.details.expected,
        actual: check.details.actual,
        difference: check.details.difference,
      } : undefined,
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
      // Legacy compatibility
      fullPrompt: debugPrompts['tax_authority'] || Object.values(debugPrompts)[0] || '',
      rawAiResponse: debugResponses['tax_authority'] || Object.values(debugResponses)[0] || '',
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
          ...this.EXTRACTION_CONFIG,
          maxOutputTokens: 4096, // Small output for classification
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
  // STAGE 2: TAX AUTHORITY DATA EXTRACTION (with sub-stages for better quality)
  // ===========================================================================

  private async extractTaxAuthorityData(
    documents: PipelineDocument[],
    debugPrompts: Record<string, string>,
    debugResponses: Record<string, string>
  ): Promise<Box3TaxAuthorityExtractionResult | null> {
    // Use sub-stage extraction for better quality
    if (this.USE_SUBSTAGE_EXTRACTION) {
      return this.extractTaxAuthorityDataWithSubstages(documents, debugPrompts, debugResponses);
    }

    // Legacy single-prompt extraction (kept for backwards compatibility / A/B testing)
    return this.extractTaxAuthorityDataLegacy(documents, debugPrompts, debugResponses);
  }

  /**
   * NEW: Sub-stage extraction for better quality
   * Stage 2a: Fiscal Entity (persons only)
   * Stage 2b: Official Totals (numbers only)
   * Stage 2c: Asset Checklist (inventory only)
   */
  private async extractTaxAuthorityDataWithSubstages(
    documents: PipelineDocument[],
    debugPrompts: Record<string, string>,
    debugResponses: Record<string, string>
  ): Promise<Box3TaxAuthorityExtractionResult | null> {
    const docSections = documents.map((doc, i) => {
      if (doc.extractedText) {
        return `### Document ${i + 1}: ${doc.filename}\n\`\`\`\n${doc.extractedText}\n\`\`\``;
      }
      return `### Document ${i + 1}: ${doc.filename}\n(Zie bijgevoegde afbeelding/PDF)`;
    });

    const visionAttachments = documents
      .filter(doc => !doc.extractedText)
      .map(doc => ({
        mimeType: doc.mimeType,
        data: doc.fileData,
        filename: doc.filename,
      }));

    const visionOptions = visionAttachments.length > 0 ? { visionAttachments } : undefined;

    // =========================================================================
    // STAGE 2a: Fiscal Entity Extraction (persons only)
    // =========================================================================
    logger.info('box3-pipeline', 'Stage 2a: Extracting fiscal entity (persons)...');

    const personsPrompt = `${TAX_AUTHORITY_PERSONS_PROMPT}\n\n## DOCUMENTEN:\n${docSections.join('\n\n')}\n\nExtraheer nu ALLEEN de fiscale entiteit.`;
    debugPrompts['tax_authority_2a_persons'] = personsPrompt;

    let fiscalEntity: Box3FiscalEntity = {
      taxpayer: { id: 'tp_01', name: null, bsn_masked: null, date_of_birth: null },
      fiscal_partner: { has_partner: false },
    };

    try {
      const personsResult = await this.factory.callModel(
        { ...this.EXTRACTION_CONFIG, maxOutputTokens: 4096 },
        personsPrompt,
        visionOptions
      );
      debugResponses['tax_authority_2a_persons'] = personsResult.content;

      const personsJson = this.parseJSON(personsResult.content);
      if (personsJson?.fiscal_entity) {
        fiscalEntity = personsJson.fiscal_entity;
        logger.info('box3-pipeline', 'Stage 2a complete: Fiscal entity extracted', {
          hasPartner: fiscalEntity.fiscal_partner?.has_partner,
          taxpayerName: fiscalEntity.taxpayer?.name,
        });
      }
    } catch (err: any) {
      logger.error('box3-pipeline', 'Stage 2a failed', { error: err.message });
    }

    // =========================================================================
    // STAGE 2b: Official Totals Extraction (numbers only)
    // =========================================================================
    logger.info('box3-pipeline', 'Stage 2b: Extracting official totals...');

    const totalsPrompt = `${TAX_AUTHORITY_TOTALS_PROMPT}\n\n## DOCUMENTEN:\n${docSections.join('\n\n')}\n\nExtraheer nu ALLEEN de officiële Box 3 cijfers.`;
    debugPrompts['tax_authority_2b_totals'] = totalsPrompt;

    let taxAuthorityData: Record<string, Box3TaxAuthorityYearData> = {};

    try {
      const totalsResult = await this.factory.callModel(
        { ...this.EXTRACTION_CONFIG, maxOutputTokens: 8192 },
        totalsPrompt,
        visionOptions
      );
      debugResponses['tax_authority_2b_totals'] = totalsResult.content;

      const totalsJson = this.parseJSON(totalsResult.content);
      if (totalsJson?.tax_authority_data) {
        taxAuthorityData = this.normalizeTaxAuthorityData(totalsJson.tax_authority_data);

        // Log the critical values for debugging
        for (const [year, data] of Object.entries(taxAuthorityData)) {
          logger.info('box3-pipeline', `Stage 2b: ${year} totals extracted`, {
            totalAssets: data.household_totals?.total_assets_gross,
            deemedReturn: data.household_totals?.deemed_return,
            taxAssessed: data.household_totals?.total_tax_assessed,
            isFinal: (data as any).is_final_assessment,
          });
        }
      }
    } catch (err: any) {
      logger.error('box3-pipeline', 'Stage 2b failed', { error: err.message });
    }

    // =========================================================================
    // STAGE 2c: Asset Checklist Extraction (inventory only)
    // =========================================================================
    logger.info('box3-pipeline', 'Stage 2c: Extracting asset checklist...');

    const checklistPrompt = `${TAX_AUTHORITY_CHECKLIST_PROMPT}\n\n## DOCUMENTEN:\n${docSections.join('\n\n')}\n\nMaak nu een inventarisatie van alle vermogensbestanddelen.`;
    debugPrompts['tax_authority_2c_checklist'] = checklistPrompt;

    let assetReferences: Box3AssetReferences = {
      bank_count: 0,
      bank_descriptions: [],
      investment_count: 0,
      investment_descriptions: [],
      real_estate_count: 0,
      real_estate_descriptions: [],
      other_assets_count: 0,
      other_descriptions: [],
    };

    try {
      const checklistResult = await this.factory.callModel(
        { ...this.EXTRACTION_CONFIG, maxOutputTokens: 8192 },
        checklistPrompt,
        visionOptions
      );
      debugResponses['tax_authority_2c_checklist'] = checklistResult.content;

      const checklistJson = this.parseJSON(checklistResult.content);
      if (checklistJson?.asset_references) {
        assetReferences = {
          bank_count: checklistJson.asset_references.bank_count || 0,
          bank_descriptions: checklistJson.asset_references.bank_descriptions || [],
          investment_count: checklistJson.asset_references.investment_count || 0,
          investment_descriptions: checklistJson.asset_references.investment_descriptions || [],
          real_estate_count: checklistJson.asset_references.real_estate_count || 0,
          real_estate_descriptions: checklistJson.asset_references.real_estate_descriptions || [],
          other_assets_count: checklistJson.asset_references.other_assets_count || 0,
          other_descriptions: checklistJson.asset_references.other_descriptions || [],
          category_totals: checklistJson.category_totals || undefined,
        };

        logger.info('box3-pipeline', 'Stage 2c complete: Asset checklist extracted', {
          bankCount: assetReferences.bank_count,
          investmentCount: assetReferences.investment_count,
          realEstateCount: assetReferences.real_estate_count,
          hasGreenInvestments: checklistJson.extraction_notes?.has_green_investments,
        });
      }
    } catch (err: any) {
      logger.error('box3-pipeline', 'Stage 2c failed', { error: err.message });
    }

    // Combine all sub-stage results
    return {
      fiscal_entity: fiscalEntity,
      tax_authority_data: taxAuthorityData,
      asset_references: assetReferences,
    };
  }

  /**
   * LEGACY: Single-prompt extraction (kept for backwards compatibility)
   */
  private async extractTaxAuthorityDataLegacy(
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
          ...this.EXTRACTION_CONFIG,
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
            category_totals: json.category_totals || undefined,
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
    debugResponses: Record<string, string>,
    exclusionContext: ExclusionContext
  ): Promise<Box3BankExtractionResult | null> {
    // Bank is first, so no exclusions yet (empty context)
    // Try extraction, with vision retry if text-based extraction fails
    const result = await this.tryBankExtraction(documents, checklist, debugPrompts, debugResponses, false, exclusionContext);

    // If we found 0 accounts but expected some, retry with forced vision
    if (result && result.bank_savings.length === 0 && checklist.bank_count > 0) {
      logger.warn('box3-pipeline', 'Bank extraction found 0 accounts, retrying with vision...', {
        expectedCount: checklist.bank_count,
      });

      const retryResult = await this.tryBankExtraction(documents, checklist, debugPrompts, debugResponses, true, exclusionContext);
      if (retryResult && retryResult.bank_savings.length > 0) {
        logger.info('box3-pipeline', `Vision retry found ${retryResult.bank_savings.length} accounts`);
        return retryResult;
      }

      // Both attempts failed, return original result with warning
      result.extraction_notes.warnings.push(
        `Geen bankrekeningen gevonden na 2 pogingen (text + vision). Controleer de documenten handmatig.`
      );
    }

    return result;
  }

  private async tryBankExtraction(
    documents: PipelineDocument[],
    checklist: Box3AssetReferences,
    debugPrompts: Record<string, string>,
    debugResponses: Record<string, string>,
    forceVision: boolean,
    exclusionContext: ExclusionContext
  ): Promise<Box3BankExtractionResult | null> {
    const prompt = buildBankExtractionPrompt({
      bank_count: checklist.bank_count,
      bank_descriptions: checklist.bank_descriptions,
    });

    // Build exclusion instruction if we have items to exclude
    const exclusionInstruction = this.buildExclusionInstruction(exclusionContext, 'bankrekeningen');

    const debugKey = forceVision ? 'bank_extraction_vision_retry' : 'bank_extraction';

    // If forceVision, ignore extracted text and use vision for all PDFs
    const docSections = documents.map((doc, i) => {
      if (!forceVision && doc.extractedText) {
        return `### Document ${i + 1}: ${doc.filename}\n\`\`\`\n${doc.extractedText}\n\`\`\``;
      }
      return `### Document ${i + 1}: ${doc.filename}\n(Zie bijgevoegde afbeelding/PDF)`;
    });

    const fullPrompt = `${prompt}${exclusionInstruction}\n\n## DOCUMENTEN:\n${docSections.join('\n\n')}\n\nExtraheer nu ALLE bankrekeningen.`;
    debugPrompts[debugKey] = fullPrompt;

    // If forceVision, include ALL documents as vision attachments
    const visionAttachments = forceVision
      ? documents.map(doc => ({
          mimeType: doc.mimeType,
          data: doc.fileData,
          filename: doc.filename,
        }))
      : documents
          .filter(doc => !doc.extractedText)
          .map(doc => ({
            mimeType: doc.mimeType,
            data: doc.fileData,
            filename: doc.filename,
          }));

    try {
      // Use EXTRACTION_CONFIG with low thinking to maximize output tokens
      // High thinking uses ~30k tokens leaving insufficient room for 24+ bank accounts
      const result = await this.factory.callModel(
        {
          ...this.EXTRACTION_CONFIG,
          maxOutputTokens: 65536, // Max output for large bank extractions
        },
        fullPrompt,
        visionAttachments.length > 0 ? { visionAttachments } : undefined
      );

      debugResponses[debugKey] = result.content;
      const json = this.parseJSON(result.content);

      // Debug: Log what the AI returned
      logger.info('box3-pipeline', 'Bank extraction AI response', {
        responseLength: result.content.length,
        parsedSuccessfully: !!json,
        hasBankSavingsKey: json ? 'bank_savings' in json : false,
        bankSavingsLength: json?.bank_savings?.length ?? 'undefined',
        jsonKeys: json ? Object.keys(json) : [],
        first500Chars: result.content.substring(0, 500),
      });

      if (json) {
        const bankSavings = (json.bank_savings || []).map((bank: any, i: number) => ({
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
        }));

        const foundCount = bankSavings.length;
        const expectedCount = checklist.bank_count;
        const warnings: string[] = json.extraction_notes?.warnings || [];

        // Log warning if we found significantly fewer than expected
        if (expectedCount > 0 && foundCount < expectedCount) {
          const missingCount = expectedCount - foundCount;
          logger.warn('box3-pipeline', `Bank extraction found ${foundCount}/${expectedCount} accounts (${missingCount} missing)`, {
            expected: expectedCount,
            found: foundCount,
            expectedDescriptions: checklist.bank_descriptions,
            responseLength: result.content.length,
            usedVision: forceVision,
          });

          // Add warning to extraction notes
          if (foundCount === 0) {
            warnings.push(`Geen bankrekeningen geëxtraheerd terwijl ${expectedCount} verwacht.`);
          } else {
            warnings.push(`${missingCount} van ${expectedCount} bankrekeningen niet gevonden.`);
          }
        }

        return {
          bank_savings: bankSavings,
          extraction_notes: json.extraction_notes ? {
            ...json.extraction_notes,
            total_found: foundCount,
            expected_from_checklist: expectedCount,
            warnings,
          } : {
            total_found: foundCount,
            expected_from_checklist: expectedCount,
            missing: [],
            warnings,
          },
        };
      }
    } catch (err: any) {
      logger.error('box3-pipeline', 'Bank extraction failed', { error: err.message, usedVision: forceVision });
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
    debugResponses: Record<string, string>,
    exclusionContext: ExclusionContext
  ): Promise<Box3InvestmentExtractionResult | null> {
    const prompt = buildInvestmentExtractionPrompt({
      investment_count: checklist.investment_count,
      investment_descriptions: checklist.investment_descriptions,
    });

    // Build exclusion instruction for items already extracted as bank accounts
    const exclusionInstruction = this.buildExclusionInstruction(exclusionContext, 'beleggingen');

    const docSections = documents.map((doc, i) => {
      if (doc.extractedText) {
        return `### Document ${i + 1}: ${doc.filename}\n\`\`\`\n${doc.extractedText}\n\`\`\``;
      }
      return `### Document ${i + 1}: ${doc.filename}\n(Zie bijgevoegde afbeelding/PDF)`;
    });

    const fullPrompt = `${prompt}${exclusionInstruction}\n\n## DOCUMENTEN:\n${docSections.join('\n\n')}\n\nExtraheer nu ALLE beleggingen.`;
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
          ...this.EXTRACTION_CONFIG,
          maxOutputTokens: 32768, // Larger output for complex investment portfolios
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
    debugResponses: Record<string, string>,
    exclusionContext: ExclusionContext
  ): Promise<Box3RealEstateExtractionResult | null> {
    const prompt = buildRealEstateExtractionPrompt({
      real_estate_count: checklist.real_estate_count,
      real_estate_descriptions: checklist.real_estate_descriptions,
    });

    // Build exclusion instruction for items already extracted
    const exclusionInstruction = this.buildExclusionInstruction(exclusionContext, 'onroerend goed');

    const docSections = documents.map((doc, i) => {
      if (doc.extractedText) {
        return `### Document ${i + 1}: ${doc.filename}\n\`\`\`\n${doc.extractedText}\n\`\`\``;
      }
      return `### Document ${i + 1}: ${doc.filename}\n(Zie bijgevoegde afbeelding/PDF)`;
    });

    const fullPrompt = `${prompt}${exclusionInstruction}\n\n## DOCUMENTEN:\n${docSections.join('\n\n')}\n\nExtraheer nu ALLE onroerende zaken in Box 3.`;
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
          ...this.EXTRACTION_CONFIG,
          maxOutputTokens: 16384, // Real estate typically has fewer items
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
    debugResponses: Record<string, string>,
    exclusionContext: ExclusionContext
  ): Promise<Box3OtherAssetsExtractionResult | null> {
    const prompt = buildOtherAssetsExtractionPrompt({
      other_assets_count: checklist.other_assets_count,
      other_descriptions: checklist.other_descriptions,
    });

    // Build exclusion instruction for items already extracted in bank/investment/real estate
    const exclusionInstruction = this.buildExclusionInstruction(exclusionContext, 'overige bezittingen');

    const docSections = documents.map((doc, i) => {
      if (doc.extractedText) {
        return `### Document ${i + 1}: ${doc.filename}\n\`\`\`\n${doc.extractedText}\n\`\`\``;
      }
      return `### Document ${i + 1}: ${doc.filename}\n(Zie bijgevoegde afbeelding/PDF)`;
    });

    const fullPrompt = `${prompt}${exclusionInstruction}\n\n## DOCUMENTEN:\n${docSections.join('\n\n')}\n\nExtraheer nu ALLE overige bezittingen en schulden.`;
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
          ...this.EXTRACTION_CONFIG,
          maxOutputTokens: 16384, // Other assets + debts
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
    const taxYearsSet = new Set<string>();
    if (taxAuthorityResult?.tax_authority_data) {
      Object.keys(taxAuthorityResult.tax_authority_data).forEach(y => taxYearsSet.add(y));
    }
    const taxYears = Array.from(taxYearsSet);

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

    // Collect raw assets before processing
    let bank_savings = bankResult?.bank_savings || [];
    let investments = investmentResult?.investments || [];
    let real_estate = realEstateResult?.real_estate || [];
    let other_assets = otherResult?.other_assets || [];
    let debts = otherResult?.debts || [];

    // CREDITCARD WITH NEGATIVE BALANCE → Move to debts
    // A creditcard with negative balance (debt) should not be counted as an asset
    const { processedBankSavings, creditcardDebts } = this.extractCreditcardDebts(bank_savings, taxYears);
    bank_savings = processedBankSavings;
    debts = [...debts, ...creditcardDebts];

    if (creditcardDebts.length > 0) {
      logger.info('box3-pipeline', `Moved ${creditcardDebts.length} creditcard(s) with negative balance to debts`);
      for (const cc of creditcardDebts) {
        logger.info('box3-pipeline', `  - "${cc.description}" reclassified as debt (consumer_credit)`);
      }
    }

    // DEDUPLICATION: Remove assets that appear in multiple categories
    const deduped = this.deduplicateAssets(
      bank_savings,
      investments,
      real_estate,
      other_assets,
      taxYears
    );
    bank_savings = deduped.bank_savings;
    investments = deduped.investments;
    other_assets = deduped.other_assets;

    // Log removed duplicates
    if (deduped.removedDuplicates.length > 0) {
      logger.info('box3-pipeline', `Deduplication removed ${deduped.removedDuplicates.length} duplicate assets`);
      for (const dup of deduped.removedDuplicates) {
        logger.info('box3-pipeline', `  - "${dup.description}" removed from ${dup.removedFrom}, kept in ${dup.keptIn}`);
      }
    }

    // STUDIESCHULD EXCLUSION: Study loans do NOT count as deductible debt in Box 3
    // This is a hard rule - DUO loans etc. should never reduce the Box 3 base
    const { filteredDebts, excludedStudyLoans } = this.excludeStudyLoans(debts);
    debts = filteredDebts;

    if (excludedStudyLoans.length > 0) {
      logger.info('box3-pipeline', `Excluded ${excludedStudyLoans.length} study loan(s) from Box 3 debts`);
      for (const loan of excludedStudyLoans) {
        logger.info('box3-pipeline', `  - "${loan.description}" excluded (studieschuld telt niet mee in Box 3)`);
      }
    }

    const blueprint: Box3Blueprint = {
      schema_version: '2.0',
      source_documents_registry: sourceDocRegistry,
      fiscal_entity: taxAuthorityResult?.fiscal_entity || {
        taxpayer: { id: 'tp_01', name: null, bsn_masked: null, date_of_birth: null },
        fiscal_partner: { has_partner: false },
      },
      assets: {
        bank_savings,
        investments,
        real_estate,
        other_assets,
      },
      debts,
      tax_authority_data: taxAuthorityResult?.tax_authority_data || {},
      year_summaries: yearSummaries,
      validation_flags: [],
      manual_overrides: [],
    };

    // Calculate totals for each year
    this.calculateYearTotals(blueprint);

    return blueprint;
  }

  /**
   * Deduplicate assets that appear in multiple categories.
   *
   * Priority rules for category assignment:
   * 1. Pensioenrekening/Lijfrente → REMOVE ENTIRELY (Box 1, not Box 3)
   * 2. Creditcard with negative balance → Move to debts (not implemented here, handled separately)
   * 3. Effecten/Beleggingen/Aandelen → investments
   * 4. Spaarrekening/Bankrekening → bank_savings
   * 5. Everything else → other_assets (lowest priority)
   */
  private deduplicateAssets(
    bank_savings: Box3BankSavingsAsset[],
    investments: Box3InvestmentAsset[],
    real_estate: Box3RealEstateAsset[],
    other_assets: Box3OtherAsset[],
    years: string[]
  ): {
    bank_savings: Box3BankSavingsAsset[];
    investments: Box3InvestmentAsset[];
    other_assets: Box3OtherAsset[];
    removedDuplicates: Array<{ description: string; amount: number; removedFrom: string; keptIn: string }>;
  } {
    const removedDuplicates: Array<{ description: string; amount: number; removedFrom: string; keptIn: string }> = [];

    // Helper to normalize description for matching
    const normalize = (desc: string): string => {
      return (desc || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/rekening|spaar|savings|account/g, '');
    };

    // Helper to check if description indicates pension/lijfrente (should be excluded from Box 3)
    const isPensionOrLijfrente = (desc: string): boolean => {
      const d = (desc || '').toLowerCase();
      return d.includes('pensioen') ||
        d.includes('lijfrente') ||
        d.includes('pension') ||
        d.includes('oudedagsvoorziening');
    };

    // Helper to check if description indicates investments
    const isInvestmentType = (desc: string): boolean => {
      const d = (desc || '').toLowerCase();
      return d.includes('effect') ||
        d.includes('belegging') ||
        d.includes('aandeel') ||
        d.includes('obligatie') ||
        d.includes('fund') ||
        d.includes('etf') ||
        d.includes('binck') ||
        d.includes('degiro') ||
        d.includes('trading');
    };

    // Helper to check if description indicates bank account
    const isBankType = (desc: string): boolean => {
      const d = (desc || '').toLowerCase();
      return d.includes('spaar') ||
        d.includes('betaal') ||
        d.includes('rekening') ||
        d.includes('savings') ||
        d.includes('checking') ||
        d.includes('deposito');
    };

    // Build a map of all assets with their values per year
    interface AssetEntry {
      type: 'bank' | 'investment' | 'other';
      index: number;
      description: string;
      amounts: Record<string, number>; // year -> amount
    }

    const allAssets: AssetEntry[] = [];

    // Add bank_savings
    bank_savings.forEach((asset, index) => {
      const desc = asset.description || asset.bank_name || '';
      const amounts: Record<string, number> = {};
      for (const year of years) {
        amounts[year] = this.getAmount(asset.yearly_data?.[year]?.value_jan_1);
      }
      allAssets.push({ type: 'bank', index, description: desc, amounts });
    });

    // Add investments
    investments.forEach((asset, index) => {
      const desc = asset.description || asset.institution || '';
      const amounts: Record<string, number> = {};
      for (const year of years) {
        amounts[year] = this.getAmount(asset.yearly_data?.[year]?.value_jan_1);
      }
      allAssets.push({ type: 'investment', index, description: desc, amounts });
    });

    // Add other_assets
    other_assets.forEach((asset, index) => {
      const desc = asset.description || asset.type || '';
      const amounts: Record<string, number> = {};
      for (const year of years) {
        amounts[year] = this.getAmount(asset.yearly_data?.[year]?.value_jan_1);
      }
      allAssets.push({ type: 'other', index, description: desc, amounts });
    });

    // Indices to remove from each category (declared early for pension removal)
    const bankToRemove = new Set<number>();
    const investmentToRemove = new Set<number>();
    const otherToRemove = new Set<number>();

    // FIRST: Remove ALL pension/lijfrente assets (even if not duplicates)
    // These belong in Box 1, not Box 3
    for (const asset of allAssets) {
      if (isPensionOrLijfrente(asset.description)) {
        if (asset.type === 'bank') bankToRemove.add(asset.index);
        if (asset.type === 'investment') investmentToRemove.add(asset.index);
        if (asset.type === 'other') otherToRemove.add(asset.index);
        logger.info('box3-pipeline', `Excluded pension/lijfrente from Box 3: "${asset.description}" (standalone)`);
      }
    }

    // Find duplicates: same normalized description AND same amount in at least one year
    const duplicateGroups: AssetEntry[][] = [];
    const processed = new Set<number>();

    for (let i = 0; i < allAssets.length; i++) {
      if (processed.has(i)) continue;
      // Skip already removed pension assets
      const asset = allAssets[i];
      if ((asset.type === 'bank' && bankToRemove.has(asset.index)) ||
          (asset.type === 'investment' && investmentToRemove.has(asset.index)) ||
          (asset.type === 'other' && otherToRemove.has(asset.index))) {
        processed.add(i);
        continue;
      }

      const normalizedDesc = normalize(asset.description);
      const group: AssetEntry[] = [asset];
      processed.add(i);

      for (let j = i + 1; j < allAssets.length; j++) {
        if (processed.has(j)) continue;

        const other = allAssets[j];
        // Skip already removed pension assets
        if ((other.type === 'bank' && bankToRemove.has(other.index)) ||
            (other.type === 'investment' && investmentToRemove.has(other.index)) ||
            (other.type === 'other' && otherToRemove.has(other.index))) {
          continue;
        }

        const otherNormalized = normalize(other.description);

        // Check if descriptions are similar enough
        if (normalizedDesc !== otherNormalized) continue;

        // Check if amounts match in at least one year
        let amountsMatch = false;
        for (const year of years) {
          const amount1 = asset.amounts[year];
          const amount2 = other.amounts[year];
          if (amount1 > 0 && amount2 > 0 && Math.abs(amount1 - amount2) < 1) {
            amountsMatch = true;
            break;
          }
        }

        if (amountsMatch) {
          group.push(other);
          processed.add(j);
        }
      }

      if (group.length > 1) {
        duplicateGroups.push(group);
      }
    }

    // Process each duplicate group (pension/lijfrente already removed above)
    for (const group of duplicateGroups) {
      const desc = group[0].description;
      const amount = Object.values(group[0].amounts).find(a => a > 0) || 0;

      // Determine the best category for this asset
      let bestCategory: 'bank' | 'investment' | 'other';
      if (isInvestmentType(desc)) {
        bestCategory = 'investment';
      } else if (isBankType(desc)) {
        bestCategory = 'bank';
      } else {
        // Default: keep in the category it was originally extracted to
        // Priority: investment > bank > other
        if (group.some(a => a.type === 'investment')) {
          bestCategory = 'investment';
        } else if (group.some(a => a.type === 'bank')) {
          bestCategory = 'bank';
        } else {
          bestCategory = 'other';
        }
      }

      // Remove from all other categories
      for (const asset of group) {
        if (asset.type !== bestCategory) {
          if (asset.type === 'bank') bankToRemove.add(asset.index);
          if (asset.type === 'investment') investmentToRemove.add(asset.index);
          if (asset.type === 'other') otherToRemove.add(asset.index);

          removedDuplicates.push({
            description: desc,
            amount,
            removedFrom: asset.type === 'bank' ? 'bank_savings' : asset.type === 'investment' ? 'investments' : 'other_assets',
            keptIn: bestCategory === 'bank' ? 'bank_savings' : bestCategory === 'investment' ? 'investments' : 'other_assets',
          });
        }
      }
    }

    // Filter out removed assets
    const filteredBankSavings = bank_savings.filter((_, idx) => !bankToRemove.has(idx));
    const filteredInvestments = investments.filter((_, idx) => !investmentToRemove.has(idx));
    const filteredOtherAssets = other_assets.filter((_, idx) => !otherToRemove.has(idx));

    return {
      bank_savings: filteredBankSavings,
      investments: filteredInvestments,
      other_assets: filteredOtherAssets,
      removedDuplicates,
    };
  }

  /**
   * Extract creditcards with negative balance and convert them to debts.
   * Creditcards typically show negative balance when there's outstanding debt.
   * This should be counted as a debt (reducing Box 3 base), not as an asset.
   */
  private extractCreditcardDebts(
    bank_savings: Box3BankSavingsAsset[],
    years: string[]
  ): {
    processedBankSavings: Box3BankSavingsAsset[];
    creditcardDebts: Box3Debt[];
  } {
    const creditcardDebts: Box3Debt[] = [];
    const indicesToRemove = new Set<number>();

    // Helper to check if description indicates creditcard
    const isCreditcard = (desc: string): boolean => {
      const d = (desc || '').toLowerCase();
      return d.includes('credit') ||
        d.includes('creditcard') ||
        d.includes('visa') ||
        d.includes('mastercard') ||
        d.includes('american express') ||
        d.includes('amex');
    };

    bank_savings.forEach((asset, index) => {
      const desc = asset.description || asset.bank_name || '';
      if (!isCreditcard(desc)) return;

      // Check if any year has a negative balance
      let hasNegativeBalance = false;
      for (const year of years) {
        const value = this.getAmount(asset.yearly_data?.[year]?.value_jan_1);
        if (value < 0) {
          hasNegativeBalance = true;
          break;
        }
      }

      if (hasNegativeBalance) {
        indicesToRemove.add(index);

        // Convert to debt - use absolute value of the negative balance
        const yearlyDebtData: Box3Debt['yearly_data'] = {};
        for (const year of years) {
          const value = this.getAmount(asset.yearly_data?.[year]?.value_jan_1);
          // Debt amount = absolute value of negative balance
          yearlyDebtData[year] = {
            value_jan_1: { amount: Math.abs(value), source_type: 'calculation' },
          };
        }

        const debt: Box3Debt = {
          id: `debt_cc_${index}`,
          owner_id: asset.owner_id || 'tp_01',
          description: desc,
          lender: asset.bank_name || undefined,
          ownership_percentage: asset.ownership_percentage || 100,
          debt_type: 'consumer_credit',
          country: 'NL',
          yearly_data: yearlyDebtData,
        };

        creditcardDebts.push(debt);
      }
    });

    const processedBankSavings = bank_savings.filter((_, idx) => !indicesToRemove.has(idx));

    return { processedBankSavings, creditcardDebts };
  }

  /**
   * Exclude study loans (studieschuld) from Box 3 debts.
   * By Dutch tax law, study loans from DUO do NOT reduce the Box 3 tax base.
   * This is a hard fiscal rule that must be enforced in code.
   */
  private excludeStudyLoans(debts: Box3Debt[]): {
    filteredDebts: Box3Debt[];
    excludedStudyLoans: Box3Debt[];
  } {
    const isStudyLoan = (debt: Box3Debt): boolean => {
      const desc = (debt.description || '').toLowerCase();
      const debtType = (debt.debt_type || '').toLowerCase();
      const lender = (debt.lender || '').toLowerCase();

      return (
        desc.includes('studieschuld') ||
        desc.includes('studielening') ||
        desc.includes('duo') ||
        desc.includes('student loan') ||
        lender.includes('duo') ||
        lender.includes('dienst uitvoering onderwijs') ||
        debtType === 'study_loan'
      );
    };

    const filteredDebts: Box3Debt[] = [];
    const excludedStudyLoans: Box3Debt[] = [];

    for (const debt of debts) {
      if (isStudyLoan(debt)) {
        excludedStudyLoans.push(debt);
      } else {
        filteredDebts.push(debt);
      }
    }

    return { filteredDebts, excludedStudyLoans };
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
        severity: extractedBankCount < expectedBankCount ? 'warning' : 'info',
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

    // Check 5: Duplicate Detection (same name + same amount across categories)
    const duplicates = this.detectDuplicateAssets(blueprint, years);
    for (const dup of duplicates) {
      checks.push({
        check_type: 'duplicate_asset',
        year: dup.year,
        passed: false,
        severity: 'warning',
        message: `Mogelijke dubbele entry: "${dup.description}" (€${dup.amount}) gevonden in ${dup.categories.join(' en ')}`,
        details: {
          field: 'duplicate_detection',
          description: dup.description,
          amount: dup.amount,
          categories: dup.categories,
        },
      });
    }

    // =========================================================================
    // NEW FISCAL VALIDATION CHECKS (Tier 1)
    // =========================================================================

    // Check 6: KEW Exclusion (Kapitaalverzekering Eigen Woning = Box 1, NOT Box 3)
    for (const oa of blueprint.assets.other_assets || []) {
      const description = (oa.description || '').toLowerCase();
      const type = (oa.type || '').toLowerCase();

      // KEW indicators: "eigen woning", "kew", "kapitaalverzekering eigen"
      const isLikelyKEW =
        description.includes('eigen woning') ||
        description.includes('kew') ||
        (description.includes('kapitaalverzekering') && description.includes('eigen')) ||
        type === 'capital_insurance_kew';

      if (isLikelyKEW) {
        checks.push({
          check_type: 'kew_exclusion',
          passed: false,
          severity: 'error',
          message: `"${oa.description}" lijkt een KEW (Kapitaalverzekering Eigen Woning) - hoort in Box 1, niet Box 3!`,
          details: {
            field: `other_assets.${oa.id}`,
            asset_type: oa.type,
            suggestion: 'Verwijder uit Box 3 extractie',
          },
        });
      }
    }

    // Check 7: Lijfrente Exclusion (Lijfrente = Box 1, NOT Box 3)
    for (const oa of blueprint.assets.other_assets || []) {
      const description = (oa.description || '').toLowerCase();
      const type = (oa.type || '').toLowerCase();

      // Lijfrente indicators
      const isLikelyLijfrente =
        description.includes('lijfrente') ||
        description.includes('lijfrentepolis') ||
        type === 'periodic_benefits' ||
        type === 'lijfrente';

      if (isLikelyLijfrente) {
        checks.push({
          check_type: 'lijfrente_exclusion',
          passed: false,
          severity: 'error',
          message: `"${oa.description}" lijkt een lijfrente - hoort in Box 1, niet Box 3!`,
          details: {
            field: `other_assets.${oa.id}`,
            asset_type: oa.type,
            suggestion: 'Verwijder uit Box 3 extractie',
          },
        });
      }
    }

    // Check 8: Studieschuld Exclusion (Study loan is NOT deductible in Box 3)
    for (const debt of blueprint.debts || []) {
      const description = (debt.description || '').toLowerCase();
      const debtType = (debt.debt_type || '').toLowerCase();

      const isStudyLoan =
        description.includes('studieschuld') ||
        description.includes('studielening') ||
        description.includes('duo') ||
        debtType === 'study_loan';

      if (isStudyLoan) {
        checks.push({
          check_type: 'studieschuld_exclusion',
          passed: false,
          severity: 'warning',
          message: `"${debt.description}" is een studieschuld - telt NIET mee als schuld in Box 3!`,
          details: {
            field: `debts.${debt.id}`,
            debt_type: debt.debt_type,
            suggestion: 'Verwijder uit Box 3 schulden',
          },
        });
      }
    }

    // Check 9: Eigen Woning Exclusion (Primary residence = Box 1)
    for (const re of blueprint.assets.real_estate || []) {
      const description = (re.description || '').toLowerCase();
      const type = (re.type || '').toLowerCase();

      const isLikelyEigenWoning =
        description.includes('eigen woning') ||
        description.includes('hoofdverblijf') ||
        description.includes('primary residence') ||
        type === 'eigen_woning' ||
        type === 'primary_residence';

      if (isLikelyEigenWoning) {
        checks.push({
          check_type: 'eigen_woning_exclusion',
          passed: false,
          severity: 'error',
          message: `"${re.description}" lijkt de eigen woning (hoofdverblijf) - hoort in Box 1, niet Box 3!`,
          details: {
            field: `real_estate.${re.id}`,
            property_type: re.type,
            suggestion: 'Verwijder uit Box 3 extractie',
          },
        });
      }
    }

    // Check 10: Final Assessment Check (Claim only possible against definitieve aanslag)
    for (const year of years) {
      const taxData = blueprint.tax_authority_data[year];
      const isFinal = (taxData as any)?.is_final_assessment;
      const docType = taxData?.document_type;

      // Only add warning if we have a voorlopige aanslag (not just aangifte)
      if (docType === 'voorlopige_aanslag') {
        checks.push({
          check_type: 'final_assessment_only',
          year,
          passed: false,
          severity: 'warning',
          message: `${year}: Alleen een voorlopige aanslag gevonden - claim pas mogelijk na definitieve aanslag`,
          details: {
            field: 'document_type',
            document_type: docType,
            is_final: isFinal,
            suggestion: 'Wacht op definitieve aanslag of vraag kopie op bij Belastingdienst',
          },
        });
      } else if (isFinal === false && docType === 'definitieve_aanslag') {
        // This shouldn't happen often, but flag if document is marked as definitieve but isFinal is false
        checks.push({
          check_type: 'final_assessment_only',
          year,
          passed: false,
          severity: 'warning',
          message: `${year}: Aanslag is gemarkeerd als niet-definitief`,
          details: {
            field: 'is_final_assessment',
            is_final: isFinal,
          },
        });
      }
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
  // STAGE 5c: LLM-ASSISTED ANOMALY DETECTION (NEW)
  // ===========================================================================

  /**
   * Use LLM to detect anomalies that rule-based checks might miss.
   * This uses REASONING_CONFIG (high thinking) for better analysis.
   */
  private async detectAnomaliesWithLLM(
    blueprint: Box3Blueprint,
    debugPrompts: Record<string, string>,
    debugResponses: Record<string, string>
  ): Promise<Box3ValidationCheck[]> {
    const anomalyChecks: Box3ValidationCheck[] = [];

    // Prepare a summary of the extraction for the LLM
    const extractionSummary = {
      fiscal_entity: blueprint.fiscal_entity,
      tax_years: Object.keys(blueprint.tax_authority_data),
      bank_accounts: blueprint.assets.bank_savings.map(b => ({
        id: b.id,
        description: b.description,
        bank_name: b.bank_name,
        is_green: b.is_green_investment,
        yearly_data: b.yearly_data,
      })),
      investments: blueprint.assets.investments.map(i => ({
        id: i.id,
        description: i.description,
        institution: i.institution,
        type: i.type,
        yearly_data: i.yearly_data,
      })),
      real_estate: blueprint.assets.real_estate.map(r => ({
        id: r.id,
        description: r.description,
        address: r.address,
        type: r.type,
        yearly_data: r.yearly_data,
      })),
      other_assets: blueprint.assets.other_assets.map(o => ({
        id: o.id,
        description: o.description,
        type: o.type,
        yearly_data: o.yearly_data,
      })),
      debts: blueprint.debts?.map(d => ({
        id: d.id,
        description: d.description,
        debt_type: d.debt_type,
        yearly_data: d.yearly_data,
      })) || [],
      tax_authority_totals: Object.fromEntries(
        Object.entries(blueprint.tax_authority_data).map(([year, data]) => [
          year,
          {
            total_assets: data.household_totals?.total_assets_gross,
            tax_assessed: data.household_totals?.total_tax_assessed,
            deemed_return: data.household_totals?.deemed_return,
          },
        ])
      ),
    };

    const prompt = ANOMALY_DETECTION_PROMPT.replace(
      '{EXTRACTED_DATA}',
      JSON.stringify(extractionSummary, null, 2)
    );

    debugPrompts['anomaly_detection'] = prompt;

    try {
      logger.info('box3-pipeline', 'Stage 5c: Running LLM anomaly detection...');

      const result = await this.factory.callModel(
        {
          ...this.REASONING_CONFIG, // High thinking for better analysis
        },
        prompt
      );

      debugResponses['anomaly_detection'] = result.content;
      const json = this.parseJSON(result.content);

      if (json?.anomalies && Array.isArray(json.anomalies)) {
        for (const anomaly of json.anomalies) {
          anomalyChecks.push({
            check_type: 'anomaly_detected',
            passed: false,
            severity: anomaly.severity === 'error' ? 'error' : 'warning',
            message: anomaly.message || 'Onbekende anomalie',
            details: {
              field: anomaly.asset_id || 'general',
              anomaly_type: anomaly.type,
              suggestion: anomaly.suggestion,
            },
          });
        }

        logger.info('box3-pipeline', 'Stage 5c complete: Anomaly detection finished', {
          anomaliesFound: anomalyChecks.length,
          overallQuality: json.overall_quality,
          confidence: json.confidence,
        });
      }
    } catch (err: any) {
      logger.error('box3-pipeline', 'Stage 5c failed: Anomaly detection error', {
        error: err.message,
      });
      // Don't fail the pipeline if anomaly detection fails - it's supplementary
    }

    return anomalyChecks;
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Sum all assets for a given year.
   *
   * IMPORTANT: For validation against the aangifte (household total), we sum
   * the FULL amounts without applying ownership_percentage. The aangifte shows
   * household totals, not per-person amounts. ownership_percentage is only
   * relevant for calculating per-person allocation, not household totals.
   */
  private sumAllAssets(blueprint: Box3Blueprint, year: string): number {
    let total = 0;

    // Bank savings - full amount (aangifte shows household total)
    for (const bank of blueprint.assets.bank_savings || []) {
      const value = this.getAmount(bank.yearly_data?.[year]?.value_jan_1);
      total += value;
    }

    // Investments - full amount
    for (const inv of blueprint.assets.investments || []) {
      const value = this.getAmount(inv.yearly_data?.[year]?.value_jan_1);
      total += value;
    }

    // Real estate - full amount (apply ownership only for external co-owners)
    for (const re of blueprint.assets.real_estate || []) {
      const value = this.getAmount(re.yearly_data?.[year]?.woz_value);
      // Only apply ownership_percentage if explicitly set to something other than
      // 50 or 100 (indicating external co-ownership, not fiscal partner split)
      const ownershipPct = re.ownership_percentage || 100;
      const isExternalCoOwnership = ownershipPct !== 50 && ownershipPct !== 100;
      total += isExternalCoOwnership ? value * (ownershipPct / 100) : value;
    }

    // Other assets - full amount
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

  /**
   * Detect potential duplicate assets across categories.
   * Duplicates are identified by similar description AND same amount for a given year.
   * This catches cases where e.g. BinckBank is extracted as both bank_savings and investments.
   */
  private detectDuplicateAssets(
    blueprint: Box3Blueprint,
    years: string[]
  ): Array<{ year: string; description: string; amount: number; categories: string[] }> {
    const duplicates: Array<{ year: string; description: string; amount: number; categories: string[] }> = [];

    for (const year of years) {
      // Build a map of all assets: key = normalized description + amount, value = categories found
      const assetMap = new Map<string, { description: string; amount: number; categories: string[] }>();

      // Helper to normalize description for matching
      const normalize = (desc: string): string => {
        return (desc || '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '') // Remove special chars
          .replace(/rekening|spaar|savings|account/g, ''); // Remove common suffixes
      };

      // Helper to add asset to map
      const addAsset = (description: string, amount: number, category: string) => {
        if (amount <= 0) return; // Skip zero/negative amounts

        const key = `${normalize(description)}_${amount}`;
        const existing = assetMap.get(key);

        if (existing) {
          if (!existing.categories.includes(category)) {
            existing.categories.push(category);
          }
        } else {
          assetMap.set(key, { description, amount, categories: [category] });
        }
      };

      // Collect all bank_savings
      for (const bank of blueprint.assets.bank_savings || []) {
        const desc = bank.description || bank.bank_name || 'Onbekend';
        const amount = this.getAmount(bank.yearly_data?.[year]?.value_jan_1);
        addAsset(desc, amount, 'bank_savings');
      }

      // Collect all investments
      for (const inv of blueprint.assets.investments || []) {
        const desc = inv.description || inv.institution || 'Onbekend';
        const amount = this.getAmount(inv.yearly_data?.[year]?.value_jan_1);
        addAsset(desc, amount, 'investments');
      }

      // Collect all other_assets
      for (const oa of blueprint.assets.other_assets || []) {
        const desc = oa.description || oa.type || 'Onbekend';
        const amount = this.getAmount(oa.yearly_data?.[year]?.value_jan_1);
        addAsset(desc, amount, 'other_assets');
      }

      // Find entries that appear in multiple categories
      Array.from(assetMap.values()).forEach((entry) => {
        if (entry.categories.length > 1) {
          duplicates.push({
            year,
            description: entry.description,
            amount: entry.amount,
            categories: entry.categories,
          });
        }
      });
    }

    return duplicates;
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

      // Bank interest - full household amount (ownership_percentage is for partner allocation, not value)
      for (const bank of blueprint.assets?.bank_savings || []) {
        const yearData = bank.yearly_data?.[year];
        if (yearData) {
          totalBankInterest += this.getAmount(yearData.interest_received);
        }
      }

      // Investment dividends & gains - full household amount
      for (const inv of blueprint.assets?.investments || []) {
        const yearData = inv.yearly_data?.[year];
        if (yearData) {
          totalDividends += this.getAmount(yearData.dividend_received);
          totalInvestmentGain += this.getAmount(yearData.realized_gains);
        }
      }

      // Rental income - full household amount
      for (const re of blueprint.assets?.real_estate || []) {
        const yearData = re.yearly_data?.[year];
        if (yearData) {
          const rentalGross = this.getAmount(yearData.rental_income_gross);
          const costs = this.getAmount(yearData.maintenance_costs) +
            this.getAmount(yearData.property_tax) +
            this.getAmount(yearData.insurance) +
            this.getAmount(yearData.other_costs);
          totalRentalIncomeNet += rentalGross - costs;
        }
      }

      // Debt interest - full household amount
      for (const debt of blueprint.debts || []) {
        const yearData = debt.yearly_data?.[year];
        if (yearData) {
          totalDebtInterestPaid += this.getAmount(yearData.interest_paid);
        }
      }

      const actualReturnTotal = totalBankInterest + totalDividends + totalInvestmentGain + totalRentalIncomeNet - totalDebtInterestPaid;

      // Get deemed return from tax authority
      const deemedReturn = taxData.household_totals?.deemed_return || 0;
      const box3TaxPaid = taxData.household_totals?.total_tax_assessed || 0;

      // Tax rate per year (from constants, fallback to 31% for older years)
      const taxRate = BOX3_CONSTANTS.TAX_RATES[year] ?? 0.31;

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

      // =========================================================================
      // DETERMINE MISSING ITEMS
      // =========================================================================
      const missingItems: Box3MissingItem[] = [];

      // Count assets per category for this year
      const bankCount = (blueprint.assets?.bank_savings || []).filter(b => b.yearly_data?.[year]).length;
      const invCount = (blueprint.assets?.investments || []).filter(i => i.yearly_data?.[year]).length;
      const reCount = (blueprint.assets?.real_estate || []).filter(r => r.yearly_data?.[year]).length;

      // Check bank interest - if we have banks but no interest data
      if (bankCount > 0 && totalBankInterest === 0) {
        missingItems.push({
          field: 'bank_interest',
          description: `Jaaropgave(s) bank ${year} met ontvangen rente`,
          severity: 'high',
          action: 'ask_client',
        });
      }

      // Check dividends - if we have investments but no dividend data
      if (invCount > 0 && totalDividends === 0) {
        missingItems.push({
          field: 'dividends',
          description: `Jaaroverzicht beleggingen ${year} met ontvangen dividend`,
          severity: 'high',
          action: 'ask_client',
        });
      }

      // Check realized gains - if we have investments but no realized gains data
      if (invCount > 0 && totalInvestmentGain === 0) {
        missingItems.push({
          field: 'realized_gains',
          description: `Transactieoverzicht ${year} met gerealiseerde koerswinst`,
          severity: 'medium',
          action: 'ask_client',
        });
      }

      // Check rental income - if we have real estate but no rental income data
      if (reCount > 0 && totalRentalIncomeNet === 0) {
        missingItems.push({
          field: 'rental_income',
          description: `Huurinkomsten overzicht ${year} (bruto ontvangsten en kosten)`,
          severity: 'high',
          action: 'ask_client',
        });
      }

      // Determine status based on missing items
      const hasMissingData = missingItems.length > 0;
      const yearStatus = hasMissingData
        ? 'incomplete'
        : indicativeRefund > 0
          ? 'complete'
          : 'ready_for_calculation';

      // Update year summary
      if (!blueprint.year_summaries[year]) {
        blueprint.year_summaries[year] = {
          status: yearStatus,
          completeness: {
            bank_savings: bankCount > 0 && totalBankInterest === 0 ? 'incomplete' : bankCount > 0 ? 'complete' : 'not_applicable',
            investments: invCount > 0 && (totalDividends === 0 && totalInvestmentGain === 0) ? 'incomplete' : invCount > 0 ? 'complete' : 'not_applicable',
            real_estate: reCount > 0 && totalRentalIncomeNet === 0 ? 'incomplete' : reCount > 0 ? 'complete' : 'not_applicable',
            debts: 'not_applicable',
            tax_return: taxData ? 'complete' : 'incomplete',
          },
          missing_items: missingItems,
        };
      } else {
        blueprint.year_summaries[year].status = yearStatus;
        blueprint.year_summaries[year].missing_items = missingItems;
        blueprint.year_summaries[year].completeness = {
          bank_savings: bankCount > 0 && totalBankInterest === 0 ? 'incomplete' : bankCount > 0 ? 'complete' : 'not_applicable',
          investments: invCount > 0 && (totalDividends === 0 && totalInvestmentGain === 0) ? 'incomplete' : invCount > 0 ? 'complete' : 'not_applicable',
          real_estate: reCount > 0 && totalRentalIncomeNet === 0 ? 'incomplete' : reCount > 0 ? 'complete' : 'not_applicable',
          debts: 'not_applicable',
          tax_return: taxData ? 'complete' : 'incomplete',
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
      // Note: status is already set above based on missing_items
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

  /**
   * Build an exclusion instruction for the extraction prompt.
   * This tells the LLM not to extract items that were already captured in earlier stages.
   *
   * This is a CRITICAL component of the "Ground Truth First" architecture:
   * - Each extraction stage runs AFTER the previous one completes
   * - The exclusion list contains descriptions/account numbers from earlier stages
   * - The LLM is instructed to SKIP any items matching the exclusion list
   *
   * Example: If bank extraction found "ASN Spaarrekening ****1234", the investment
   * extraction should NOT extract this same account again.
   */
  private buildExclusionInstruction(context: ExclusionContext, categoryName: string): string {
    const hasExclusions =
      context.extractedDescriptions.length > 0 ||
      context.extractedAccountNumbers.length > 0 ||
      context.extractedAddresses.length > 0;

    if (!hasExclusions) {
      return ''; // No exclusions yet (first stage)
    }

    const parts: string[] = [];

    parts.push(`\n\n## ⚠️ EXCLUSIE-LIJST - NIET EXTRAHEREN`);
    parts.push(`De volgende items zijn REEDS geëxtraheerd in eerdere categorieën.`);
    parts.push(`SLAAG DEZE OVER bij het extraheren van ${categoryName}!`);
    parts.push(``);

    if (context.extractedDescriptions.length > 0) {
      parts.push(`### Beschrijvingen (al geëxtraheerd):`);
      // Deduplicate and limit to prevent prompt bloat
      const uniqueDescs = Array.from(new Set(context.extractedDescriptions)).slice(0, 50);
      for (const desc of uniqueDescs) {
        parts.push(`- "${desc}"`);
      }
      parts.push(``);
    }

    if (context.extractedAccountNumbers.length > 0) {
      parts.push(`### Rekeningnummers (al geëxtraheerd):`);
      const uniqueAccounts = Array.from(new Set(context.extractedAccountNumbers)).slice(0, 50);
      for (const acc of uniqueAccounts) {
        parts.push(`- ${acc}`);
      }
      parts.push(``);
    }

    if (context.extractedAddresses.length > 0) {
      parts.push(`### Adressen (al geëxtraheerd):`);
      const uniqueAddrs = Array.from(new Set(context.extractedAddresses)).slice(0, 20);
      for (const addr of uniqueAddrs) {
        parts.push(`- ${addr}`);
      }
      parts.push(``);
    }

    parts.push(`Als je een item tegenkomt dat overeenkomt met bovenstaande, SKIP dit item volledig.`);

    return parts.join('\n');
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
          bank_accounts: classification.asset_hints.bank_accounts.map(b => ({
            account_last4: b.account_last4 || '',
            bank_name: b.bank_name,
            iban_pattern: undefined,
          })),
          real_estate: classification.asset_hints.properties.map(p => ({
            address: p.address || '',
            postcode: p.postcode,
          })),
          investments: classification.asset_hints.investments.map(i => ({
            account_number: '',
            institution: i.institution || '',
          })),
        },
      },
      rawResponse: debugResponses['classification_0'] || '',
    };
  }

  /**
   * Legacy support: Extract multiple documents (for incremental merge)
   */
  async extractMultipleDocuments(
    documents: PipelineDocument[]
  ): Promise<Array<{ extraction: Box3DocumentExtraction; rawResponse: string; error?: string }>> {
    const results: Array<{ extraction: Box3DocumentExtraction; rawResponse: string; error?: string }> = [];

    for (let i = 0; i < documents.length; i += this.CONCURRENCY) {
      const batch = documents.slice(i, i + this.CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(doc => this.extractSingleDocument(doc))
      );
      results.push(...batchResults);
    }

    return results;
  }
}
