/**
 * Box 3 V2 Schema - Canonical Data Model for Box 3 Bezwaar Dossiers
 *
 * Dit bestand bevat alle Box 3 gerelateerde database tabellen, TypeScript types,
 * en Zod validation schemas.
 *
 * ## Architectuur
 *
 * ### Drie tabellen:
 * 1. `box3_dossiers` - Metadata (normale kolommen voor queries)
 * 2. `box3_documents` - Alle uploads met classificatie
 * 3. `box3_blueprints` - Blueprint JSON blob, versioned
 *
 * ### Principe:
 * - LLM extraheert data → vult blueprint
 * - Backend rekent ermee (deterministic)
 * - Elke waarde heeft source tracking
 */

import { sql } from "drizzle-orm";
import { pgTable, text, varchar, jsonb, timestamp, boolean, index, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE TABLES
// ═══════════════════════════════════════════════════════════════════════════

export const box3Dossiers = pgTable("box3_dossiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  // Identificatie
  dossierNummer: text("dossier_nummer").unique(), // "BZ-2024-001"

  // Klant info
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email"),

  // Intake
  intakeText: text("intake_text"), // Originele mail van klant

  // Status
  status: text("status").default("intake"), // intake | in_behandeling | wacht_op_klant | klaar | afgerond
  taxYears: text("tax_years").array(), // ["2022", "2023"]
  hasFiscalPartner: boolean("has_fiscal_partner").default(false),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  statusIdx: index("box3_dossiers_status_idx").on(table.status),
  clientNameIdx: index("box3_dossiers_client_name_idx").on(table.clientName),
  createdAtIdx: index("box3_dossiers_created_at_idx").on(table.createdAt),
}));

export const box3Documents = pgTable("box3_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dossierId: varchar("dossier_id").notNull().references(() => box3Dossiers.id, { onDelete: 'cascade' }),

  // File info
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  fileData: text("file_data").notNull(), // base64

  // Upload tracking
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  uploadedVia: text("uploaded_via"), // "intake" | "aanvulling" | "hervalidatie"

  // AI classificatie (JSON voor flexibiliteit)
  classification: jsonb("classification").$type<Box3DocumentClassification>(),
  extractionSummary: text("extraction_summary"),
  extractedValues: jsonb("extracted_values").$type<Record<string, string | number | boolean | null>>(),
}, (table) => ({
  dossierIdIdx: index("box3_documents_dossier_id_idx").on(table.dossierId),
}));

export const box3Blueprints = pgTable("box3_blueprints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dossierId: varchar("dossier_id").notNull().references(() => box3Dossiers.id, { onDelete: 'cascade' }),

  version: integer("version").notNull(), // 1, 2, 3...
  blueprint: jsonb("blueprint").notNull().$type<Box3Blueprint>(),

  createdAt: timestamp("created_at").defaultNow(),
  createdBy: text("created_by"), // "intake" | "aanvulling" | "hervalidatie" | "manual"
}, (table) => ({
  dossierIdIdx: index("box3_blueprints_dossier_id_idx").on(table.dossierId),
  versionIdx: index("box3_blueprints_version_idx").on(table.dossierId, table.version),
}));

// ═══════════════════════════════════════════════════════════════════════════
// TYPESCRIPT TYPES FOR BLUEPRINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * DataPoint - Elke waarde met source tracking
 */
export interface Box3DataPoint<T = number> {
  amount: T;
  source_doc_id?: string;
  source_type?: 'document' | 'email' | 'client_estimate' | 'calculation' | 'estimate';
  source_snippet?: string;
  confidence?: number; // 0.0 - 1.0
  requires_validation?: boolean;
  validation_note?: string;
}

/**
 * Person - Belastingplichtige of partner
 */
export interface Box3Person {
  id: string; // "tp_01" | "fp_01"
  name: string | null;
  bsn_masked: string | null;
  date_of_birth: string | null;
  email?: string | null;
}

export interface Box3FiscalEntity {
  taxpayer: Box3Person;
  fiscal_partner: {
    has_partner: boolean;
    id?: string;
    name?: string | null;
    bsn_masked?: string | null;
    date_of_birth?: string | null;
  };
}

