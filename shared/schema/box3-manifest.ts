/**
 * Box 3 Asset Manifest Types
 *
 * The manifest is extracted directly from the aangifte IB / definitieve aanslag.
 * It represents the GROUND TRUTH - the exact classification and values as filed.
 *
 * Key principle: The aangifte determines everything. If something is listed under
 * "Bankrekeningen" in the aangifte, it IS a bank account. No reclassification.
 */

// =============================================================================
// MANIFEST TYPES (extracted from aangifte)
// =============================================================================

export interface Box3Manifest {
  schema_version: '3.0';
  extraction_timestamp: string;
  source_document_id: string; // ID of the aangifte/aanslag document

  tax_years: string[]; // e.g., ['2022', '2023']

  fiscal_entity: ManifestFiscalEntity;

  // Items EXACTLY as they appear in the aangifte
  asset_items: {
    bank_savings: ManifestBankItem[];
    investments: ManifestInvestmentItem[];
    real_estate: ManifestRealEstateItem[];
    other_assets: ManifestOtherItem[];
  };

  debt_items: ManifestDebtItem[];

  // Totals from aangifte (for validation)
  category_totals: {
    bank_savings: number;
    investments: number;
    real_estate: number;
    other_assets: number;
    debts: number;
    grand_total: number; // bezittingen - schulden
  };

  // Tax authority data per year
  tax_authority: {
    [year: string]: ManifestTaxAuthorityYear;
  };

  // Green investments (vrijstelling groene beleggingen)
  green_investments?: {
    total_value: number;
    exemption_applied: number;
  };
}

export interface ManifestFiscalEntity {
  taxpayer: {
    id: 'tp_01';
    name: string;
    bsn_masked: string;
    date_of_birth?: string;
  };
  fiscal_partner?: {
    id: 'fp_01';
    name: string;
    bsn_masked: string;
    date_of_birth?: string;
  };
  filing_type: 'individual' | 'joint'; // Samen aangifte doen?
}

export interface ManifestTaxAuthorityYear {
  grondslag_sparen_beleggen: number;
  heffingsvrij_vermogen: number;
  forfaitair_rendement: number;
  belasting_box3: number;
  // For comparison with actual returns
  rendementsgrondslag?: number;
}

// =============================================================================
// MANIFEST ITEM BASE
// =============================================================================

interface ManifestItemBase {
  // Unique ID within manifest
  manifest_id: string;

  // EXACT description from aangifte - do not modify
  description_from_aangifte: string;

  // Owner information
  owner_id: 'tp_01' | 'fp_01' | 'joint';
  ownership_percentage: number; // Usually 100, unless external co-owners

  // Values per year (from aangifte)
  yearly_values: {
    [year: string]: {
      value_jan_1: number;
      value_dec_31?: number;
    };
  };

  // After enrichment (Stage 2) - optional
  enrichment?: ManifestEnrichment;
}

export interface ManifestEnrichment {
  matched_source_doc_id?: string;
  match_confidence: number; // 0.0 - 1.0

  // Actual returns (what we need for Box 3 claim)
  interest_received?: number;
  dividends_received?: number;
  rental_income_net?: number;
  costs_paid?: number;
  capital_gains_realized?: number;

  // Additional identifiers found
  full_iban?: string;
  full_address?: string;
}

// =============================================================================
// BANK ITEM
// =============================================================================

export interface ManifestBankItem extends ManifestItemBase {
  category: 'bank_savings';

  // Identifier hints from aangifte (for matching with source docs)
  iban_from_aangifte?: string; // Could be full or partial (masked)
  bank_name?: string; // e.g., "ING", "Rabobank", "BinckBank"

  // Special flags
  is_joint_account?: boolean; // "J W OTTO en/of G C OTTO-WORTELBOER"
  is_foreign_account?: boolean; // Land !== Nederland
  foreign_country?: string;
}

// =============================================================================
// INVESTMENT ITEM
// =============================================================================

export interface ManifestInvestmentItem extends ManifestItemBase {
  category: 'investments';

  // Identifier hints
  account_number?: string; // e.g., "10126", "Janotto", "NL07BICK0807803936"
  institution?: string; // e.g., "DEGIRO", "BinckBank", "ABN AMRO"

  // Investment type hints
  investment_type_hint?:
    | 'stocks'
    | 'bonds'
    | 'funds'
    | 'etf'
    | 'real_estate_fund'
    | 'crowdfunding'
    | 'other';

