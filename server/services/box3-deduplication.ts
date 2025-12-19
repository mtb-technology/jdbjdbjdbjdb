/**
 * Box 3 Semantic Deduplication Service
 *
 * Implementeert een 4-staps deduplicatie waterval:
 * 1. EXACT MATCH - Automatisch samenvoegen (identieke IBAN + eigendom)
 * 2. HIGH PROBABILITY - Samenvoegen met logging (zelfde identifier, bedrag binnen 1%)
 * 3. POSSIBLE MATCH - LLM beoordeling + menselijke review flag
 * 4. UNCERTAIN - NOOIT automatisch samenvoegen
 *
 * Fiscale regels:
 * - Volledige IBAN is primaire sleutel
 * - Eigendomspercentage MOET matchen voor samenvoeging
 * - Peildatum MOET 1 januari zijn
 * - Bij twijfel: NIET samenvoegen (beter dubbel dan missend)
 */

import { createHash } from 'crypto';
import { logger } from './logger';
import type {
  Box3Blueprint,
  Box3BankSavingsAsset,
  Box3InvestmentAsset,
  Box3RealEstateAsset,
  Box3OtherAsset,
  Box3Debt,
  Box3AssetFingerprint,
  Box3DeduplicationMatch,
  Box3DeduplicationResult,
} from '../../shared/schema/box3';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bank name normalization mapping
 * Handles: "de Volksbank" vs "SNS" vs "ASN" vs "RegioBank"
 */
const BANK_NAME_NORMALIZATION: Record<string, string> = {
  // ING varianten
  'ing': 'ING',
  'ing bank': 'ING',
  'ing-diba': 'ING',

  // Rabobank varianten
  'rabobank': 'RABO',
  'rabo': 'RABO',
  'rabobank nederland': 'RABO',

  // ABN AMRO varianten
  'abn amro': 'ABNAMRO',
  'abn': 'ABNAMRO',
  'abnamro': 'ABNAMRO',
  'abn amro bank': 'ABNAMRO',

  // Volksbank groep
  'sns': 'SNS',
  'sns bank': 'SNS',
  'asn': 'ASN',
  'asn bank': 'ASN',
  'regiobank': 'REGIOBANK',
  'de volksbank': 'VOLKSBANK',

  // Triodos
  'triodos': 'TRIODOS',
  'triodos bank': 'TRIODOS',

  // Beleggingsplatformen
  'degiro': 'DEGIRO',
  'de giro': 'DEGIRO',
  'binck': 'BINCK',
  'binckbank': 'BINCK',
  'saxo': 'SAXO',
  'saxo bank': 'SAXO',

  // Neobanken
  'bunq': 'BUNQ',
  'knab': 'KNAB',
  'revolut': 'REVOLUT',
  'n26': 'N26',
};

/**
 * Match thresholds
 */
const THRESHOLDS = {
  EXACT_MATCH_AMOUNT_TOLERANCE: 0,        // €0 verschil
  HIGH_MATCH_AMOUNT_TOLERANCE: 0.01,      // 1% verschil
  POSSIBLE_MATCH_AMOUNT_TOLERANCE: 0.05,  // 5% verschil
  WOZ_VALUE_TOLERANCE: 0.05,              // 5% voor WOZ waardes
};

// ═══════════════════════════════════════════════════════════════════════════
// FINGERPRINT GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize bank/institution name for consistent matching
 */
export function normalizeInstitutionName(name: string | undefined): string {
  if (!name) return 'UNKNOWN';

  const normalized = name.toLowerCase().trim();

  // Check exact matches first
  if (BANK_NAME_NORMALIZATION[normalized]) {
    return BANK_NAME_NORMALIZATION[normalized];
  }

  // Check partial matches
  for (const [key, value] of Object.entries(BANK_NAME_NORMALIZATION)) {
    if (normalized.includes(key)) {
      return value;
    }
  }

  // Return uppercase version if no match found
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}

/**
 * Extract IBAN from various formats
 * Handles: NL91INGB0001234567, NL91 INGB 0001 2345 67, ****1234
 */