/**
 * Owner reference
 */
export type Box3OwnerRef = string; // "tp_01" | "fp_01" | "joint"

/**
 * Bank/Savings Asset
 * Matches Belastingdienst "Bank- en spaartegoeden" category
 */
export interface Box3BankSavingsAsset {
  id: string;
  owner_id: Box3OwnerRef;
  description: string;
  account_masked?: string;
  bank_name?: string;
  country?: string; // NL, BE, etc. - Belastingdienst requires this
  is_joint_account: boolean;
  ownership_percentage: number;
  is_green_investment: boolean;

  yearly_data: Record<string, {
    value_jan_1?: Box3DataPoint;
    value_dec_31?: Box3DataPoint;
    interest_received?: Box3DataPoint;
    currency_result?: Box3DataPoint; // Valutaresultaten
  }>;
}

/**
 * Investment Asset
 * Matches Belastingdienst "Beleggingen" category
 */
export interface Box3InvestmentAsset {
  id: string;
  owner_id: Box3OwnerRef;
  description: string;
  institution?: string;
  account_masked?: string; // Rekeningnummer - Belastingdienst shows this
  country?: string; // NL, BE, etc. - Belastingdienst requires this
  type: 'stocks' | 'bonds' | 'funds' | 'crypto' | 'other';
  ownership_percentage: number;

  yearly_data: Record<string, {
    value_jan_1?: Box3DataPoint;
    value_dec_31?: Box3DataPoint;
    dividend_received?: Box3DataPoint;
    deposits?: Box3DataPoint; // Stortingen
    withdrawals?: Box3DataPoint; // Onttrekkingen
    realized_gains?: Box3DataPoint;
    transaction_costs?: Box3DataPoint;
    currency_result?: Box3DataPoint; // Valutaresultaten
  }>;
}

/**
 * Real Estate Asset
 * Matches Belastingdienst "Onroerende zaken" category
 * Note: This is part of "Onroerende zaken en overige bezittingen" tab
 */
export interface Box3RealEstateAsset {
  id: string;
  owner_id: Box3OwnerRef;
  description: string;
  address: string;
  postcode?: string; // Belastingdienst shows this
  house_number?: string; // Belastingdienst shows this
  country?: string; // NL or buitenland - Belastingdienst distinguishes this
  type: 'rented_residential' | 'rented_commercial' | 'vacation_home' | 'land' | 'other';
  ownership_percentage: number;
  ownership_note?: string;

  // Belastingdienst specific fields
  is_dwelling?: boolean; // Is het een woning?
  has_rent_protection?: boolean; // Huurbescherming (affects valuation)
  is_foreign?: boolean; // Buitenland onroerend goed

  yearly_data: Record<string, {
    woz_value?: Box3DataPoint & { reference_date?: string };
    economic_value?: Box3DataPoint;
    rental_value_jan_1?: Box3DataPoint; // Huurwaarde 1 januari
    rental_value_dec_31?: Box3DataPoint; // Huurwaarde 31 december
    rental_income_gross?: Box3DataPoint;
    maintenance_costs?: Box3DataPoint;
    property_tax?: Box3DataPoint;
    insurance?: Box3DataPoint;
    other_costs?: Box3DataPoint;
  }>;
}

/**
 * Other Asset
 * Matches Belastingdienst "Overige bezittingen" (part of "Onroerende zaken en overige bezittingen" tab)
 * Includes: Kapitaalverzekeringen, Uitgeleend geld, Contant geld, Periodieke uitkeringen, etc.
 */
export interface Box3OtherAsset {
  id: string;
  owner_id: Box3OwnerRef;
  description: string;
  type:
    | 'vve_share' // VvE reserve
    | 'claims' // Vorderingen
    | 'rights' // Rechten
    | 'capital_insurance' // Kapitaalverzekering eigen woning / Kapitaalverzekering
    | 'loaned_money' // Uitgeleend geld aan derden
    | 'cash' // Contant geld
    | 'periodic_benefits' // Periodieke uitkeringen (lijfrente etc.)
    | 'other';

  // Extra details afhankelijk van type
  insurance_policy_number?: string; // Voor kapitaalverzekeringen
  borrower_name?: string; // Voor uitgeleend geld
  country?: string; // NL of buitenland

