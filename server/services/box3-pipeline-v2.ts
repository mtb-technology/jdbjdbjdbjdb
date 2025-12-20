/**
 * Box 3 Extraction Pipeline V2 - Aangifte-First Architecture
 *
 * A simplified 3-stage pipeline that uses the aangifte as the single source of truth.
 *
 * Stages:
 * 1. Manifest Extraction - Extract complete asset manifest from aangifte (1 LLM call)
 * 2. Enrichment - Match source documents and extract actual returns (1 LLM call)
 * 3. Validation & Calculation - Verify and calculate (deterministic + optional LLM)
 *
 * Key principles:
 * - The aangifte determines classification (no reclassification)
 * - No deduplication needed (manifest is unique)
 * - Source documents only for actual return data (rente, dividend)
 */

import { AIModelFactory } from './ai-models/ai-model-factory';
import { logger } from './logger';
import { extractPdfTextFromBase64, hasUsableText } from './pdf-text-extractor';
import {
  buildManifestExtractionPrompt,
  buildEnrichmentPrompt,
  ANOMALY_DETECTION_PROMPT_V2,
} from './box3-prompts-v2';
import type {
  Box3Manifest,
  Box3EnrichedManifest,
  ManifestBankItem,
  ManifestInvestmentItem,
  ManifestOtherItem,
  ManifestDebtItem,
  ManifestValidationResult,
  ActualReturnCalculation,
} from '@shared/schema/box3-manifest';
import type {
  Box3Blueprint,
  Box3BankSavingsAsset,
  Box3InvestmentAsset,
  Box3OtherAsset,
  Box3Debt,
  Box3ValidationResult,
  Box3FiscalEntity,
  Box3TaxAuthorityYearData,
  Box3YearSummary,
  Box3CalculatedTotals,
  Box3ValidationFlag,
} from '@shared/schema/box3';
import { BOX3_CONSTANTS } from '@shared/constants';

// =============================================================================
// TYPES
// =============================================================================

export interface PipelineV2Document {
  id: string;
  filename: string;
  mimeType: string;
  fileData: string; // base64
  extractedText?: string;
  docType?: string; // After classification
}

export interface PipelineV2Progress {
  stage: 'preparing' | 'manifest' | 'enrichment' | 'validation' | 'complete';
  stageNumber: number;
  totalStages: number;
  message: string;
  percentage: number;
}

export interface PipelineV2Result {
  success: boolean;
  manifest: Box3Manifest;
  enrichedManifest?: Box3EnrichedManifest;
  blueprint: Box3Blueprint; // Converted for backwards compatibility
  actualReturns?: ActualReturnCalculation;
  validation: ManifestValidationResult;
  errors: string[];
  warnings: string[];
  timing: {
    total_ms: number;
    stage_times: Record<string, number>;
  };
  // Debug
  debugPrompts?: Record<string, string>;
  debugResponses?: Record<string, string>;
}

// =============================================================================
// PIPELINE V2 CLASS
// =============================================================================

export class Box3PipelineV2 {
  private factory: AIModelFactory;
  private onProgress?: (progress: PipelineV2Progress) => void;

  // Model configuration - using Flash for speed, Pro not needed for reading aangifte
  private readonly MODEL_CONFIG = {
    model: 'gemini-3-flash-preview',
    provider: 'google' as const,
    temperature: 0.0,
    topP: 0.95,
    topK: 40,
    thinkingLevel: 'low' as const,
    maxOutputTokens: 65536, // Large output for complete manifest
    useGrounding: false,
  };

  constructor(onProgress?: (progress: PipelineV2Progress) => void) {
    this.factory = AIModelFactory.getInstance();
    this.onProgress = onProgress;
  }

  private reportProgress(progress: PipelineV2Progress): void {
    if (this.onProgress) {
      this.onProgress(progress);
    }
    logger.info('box3-pipeline-v2', `Stage ${progress.stageNumber}/${progress.totalStages}: ${progress.message}`);
  }

  // ===========================================================================
  // MAIN ENTRY POINT
  // ===========================================================================

  async run(documents: PipelineV2Document[], emailText?: string | null): Promise<PipelineV2Result> {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];
    const stageTimes: Record<string, number> = {};
    const debugPrompts: Record<string, string> = {};
    const debugResponses: Record<string, string> = {};