export function extractIBAN(accountMasked: string | undefined): { full?: string; last4?: string } {
  if (!accountMasked) return {};

  // Remove spaces and convert to uppercase
  const cleaned = accountMasked.replace(/\s/g, '').toUpperCase();

  // Full IBAN pattern: NL + 2 digits + 4 letters + 10 digits
  const ibanMatch = cleaned.match(/([A-Z]{2}\d{2}[A-Z]{4}\d{10})/);
  if (ibanMatch) {
    return {
      full: ibanMatch[1],
      last4: ibanMatch[1].slice(-4),
    };
  }

  // Masked pattern: ****1234 or NL**INGB****1234
  const maskedMatch = cleaned.match(/\*+(\d{4})$/);
  if (maskedMatch) {
    return { last4: maskedMatch[1] };
  }

  // Just last 4 digits
  const last4Match = cleaned.match(/(\d{4})$/);
  if (last4Match) {
    return { last4: last4Match[1] };
  }

  return {};
}

/**
 * Normalize address for comparison
 */
export function normalizeAddress(address: string | undefined): string {
  if (!address) return '';

  return address
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/straat/g, 'str')
    .replace(/laan/g, 'ln')
    .replace(/weg/g, 'wg')
    .replace(/plein/g, 'pln')
    .replace(/[.,]/g, '')
    .trim();
}

/**
 * Get amount for a specific year from asset
 */
function getAmountForYear(asset: any, year: string): number {
  const yearData = asset.yearly_data?.[year];
  if (!yearData) return 0;

  // Try different value fields
  const value = yearData.value_jan_1?.amount
    ?? yearData.woz_value?.amount
    ?? yearData.value_jan_1
    ?? yearData.woz_value
    ?? 0;

  return typeof value === 'number' ? value : 0;
}

/**
 * Generate fingerprint for a bank savings asset
 */
export function generateBankFingerprint(asset: Box3BankSavingsAsset, years: string[]): Box3AssetFingerprint {
  const iban = extractIBAN(asset.account_masked);

  const amounts: Record<string, number> = {};
  for (const year of years) {
    const amount = getAmountForYear(asset, year);
    if (amount > 0) amounts[year] = amount;
  }

  const primaryId = iban.full || `${normalizeInstitutionName(asset.bank_name)}-${iban.last4 || 'UNKNOWN'}`;

  return {
    iban_full: iban.full,
    institution_normalized: normalizeInstitutionName(asset.bank_name),
    account_last4: iban.last4,
    ownership_percentage: asset.ownership_percentage,
    amounts_by_year: amounts,
    category: 'bank_savings',
    fingerprint_hash: createHash('md5').update(`bank:${primaryId}:${asset.ownership_percentage}`).digest('hex'),
  };
}

/**
 * Generate fingerprint for an investment asset
 */
export function generateInvestmentFingerprint(asset: Box3InvestmentAsset, years: string[]): Box3AssetFingerprint {
  const iban = extractIBAN(asset.account_masked);

  const amounts: Record<string, number> = {};
  for (const year of years) {
    const amount = getAmountForYear(asset, year);
    if (amount > 0) amounts[year] = amount;
  }

  const primaryId = iban.full || `${normalizeInstitutionName(asset.institution)}-${iban.last4 || 'UNKNOWN'}`;

  return {
    iban_full: iban.full,
    institution_normalized: normalizeInstitutionName(asset.institution),
    account_last4: iban.last4,
    ownership_percentage: asset.ownership_percentage,
    amounts_by_year: amounts,
    category: 'investments',
    asset_type: asset.type,
    fingerprint_hash: createHash('md5').update(`inv:${primaryId}:${asset.ownership_percentage}`).digest('hex'),
  };
}

/**
 * Generate fingerprint for a real estate asset
 */
export function generateRealEstateFingerprint(asset: Box3RealEstateAsset, years: string[]): Box3AssetFingerprint {
  const normalizedAddress = normalizeAddress(asset.address);

  const amounts: Record<string, number> = {};
  for (const year of years) {
    const amount = getAmountForYear(asset, year);
    if (amount > 0) amounts[year] = amount;
  }

  // Primary ID: postcode + house number or normalized address
  const primaryId = asset.postcode && asset.house_number
    ? `${asset.postcode}-${asset.house_number}`
    : normalizedAddress;

  return {
    address_normalized: normalizedAddress,
    institution_normalized: 'VASTGOED',
    postcode: asset.postcode,
    ownership_percentage: asset.ownership_percentage,
    amounts_by_year: amounts,
    category: 'real_estate',
    asset_type: asset.type,
    fingerprint_hash: createHash('md5').update(`re:${primaryId}:${asset.ownership_percentage}`).digest('hex'),
  };
}

/**
 * Generate fingerprint for other assets
 * Note: Box3OtherAsset doesn't have ownership_percentage, so we default to 100
 */