  yearly_data: Record<string, {
    value_jan_1?: Box3DataPoint;
    value_dec_31?: Box3DataPoint;
    income_received?: Box3DataPoint;
    premium_paid?: Box3DataPoint; // Voor verzekeringen
    interest_received?: Box3DataPoint; // Voor uitgeleend geld
  }>;
}

/**
 * Assets container
 */
export interface Box3Assets {
  bank_savings: Box3BankSavingsAsset[];
  investments: Box3InvestmentAsset[];
  real_estate: Box3RealEstateAsset[];
  other_assets: Box3OtherAsset[];
}

/**
 * Debt
 * Matches Belastingdienst "Schulden" category
 * Note: Belastingdienst distinguishes debt types (hypotheek, consumptief, etc.)
 */
export interface Box3Debt {
  id: string;
  owner_id: Box3OwnerRef;
  description: string;
  lender?: string;
  linked_asset_id?: string;
  ownership_percentage: number;

  // Belastingdienst categorization
  debt_type:
    | 'mortgage_box3' // Hypotheek (niet eigen woning, die is box 1)
    | 'mortgage_box1_residual' // Restschuld eigen woning
    | 'consumer_credit' // Consumptief krediet
    | 'personal_loan' // Persoonlijke lening
    | 'study_loan' // Studieschuld
    | 'tax_debt' // Belastingschuld
    | 'other'; // Overige schulden

  country?: string; // NL of buitenland

  yearly_data: Record<string, {
    value_jan_1?: Box3DataPoint;
    value_dec_31?: Box3DataPoint;
    interest_paid?: Box3DataPoint; // Betaalde rente
    interest_rate?: Box3DataPoint<number>; // percentage
    currency_result?: Box3DataPoint; // Valutaresultaten
  }>;
}

/**
 * Tax Authority Data - per person
 */
export interface Box3TaxAuthorityPersonData {
  allocation_percentage: number;
  total_assets_box3: number;
  total_debts_box3: number;
  exempt_amount: number;
  taxable_base: number;
  deemed_return: number;
  tax_assessed: number;
}

/**
 * Tax Authority Data - per year
 */
export interface Box3TaxAuthorityYearData {
  source_doc_id: string;
  document_type: 'aangifte' | 'voorlopige_aanslag' | 'definitieve_aanslag';
  document_date?: string;

  per_person: Record<string, Box3TaxAuthorityPersonData>;

  household_totals: {
    total_assets_gross: number;
    total_debts: number;
    net_assets: number;
    total_exempt: number;
    taxable_base: number;
    deemed_return?: number; // Box 3 inkomen = belastbaar inkomen uit sparen en beleggen
    total_tax_assessed: number;
  };
}

/**
 * Year Summary - status and calculations
 */
export type Box3CompletenessStatus = 'complete' | 'incomplete' | 'not_applicable';
export type Box3YearStatus = 'no_data' | 'incomplete' | 'ready_for_calculation' | 'complete';

export interface Box3MissingItem {
  field: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: 'ask_client' | 'search_documents' | 'manual_entry';
}

export interface Box3CalculatedTotals {
  total_assets_jan_1: number;
  actual_return: {
    bank_interest: number;
    investment_gain: number;
    dividends: number;
    rental_income_net: number;
    debt_interest_paid: number;
    total: number;
  };
  deemed_return_from_tax_authority: number;
  difference: number;
  indicative_refund: number;
  is_profitable: boolean;
}

export interface Box3YearSummary {
  status: Box3YearStatus;
  completeness: {
    bank_savings: Box3CompletenessStatus;
    investments: Box3CompletenessStatus;
    real_estate: Box3CompletenessStatus;
    debts: Box3CompletenessStatus;
    tax_return: Box3CompletenessStatus;
  };
  missing_items: Box3MissingItem[];
  calculated_totals?: Box3CalculatedTotals;
}

/**
 * Validation Flag
 */
export interface Box3ValidationFlag {
  id: string;
  field_path: string;
  type: 'requires_validation' | 'low_confidence' | 'inconsistency';
  message: string;
  severity: 'low' | 'medium' | 'high';
  created_at: string;
  resolved_at?: string;
}