    try {
      // =========================================================================
      // STAGE 0: Prepare documents (extract text)
      // =========================================================================
      this.reportProgress({
        stage: 'preparing',
        stageNumber: 0,
        totalStages: 3,
        message: 'Documenten voorbereiden...',
        percentage: 5,
      });

      const stageStart = Date.now();
      const preparedDocs = await this.prepareDocuments(documents);
      stageTimes['prepare'] = Date.now() - stageStart;

      // Classify documents to find aangifte
      const classifiedDocs = this.classifyDocuments(preparedDocs);
      const aangifteDocs = classifiedDocs.filter(
        (d) => d.docType === 'aangifte_ib' || d.docType === 'definitieve_aanslag' || d.docType === 'voorlopige_aanslag'
      );

      if (aangifteDocs.length === 0) {
        throw new Error(
          'Geen aangifte of aanslag gevonden. Pipeline V2 vereist een aangifte IB of definitieve aanslag.'
        );
      }

      // =========================================================================
      // STAGE 1: Manifest Extraction
      // =========================================================================
      this.reportProgress({
        stage: 'manifest',
        stageNumber: 1,
        totalStages: 3,
        message: 'Box 3 manifest extraheren uit aangifte...',
        percentage: 20,
      });

      const stage1Start = Date.now();
      const manifestPrompt = buildManifestExtractionPrompt(
        classifiedDocs.map((d) => ({
          doc_id: d.id,
          doc_type: d.docType || 'overig',
          content: d.extractedText || '',
        }))
      );
      debugPrompts['manifest'] = manifestPrompt;

      const manifestResponse = await this.callModel(manifestPrompt);
      debugResponses['manifest'] = manifestResponse;

      const manifest = this.parseManifestResponse(manifestResponse);
      stageTimes['manifest'] = Date.now() - stage1Start;

      // Validate manifest totals
      const manifestValidation = this.validateManifestTotals(manifest);
      if (!manifestValidation.is_valid) {
        warnings.push(
          `Manifest totalen wijken af: ${manifestValidation.percentage_difference.toFixed(1)}% verschil`
        );
      }

      // =========================================================================
      // STAGE 2: Enrichment (optional - if source documents OR email context exist)
      // =========================================================================
      const sourceDocs = classifiedDocs.filter(
        (d) => d.docType !== 'aangifte_ib' && d.docType !== 'definitieve_aanslag' && d.docType !== 'voorlopige_aanslag'
      );

      let enrichedManifest: Box3EnrichedManifest | undefined;
      const hasEmailContext = emailText && emailText.trim().length > 0;

      if (sourceDocs.length > 0 || hasEmailContext) {
        const contextSources: string[] = [];
        if (sourceDocs.length > 0) contextSources.push(`${sourceDocs.length} brondocumenten`);
        if (hasEmailContext) contextSources.push('klant email/context');

        this.reportProgress({
          stage: 'enrichment',
          stageNumber: 2,
          totalStages: 3,
          message: `Werkelijk rendement extraheren uit ${contextSources.join(' en ')}...`,
          percentage: 50,
        });

        const stage2Start = Date.now();
        const enrichmentPrompt = buildEnrichmentPrompt(
          manifest,
          sourceDocs.map((d) => ({
            doc_id: d.id,
            doc_type: d.docType || 'overig',
            content: d.extractedText || '',
          })),
          emailText
        );

        if (enrichmentPrompt) {
          debugPrompts['enrichment'] = enrichmentPrompt;
          const enrichmentResponse = await this.callModel(enrichmentPrompt);
          debugResponses['enrichment'] = enrichmentResponse;

          enrichedManifest = this.applyEnrichment(manifest, enrichmentResponse);
        }
        stageTimes['enrichment'] = Date.now() - stage2Start;
      } else {
        warnings.push('Geen brondocumenten (jaaroverzichten) of klant context gevonden. Alleen aangifte data beschikbaar.');
      }

      // =========================================================================
      // STAGE 3: Validation & Calculation
      // =========================================================================
      this.reportProgress({
        stage: 'validation',
        stageNumber: 3,
        totalStages: 3,
        message: 'Valideren en berekenen...',
        percentage: 80,
      });

      const stage3Start = Date.now();

      // Calculate actual returns if we have enrichment data
      let actualReturns: ActualReturnCalculation | undefined;
      if (enrichedManifest) {
        actualReturns = this.calculateActualReturns(enrichedManifest);
      }

      // Final validation
      const validation = this.validateManifestTotals(manifest);
      stageTimes['validation'] = Date.now() - stage3Start;

      // =========================================================================
      // Convert to Blueprint for backwards compatibility
      // =========================================================================
      const blueprint = this.manifestToBlueprint(enrichedManifest || manifest, warnings, validation);

      // =========================================================================
      // Complete
      // =========================================================================
      this.reportProgress({
        stage: 'complete',
        stageNumber: 3,
        totalStages: 3,
        message: 'Pipeline V2 voltooid',
        percentage: 100,
      });

      const totalTime = Date.now() - startTime;
      logger.info('box3-pipeline-v2', `Pipeline V2 completed in ${totalTime}ms`, {
        stages: Object.keys(stageTimes).length,
        errors: errors.length,
        warnings: warnings.length,
      });

      return {
        success: true,
        manifest,
        enrichedManifest,
        blueprint,
        actualReturns,
        validation,
        errors,
        warnings,
        timing: {
          total_ms: totalTime,
          stage_times: stageTimes,
        },
        debugPrompts,
        debugResponses,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('box3-pipeline-v2', `Pipeline V2 failed: ${errorMessage}`);
      errors.push(errorMessage);

      // Return minimal result on error
      return {
        success: false,
        manifest: this.createEmptyManifest(),
        blueprint: this.createEmptyBlueprint(),
        validation: {
          is_valid: false,
          total_difference: 0,
          percentage_difference: 0,
          per_category: {
            bank_savings: { expected_count: 0, extracted_count: 0, expected_total: 0, extracted_total: 0, difference: 0, is_match: false },
            investments: { expected_count: 0, extracted_count: 0, expected_total: 0, extracted_total: 0, difference: 0, is_match: false },
            other_assets: { expected_count: 0, extracted_count: 0, expected_total: 0, extracted_total: 0, difference: 0, is_match: false },
            debts: { expected_count: 0, extracted_count: 0, expected_total: 0, extracted_total: 0, difference: 0, is_match: false },
          },
          warnings: [],
          errors: [errorMessage],
        },
        errors,
        warnings,
        timing: {
          total_ms: Date.now() - startTime,
          stage_times: stageTimes,
        },
        debugPrompts,
        debugResponses,
      };
    }
  }