  // Green investment flag
  is_green_investment?: boolean;

  // Foreign withholding tax (for tax credit)
  foreign_tax_withheld?: {
    country: string;
    amount: number;
    dividend_amount?: number;
  }[];

  // Dutch dividend tax withheld
  dutch_dividend_tax_withheld?: number;
}

// =============================================================================
// REAL ESTATE ITEM
// =============================================================================

export interface ManifestRealEstateItem extends ManifestItemBase {
  category: 'real_estate';

  // Address from aangifte
  address?: {
    postcode: string;
    house_number: string;
    addition?: string;
    city?: string;
  };

  // WOZ value
  woz_value?: number;
  woz_peildatum?: string; // e.g., "1 januari 2021" for 2022

  // Property type
  property_type?: 'eigen_woning' | 'verhuurde_woning' | 'vakantiewoning' | 'grond' | 'overig';

  // Is this the main residence (eigen woning)?
  is_hoofdverblijf?: boolean;
}

// =============================================================================
// OTHER ASSETS ITEM
// =============================================================================

export interface ManifestOtherItem extends ManifestItemBase {
  category: 'other_assets';

  // Type of other asset
  asset_type:
    | 'loaned_money' // Uitgeleend geld / vorderingen
    | 'claims' // Schenkingen op papier
    | 'vve_share' // Aandeel VvE
    | 'crypto' // Virtuele betaalmiddelen
    | 'movable_property' // Roerende zaken
    | 'trust' // Trustvermogen
    | 'usufruct' // Vruchtgebruik
    | 'other';

  // For loaned_money: details about the loan
  loan_details?: {
    borrower_name?: string;
    interest_rate?: number;
    is_family_loan?: boolean;
  };
}

// =============================================================================
// DEBT ITEM
// =============================================================================

export interface ManifestDebtItem extends ManifestItemBase {
  category: 'debt';

  // Creditor information
  creditor_name?: string;
  loan_number?: string;

  // Is this a mortgage for the main residence (Box 1)?
  is_eigen_woning_schuld?: boolean;

  // If eigen woning schuld: related to which property?
  related_property_postcode?: string;

  // Debt details
  interest_paid?: number;
  is_annuity_or_linear?: boolean;
  loan_start_date?: string;
  loan_end_date?: string;
}

// =============================================================================
// ENRICHED MANIFEST (after Stage 2)
// =============================================================================

export interface Box3EnrichedManifest extends Box3Manifest {
  enrichment_timestamp: string;
  enrichment_stats: {
    bank_items_matched: number;
    bank_items_total: number;
    investment_items_matched: number;
    investment_items_total: number;
    other_items_matched: number;
    other_items_total: number;
    debt_items_matched: number;
    debt_items_total: number;
  };

  // Items that couldn't be matched to source documents
  unmatched_items: Array<{
    manifest_id: string;
    category: string;
    description: string;
    note: string;
  }>;

  // Source documents that didn't match any manifest item
  unmatched_source_docs: Array<{
    doc_id: string;
    doc_type: string;
    reason: string;
  }>;
}

// =============================================================================
// VALIDATION RESULT
// =============================================================================

export interface ManifestValidationResult {
  is_valid: boolean;
  total_difference: number; // Should be 0 if valid
  percentage_difference: number;

  per_category: {
    bank_savings: CategoryValidation;
    investments: CategoryValidation;
    other_assets: CategoryValidation;
    debts: CategoryValidation;
  };

  warnings: string[];
  errors: string[];
}

interface CategoryValidation {
  expected_count: number;
  extracted_count: number;
  expected_total: number;
  extracted_total: number;
  difference: number;
  is_match: boolean;
}

// =============================================================================
// ACTUAL RETURN CALCULATION
// =============================================================================

export interface ActualReturnCalculation {
  tax_year: string;

  // Components of actual return
  bank_interest: number;
  dividends: number;
  rental_income_net: number;
  other_income: number;
  costs_deductible: number;
  debt_interest_paid: number;

  // Totals
  total_actual_return: number;
  forfaitair_rendement: number; // From tax authority
  difference: number; // actual - forfaitair (negative = favorable)

  // Indicative refund
  indicative_refund: number;
  is_claim_profitable: boolean; // difference < -€250 threshold
}