/**
 * Manual Override
 */
export interface Box3ManualOverrideV2 {
  id: string;
  field_path: string;
  original_value: number | string | null;
  override_value: number | string;
  reason: string;
  created_at: string;
  created_by: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MERGE ENGINE TYPES (V3 Extensions)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enhanced DataPoint with full provenance tracking
 * Used by merge engine to track source and alternatives
 */
export interface Box3EnhancedDataPoint<T = number> {
  value: T;

  // Source tracking
  source_doc_id: string;
  source_type: 'document' | 'email' | 'manual_entry' | 'calculation' | 'default';
  source_snippet?: string;
  extraction_date: string;

  // Quality indicators
  confidence: number; // 0.0 - 1.0
  requires_validation: boolean;
  validation_note?: string;

  // Alternative values (when conflicts were detected)
  alternative_values?: Array<{
    value: T;
    source_doc_id: string;
    confidence: number;
    reason_not_used: 'lower_confidence' | 'lower_authority' | 'manual_override_preserved' | 'older_extraction';
  }>;

  // Override tracking
  is_overridden: boolean;
  original_extracted_value?: T;
}

/**
 * Document Authority Ranking
 * Higher number = higher authority, wins in conflicts
 */
export const DOCUMENT_AUTHORITY_RANKING: Record<string, number> = {
  // Belastingdienst bronnen (hoogste autoriteit voor "hun versie")
  'definitieve_aanslag': 100,
  'aanslag_definitief': 100,
  'voorlopige_aanslag': 90,
  'aanslag_voorlopig': 90,
  'aangifte_ib': 80,

  // Financiele instellingen (hoogste autoriteit voor werkelijke waarden)
  'jaaroverzicht_bank': 95,
  'jaaropgave_bank': 95,
  'spaarrekeningoverzicht': 95,
  'effectenoverzicht': 95,

  // Overheid
  'woz_beschikking': 95,

  // Overig
  'hypotheekoverzicht': 85,
  'leningoverzicht': 85,
  'dividendnota': 80,
  'email_body': 30,
  'client_estimate': 20,
  'overig': 10,
};

/**
 * Extracted Claim - What a document claims about a field
 */
export interface Box3ExtractedClaim {
  path: string;           // e.g., "assets.bank_savings[0].yearly_data.2023.value_jan_1"
  value: any;
  confidence: number;
  source_snippet?: string;
}

/**
 * Document Extraction Result
 * What we extracted from a single document
 */
export interface Box3DocumentExtraction {
  document_id: string;
  extraction_version: number;
  extracted_at: string;
  model_used: string;

  // Document classification
  detected_type: Box3SourceDocumentEntry['detected_type'];
  detected_tax_years: string[];
  detected_person: 'taxpayer' | 'partner' | 'both' | null;

  // Extracted claims
  claims: Box3ExtractedClaim[];

  // For asset matching
  asset_identifiers?: {
    bank_accounts?: Array<{ account_last4: string; bank_name: string; iban_pattern?: string }>;
    real_estate?: Array<{ address: string; postcode?: string }>;
    investments?: Array<{ account_number: string; institution: string }>;
  };
}

/**
 * Merge Conflict - When two sources disagree
 */
export interface Box3MergeConflict {
  id: string;
  path: string;

  // What was kept
  kept_value: any;
  kept_source_doc_id: string;
  kept_confidence: number;

  // What was rejected
  rejected_value: any;
  rejected_source_doc_id: string;
  rejected_confidence: number;

  // Resolution
  resolution_reason: 'higher_confidence' | 'higher_authority' | 'newer_document' | 'manual_override' | 'lower_confidence' | 'lower_authority';
  occurred_at: string;

