/**
 * Report Data Types
 *
 * Strict type definitions for JSON fields in the reports table.
 * These replace the pervasive `any` types throughout the codebase.
 *
 * @see shared/schema.ts for database schema
 * @see docs/ARCHITECTURE.md for data flow documentation
 */

import { z } from 'zod';
import type { StageId } from '../schema';

// =============================================================================
// DOSSIER DATA - Input data from client (stored in reports.dossierData)
// =============================================================================

/**
 * Extended Dossier Data - runtime version that includes rawText and attachments
 *
 * The base DossierData from schema.ts is for validation at creation time.
 * This extended version is what's actually stored and passed through stages.
 */
export interface DossierDataExtended {
  klant: {
    naam: string;
    situatie: string;
  };
  fiscale_gegevens: {
    vermogen: number;
    inkomsten: number;
  };
  datum?: string;
  /** Raw text input - used primarily in Stage 1a */
  rawText?: string;
  /** Additional context added by AI analysis */
  context?: string;
}

// =============================================================================
// BOUWPLAN DATA - Report structure configuration
// =============================================================================

/**
 * Theme with optional reasoning (supports legacy string format)
 */
export type BouwplanThema = string | {
  thema: string;
  reden?: string;
};

/**
 * Risk with optional reasoning and severity
 */
export type BouwplanRisico = string | {
  risico: string;
  reden?: string;
  ernst?: 'laag' | 'middel' | 'hoog';
};

/**
 * Report section definition
 */
export interface BouwplanSectie {
  koptekst: string;
  subdoelen?: string[];
  reden_inclusie?: string;
}

/**
 * BouwplanData - AI-generated report structure from Stage 2
 */
export interface BouwplanDataExtended {
  denkwijze_samenvatting?: string;
  fiscale_kernthemas: BouwplanThema[];
  geidentificeerde_risicos: BouwplanRisico[];
  bouwplan_voor_rapport: Record<string, BouwplanSectie>;
}

// =============================================================================
// CONCEPT REPORT VERSIONS - Version tracking system
// =============================================================================

/**
 * Individual snapshot of the report at a specific stage
 */
export interface ConceptReportSnapshot {
  /** Version number (incremental) */
  v: number;
  /** Full report content at this stage */
  content: string;
  /** Which stage this was derived from */
  from?: StageId;
  /** When this version was created */
  createdAt?: string;
  /** The feedback that was processed to create this version */
  processedFeedback?: string;
  /** Source of this version (e.g., "express_mode_generation", "manual_edit") */
  source?: string;
  /** Timestamp alias (some code uses this instead of createdAt) */
  timestamp?: string;
}

/**
 * Latest pointer - tracks the most recent version
 */
export interface ConceptVersionLatest {
  /** Points to the stage key of the most recent version */
  pointer: string;
  /** Version number of that stage */
  v: number;
  /** Optional: direct content for legacy compatibility */
  content?: string;
  /** Optional: creation timestamp */
  createdAt?: string;
}

/**
 * History entry - for audit trail
 */
export interface ConceptVersionHistoryEntry {
  stageId: string;
  v: number;
  timestamp: string;
}

/**
 * Complete ConceptReportVersions structure
 *
 * This is the main versioning object stored in reports.conceptReportVersions
 * Uses string index signature for flexibility with dynamic stage keys
 */
export interface ConceptReportVersions {
  /** Stage 3 initial generation */
  '3_generatie'?: ConceptReportSnapshot;
  /** Stage 4a: Bronnen Specialist review */
  '4a_BronnenSpecialist'?: ConceptReportSnapshot;
  /** Stage 4b: Fiscaal Technisch review */
  '4b_FiscaalTechnischSpecialist'?: ConceptReportSnapshot;
  /** Stage 4c: Scenario Gaten analysis */
  '4c_ScenarioGatenAnalist'?: ConceptReportSnapshot;
  /** Stage 4e: De Advocaat review */
  '4e_DeAdvocaat'?: ConceptReportSnapshot;
  /** Stage 4f: Hoofd Communicatie review */
  '4f_HoofdCommunicatie'?: ConceptReportSnapshot;
  /** Stage 5: Eindredactie */
  '5_eindredactie'?: ConceptReportSnapshot;
  /** Pointer to the latest version */
  latest?: ConceptVersionLatest;
  /** History of all versions for audit trail */
  history?: ConceptVersionHistoryEntry[];
  /** Allow dynamic stage keys (adjustment_N, etc.) */
  [key: string]: ConceptReportSnapshot | ConceptVersionLatest | ConceptVersionHistoryEntry[] | string | undefined;
}

