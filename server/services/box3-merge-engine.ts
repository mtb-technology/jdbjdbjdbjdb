/**
 * Box3 Blueprint Merge Engine
 *
 * Handles incremental updates to blueprints without losing existing data.
 * Key principles:
 * 1. Match assets by unique identifiers (account number, address, etc.)
 * 2. Never overwrite manual overrides
 * 3. Higher authority documents win conflicts
 * 4. Track all conflicts for review
 */

import { logger } from "./logger";
import type {
  Box3Blueprint,
  Box3BankSavingsAsset,
  Box3InvestmentAsset,
  Box3RealEstateAsset,
  Box3OtherAsset,
  Box3Debt,
  Box3DocumentExtraction,
  Box3ExtractedClaim,
  Box3MergeConflict,
  Box3DocumentContribution,
  Box3AssetMatchResult,
  Box3DataPoint,
  Box3SourceDocumentEntry,
} from "@shared/schema/box3";
import { DOCUMENT_AUTHORITY_RANKING } from "@shared/schema/box3";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface MergeResult {
  blueprint: Box3Blueprint;
  conflicts: Box3MergeConflict[];
  contributions: Box3DocumentContribution;
  stats: {
    valuesAdded: number;
    valuesUpdated: number;
    valuesSkipped: number;
    conflictsDetected: number;
  };
}

interface AssetIdentifiers {
  // For bank accounts
  account_last4?: string;
  iban_pattern?: string;
  bank_name?: string;

  // For real estate
  address?: string;
  postcode?: string;

  // For investments
  account_number?: string;
  institution?: string;