  // ===========================================================================
  // DOCUMENT PREPARATION
  // ===========================================================================

  private async prepareDocuments(documents: PipelineV2Document[]): Promise<PipelineV2Document[]> {
    const prepared: PipelineV2Document[] = [];

    for (const doc of documents) {
      try {
        if (doc.mimeType === 'application/pdf') {
          const result = await extractPdfTextFromBase64(doc.fileData);
          if (hasUsableText(result)) {
            prepared.push({
              ...doc,
              extractedText: result.text,
            });
          } else {
            // Fallback: include without text (will use vision if needed)
            prepared.push(doc);
          }
        } else {
          // Non-PDF (images, etc.)
          prepared.push(doc);
        }
      } catch (error) {
        logger.warn('box3-pipeline-v2', `Failed to extract text from ${doc.filename}: ${error}`);
        prepared.push(doc);
      }
    }

    return prepared;
  }

  private classifyDocuments(documents: PipelineV2Document[]): PipelineV2Document[] {
    // Simple heuristic classification based on filename and content
    return documents.map((doc) => {
      const filename = doc.filename.toLowerCase();
      const text = (doc.extractedText || '').toLowerCase();

      let docType = 'overig';

      if (
        filename.includes('aangifte') ||
        text.includes('aangifte inkomstenbelasting') ||
        text.includes('formulierenversie ib')
      ) {
        docType = 'aangifte_ib';
      } else if (
        filename.includes('aanslag') ||
        text.includes('definitieve aanslag') ||
        text.includes('voorlopige aanslag')
      ) {
        docType = text.includes('voorlopige') ? 'voorlopige_aanslag' : 'definitieve_aanslag';
      } else if (
        filename.includes('jaaroverzicht') ||
        filename.includes('jaaropgave') ||
        text.includes('jaaroverzicht') ||
        text.includes('rekeningoverzicht')
      ) {
        docType = 'jaaroverzicht_bank';
      } else if (
        filename.includes('effecten') ||
        filename.includes('belegging') ||
        text.includes('effectenoverzicht') ||
        text.includes('portefeuille')
      ) {
        docType = 'effectenoverzicht';
      } else if (filename.includes('woz') || text.includes('woz-waarde')) {
        docType = 'woz_beschikking';
      }

      return { ...doc, docType };
    });
  }

  // ===========================================================================
  // MODEL CALLING
  // ===========================================================================

  private async callModel(prompt: string): Promise<string> {
    const result = await this.factory.callModel(this.MODEL_CONFIG, prompt);
    return result.content;
  }

  // ===========================================================================
  // RESPONSE PARSING
  // ===========================================================================

  /**
   * Attempt to repair common JSON errors from LLM responses
   */
  private repairJson(jsonStr: string): string {
    let repaired = jsonStr;

    // Remove trailing commas before } or ]
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');

    // Fix missing commas between properties (newline between "value" and "key":)
    repaired = repaired.replace(/("[^"]*")\s*\n\s*("[^"]*"\s*:)/g, '$1,\n$2');

    // Fix missing commas between array elements
    repaired = repaired.replace(/(\})\s*\n\s*(\{)/g, '$1,\n$2');

    // Remove any control characters except newlines and tabs
    repaired = repaired.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

    return repaired;
  }

  private parseManifestResponse(response: string): Box3Manifest {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in manifest response');
      }

      let jsonStr = jsonMatch[1] || jsonMatch[0];

      // First try parsing as-is
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (firstError) {
        // Try repairing common JSON issues
        logger.warn('box3-pipeline-v2', 'Initial JSON parse failed, attempting repair', {
          error: (firstError as Error).message
        });
        jsonStr = this.repairJson(jsonStr);
        try {
          parsed = JSON.parse(jsonStr);
          logger.info('box3-pipeline-v2', 'JSON repair successful');
        } catch (repairError) {
          // Log a portion of the problematic JSON for debugging
          const errorPos = parseInt((firstError as Error).message.match(/position (\d+)/)?.[1] || '0');
          const context = jsonStr.substring(Math.max(0, errorPos - 100), errorPos + 100);
          logger.error('box3-pipeline-v2', 'JSON repair failed', {
            originalError: (firstError as Error).message,
            repairError: (repairError as Error).message,
            contextAroundError: context
          });
          throw firstError; // Re-throw original error
        }
      }

      // Validate required fields
      if (!parsed.fiscal_entity || !parsed.asset_items) {
        throw new Error('Manifest missing required fields: fiscal_entity or asset_items');
      }

      // Ensure schema version
      parsed.schema_version = '3.0';
      parsed.extraction_timestamp = new Date().toISOString();