// =============================================================================
// STAGE RESULTS - Output from each AI stage
// =============================================================================

/**
 * Individual stage result with optional metadata
 */
export interface StageResultEntry {
  /** The review/feedback output from the AI specialist */
  review?: string;
  /** Processing result after feedback is applied */
  processing?: string;
  /** Metadata about the AI execution */
  metadata?: {
    model?: string;
    timestamp?: string;
    duration?: number;
    tokensUsed?: number;
  };
}

/**
 * StageResults - Output from all stages (stored in reports.stageResults)
 *
 * Most stage results are stored as raw strings (AI output).
 * For compatibility with existing code, this is typed as Record<string, string>
 */
export type StageResults = Record<string, string>;

// =============================================================================
// SUBSTEP RESULTS - Reviewer feedback and change proposals
// =============================================================================

/**
 * Change proposal from a reviewer stage
 */
export interface ChangeProposal {
  id: string;
  type: 'content_addition' | 'text_replacement' | 'content_removal' | 'structure_change' | 'source_addition';
  section: string;
  description: string;
  reasoning: string;
  impact: 'low' | 'medium' | 'high';
  specificText?: string;
  currentText?: string;
  newText?: string;
  location?: string;
  /** User approval status */
  approved?: boolean;
}

/**
 * Individual substep result for a reviewer stage
 */
export interface SubstepResultEntry {
  /** Raw review output */
  review?: string;
  /** Processed result after applying changes */
  processing?: string;
  /** Structured change proposals */
  changeProposals?: ChangeProposal[];
}

/**
 * SubstepResults - Reviewer feedback per stage (stored in reports.substepResults)
 */
export type SubstepResults = Record<string, SubstepResultEntry>;

// =============================================================================
// STAGE PROMPTS - Audit trail of prompts sent to AI
// =============================================================================

/**
 * StagePrompts - The exact prompts sent to AI for each stage
 */
export type StagePrompts = Record<string, string>;

// =============================================================================
// DOCUMENT STATE - TipTap editor state
// =============================================================================

/**
 * TipTap document node
 */
export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

/**
 * TipTap document state (stored in reports.documentState)
 */
export interface DocumentState {
  type: 'doc';
  content: TipTapNode[];
}

// =============================================================================
// PENDING CHANGES - Structured change proposals from specialists
// =============================================================================

/**
 * Pending change from a specialist
 */