  // Generic
  description?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MERGE ENGINE CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class Box3MergeEngine {
  private blueprint: Box3Blueprint;
  private conflicts: Box3MergeConflict[] = [];
  private contributedPaths: string[] = [];
  private stats = {
    valuesAdded: 0,
    valuesUpdated: 0,
    valuesSkipped: 0,
    conflictsDetected: 0,
  };

  constructor(existingBlueprint: Box3Blueprint) {
    // Deep clone to avoid mutations
    this.blueprint = JSON.parse(JSON.stringify(existingBlueprint));

    // Initialize V3 tracking if not present
    if (!this.blueprint.document_contributions) {
      this.blueprint.document_contributions = [];
    }
    if (!this.blueprint.merge_conflicts) {
      this.blueprint.merge_conflicts = [];
    }
  }

  /**
   * Main entry point: merge extraction from a single document into blueprint
   */
  mergeDocumentExtraction(extraction: Box3DocumentExtraction): MergeResult {
    logger.info('box3-merge', `Merging extraction from document ${extraction.document_id}`, {
      type: extraction.detected_type,
      claimCount: extraction.claims.length,
    });

    // Process each claim
    for (const claim of extraction.claims) {
      this.processClaim(claim, extraction);
    }

    // Add source document to registry if not present
    this.addToSourceRegistry(extraction);

    // Build contribution record
    const contribution: Box3DocumentContribution = {
      document_id: extraction.document_id,
      document_type: extraction.detected_type,
      contributed_paths: [...this.contributedPaths],
      extraction_version: extraction.extraction_version,
      extracted_at: extraction.extracted_at,
    };

    // Add to blueprint
    this.blueprint.document_contributions!.push(contribution);

    // Add new conflicts to blueprint
    this.blueprint.merge_conflicts!.push(...this.conflicts);

    logger.info('box3-merge', 'Merge complete', this.stats);

    return {
      blueprint: this.blueprint,
      conflicts: this.conflicts,
      contributions: contribution,
      stats: { ...this.stats },
    };
  }

  /**
   * Process a single claim from extraction
   */
  private processClaim(claim: Box3ExtractedClaim, extraction: Box3DocumentExtraction): void {
    const { path, value, confidence, source_snippet } = claim;

    // Parse the path to understand what we're updating
    const pathParts = this.parsePath(path);

    if (!pathParts) {
      logger.warn('box3-merge', `Invalid path: ${path}`);
      return;
    }

    // Route to appropriate handler based on path type
    if (pathParts.category === 'assets') {
      this.processAssetClaim(pathParts, claim, extraction);
    } else if (pathParts.category === 'debts') {
      this.processDebtClaim(pathParts, claim, extraction);
    } else if (pathParts.category === 'tax_authority_data') {
      this.processTaxDataClaim(pathParts, claim, extraction);
    } else if (pathParts.category === 'fiscal_entity') {
      this.processFiscalEntityClaim(pathParts, claim, extraction);
    } else {
      // Generic path handling
      this.processGenericClaim(path, claim, extraction);
    }
  }

  /**
   * Parse a claim path into structured parts
   */
  private parsePath(path: string): {
    category: string;
    assetType?: string;
    index?: number;
    field?: string;
    year?: string;
    subfield?: string;
  } | null {
    // Examples:
    // "assets.bank_savings[0].yearly_data.2023.value_jan_1"
    // "tax_authority_data.2023.household_totals.total_assets_gross"
    // "fiscal_entity.taxpayer.name"

    const match = path.match(/^(\w+)(?:\.(\w+))?(?:\[(\d+)\])?(?:\.(.+))?$/);
    if (!match) return null;

    const [, category, second, indexStr, rest] = match;

    const result: any = { category };

    if (category === 'assets' && second) {
      result.assetType = second;
      if (indexStr !== undefined) {
        result.index = parseInt(indexStr, 10);
      }
      if (rest) {
        // Parse yearly_data.2023.value_jan_1
        const yearMatch = rest.match(/^yearly_data\.(\d{4})\.(\w+)$/);
        if (yearMatch) {
          result.year = yearMatch[1];
          result.subfield = yearMatch[2];
        } else {
          result.field = rest;
        }
      }
    } else if (category === 'tax_authority_data' && second) {
      result.year = second;
      result.field = rest;
    } else if (category === 'fiscal_entity') {
      result.field = second ? (rest ? `${second}.${rest}` : second) : undefined;
    } else {
      result.field = second ? (rest ? `${second}.${rest}` : second) : undefined;
    }

    return result;
  }

  /**
   * Process asset-related claims with matching logic
   */
  private processAssetClaim(
    pathParts: any,
    claim: Box3ExtractedClaim,
    extraction: Box3DocumentExtraction
  ): void {
    const { assetType, year, subfield } = pathParts;

    if (!assetType) return;

    // Get identifiers for matching
    const identifiers = this.extractIdentifiersFromClaim(claim, extraction);

    // Try to find matching asset
    const matchResult = this.findMatchingAsset(assetType, identifiers);

    let assetIndex: number;

    if (matchResult.matched && matchResult.index !== undefined) {
      // Found existing asset - update it
      assetIndex = matchResult.index;
      logger.debug('box3-merge', `Matched ${assetType} at index ${assetIndex}`, {
        reason: matchResult.match_reason,
      });
    } else {
      // No match - create new asset
      assetIndex = this.createNewAsset(assetType, identifiers, extraction);
      logger.debug('box3-merge', `Created new ${assetType} at index ${assetIndex}`);
    }

    // Now update the specific field
    if (year && subfield) {
      this.updateAssetYearlyData(assetType, assetIndex, year, subfield, claim, extraction);
    } else if (pathParts.field) {
      this.updateAssetField(assetType, assetIndex, pathParts.field, claim, extraction);
    }
  }

  /**
   * Extract identifiers from a claim for asset matching
   */
  private extractIdentifiersFromClaim(
    claim: Box3ExtractedClaim,
    extraction: Box3DocumentExtraction
  ): AssetIdentifiers {
    const identifiers: AssetIdentifiers = {};

    // Try to get from extraction's asset_identifiers
    if (extraction.asset_identifiers) {
      // These would be populated by the extraction prompt
      // For now, try to parse from the claim path or value
    }

    // Try to parse IBAN from source snippet
    if (claim.source_snippet) {
      const ibanMatch = claim.source_snippet.match(/NL\d{2}[A-Z]{4}\*{4,}(\d{4})/i);
      if (ibanMatch) {
        identifiers.account_last4 = ibanMatch[1];
        identifiers.iban_pattern = claim.source_snippet.match(/NL\d{2}[A-Z]{4}/)?.[0];
      }

      // Try to extract bank name
      const bankNames = ['ING', 'ABN AMRO', 'Rabobank', 'SNS', 'ASN', 'Triodos', 'Knab', 'bunq'];
      for (const bank of bankNames) {
        if (claim.source_snippet.toLowerCase().includes(bank.toLowerCase())) {
          identifiers.bank_name = bank;
          break;
        }
      }

      // Try to extract address
      const addressMatch = claim.source_snippet.match(/([A-Za-z\s]+\d+[a-zA-Z]?,?\s*\d{4}\s*[A-Z]{2})/);
      if (addressMatch) {
        identifiers.address = addressMatch[1].trim();
      }
    }

    return identifiers;
  }

  /**
   * Find matching asset in blueprint
   */
  private findMatchingAsset(
    assetType: string,
    identifiers: AssetIdentifiers
  ): Box3AssetMatchResult {
    const assets = this.getAssetArray(assetType);

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];

      // Match by account number (highest confidence)
      if (identifiers.account_last4 && 'account_masked' in asset) {
        const assetAccount = (asset as Box3BankSavingsAsset).account_masked;
        if (assetAccount && assetAccount.endsWith(identifiers.account_last4)) {
          return { matched: true, index: i, match_reason: 'account_number', confidence: 0.95 };
        }
      }

      // Match by IBAN pattern + bank name
      if (identifiers.iban_pattern && identifiers.bank_name && 'bank_name' in asset) {
        const bankAsset = asset as Box3BankSavingsAsset;
        if (bankAsset.bank_name?.toLowerCase() === identifiers.bank_name.toLowerCase()) {
          // Same bank - could be match, but need more info
          // Check if account_masked contains same pattern
          if (bankAsset.account_masked?.includes(identifiers.iban_pattern)) {
            return { matched: true, index: i, match_reason: 'iban', confidence: 0.85 };
          }
        }
      }

      // Match by address (for real estate)
      if (identifiers.address && 'address' in asset) {
        const reAsset = asset as Box3RealEstateAsset;
        if (this.normalizeAddress(reAsset.address) === this.normalizeAddress(identifiers.address)) {
          return { matched: true, index: i, match_reason: 'address', confidence: 0.9 };
        }
      }

      // Match by postcode + house number
      if (identifiers.postcode && 'postcode' in asset) {
        const reAsset = asset as Box3RealEstateAsset;
        if (reAsset.postcode === identifiers.postcode) {
          return { matched: true, index: i, match_reason: 'address', confidence: 0.85 };
        }
      }
    }