  // For UI review
  needs_review: boolean;
  reviewed_at?: string;
  reviewed_by?: string;
}

/**
 * Document Contribution - Tracks what each document contributed to blueprint
 */
export interface Box3DocumentContribution {
  document_id: string;
  document_type: string;
  contributed_paths: string[];
  extraction_version: number;
  extracted_at: string;
}

/**
 * Asset Matcher Result
 */
export interface Box3AssetMatchResult {
  matched: boolean;
  index?: number;
  match_reason?: 'account_number' | 'iban' | 'address' | 'description';
  confidence: number;
}

/**
 * Document Classification (for box3_documents.classification)
 */
export interface Box3DocumentClassification {
  document_type: 'aangifte_ib' | 'definitieve_aanslag' | 'voorlopige_aanslag' |
    'jaaroverzicht_bank' | 'spaarrekeningoverzicht' | 'effectenoverzicht' |
    'dividendnota' | 'woz_beschikking' | 'hypotheekoverzicht' |
    'leningoverzicht' | 'overig';
  tax_years: string[];
  for_person: string | null; // person id or null = both
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Source Document Registry Entry - tracks what docs were analyzed
 */
export interface Box3SourceDocumentEntry {
  file_id: string;
  filename: string;
  detected_type: 'aangifte_ib' | 'aanslag_definitief' | 'aanslag_voorlopig' |
    'jaaropgave_bank' | 'woz_beschikking' | 'email_body' | 'overig';
  detected_tax_year: number | null;
  for_person?: string | null; // person id (taxpayer/partner) or null = both/unknown
  is_readable: boolean;
  used_for_extraction: boolean;
  notes?: string;
}

/**
 * Complete Blueprint - The canonical data structure
 */
export interface Box3Blueprint {
  schema_version: string;

  source_documents_registry?: Box3SourceDocumentEntry[];
  fiscal_entity: Box3FiscalEntity;
  assets: Box3Assets;
  debts: Box3Debt[];
  tax_authority_data: Record<string, Box3TaxAuthorityYearData>;
  year_summaries: Record<string, Box3YearSummary>;

  validation_flags: Box3ValidationFlag[];
  manual_overrides: Box3ManualOverrideV2[];

  // V3 Merge tracking (optional for backwards compatibility)
  document_contributions?: Box3DocumentContribution[];
  merge_conflicts?: Box3MergeConflict[];
}

// ═══════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS FOR VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

export const box3DataPointSchema = z.object({
  amount: z.number(),
  source_doc_id: z.string().optional(),
  source_type: z.enum(['document', 'email', 'client_estimate', 'calculation', 'estimate']).optional(),
  source_snippet: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  requires_validation: z.boolean().optional(),
  validation_note: z.string().optional(),
});

export const box3PersonSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  bsn_masked: z.string().nullable(),
  date_of_birth: z.string().nullable(),
  email: z.string().nullable().optional(),
});

export const box3FiscalEntitySchema = z.object({
  taxpayer: box3PersonSchema,
  fiscal_partner: z.object({
    has_partner: z.boolean(),
    id: z.string().optional(),
    name: z.string().nullable().optional(),
    bsn_masked: z.string().nullable().optional(),
    date_of_birth: z.string().nullable().optional(),
  }),
});