export interface PendingChange {
  id: string;
  stageId: string;
  type: 'addition' | 'modification' | 'deletion' | 'restructure';
  section?: string;
  description: string;
  originalText?: string;
  proposedText?: string;
  reasoning: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

/**
 * PendingChanges structure (stored in reports.pendingChanges)
 */
export type PendingChanges = PendingChange[];

// =============================================================================
// DOCUMENT SNAPSHOTS - Audit trail of document changes
// =============================================================================

/**
 * Document snapshot for a specific stage
 */
export interface DocumentSnapshot {
  stageId: string;
  content: string;
  timestamp: string;
  source: 'stage_execution' | 'manual_edit' | 'feedback_processing';
}

/**
 * DocumentSnapshots structure (stored in reports.documentSnapshots)
 */
export type DocumentSnapshots = Record<string, DocumentSnapshot>;

// =============================================================================
// ROLLED BACK CHANGES - Tracking which changes have been rolled back
// =============================================================================

/**
 * RolledBackChanges structure (stored in reports.rolledBackChanges)
 */
export type RolledBackChanges = Record<string, { rolledBackAt: string }>;

// =============================================================================
// JOB PROGRESS - Background job tracking
// =============================================================================

/**
 * Stage progress within a job
 */
export interface JobStageProgress {
  stageId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  percentage: number;
  changesCount?: number;
  error?: string;
}

/**
 * JobProgress structure (stored in jobs.progress as JSON string)
 */
export interface JobProgress {
  currentStage: string;
  percentage: number;
  message: string;
  stages: JobStageProgress[];
}

/**
 * Express Mode result structure (stored in jobs.result)
 */
export interface ExpressModeJobResult {
  stages: Array<{
    stageId: string;
    stageName: string;
    changesCount: number;
    changes: Array<{
      type: string;
      description: string;
      severity: string;
      section?: string;
    }>;
    processingTimeMs?: number;
  }>;
  totalChanges: number;
  finalVersion: number;
  finalContent: string;
  fiscaleBriefing?: string;
}

/**
 * Single stage job result
 */
export interface SingleStageJobResult {
  stageId: string;
  stageOutput: string;
  prompt: string;
}

/**
 * Job result - union of possible result types
 */
export type JobResult = ExpressModeJobResult | SingleStageJobResult | Record<string, unknown>;

// =============================================================================
// PROMPT CONFIG - AI configuration from database
// =============================================================================

/**
 * AI provider type
 */
export type AIProvider = 'google' | 'openai';

/**
 * AI configuration for a stage or global
 */
export interface AIConfig {
  provider: AIProvider;
  model: string;
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens: number;
  reasoning?: {
    effort?: 'minimal' | 'low' | 'medium' | 'high';
  };
  verbosity?: 'low' | 'medium' | 'high';
  thinkingLevel?: 'low' | 'medium' | 'high';
  useDeepResearch?: boolean;
  maxQuestions?: number;
  parallelExecutors?: number;
}

/**
 * Stage-specific configuration
 */
export interface StagePromptConfig {
  prompt: string;
  useGrounding?: boolean;
  useWebSearch?: boolean;
  polishPrompt?: string;
  stepType?: 'generator' | 'reviewer' | 'processor';
  aiConfig?: AIConfig;
}

/**
 * Tool-specific AI configuration (no prompt)
 */
export interface ToolAIConfig {
  aiConfig?: AIConfig;
  description?: string;
}

/**
 * Complete PromptConfig structure (stored in prompt_configs.config)
 */
export interface PromptConfigData {
  '1a_informatiecheck'?: StagePromptConfig;
  '1b_informatiecheck_email'?: StagePromptConfig;
  '2_complexiteitscheck'?: StagePromptConfig;
  '3_generatie'?: StagePromptConfig;
  '4a_BronnenSpecialist'?: StagePromptConfig;
  '4b_FiscaalTechnischSpecialist'?: StagePromptConfig;
  '4c_ScenarioGatenAnalist'?: StagePromptConfig;
  '4e_DeAdvocaat'?: StagePromptConfig;
  '4f_HoofdCommunicatie'?: StagePromptConfig;
  '7_fiscale_briefing'?: StagePromptConfig;
  editor?: StagePromptConfig;
  adjustment?: StagePromptConfig;
  '6_change_summary'?: StagePromptConfig;
  /** Legacy key for editor */
  '5_feedback_verwerker'?: StagePromptConfig;
  test_ai?: ToolAIConfig;
  follow_up_assistant?: ToolAIConfig;
  aiConfig?: AIConfig;
}

// =============================================================================
// ZOD SCHEMAS FOR RUNTIME VALIDATION
// =============================================================================

/**
 * Zod schema for ConceptReportSnapshot
 */
export const conceptReportSnapshotSchema = z.object({
  v: z.number().int().positive(),
  content: z.string(),
  from: z.string().optional(),
  createdAt: z.string().optional(),
  processedFeedback: z.string().optional(),
  source: z.string().optional(),
  timestamp: z.string().optional(),
});

/**
 * Zod schema for ConceptVersionLatest
 */
export const conceptVersionLatestSchema = z.object({
  pointer: z.string(),
  v: z.number().int().positive(),
  content: z.string().optional(),
  createdAt: z.string().optional(),
});

/**
 * Zod schema for ConceptReportVersions
 */
export const conceptReportVersionsSchema = z.object({
  '3_generatie': conceptReportSnapshotSchema.optional(),
  '4a_BronnenSpecialist': conceptReportSnapshotSchema.optional(),
  '4b_FiscaalTechnischSpecialist': conceptReportSnapshotSchema.optional(),
  '4c_ScenarioGatenAnalist': conceptReportSnapshotSchema.optional(),
  '4e_DeAdvocaat': conceptReportSnapshotSchema.optional(),
  '4f_HoofdCommunicatie': conceptReportSnapshotSchema.optional(),
  '5_eindredactie': conceptReportSnapshotSchema.optional(),
  latest: conceptVersionLatestSchema.optional(),
  history: z.array(z.object({
    stageId: z.string(),
    v: z.number().int().positive(),
    timestamp: z.string(),
  })).optional(),
}).passthrough(); // Allow adjustment_N keys

/**
 * Zod schema for ChangeProposal
 */
export const changeProposalSchema = z.object({
  id: z.string(),
  type: z.enum(['content_addition', 'text_replacement', 'content_removal', 'structure_change', 'source_addition']),
  section: z.string(),
  description: z.string(),
  reasoning: z.string(),
  impact: z.enum(['low', 'medium', 'high']),
  specificText: z.string().optional(),
  currentText: z.string().optional(),
  newText: z.string().optional(),
  location: z.string().optional(),
  approved: z.boolean().optional(),
});

/**
 * Zod schema for SubstepResultEntry
 */
export const substepResultEntrySchema = z.object({
  review: z.string().optional(),
  processing: z.string().optional(),
  changeProposals: z.array(changeProposalSchema).optional(),
});

/**
 * Zod schema for JobProgress
 */
export const jobProgressSchema = z.object({
  currentStage: z.string(),
  percentage: z.number(),
  message: z.string(),
  stages: z.array(z.object({
    stageId: z.string(),
    status: z.enum(['pending', 'processing', 'completed', 'failed']),
    percentage: z.number(),
    changesCount: z.number().optional(),
    error: z.string().optional(),
  })),
});

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Type guard for ConceptReportSnapshot
 */
export function isConceptReportSnapshot(value: unknown): value is ConceptReportSnapshot {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.v === 'number' && typeof obj.content === 'string';
}

/**
 * Type guard for checking if a value is a string (legacy format)
 */
export function isLegacyStringSnapshot(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Extract content from a snapshot (handles both object and string formats)
 */
export function extractSnapshotContent(snapshot: unknown): string | undefined {
  if (!snapshot) return undefined;
  if (typeof snapshot === 'string' && snapshot.length > 0) return snapshot;
  if (isConceptReportSnapshot(snapshot)) return snapshot.content;
  return undefined;
}

/**
 * Type guard for ConceptReportVersions
 */
export function isConceptReportVersions(value: unknown): value is ConceptReportVersions {
  if (!value || typeof value !== 'object') return false;
  // A valid ConceptReportVersions should have at least one stage snapshot or a latest pointer
  const obj = value as Record<string, unknown>;
  return (
    obj['3_generatie'] !== undefined ||
    obj['latest'] !== undefined ||
    obj['4a_BronnenSpecialist'] !== undefined
  );
}

/**
 * Safe parse of ConceptReportVersions
 */
export function parseConceptReportVersions(value: unknown): ConceptReportVersions | null {
  const result = conceptReportVersionsSchema.safeParse(value);
  return result.success ? result.data as ConceptReportVersions : null;
}

/**
 * Safe parse of JobProgress from string
 */
export function parseJobProgress(value: string | null | undefined): JobProgress | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    const result = jobProgressSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