      return parsed as Box3Manifest;
    } catch (error) {
      logger.error('box3-pipeline-v2', `Failed to parse manifest: ${error}`);
      throw new Error(`Failed to parse manifest response: ${error}`);
    }
  }

  private applyEnrichment(manifest: Box3Manifest, enrichmentResponse: string): Box3EnrichedManifest {
    try {
      const jsonMatch = enrichmentResponse.match(/```json\s*([\s\S]*?)\s*```/) || enrichmentResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('box3-pipeline-v2', 'No JSON found in enrichment response, returning manifest as-is');
        return {
          ...manifest,
          enrichment_timestamp: new Date().toISOString(),
          enrichment_stats: {
            bank_items_matched: 0,
            bank_items_total: manifest.asset_items.bank_savings.length,
            investment_items_matched: 0,
            investment_items_total: manifest.asset_items.investments.length,
            other_items_matched: 0,
            other_items_total: manifest.asset_items.other_assets.length,
            debt_items_matched: 0,
            debt_items_total: manifest.debt_items.length,
          },
          unmatched_items: [],
          unmatched_source_docs: [],
        };
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const enrichmentData = JSON.parse(jsonStr);

      // Apply enrichments to manifest items
      const enrichedItems = enrichmentData.enriched_items || [];
      let matchedBank = 0, matchedInv = 0, matchedOther = 0, matchedDebt = 0;

      for (const item of enrichedItems) {
        if (!item.enrichment) continue;

        // Find and update the corresponding manifest item
        const bankItem = manifest.asset_items.bank_savings.find((b) => b.manifest_id === item.manifest_id);
        if (bankItem) {
          bankItem.enrichment = item.enrichment;
          matchedBank++;
          continue;
        }

        const invItem = manifest.asset_items.investments.find((i) => i.manifest_id === item.manifest_id);
        if (invItem) {
          invItem.enrichment = item.enrichment;
          matchedInv++;
          continue;
        }

        const otherItem = manifest.asset_items.other_assets.find((o) => o.manifest_id === item.manifest_id);
        if (otherItem) {
          otherItem.enrichment = item.enrichment;
          matchedOther++;
          continue;
        }

        const debtItem = manifest.debt_items.find((d) => d.manifest_id === item.manifest_id);
        if (debtItem) {
          debtItem.enrichment = item.enrichment;
          matchedDebt++;
        }
      }

      return {
        ...manifest,
        enrichment_timestamp: new Date().toISOString(),
        enrichment_stats: {
          bank_items_matched: matchedBank,
          bank_items_total: manifest.asset_items.bank_savings.length,
          investment_items_matched: matchedInv,
          investment_items_total: manifest.asset_items.investments.length,
          other_items_matched: matchedOther,
          other_items_total: manifest.asset_items.other_assets.length,
          debt_items_matched: matchedDebt,
          debt_items_total: manifest.debt_items.length,
        },
        unmatched_items: enrichmentData.enriched_items
          ?.filter((e: any) => !e.enrichment)
          .map((e: any) => ({
            manifest_id: e.manifest_id,
            category: 'unknown',
            description: '',
            note: e.note || 'No match found',
          })) || [],
        unmatched_source_docs: enrichmentData.unmatched_source_docs || [],
      };
    } catch (error) {
      logger.error('box3-pipeline-v2', `Failed to apply enrichment: ${error}`);
      // Return manifest as enriched manifest without enrichment data
      return {
        ...manifest,
        enrichment_timestamp: new Date().toISOString(),
        enrichment_stats: {
          bank_items_matched: 0,
          bank_items_total: manifest.asset_items.bank_savings.length,
          investment_items_matched: 0,
          investment_items_total: manifest.asset_items.investments.length,
          other_items_matched: 0,
          other_items_total: manifest.asset_items.other_assets.length,
          debt_items_matched: 0,
          debt_items_total: manifest.debt_items.length,
        },
        unmatched_items: [],
        unmatched_source_docs: [],
      };
    }
  }

  // ===========================================================================
  // VALIDATION
  // ===========================================================================

  private validateManifestTotals(manifest: Box3Manifest): ManifestValidationResult {
    const expected = manifest.category_totals;

    // Calculate actual totals from items
    const bankTotal = manifest.asset_items.bank_savings.reduce((sum, item) => {
      const yearData = Object.values(item.yearly_values)[0];
      return sum + (yearData?.value_jan_1 || 0);
    }, 0);

    // For investments: separate green and non-green
    // The aangifte shows category_totals.investments EXCLUDING green investments
    // Green investments are reported separately in green_investments.total_value
    let invTotalNonGreen = 0;
    let invTotalGreen = 0;
    for (const item of manifest.asset_items.investments) {
      const yearData = Object.values(item.yearly_values)[0];
      const value = yearData?.value_jan_1 || 0;
      if (item.is_green_investment) {
        invTotalGreen += value;
      } else {
        invTotalNonGreen += value;
      }
    }
    const invTotal = invTotalNonGreen + invTotalGreen;

    const otherTotal = manifest.asset_items.other_assets.reduce((sum, item) => {
      const yearData = Object.values(item.yearly_values)[0];
      return sum + (yearData?.value_jan_1 || 0);
    }, 0);

    const debtTotal = manifest.debt_items.reduce((sum, item) => {
      const yearData = Object.values(item.yearly_values)[0];
      return sum + (yearData?.value_jan_1 || 0);
    }, 0);

    // Expected investments: from category_totals (excludes green) + green_investments.total_value
    // The LLM should extract:
    // - category_totals.investments = regular investments only (excl. green)
    // - green_investments.total_value = green investments
    // And place all in investments array with is_green_investment flag
    const expectedGreen = manifest.green_investments?.total_value || 0;
    const expectedInvTotal = expected.investments + expectedGreen;

    const extractedTotal = bankTotal + invTotal + otherTotal;
    const expectedTotal = expected.bank_savings + expectedInvTotal + expected.other_assets;

    const totalDifference = extractedTotal - expectedTotal;
    const percentageDifference = expectedTotal > 0 ? (totalDifference / expectedTotal) * 100 : 0;

    const warnings: string[] = [];
    const errors: string[] = [];

    // Per-category validation with detailed messages
    const categoryResults = {
      bank_savings: {
        expected_count: manifest.asset_items.bank_savings.length,
        extracted_count: manifest.asset_items.bank_savings.length,
        expected_total: expected.bank_savings,
        extracted_total: bankTotal,
        difference: bankTotal - expected.bank_savings,
        is_match: Math.abs(bankTotal - expected.bank_savings) < 1,
      },
      investments: {
        expected_count: manifest.asset_items.investments.length,
        extracted_count: manifest.asset_items.investments.length,
        // Show expected as including green for correct comparison
        expected_total: expectedInvTotal,
        extracted_total: invTotal,
        difference: invTotal - expectedInvTotal,
        is_match: Math.abs(invTotal - expectedInvTotal) < 1,
      },
      other_assets: {
        expected_count: manifest.asset_items.other_assets.length,
        extracted_count: manifest.asset_items.other_assets.length,
        expected_total: expected.other_assets,
        extracted_total: otherTotal,
        difference: otherTotal - expected.other_assets,
        is_match: Math.abs(otherTotal - expected.other_assets) < 1,
      },
      debts: {
        expected_count: manifest.debt_items.length,
        extracted_count: manifest.debt_items.length,
        expected_total: expected.debts,
        extracted_total: debtTotal,
        difference: debtTotal - expected.debts,
        is_match: Math.abs(debtTotal - expected.debts) < 1,
      },
    };

    // Generate specific warnings per category
    if (!categoryResults.bank_savings.is_match) {
      const diff = categoryResults.bank_savings.difference;
      const pct = expected.bank_savings > 0 ? ((diff / expected.bank_savings) * 100).toFixed(1) : '0';
      warnings.push(`Bank/sparen: €${Math.abs(diff).toLocaleString('nl-NL')} verschil (${pct}%)`);
    }
    if (!categoryResults.investments.is_match) {
      const diff = categoryResults.investments.difference;
      const pct = expectedInvTotal > 0 ? ((diff / expectedInvTotal) * 100).toFixed(1) : '0';
      warnings.push(`Beleggingen: €${Math.abs(diff).toLocaleString('nl-NL')} verschil (${pct}%)`);
      // Add note about green investments if relevant
      if (expectedGreen > 0) {
        warnings.push(`  (incl. groene beleggingen: verwacht €${expectedGreen.toLocaleString('nl-NL')}, gevonden €${invTotalGreen.toLocaleString('nl-NL')})`);
      }
    }
    if (!categoryResults.other_assets.is_match) {
      const diff = categoryResults.other_assets.difference;
      const pct = expected.other_assets > 0 ? ((diff / expected.other_assets) * 100).toFixed(1) : '0';
      warnings.push(`Overige bezittingen: €${Math.abs(diff).toLocaleString('nl-NL')} verschil (${pct}%)`);
    }
    if (!categoryResults.debts.is_match) {
      const diff = categoryResults.debts.difference;
      const pct = expected.debts > 0 ? ((diff / expected.debts) * 100).toFixed(1) : '0';
      warnings.push(`Schulden: €${Math.abs(diff).toLocaleString('nl-NL')} verschil (${pct}%)`);
    }

    if (Math.abs(percentageDifference) > 5) {
      errors.push(`Significant totaal verschil: ${percentageDifference.toFixed(1)}%`);
    }

    return {
      is_valid: Math.abs(percentageDifference) <= 1,
      total_difference: totalDifference,
      percentage_difference: percentageDifference,
      per_category: categoryResults,
      warnings,
      errors,
    };
  }

  // ===========================================================================
  // ACTUAL RETURN CALCULATION
  // ===========================================================================

  private calculateActualReturns(manifest: Box3EnrichedManifest): ActualReturnCalculation {
    const year = manifest.tax_years[0] || '2022';

    let bankInterest = 0;
    let dividends = 0;
    let otherIncome = 0;
    let costsPaid = 0;
    let debtInterest = 0;

    // Sum up actual returns from enriched items
    for (const bank of manifest.asset_items.bank_savings) {
      bankInterest += bank.enrichment?.interest_received || 0;
    }

    for (const inv of manifest.asset_items.investments) {
      dividends += inv.enrichment?.dividends_received || 0;
      costsPaid += inv.enrichment?.costs_paid || 0;
    }

    for (const other of manifest.asset_items.other_assets) {
      otherIncome += other.enrichment?.interest_received || 0;
    }

    for (const debt of manifest.debt_items) {
      if (!debt.is_eigen_woning_schuld) {
        // Box 3 debt interest is not deductible but reduces forfaitair rendement
        // Actually, for Box 3 claims, we just track it
        debtInterest += debt.interest_paid || 0;
      }
    }

    const totalActualReturn = bankInterest + dividends + otherIncome - costsPaid;
    const forfaitairRendement = manifest.tax_authority[year]?.forfaitair_rendement || 0;
    const difference = totalActualReturn - forfaitairRendement;
    const box3TaxPaid = manifest.tax_authority[year]?.belasting_box3 || 0;

    // Use correct tax rate for the year from shared constants
    const taxRate = BOX3_CONSTANTS.TAX_RATES[year] || 0.31;
    // Calculate theoretical refund, but cap at actually paid tax (can't get back more than paid)
    const theoreticalRefund = difference < 0 ? Math.abs(difference) * taxRate : 0;
    const indicativeRefund = Math.min(theoreticalRefund, box3TaxPaid);

    return {
      tax_year: year,
      bank_interest: bankInterest,
      dividends,
      rental_income_net: 0, // Not extracted in V2 yet
      other_income: otherIncome,
      costs_deductible: costsPaid,
      debt_interest_paid: debtInterest,
      total_actual_return: totalActualReturn,
      forfaitair_rendement: forfaitairRendement,
      difference,
      indicative_refund: indicativeRefund,
      is_claim_profitable: difference < -250, // Threshold for profitable claim
    };
  }

  // ===========================================================================
  // MANIFEST TO BLUEPRINT CONVERSION
  // ===========================================================================

  private manifestToBlueprint(
    manifest: Box3Manifest,
    warnings: string[] = [],
    validation?: ManifestValidationResult
  ): Box3Blueprint {
    const year = manifest.tax_years[0] || '2022';

    // Convert bank items
    const bankSavings: Box3BankSavingsAsset[] = manifest.asset_items.bank_savings.map((item, idx) => ({
      id: `bank_${idx + 1}`,
      owner_id: item.owner_id,
      description: item.description_from_aangifte,
      bank_name: item.bank_name,
      account_masked: item.iban_from_aangifte,
      is_joint_account: item.is_joint_account ?? false,
      is_green_investment: false, // Bank accounts are not green investments
      ownership_percentage: item.ownership_percentage,
      yearly_data: Object.fromEntries(
        Object.entries(item.yearly_values).map(([y, data]) => [
          y,
          {
            value_jan_1: { amount: data.value_jan_1, confidence: 1.0 },
            value_dec_31: data.value_dec_31 ? { amount: data.value_dec_31, confidence: 1.0 } : undefined,
            interest_received: item.enrichment?.interest_received
              ? { amount: item.enrichment.interest_received, confidence: item.enrichment.match_confidence }
              : undefined,
          },
        ])
      ),
    }));

    // Map manifest investment types to blueprint types
    const mapInvestmentType = (hint?: string): 'stocks' | 'bonds' | 'funds' | 'crypto' | 'other' => {
      if (!hint) return 'other';
      if (hint === 'stocks') return 'stocks';
      if (hint === 'bonds') return 'bonds';
      if (hint === 'funds' || hint === 'etf' || hint === 'real_estate_fund') return 'funds';
      if (hint === 'crowdfunding') return 'other';
      return 'other';
    };

    // Convert investment items
    const investments: Box3InvestmentAsset[] = manifest.asset_items.investments.map((item, idx) => ({
      id: `inv_${idx + 1}`,
      owner_id: item.owner_id,
      description: item.description_from_aangifte,
      institution: item.institution,
      type: mapInvestmentType(item.investment_type_hint),
      ownership_percentage: item.ownership_percentage,
      yearly_data: Object.fromEntries(
        Object.entries(item.yearly_values).map(([y, data]) => [
          y,
          {
            value_jan_1: { amount: data.value_jan_1, confidence: 1.0 },
            dividend_received: item.enrichment?.dividends_received
              ? { amount: item.enrichment.dividends_received, confidence: item.enrichment.match_confidence }
              : undefined,
          },
        ])
      ),
    }));

    // Map manifest other asset types to blueprint types
    const mapOtherAssetType = (
      assetType: string
    ): 'vve_share' | 'claims' | 'rights' | 'capital_insurance' | 'loaned_money' | 'cash' | 'periodic_benefits' | 'other' => {
      if (assetType === 'vve_share') return 'vve_share';
      if (assetType === 'claims') return 'claims';
      if (assetType === 'loaned_money') return 'loaned_money';
      if (assetType === 'crypto') return 'other'; // Crypto maps to other
      if (assetType === 'movable_property') return 'other';
      if (assetType === 'trust') return 'other';
      if (assetType === 'usufruct') return 'rights';
      return 'other';
    };

    // Convert other assets
    const otherAssets: Box3OtherAsset[] = manifest.asset_items.other_assets.map((item, idx) => ({
      id: `other_${idx + 1}`,
      owner_id: item.owner_id,
      description: item.description_from_aangifte,
      type: mapOtherAssetType(item.asset_type),
      borrower_name: item.loan_details?.borrower_name,
      is_family_loan: item.loan_details?.is_family_loan,
      agreed_interest_rate: item.loan_details?.interest_rate,
      yearly_data: Object.fromEntries(
        Object.entries(item.yearly_values).map(([y, data]) => [
          y,
          {
            value_jan_1: { amount: data.value_jan_1, confidence: 1.0 },
            interest_received: item.enrichment?.interest_received
              ? { amount: item.enrichment.interest_received, confidence: item.enrichment.match_confidence }
              : undefined,
          },
        ])
      ),
    }));

    // Determine debt type from manifest item
    const inferDebtType = (
      item: ManifestDebtItem
    ): 'mortgage_box3' | 'mortgage_box1_residual' | 'consumer_credit' | 'personal_loan' | 'study_loan' | 'tax_debt' | 'other' => {
      // If it's an eigen woning schuld, it shouldn't be in Box 3 at all
      if (item.is_eigen_woning_schuld) return 'mortgage_box1_residual';

      // Try to infer from description
      const desc = item.description_from_aangifte.toLowerCase();
      if (desc.includes('hypotheek')) return 'mortgage_box3';
      if (desc.includes('studieschuld') || desc.includes('studielening')) return 'study_loan';
      if (desc.includes('belasting')) return 'tax_debt';
      if (desc.includes('krediet')) return 'consumer_credit';
      if (desc.includes('lening')) return 'personal_loan';
      return 'other';
    };

    // Convert debts
    const debts: Box3Debt[] = manifest.debt_items.map((item, idx) => ({
      id: `debt_${idx + 1}`,
      owner_id: item.owner_id,
      description: item.description_from_aangifte,
      lender: item.creditor_name,
      debt_type: inferDebtType(item),
      ownership_percentage: item.ownership_percentage,
      yearly_data: Object.fromEntries(
        Object.entries(item.yearly_values).map(([y, data]) => [
          y,
          {
            value_jan_1: { amount: data.value_jan_1, confidence: 1.0 },
            interest_paid: item.interest_paid ? { amount: item.interest_paid, confidence: 1.0 } : undefined,
          },
        ])
      ),
    }));

    // Convert fiscal entity (ensure undefined -> null conversion)
    const fiscalEntity: Box3FiscalEntity = {
      taxpayer: {
        id: manifest.fiscal_entity.taxpayer.id,
        name: manifest.fiscal_entity.taxpayer.name || null,
        bsn_masked: manifest.fiscal_entity.taxpayer.bsn_masked || null,
        date_of_birth: manifest.fiscal_entity.taxpayer.date_of_birth ?? null,
      },
      fiscal_partner: manifest.fiscal_entity.fiscal_partner
        ? {
            has_partner: true,
            id: manifest.fiscal_entity.fiscal_partner.id,
            name: manifest.fiscal_entity.fiscal_partner.name || null,
            bsn_masked: manifest.fiscal_entity.fiscal_partner.bsn_masked || null,
            date_of_birth: manifest.fiscal_entity.fiscal_partner.date_of_birth ?? null,
          }
        : { has_partner: false },
    };

    // Convert tax authority data
    const taxAuthorityData: Record<string, Box3TaxAuthorityYearData> = {};
    for (const [y, data] of Object.entries(manifest.tax_authority)) {
      // Calculate totals from manifest for conversion
      const totalAssets = manifest.category_totals.bank_savings +
                         manifest.category_totals.investments +
                         manifest.category_totals.real_estate +
                         manifest.category_totals.other_assets;
      const totalDebts = manifest.category_totals.debts;

      taxAuthorityData[y] = {
        source_doc_id: manifest.source_document_id,
        document_type: 'aangifte',
        per_person: {
          'tp_01': {
            allocation_percentage: manifest.fiscal_entity.fiscal_partner ? 50 : 100,
            total_assets_box3: totalAssets,
            total_debts_box3: totalDebts,
            exempt_amount: data.heffingsvrij_vermogen,
            taxable_base: data.grondslag_sparen_beleggen,
            deemed_return: data.forfaitair_rendement,
            tax_assessed: data.belasting_box3,
          },
        },
        household_totals: {
          total_assets_gross: totalAssets,
          total_debts: totalDebts,
          net_assets: totalAssets - totalDebts,
          total_exempt: data.heffingsvrij_vermogen,
          taxable_base: data.grondslag_sparen_beleggen,
          deemed_return: data.forfaitair_rendement,
          total_tax_assessed: data.belasting_box3,
        },
      };
    }

    // Generate year_summaries for each tax year in the manifest
    const yearSummaries: Record<string, Box3YearSummary> = {};
    for (const taxYear of manifest.tax_years) {
      const taxAuthData = manifest.tax_authority[taxYear];
      const totalAssets = manifest.category_totals.bank_savings +
                         manifest.category_totals.investments +
                         manifest.category_totals.real_estate +
                         manifest.category_totals.other_assets;

      // Calculate actual returns from enrichment data, with estimates where missing
      let bankInterest = 0;
      let bankInterestEstimated = 0;
      let dividends = 0;
      let otherIncome = 0;
      let debtInterest = 0;

      // Get savings rate for this year for estimates
      const savingsRate = BOX3_CONSTANTS.AVERAGE_SAVINGS_RATES[taxYear] || 0.001;

      // Sum up enrichment data for bank savings, estimate if missing
      for (const item of manifest.asset_items.bank_savings) {
        if (item.enrichment?.interest_received) {
          bankInterest += item.enrichment.interest_received;
        } else {
          // Estimate based on balance × average savings rate for the year
          const yearData = item.yearly_values[taxYear];
          const balance = yearData?.value_jan_1 || 0;
          if (balance > 0) {
            bankInterestEstimated += balance * savingsRate;
          }
        }
      }
      for (const item of manifest.asset_items.investments) {
        if (item.enrichment?.dividends_received) {
          dividends += item.enrichment.dividends_received;
        }
        // Note: we don't estimate dividends - too variable
      }
      for (const item of manifest.asset_items.other_assets) {
        if (item.enrichment?.interest_received) {
          otherIncome += item.enrichment.interest_received;
        }
        // Note: we don't estimate other income - too variable
      }
      for (const item of manifest.debt_items) {
        if (item.interest_paid) {
          debtInterest += item.interest_paid;
        }
      }

      // Use actual + estimated bank interest for total
      const totalBankInterest = bankInterest + bankInterestEstimated;
      const totalActualReturn = totalBankInterest + dividends + otherIncome - debtInterest;
      const deemedReturn = taxAuthData?.forfaitair_rendement || 0;
      const difference = totalActualReturn - deemedReturn;
      const box3TaxPaid = taxAuthData?.belasting_box3 || 0;
      // Use correct tax rate for the year from shared constants
      const taxRate = BOX3_CONSTANTS.TAX_RATES[taxYear] || 0.31;
      // Calculate theoretical refund, but cap at actually paid tax (can't get back more than paid)
      const theoreticalRefund = difference < 0 ? Math.abs(difference) * taxRate : 0;
      const indicativeRefund = Math.min(theoreticalRefund, box3TaxPaid);

      // Debug logging for refund cap
      logger.info('box3-pipeline-v2', 'Refund calculation', {
        taxYear,
        deemedReturn,
        totalActualReturn,
        difference,
        taxRate,
        theoreticalRefund,
        box3TaxPaid,
        indicativeRefund,
        bankInterestActual: bankInterest,
        bankInterestEstimated,
        totalBankInterest,
        taxAuthData: taxAuthData ? { belasting_box3: taxAuthData.belasting_box3, forfaitair_rendement: taxAuthData.forfaitair_rendement } : null
      });

      const calculatedTotals: Box3CalculatedTotals = {
        total_assets_jan_1: totalAssets,
        actual_return: {
          bank_interest: totalBankInterest, // Includes estimated if no enrichment data
          investment_gain: 0, // Not calculated in V2
          dividends,
          other_assets_income: otherIncome,
          rental_income_net: 0, // Not extracted in V2 yet
          debt_interest_paid: debtInterest,
          total: totalActualReturn,
        },
        deemed_return_from_tax_authority: deemedReturn,
        difference,
        indicative_refund: indicativeRefund,
        is_profitable: difference < -250,
      };

      yearSummaries[taxYear] = {
        status: taxAuthData ? 'ready_for_calculation' : 'incomplete',
        completeness: {
          bank_savings: manifest.asset_items.bank_savings.length > 0 ? 'complete' : 'not_applicable',
          investments: manifest.asset_items.investments.length > 0 ? 'complete' : 'not_applicable',
          real_estate: manifest.asset_items.real_estate.length > 0 ? 'complete' : 'not_applicable',
          debts: manifest.debt_items.length > 0 ? 'complete' : 'not_applicable',
          tax_return: taxAuthData ? 'complete' : 'incomplete',
        },
        missing_items: [],
        calculated_totals: calculatedTotals,
      };
    }

    // Generate validation_flags from warnings and validation results
    const validationFlags: Box3ValidationFlag[] = [];

    // Add warnings as validation flags
    warnings.forEach((warning, idx) => {
      // Determine severity based on warning content
      let severity: 'low' | 'medium' | 'high' = 'medium';
      let type: 'requires_validation' | 'low_confidence' | 'inconsistency' = 'low_confidence';

      if (warning.includes('Geen brondocumenten')) {
        severity = 'medium';
        type = 'requires_validation';
      } else if (warning.includes('wijken af') || warning.includes('verschil')) {
        severity = 'medium';
        type = 'inconsistency';
      }

      validationFlags.push({
        id: `warning_${idx}`,
        field_path: 'general',
        type,
        message: warning,
        severity,
        created_at: new Date().toISOString(),
      });
    });

    // Add validation result if not valid
    if (validation && !validation.is_valid) {
      validationFlags.push({
        id: 'validation_totals',
        field_path: 'category_totals',
        type: 'inconsistency',
        message: `Totalen validatie: ${validation.percentage_difference.toFixed(1)}% verschil (€${Math.abs(validation.total_difference).toLocaleString('nl-NL')})`,
        severity: validation.percentage_difference > 10 ? 'high' : 'medium',
        created_at: new Date().toISOString(),
      });
    }

    return {
      schema_version: '2.0',
      source_documents_registry: [],
      fiscal_entity: fiscalEntity,
      assets: {
        bank_savings: bankSavings,
        investments,
        real_estate: [],
        other_assets: otherAssets,
      },
      debts,
      tax_authority_data: taxAuthorityData,
      year_summaries: yearSummaries,
      validation_flags: validationFlags,
      audit_checks: [],
      manual_overrides: [],
    };
  }

  // ===========================================================================
  // EMPTY STRUCTURES
  // ===========================================================================

  private createEmptyManifest(): Box3Manifest {
    return {
      schema_version: '3.0',
      extraction_timestamp: new Date().toISOString(),
      source_document_id: '',
      tax_years: [],
      fiscal_entity: {
        taxpayer: { id: 'tp_01', name: '', bsn_masked: '' },
        filing_type: 'individual',
      },
      asset_items: {
        bank_savings: [],
        investments: [],
        real_estate: [],
        other_assets: [],
      },
      debt_items: [],
      category_totals: {
        bank_savings: 0,
        investments: 0,
        real_estate: 0,
        other_assets: 0,
        debts: 0,
        grand_total: 0,
      },
      tax_authority: {},
    };
  }

  private createEmptyBlueprint(): Box3Blueprint {
    return {
      schema_version: '2.0',
      source_documents_registry: [],
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
      validation_flags: [],
      audit_checks: [],
      manual_overrides: [],
    };
  }
}