export const box3DocumentClassificationSchema = z.object({
  document_type: z.enum([
    'aangifte_ib', 'definitieve_aanslag', 'voorlopige_aanslag',
    'jaaroverzicht_bank', 'spaarrekeningoverzicht', 'effectenoverzicht',
    'dividendnota', 'woz_beschikking', 'hypotheekoverzicht',
    'leningoverzicht', 'overig'
  ]),
  tax_years: z.array(z.string()),
  for_person: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const box3YearSummarySchema = z.object({
  status: z.enum(['no_data', 'incomplete', 'ready_for_calculation', 'complete']),
  completeness: z.object({
    bank_savings: z.enum(['complete', 'incomplete', 'not_applicable']),
    investments: z.enum(['complete', 'incomplete', 'not_applicable']),
    real_estate: z.enum(['complete', 'incomplete', 'not_applicable']),
    debts: z.enum(['complete', 'incomplete', 'not_applicable']),
    tax_return: z.enum(['complete', 'incomplete', 'not_applicable']),
  }),
  missing_items: z.array(z.object({
    field: z.string(),
    description: z.string(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    action: z.enum(['ask_client', 'search_documents', 'manual_entry']),
  })),
  calculated_totals: z.object({
    total_assets_jan_1: z.number(),
    actual_return: z.object({
      bank_interest: z.number(),
      investment_gain: z.number(),
      dividends: z.number(),
      rental_income_net: z.number(),
      debt_interest_paid: z.number(),
      total: z.number(),
    }),
    deemed_return_from_tax_authority: z.number(),
    difference: z.number(),
    indicative_refund: z.number(),
    is_profitable: z.boolean(),
  }).optional(),
});

// Source document entry schema for LLM output
export const box3SourceDocumentEntrySchema = z.object({
  file_id: z.string(),
  filename: z.string(),
  detected_type: z.enum(['aangifte_ib', 'aanslag_definitief', 'aanslag_voorlopig',
    'jaaropgave_bank', 'woz_beschikking', 'email_body', 'overig']),
  detected_tax_year: z.number().nullable(),
  for_person: z.string().nullable().optional(),
  is_readable: z.boolean(),
  used_for_extraction: z.boolean(),
  notes: z.string().optional(),
});

// Partial blueprint schema for LLM output validation (more lenient)
export const box3BlueprintPartialSchema = z.object({
  schema_version: z.string(),
  source_documents_registry: z.array(box3SourceDocumentEntrySchema).optional(),
  fiscal_entity: box3FiscalEntitySchema.optional(),
  assets: z.object({
    bank_savings: z.array(z.any()).optional(),
    investments: z.array(z.any()).optional(),
    real_estate: z.array(z.any()).optional(),
    other_assets: z.array(z.any()).optional(),
  }).optional(),
  debts: z.array(z.any()).optional(),
  tax_authority_data: z.record(z.any()).optional(),
  year_summaries: z.record(box3YearSummarySchema).optional(),
  validation_flags: z.array(z.any()).optional(),
  manual_overrides: z.array(z.any()).optional(),
}).passthrough();

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export type Box3Dossier = typeof box3Dossiers.$inferSelect;
export type InsertBox3Dossier = typeof box3Dossiers.$inferInsert;

export type Box3Document = typeof box3Documents.$inferSelect;
export type InsertBox3Document = typeof box3Documents.$inferInsert;

// Light version without file_data for list views (performance optimization)
export type Box3DocumentLight = Omit<Box3Document, 'fileData'>;

export type Box3BlueprintRecord = typeof box3Blueprints.$inferSelect;
export type InsertBox3BlueprintRecord = typeof box3Blueprints.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// INSERT SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const insertBox3DossierSchema = createInsertSchema(box3Dossiers, {
  clientName: z.string().min(1, "Klantnaam is verplicht"),
  clientEmail: z.string().email().optional().nullable(),
  status: z.enum(['intake', 'in_behandeling', 'wacht_op_klant', 'klaar', 'afgerond']).optional(),
  taxYears: z.array(z.string()).optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const insertBox3DocumentSchema = createInsertSchema(box3Documents, {
  dossierId: z.string().uuid("Ongeldige dossier ID"),
  filename: z.string().min(1, "Filename is verplicht"),
  mimeType: z.string().min(1, "MIME type is verplicht"),
  fileSize: z.number().positive(),
  fileData: z.string().min(1, "File data is verplicht"),
  uploadedVia: z.enum(['intake', 'aanvulling', 'hervalidatie']).optional(),
  classification: box3DocumentClassificationSchema.optional(),
}).omit({ id: true, uploadedAt: true });

export const insertBox3BlueprintSchema = createInsertSchema(box3Blueprints, {
  dossierId: z.string().uuid("Ongeldige dossier ID"),
  version: z.number().int().positive(),
  blueprint: box3BlueprintPartialSchema,
  createdBy: z.enum(['intake', 'aanvulling', 'hervalidatie', 'manual']).optional(),
}).omit({ id: true, createdAt: true });

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-STAGE PIPELINE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stage 1: Document Classification Result
 */
export interface Box3ClassificationResult {
  document_id: string;
  detected_type: Box3SourceDocumentEntry['detected_type'];
  detected_tax_years: number[];
  detected_persons: Array<{
    name: string;
    bsn_last4?: string;
    role: 'taxpayer' | 'partner';
  }>;
  asset_hints: {
    bank_accounts: Array<{ bank_name: string; account_last4?: string }>;
    properties: Array<{ address?: string; postcode?: string }>;
    investments: Array<{ institution?: string }>;
  };
  confidence: number;
  notes?: string;
}

/**
 * Stage 2: Asset References (checklist from aangifte)
 */
export interface Box3AssetReferences {
  bank_count: number;
  bank_descriptions: string[];
  investment_count: number;
  investment_descriptions: string[];
  real_estate_count: number;
  real_estate_descriptions: string[];
  other_assets_count: number;
  other_descriptions: string[];
  /** Category totals per year from aangifte - for validation */
  category_totals?: Record<string, {
    bank_savings_total?: number;
    investments_total?: number;
    real_estate_total?: number;
    other_assets_total?: number;
    debts_total?: number;
  }>;
}

/**
 * Stage 2: Tax Authority Extraction Result
 */
export interface Box3TaxAuthorityExtractionResult {
  fiscal_entity: Box3FiscalEntity;
  tax_authority_data: Record<string, Box3TaxAuthorityYearData>;
  asset_references: Box3AssetReferences;
}

/**
 * Stage 3: Asset Extraction Notes (per category)
 */
export interface Box3ExtractionNotes {
  total_found: number;
  expected_from_checklist: number;
  missing: string[];
  warnings: string[];
}

/**
 * Stage 3a: Bank Extraction Result
 */
export interface Box3BankExtractionResult {
  bank_savings: Box3BankSavingsAsset[];
  extraction_notes: Box3ExtractionNotes;
}

/**
 * Stage 3b: Investment Extraction Result
 */
export interface Box3InvestmentExtractionResult {
  investments: Box3InvestmentAsset[];
  extraction_notes: Box3ExtractionNotes;
}

/**
 * Stage 3c: Real Estate Extraction Result
 */
export interface Box3RealEstateExtractionResult {
  real_estate: Box3RealEstateAsset[];
  extraction_notes: Box3ExtractionNotes & {
    peildatum_mappings?: Array<{
      peildatum: string;
      applies_to_tax_year: number;
    }>;
  };
}

/**
 * Stage 3d: Other Assets & Debts Extraction Result
 */
export interface Box3OtherAssetsExtractionResult {
  other_assets: Box3OtherAsset[];
  debts: Box3Debt[];
  extraction_notes: Box3ExtractionNotes;
}

/**
 * Stage 5: Validation Result
 */
export interface Box3ValidationResult {
  is_valid: boolean;
  checks: Box3ValidationCheck[];
  summary: {
    total_checks: number;
    passed: number;
    warnings: number;
    errors: number;
  };
}

export interface Box3ValidationCheck {
  check_type: 'asset_total' | 'asset_count' | 'interest_plausibility' | 'missing_data' | 'discrepancy';
  year?: string;
  passed: boolean;
  severity: 'info' | 'warning' | 'error';
  message: string;
  details?: {
    expected?: number;
    actual?: number;
    difference?: number;
    field?: string;
  };
}

/**
 * Multi-Stage Pipeline Progress
 */
export interface Box3PipelineProgress {
  stage: 'classification' | 'tax_authority' | 'assets' | 'merge' | 'validation' | 'complete';
  stage_number: number;
  total_stages: number;
  message: string;
  sub_progress?: {
    current: number;
    total: number;
    item?: string;
  };
}

/**
 * Multi-Stage Pipeline Result
 */
export interface Box3MultiStageResult {
  blueprint: Box3Blueprint;
  classification_results: Box3ClassificationResult[];
  tax_authority_result: Box3TaxAuthorityExtractionResult | null;
  asset_results: {
    banks: Box3BankExtractionResult | null;
    investments: Box3InvestmentExtractionResult | null;
    real_estate: Box3RealEstateExtractionResult | null;
    other: Box3OtherAssetsExtractionResult | null;
  };
  validation_result: Box3ValidationResult;
  timing: {
    total_ms: number;
    stage_times: Record<string, number>;
  };
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export function createEmptyBox3Blueprint(): Box3Blueprint {
  return {
    schema_version: "2.0",
    fiscal_entity: {
      taxpayer: {
        id: "tp_01",
        name: null,
        bsn_masked: null,
        date_of_birth: null,
      },
      fiscal_partner: {
        has_partner: false,
      },
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
    manual_overrides: [],
  };
}