    return { matched: false, confidence: 0 };
  }

  /**
   * Normalize address for comparison
   */
  private normalizeAddress(address: string): string {
    return address
      .toLowerCase()
      .replace(/[,.\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Get asset array by type
   */
  private getAssetArray(assetType: string): any[] {
    switch (assetType) {
      case 'bank_savings':
        return this.blueprint.assets.bank_savings;
      case 'investments':
        return this.blueprint.assets.investments;
      case 'real_estate':
        return this.blueprint.assets.real_estate;
      case 'other_assets':
        return this.blueprint.assets.other_assets;
      default:
        return [];
    }
  }

  /**
   * Create new asset entry
   */
  private createNewAsset(
    assetType: string,
    identifiers: AssetIdentifiers,
    extraction: Box3DocumentExtraction
  ): number {
    const assets = this.getAssetArray(assetType);
    const newId = `${assetType.replace('_', '')}_${assets.length + 1}`;

    let newAsset: any;

    switch (assetType) {
      case 'bank_savings':
        newAsset = {
          id: newId,
          owner_id: extraction.detected_person === 'partner' ? 'fp_01' : 'tp_01',
          description: identifiers.bank_name
            ? `${identifiers.bank_name} rekening`
            : 'Bankrekening',
          account_masked: identifiers.account_last4
            ? `****${identifiers.account_last4}`
            : undefined,
          bank_name: identifiers.bank_name,
          country: 'NL',
          is_joint_account: false,
          ownership_percentage: 100,
          is_green_investment: false,
          yearly_data: {},
        } as Box3BankSavingsAsset;
        break;

      case 'investments':
        newAsset = {
          id: newId,
          owner_id: extraction.detected_person === 'partner' ? 'fp_01' : 'tp_01',
          description: identifiers.institution || 'Beleggingsrekening',
          institution: identifiers.institution,
          account_masked: identifiers.account_number,
          country: 'NL',
          type: 'other',
          ownership_percentage: 100,
          yearly_data: {},
        } as Box3InvestmentAsset;
        break;

      case 'real_estate':
        newAsset = {
          id: newId,
          owner_id: extraction.detected_person === 'partner' ? 'fp_01' : 'tp_01',
          description: identifiers.address || 'Onroerend goed',
          address: identifiers.address || '',
          postcode: identifiers.postcode,
          country: 'NL',
          type: 'other',
          ownership_percentage: 100,
          yearly_data: {},
        } as Box3RealEstateAsset;
        break;

      case 'other_assets':
        newAsset = {
          id: newId,
          owner_id: extraction.detected_person === 'partner' ? 'fp_01' : 'tp_01',
          description: identifiers.description || 'Overige bezitting',
          type: 'other',
          yearly_data: {},
        } as Box3OtherAsset;
        break;

      default:
        throw new Error(`Unknown asset type: ${assetType}`);
    }

    assets.push(newAsset);
    this.stats.valuesAdded++;

    return assets.length - 1;
  }

  /**
   * Update yearly data for an asset
   */
  private updateAssetYearlyData(
    assetType: string,
    assetIndex: number,
    year: string,
    field: string,
    claim: Box3ExtractedClaim,
    extraction: Box3DocumentExtraction
  ): void {
    const assets = this.getAssetArray(assetType);
    const asset = assets[assetIndex];

    if (!asset.yearly_data[year]) {
      asset.yearly_data[year] = {};
    }

    const existingValue = asset.yearly_data[year][field];
    const newDataPoint: Box3DataPoint = {
      amount: claim.value,
      source_doc_id: extraction.document_id,
      source_type: 'document',
      source_snippet: claim.source_snippet,
      confidence: claim.confidence,
    };

    const path = `assets.${assetType}[${assetIndex}].yearly_data.${year}.${field}`;

    if (this.shouldUpdate(existingValue, newDataPoint, extraction.detected_type, path)) {
      asset.yearly_data[year][field] = newDataPoint;
      this.contributedPaths.push(path);

      if (existingValue) {
        this.stats.valuesUpdated++;
      } else {
        this.stats.valuesAdded++;
      }
    } else {
      this.stats.valuesSkipped++;
    }
  }

  /**
   * Update a non-yearly field on an asset
   */
  private updateAssetField(
    assetType: string,
    assetIndex: number,
    field: string,
    claim: Box3ExtractedClaim,
    extraction: Box3DocumentExtraction
  ): void {
    const assets = this.getAssetArray(assetType);
    const asset = assets[assetIndex];

    const existingValue = asset[field];
    const path = `assets.${assetType}[${assetIndex}].${field}`;

    // For simple fields (non-DataPoint), just update if not present
    if (existingValue === undefined || existingValue === null) {
      asset[field] = claim.value;
      this.contributedPaths.push(path);
      this.stats.valuesAdded++;
    }
  }

  /**
   * Process debt claims
   */
  private processDebtClaim(
    pathParts: any,
    claim: Box3ExtractedClaim,
    extraction: Box3DocumentExtraction
  ): void {
    // Similar to asset processing but for debts
    // For now, simplified - add as new debt
    const debts = this.blueprint.debts;
    const newId = `debt_${debts.length + 1}`;

    // Check if similar debt exists (by description or lender)
    const existingIndex = debts.findIndex(d =>
      d.description?.toLowerCase().includes(claim.source_snippet?.toLowerCase() || '') ||
      d.lender?.toLowerCase().includes(claim.source_snippet?.toLowerCase() || '')
    );

    if (existingIndex >= 0 && pathParts.year && pathParts.subfield) {
      // Update existing debt's yearly data
      const debt = debts[existingIndex];
      if (!debt.yearly_data[pathParts.year]) {
        debt.yearly_data[pathParts.year] = {};
      }
      // Type-safe assignment for debt yearly data fields
      const yearData = debt.yearly_data[pathParts.year];
      const validFields = ['value_jan_1', 'value_dec_31', 'interest_paid', 'interest_rate', 'currency_result'] as const;
      if (validFields.includes(pathParts.subfield as any)) {
        (yearData as any)[pathParts.subfield] = {
          amount: claim.value,
          source_doc_id: extraction.document_id,
          source_type: 'document',
          confidence: claim.confidence,
        };
      }
      this.stats.valuesUpdated++;
    }
  }

  /**
   * Process tax authority data claims
   */
  private processTaxDataClaim(
    pathParts: any,
    claim: Box3ExtractedClaim,
    extraction: Box3DocumentExtraction
  ): void {
    const { year, field } = pathParts;

    if (!year) return;

    // Initialize year data if not present
    if (!this.blueprint.tax_authority_data[year]) {
      this.blueprint.tax_authority_data[year] = {
        source_doc_id: extraction.document_id,
        document_type: this.mapToTaxDocType(extraction.detected_type),
        per_person: {},
        household_totals: {
          total_assets_gross: 0,
          total_debts: 0,
          net_assets: 0,
          total_exempt: 0,
          taxable_base: 0,
          total_tax_assessed: 0,
        },
      };
    }

    const taxData = this.blueprint.tax_authority_data[year];
    const path = `tax_authority_data.${year}.${field}`;

    // Parse field path (e.g., "household_totals.total_assets_gross")
    if (field?.startsWith('household_totals.')) {
      const subfield = field.replace('household_totals.', '');
      const existingValue = (taxData.household_totals as any)[subfield];

      if (this.shouldUpdateSimple(existingValue, claim.value, extraction.detected_type, path)) {
        (taxData.household_totals as any)[subfield] = claim.value;
        this.contributedPaths.push(path);
        this.stats.valuesUpdated++;
      }
    } else if (field?.startsWith('per_person.')) {
      // Handle per-person data
      const [, personId, subfield] = field.split('.');
      if (!taxData.per_person[personId]) {
        taxData.per_person[personId] = {
          allocation_percentage: 50,
          total_assets_box3: 0,
          total_debts_box3: 0,
          exempt_amount: 0,
          taxable_base: 0,
          deemed_return: 0,
          tax_assessed: 0,
        };
      }
      (taxData.per_person[personId] as any)[subfield] = claim.value;
      this.contributedPaths.push(path);
      this.stats.valuesUpdated++;
    }
  }

  /**
   * Process fiscal entity claims (person data)
   */
  private processFiscalEntityClaim(
    pathParts: any,
    claim: Box3ExtractedClaim,
    extraction: Box3DocumentExtraction
  ): void {
    const { field } = pathParts;
    if (!field) return;

    const path = `fiscal_entity.${field}`;

    // Parse field (e.g., "taxpayer.name" or "fiscal_partner.bsn_masked")
    const parts = field.split('.');
    if (parts.length < 2) return;

    const [personType, subfield] = parts;
    let target: any;

    if (personType === 'taxpayer') {
      target = this.blueprint.fiscal_entity.taxpayer;
    } else if (personType === 'fiscal_partner') {
      target = this.blueprint.fiscal_entity.fiscal_partner;
      if (claim.value && subfield !== 'has_partner') {
        target.has_partner = true;
      }
    }

    if (target && (target[subfield] === null || target[subfield] === undefined)) {
      target[subfield] = claim.value;
      this.contributedPaths.push(path);
      this.stats.valuesAdded++;
    }
  }

  /**
   * Process generic claims (fallback)
   */
  private processGenericClaim(
    path: string,
    claim: Box3ExtractedClaim,
    extraction: Box3DocumentExtraction
  ): void {
    // For paths we don't have special handling for
    logger.debug('box3-merge', `Generic claim handling for path: ${path}`);
  }

  /**
   * Determine if we should update an existing DataPoint value
   */
  private shouldUpdate(
    existing: Box3DataPoint | undefined,
    incoming: Box3DataPoint,
    incomingDocType: string,
    path: string
  ): boolean {
    // No existing value - always add
    if (!existing) return true;

    // Check for manual override
    const override = this.blueprint.manual_overrides.find(o => o.field_path === path);
    if (override) {
      // Manual override exists - never overwrite, but track as alternative
      this.recordConflict(path, existing, incoming, 'manual_override');
      this.stats.valuesSkipped++;
      return false;
    }

    // Compare authority
    const existingAuthority = DOCUMENT_AUTHORITY_RANKING[existing.source_type || 'overig'] || 10;
    const incomingAuthority = DOCUMENT_AUTHORITY_RANKING[incomingDocType] || 10;

    if (incomingAuthority > existingAuthority) {
      this.recordConflict(path, existing, incoming, 'higher_authority');
      return true;
    }

    if (incomingAuthority === existingAuthority) {
      // Same authority - compare confidence
      if ((incoming.confidence || 0) > (existing.confidence || 0)) {
        this.recordConflict(path, existing, incoming, 'higher_confidence');
        return true;
      }
    }

    // Lower authority or confidence - skip but track
    if (existing.amount !== incoming.amount) {
      this.recordConflict(path, incoming, existing, 'lower_confidence');
    }

    return false;
  }

  /**
   * Simplified update check for non-DataPoint values
   */
  private shouldUpdateSimple(
    existing: any,
    incoming: any,
    incomingDocType: string,
    path: string
  ): boolean {
    if (existing === undefined || existing === null || existing === 0) {
      return true;
    }

    // For simple values, prefer tax authority data
    const incomingAuthority = DOCUMENT_AUTHORITY_RANKING[incomingDocType] || 10;
    if (incomingAuthority >= 80) {
      return true;
    }

    return false;
  }

  /**
   * Record a merge conflict
   */
  private recordConflict(
    path: string,
    rejected: Box3DataPoint | { amount: any },
    kept: Box3DataPoint | { amount: any },
    reason: Box3MergeConflict['resolution_reason']
  ): void {
    const conflict: Box3MergeConflict = {
      id: `conflict_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      path,
      kept_value: 'amount' in kept ? kept.amount : kept,
      kept_source_doc_id: 'source_doc_id' in kept ? kept.source_doc_id || 'unknown' : 'unknown',
      kept_confidence: 'confidence' in kept ? kept.confidence || 0 : 0,
      rejected_value: 'amount' in rejected ? rejected.amount : rejected,
      rejected_source_doc_id: 'source_doc_id' in rejected ? rejected.source_doc_id || 'unknown' : 'unknown',
      rejected_confidence: 'confidence' in rejected ? rejected.confidence || 0 : 0,
      resolution_reason: reason,
      occurred_at: new Date().toISOString(),
      needs_review: reason !== 'higher_authority', // Auto-resolved by authority don't need review
    };

    this.conflicts.push(conflict);
    this.stats.conflictsDetected++;

    logger.debug('box3-merge', 'Conflict recorded', {
      path,
      reason,
      kept: conflict.kept_value,
      rejected: conflict.rejected_value,
    });
  }

  /**
   * Add document to source registry
   */
  private addToSourceRegistry(extraction: Box3DocumentExtraction): void {
    if (!this.blueprint.source_documents_registry) {
      this.blueprint.source_documents_registry = [];
    }

    // Check if already registered
    const existing = this.blueprint.source_documents_registry.find(
      d => d.file_id === extraction.document_id
    );

    if (!existing) {
      // Document is readable if it was classified (not 'overig')
      const isReadable = extraction.detected_type !== 'overig';

      this.blueprint.source_documents_registry.push({
        file_id: extraction.document_id,
        filename: extraction.document_id, // Will be updated by caller
        detected_type: extraction.detected_type,
        detected_tax_year: extraction.detected_tax_years[0]
          ? parseInt(extraction.detected_tax_years[0], 10)
          : null,
        for_person: extraction.detected_person,
        is_readable: isReadable,
        used_for_extraction: isReadable,
      });
    }
  }

  /**
   * Map extraction type to tax document type
   */
  private mapToTaxDocType(type: string): 'aangifte' | 'voorlopige_aanslag' | 'definitieve_aanslag' {
    switch (type) {
      case 'aangifte_ib':
        return 'aangifte';
      case 'aanslag_voorlopig':
        return 'voorlopige_aanslag';
      case 'aanslag_definitief':
        return 'definitieve_aanslag';
      default:
        return 'aangifte';
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a merge engine for a blueprint
 */
export function createMergeEngine(blueprint: Box3Blueprint): Box3MergeEngine {
  return new Box3MergeEngine(blueprint);
}

/**
 * Merge multiple document extractions into a blueprint
 */
export function mergeMultipleExtractions(
  blueprint: Box3Blueprint,
  extractions: Box3DocumentExtraction[]
): Box3Blueprint {
  let currentBlueprint = blueprint;

  for (const extraction of extractions) {
    const engine = new Box3MergeEngine(currentBlueprint);
    const result = engine.mergeDocumentExtraction(extraction);
    currentBlueprint = result.blueprint;
  }

  return currentBlueprint;
}