export function generateOtherAssetFingerprint(asset: Box3OtherAsset, years: string[]): Box3AssetFingerprint {
  const normalizedDesc = asset.description?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30) || 'unknown';

  const amounts: Record<string, number> = {};
  for (const year of years) {
    const amount = getAmountForYear(asset, year);
    if (amount > 0) amounts[year] = amount;
  }

  // Other assets don't have explicit ownership_percentage in the schema
  // Default to 100% (full ownership by this household)
  const ownershipPercentage = 100;

  return {
    institution_normalized: normalizedDesc.toUpperCase(),
    ownership_percentage: ownershipPercentage,
    amounts_by_year: amounts,
    category: 'other_assets',
    asset_type: asset.type,
    fingerprint_hash: createHash('md5').update(`other:${normalizedDesc}:${ownershipPercentage}`).digest('hex'),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4-STEP DEDUPLICATION WATERFALL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compare two fingerprints and determine match level
 */
export function compareFingerprints(
  fpA: Box3AssetFingerprint,
  fpB: Box3AssetFingerprint,
  idA: string,
  idB: string
): Box3DeduplicationMatch | null {
  // Different categories = no match
  if (fpA.category !== fpB.category) return null;

  const matchedOn: string[] = [];
  const conflicts: string[] = [];

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1: EXACT MATCH - Same primary identifier + same ownership
  // ═══════════════════════════════════════════════════════════════════════

  // Check primary identifier match
  let hasPrimaryMatch = false;

  if (fpA.iban_full && fpB.iban_full && fpA.iban_full === fpB.iban_full) {
    hasPrimaryMatch = true;
    matchedOn.push('iban_full');
  }

  if (fpA.cadastral_id && fpB.cadastral_id && fpA.cadastral_id === fpB.cadastral_id) {
    hasPrimaryMatch = true;
    matchedOn.push('cadastral_id');
  }

  if (fpA.address_normalized && fpB.address_normalized && fpA.address_normalized === fpB.address_normalized) {
    hasPrimaryMatch = true;
    matchedOn.push('address_normalized');
  }

  // CRITICAL: Ownership percentage must match for merge
  const ownershipMatch = fpA.ownership_percentage === fpB.ownership_percentage;
  if (!ownershipMatch) {
    conflicts.push(`ownership_percentage differs: ${fpA.ownership_percentage}% vs ${fpB.ownership_percentage}%`);
  }

  // EXACT MATCH: Primary identifier + ownership match
  if (hasPrimaryMatch && ownershipMatch) {
    return {
      asset_a_id: idA,
      asset_b_id: idB,
      match_level: 'exact',
      match_score: 100,
      matched_on: [...matchedOn, 'ownership_percentage'],
      conflicts: [],
      recommendation: 'merge',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2: HIGH PROBABILITY - Same institution + last4 + amount within 1%
  // ═══════════════════════════════════════════════════════════════════════

  const institutionMatch = fpA.institution_normalized === fpB.institution_normalized;
  const last4Match = fpA.account_last4 && fpB.account_last4 && fpA.account_last4 === fpB.account_last4;

  // Check amount similarity
  let amountSimilarity = 0;
  let amountChecked = 0;
  for (const year of Object.keys(fpA.amounts_by_year)) {
    if (fpB.amounts_by_year[year]) {
      amountChecked++;
      const amtA = fpA.amounts_by_year[year];
      const amtB = fpB.amounts_by_year[year];
      const diff = Math.abs(amtA - amtB) / Math.max(amtA, amtB, 1);
      if (diff <= THRESHOLDS.HIGH_MATCH_AMOUNT_TOLERANCE) {
        amountSimilarity++;
        matchedOn.push(`amount_${year}_within_1%`);
      } else if (diff <= THRESHOLDS.POSSIBLE_MATCH_AMOUNT_TOLERANCE) {
        conflicts.push(`amount_${year} differs by ${(diff * 100).toFixed(1)}%`);
      } else {
        conflicts.push(`amount_${year} differs significantly: €${amtA} vs €${amtB}`);
      }
    }
  }

  if (institutionMatch) matchedOn.push('institution');
  if (last4Match) matchedOn.push('account_last4');

  // HIGH PROBABILITY: Institution + last4 + amounts within 1% + ownership match
  if (institutionMatch && last4Match && ownershipMatch && amountChecked > 0 && amountSimilarity === amountChecked) {
    return {
      asset_a_id: idA,
      asset_b_id: idB,
      match_level: 'high',
      match_score: 85,
      matched_on: matchedOn,
      conflicts,
      recommendation: 'merge',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3: POSSIBLE MATCH - Institution match + partial identifier match
  // ═══════════════════════════════════════════════════════════════════════

  if (institutionMatch && (last4Match || amountSimilarity > 0)) {
    // If ownership doesn't match, this needs review
    const recommendation = ownershipMatch ? 'review' : 'keep_separate';

    return {
      asset_a_id: idA,
      asset_b_id: idB,
      match_level: 'possible',
      match_score: 60,
      matched_on: matchedOn,
      conflicts,
      recommendation,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 4: UNCERTAIN - Some similarity but not enough to act on
  // ═══════════════════════════════════════════════════════════════════════

  if (matchedOn.length > 0) {
    return {
      asset_a_id: idA,
      asset_b_id: idB,
      match_level: 'uncertain',
      match_score: 30,
      matched_on: matchedOn,
      conflicts,
      recommendation: 'keep_separate',
    };
  }

  // No match at all
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN DEDUPLICATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run semantic deduplication on a blueprint
 *
 * @param blueprint The Box3Blueprint to deduplicate
 * @param years Tax years to consider
 * @returns Deduplicated blueprint and match results
 */
export function runSemanticDeduplication(
  blueprint: Box3Blueprint,
  years: string[]
): { blueprint: Box3Blueprint; result: Box3DeduplicationResult } {
  logger.info('box3-dedup', 'Starting semantic deduplication', {
    bank_count: blueprint.assets.bank_savings.length,
    investment_count: blueprint.assets.investments.length,
    real_estate_count: blueprint.assets.real_estate.length,
    other_count: blueprint.assets.other_assets.length,
    years,
  });

  const result: Box3DeduplicationResult = {
    original_count: {
      bank_savings: blueprint.assets.bank_savings.length,
      investments: blueprint.assets.investments.length,
      real_estate: blueprint.assets.real_estate.length,
      other_assets: blueprint.assets.other_assets.length,
      debts: blueprint.debts?.length || 0,
    },
    deduplicated_count: {
      bank_savings: 0,
      investments: 0,
      real_estate: 0,
      other_assets: 0,
      debts: 0,
    },
    matches_found: [],
    items_merged: 0,
    items_flagged_for_review: 0,
    ownership_conflicts: [],
  };

  // Generate fingerprints for all assets
  const bankFingerprints = blueprint.assets.bank_savings.map(a => ({
    asset: a,
    fingerprint: generateBankFingerprint(a, years),
  }));

  const investmentFingerprints = blueprint.assets.investments.map(a => ({
    asset: a,
    fingerprint: generateInvestmentFingerprint(a, years),
  }));

  const realEstateFingerprints = blueprint.assets.real_estate.map(a => ({
    asset: a,
    fingerprint: generateRealEstateFingerprint(a, years),
  }));

  const otherFingerprints = blueprint.assets.other_assets.map(a => ({
    asset: a,
    fingerprint: generateOtherAssetFingerprint(a, years),
  }));

  // Find all matches
  const allMatches: Box3DeduplicationMatch[] = [];

  // Compare bank accounts
  for (let i = 0; i < bankFingerprints.length; i++) {
    for (let j = i + 1; j < bankFingerprints.length; j++) {
      const match = compareFingerprints(
        bankFingerprints[i].fingerprint,
        bankFingerprints[j].fingerprint,
        bankFingerprints[i].asset.id,
        bankFingerprints[j].asset.id
      );
      if (match) allMatches.push(match);
    }
  }

  // Compare investments
  for (let i = 0; i < investmentFingerprints.length; i++) {
    for (let j = i + 1; j < investmentFingerprints.length; j++) {
      const match = compareFingerprints(
        investmentFingerprints[i].fingerprint,
        investmentFingerprints[j].fingerprint,
        investmentFingerprints[i].asset.id,
        investmentFingerprints[j].asset.id
      );
      if (match) allMatches.push(match);
    }
  }

  // Compare real estate
  for (let i = 0; i < realEstateFingerprints.length; i++) {
    for (let j = i + 1; j < realEstateFingerprints.length; j++) {
      const match = compareFingerprints(
        realEstateFingerprints[i].fingerprint,
        realEstateFingerprints[j].fingerprint,
        realEstateFingerprints[i].asset.id,
        realEstateFingerprints[j].asset.id
      );
      if (match) allMatches.push(match);
    }
  }

  // Compare other assets
  for (let i = 0; i < otherFingerprints.length; i++) {
    for (let j = i + 1; j < otherFingerprints.length; j++) {
      const match = compareFingerprints(
        otherFingerprints[i].fingerprint,
        otherFingerprints[j].fingerprint,
        otherFingerprints[i].asset.id,
        otherFingerprints[j].asset.id
      );
      if (match) allMatches.push(match);
    }
  }

  result.matches_found = allMatches;

  // Track which IDs to remove (merged into another)
  const idsToRemove = new Set<string>();
  const reviewFlags: string[] = [];

  // Process matches
  for (const match of allMatches) {
    if (match.recommendation === 'merge' && !idsToRemove.has(match.asset_a_id) && !idsToRemove.has(match.asset_b_id)) {
      // Mark second asset for removal (first one is kept)
      idsToRemove.add(match.asset_b_id);
      match.merged_into = match.asset_a_id;
      result.items_merged++;

      logger.info('box3-dedup', `Merging duplicate: ${match.asset_b_id} → ${match.asset_a_id}`, {
        match_level: match.match_level,
        matched_on: match.matched_on,
      });
    } else if (match.recommendation === 'review') {
      reviewFlags.push(match.asset_a_id, match.asset_b_id);
      result.items_flagged_for_review++;

      logger.warn('box3-dedup', `Flagged for review: ${match.asset_a_id} and ${match.asset_b_id}`, {
        match_level: match.match_level,
        conflicts: match.conflicts,
      });
    }

    // Track ownership conflicts
    if (match.conflicts.some(c => c.includes('ownership_percentage'))) {
      result.ownership_conflicts.push({
        asset_ids: [match.asset_a_id, match.asset_b_id],
        percentages: [], // Will be filled from actual assets
        message: match.conflicts.find(c => c.includes('ownership_percentage')) || '',
      });
    }
  }

  // Create deduplicated arrays
  const deduplicatedBlueprint: Box3Blueprint = {
    ...blueprint,
    assets: {
      bank_savings: blueprint.assets.bank_savings.filter(a => !idsToRemove.has(a.id)),
      investments: blueprint.assets.investments.filter(a => !idsToRemove.has(a.id)),
      real_estate: blueprint.assets.real_estate.filter(a => !idsToRemove.has(a.id)),
      other_assets: blueprint.assets.other_assets.filter(a => !idsToRemove.has(a.id)),
    },
    debts: blueprint.debts?.filter(d => !idsToRemove.has(d.id)),
  };

  // Update counts
  result.deduplicated_count = {
    bank_savings: deduplicatedBlueprint.assets.bank_savings.length,
    investments: deduplicatedBlueprint.assets.investments.length,
    real_estate: deduplicatedBlueprint.assets.real_estate.length,
    other_assets: deduplicatedBlueprint.assets.other_assets.length,
    debts: deduplicatedBlueprint.debts?.length || 0,
  };

  logger.info('box3-dedup', 'Deduplication complete', {
    items_merged: result.items_merged,
    items_flagged: result.items_flagged_for_review,
    ownership_conflicts: result.ownership_conflicts.length,
    original_total: Object.values(result.original_count).reduce((a, b) => a + b, 0),
    deduplicated_total: Object.values(result.deduplicated_count).reduce((a, b) => a + b, 0),
  });

  return { blueprint: deduplicatedBlueprint, result };
}

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-CATEGORY DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect potential duplicates ACROSS categories
 * E.g., same item in bank_savings AND investments, or investments AND other_assets
 *
 * This is separate because cross-category duplicates are more complex
 * and often indicate classification errors.
 *
 * Special case: "Vordering" items (loans to family, etc.) can appear in both
 * investments (type: 'other') and other_assets (type: 'loaned_money' or 'claims').
 * These are detected by matching descriptions containing "vordering", "lening", "hypotheek"
 * AND having the same amount.
 */
export function detectCrossCategoryDuplicates(
  blueprint: Box3Blueprint,
  years: string[]
): Box3DeduplicationMatch[] {
  const crossMatches: Box3DeduplicationMatch[] = [];

  // Generate all fingerprints
  const allFingerprints: Array<{ id: string; category: string; fingerprint: Box3AssetFingerprint; description: string }> = [];

  for (const bank of blueprint.assets.bank_savings) {
    allFingerprints.push({
      id: bank.id,
      category: 'bank_savings',
      fingerprint: generateBankFingerprint(bank, years),
      description: bank.description || '',
    });
  }

  for (const inv of blueprint.assets.investments) {
    allFingerprints.push({
      id: inv.id,
      category: 'investments',
      fingerprint: generateInvestmentFingerprint(inv, years),
      description: inv.description || '',
    });
  }

  for (const other of blueprint.assets.other_assets) {
    allFingerprints.push({
      id: other.id,
      category: 'other_assets',
      fingerprint: generateOtherAssetFingerprint(other, years),
      description: other.description || '',
    });
  }

  // Compare bank_savings vs investments (most common cross-category duplicate)
  const banks = allFingerprints.filter(f => f.category === 'bank_savings');
  const invs = allFingerprints.filter(f => f.category === 'investments');
  const others = allFingerprints.filter(f => f.category === 'other_assets');

  // Helper: check if description suggests a "vordering" type item
  const isVorderingType = (desc: string): boolean => {
    const lowerDesc = desc.toLowerCase();
    return lowerDesc.includes('vordering') ||
           lowerDesc.includes('lening') ||
           lowerDesc.includes('hypotheek') ||
           lowerDesc.includes('uitgeleend') ||
           lowerDesc.includes('familielening') ||
           lowerDesc.includes('aan zoon') ||
           lowerDesc.includes('aan dochter') ||
           lowerDesc.includes('aan familie');
  };

  // Helper: check if amounts match within tolerance (1%)
  const amountsMatch = (fpA: Box3AssetFingerprint, fpB: Box3AssetFingerprint): boolean => {
    for (const year of Object.keys(fpA.amounts_by_year)) {
      if (fpB.amounts_by_year[year]) {
        const amtA = fpA.amounts_by_year[year];
        const amtB = fpB.amounts_by_year[year];
        const diff = Math.abs(amtA - amtB) / Math.max(amtA, amtB, 1);
        if (diff <= 0.01) return true; // Within 1%
      }
    }
    return false;
  };

  // 1. Bank vs Investment duplicates (IBAN-based)
  for (const bank of banks) {
    for (const inv of invs) {
      const sameIBAN = bank.fingerprint.iban_full && inv.fingerprint.iban_full &&
        bank.fingerprint.iban_full === inv.fingerprint.iban_full;

      const sameLast4AndInst = bank.fingerprint.account_last4 && inv.fingerprint.account_last4 &&
        bank.fingerprint.account_last4 === inv.fingerprint.account_last4 &&
        bank.fingerprint.institution_normalized === inv.fingerprint.institution_normalized;

      if (sameIBAN || sameLast4AndInst) {
        crossMatches.push({
          asset_a_id: bank.id,
          asset_b_id: inv.id,
          match_level: sameIBAN ? 'high' : 'possible',
          match_score: sameIBAN ? 80 : 60,
          matched_on: sameIBAN ? ['iban_full', 'cross_category'] : ['account_last4', 'institution', 'cross_category'],
          conflicts: [`Category mismatch: bank_savings vs investments`],
          recommendation: 'review',
        });

        logger.warn('box3-dedup', `Cross-category duplicate detected: bank ${bank.id} vs investment ${inv.id}`, {
          match_level: sameIBAN ? 'high' : 'possible',
        });
      }
    }
  }

  // 2. Investment vs Other_Assets duplicates (vordering/lening type)
  // This catches: "Overige vordering" (investment) vs "Hypotheekvordering aan zoon" (other_asset)
  for (const inv of invs) {
    for (const other of others) {
      const invIsVordering = isVorderingType(inv.description) || inv.fingerprint.asset_type === 'other';
      const otherIsVordering = isVorderingType(other.description) ||
                               other.fingerprint.asset_type === 'loaned_money' ||
                               other.fingerprint.asset_type === 'claims';

      // Both are vordering-type AND amounts match
      if (invIsVordering && otherIsVordering && amountsMatch(inv.fingerprint, other.fingerprint)) {
        crossMatches.push({
          asset_a_id: inv.id,
          asset_b_id: other.id,
          match_level: 'high',
          match_score: 85,
          matched_on: ['vordering_type', 'amount_match', 'cross_category'],
          conflicts: [`Category mismatch: investments vs other_assets - likely same "vordering" item`],
          recommendation: 'review',
        });

        logger.warn('box3-dedup', `Cross-category vordering duplicate detected: investment ${inv.id} (${inv.description}) vs other_asset ${other.id} (${other.description})`, {
          inv_amounts: inv.fingerprint.amounts_by_year,
          other_amounts: other.fingerprint.amounts_by_year,
        });
      }
    }
  }

  return crossMatches;
}
