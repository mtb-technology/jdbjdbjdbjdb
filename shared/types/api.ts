/**
 * Strikte API type definities voor type-safe communicatie
 * tussen frontend en backend
 */

import { z } from 'zod';
import type {
  Report, InsertReport,
  DossierData, BouwplanData,
  PromptConfig, AiConfig,
  User, InsertUser
} from '../schema';
import {
  conceptReportVersionsSchema,
  substepResultEntrySchema,
  type ConceptReportVersions,
  type SubstepResults,
  type StageResults,
  type StagePrompts,
} from './report-data';

// ===== REQUEST SCHEMAS =====

// Report Creation Request (NEW - for /api/reports/create)
export const createReportRequestSchema = z.object({
  clientName: z.string()
    .min(1, "Clientnaam is verplicht")
    .max(200, "Clientnaam mag niet langer zijn dan 200 karakters")
    .regex(/^[a-zA-Z0-9\s\-\.,']+$/, "Clientnaam bevat ongeldige karakters"),
  rawText: z.string()
    .min(10, "Ruwe tekst moet minimaal 10 karakters bevatten")
    .max(5000000, "Ruwe tekst mag niet langer zijn dan 5MB (5.000.000 karakters)") // ✅ FIX: Verhoogd voor grote PDF uploads
});

// Report Generation Request (LEGACY - kept for backwards compatibility)
export const generateReportRequestSchema = z.object({
  dossier: z.object({
    klant: z.object({
      naam: z.string().min(1, "Naam is verplicht").max(200, "Naam te lang"),
      situatie: z.string().min(10, "Situatie moet minimaal 10 karakters bevatten").max(2000, "Situatie te lang"),
    }),
    fiscale_gegevens: z.object({
      vermogen: z.number().min(0, "Vermogen moet positief zijn").max(100000000, "Vermogen te hoog"),
      inkomsten: z.number().min(0, "Inkomsten moeten positief zijn").max(10000000, "Inkomsten te hoog"),
    }),
    datum: z.string().datetime().optional(),
  }),
  bouwplan: z.object({
    structuur: z.object({
      inleiding: z.boolean().default(true),
      knelpunten: z.array(z.string().min(1).max(500)).min(1, "Minimaal één knelpunt vereist").max(10, "Maximaal 10 knelpunten"),
      scenario_analyse: z.boolean().default(true),
      vervolgstappen: z.boolean().default(true),
    }),
  }),
  clientName: z.string().min(1, "Clientnaam is verplicht").max(200, "Clientnaam te lang"),
  aiConfig: z.object({
    provider: z.enum(["google", "openai"]).default("google"),
    model: z.string().min(1, "Model is verplicht"),
    temperature: z.number().min(0).max(2).default(0.1),
    topP: z.number().min(0).max(1).default(0.95),
  }).optional(),
});

// Report Update Request
export const updateReportRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  clientName: z.string().min(1).max(200).optional(),
  dossierData: z.object({
    klant: z.object({
      naam: z.string(),
      situatie: z.string(),
    }),
    fiscale_gegevens: z.object({
      vermogen: z.number(),
      inkomsten: z.number(),
    }),
    datum: z.string().optional(),
    rawText: z.string().optional(),
    context: z.string().optional(),
  }).optional(),
  bouwplanData: z.object({
    denkwijze_samenvatting: z.string().optional(),
    fiscale_kernthemas: z.array(z.union([
      z.string(),
      z.object({ thema: z.string(), reden: z.string().optional() })
    ])).optional(),
    geidentificeerde_risicos: z.array(z.union([
      z.string(),
      z.object({ risico: z.string(), reden: z.string().optional(), ernst: z.enum(['laag', 'middel', 'hoog']).optional() })
    ])).optional(),
    bouwplan_voor_rapport: z.record(z.object({
      koptekst: z.string(),
      subdoelen: z.array(z.string()).optional(),
      reden_inclusie: z.string().optional(),
    })).optional(),
  }).optional(),
  generatedContent: z.string().optional(),
  status: z.enum(["draft", "processing", "generated", "exported"]).optional(),
});

// Stage Execution Request
export const executeStageRequestSchema = z.object({
  stage: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional(),
  overrideConfig: z.object({
    aiConfig: z.object({
      provider: z.enum(["google", "openai"]).optional(),
      model: z.string().optional(),
      temperature: z.number().optional(),
      topP: z.number().optional(),
      maxOutputTokens: z.number().optional(),
    }).optional(),
    prompt: z.string().optional(),
  }).optional(),
});

// Manual Feedback Processing Request - Simplified approach
export const processFeedbackRequestSchema = z.object({
  userInstructions: z.string()
    .min(1, "Geef instructies over welke feedback je wilt verwerken")
    .max(50000, "Instructies mogen niet langer zijn dan 50000 karakters"),
  processingStrategy: z.enum(["merge", "append", "sectional", "replace"]).default("merge"),
  // Optional: Pre-filtered changes JSON (only accepted/modified proposals)
  // If provided, this overrides the raw feedback from stageResults
  filteredChanges: z.string().optional()
});

// User Registration Request
export const registerUserRequestSchema = z.object({
  username: z.string().min(3, "Gebruikersnaam moet minimaal 3 karakters zijn").max(50, "Gebruikersnaam te lang"),
  password: z.string().min(8, "Wachtwoord moet minimaal 8 karakters zijn").max(128, "Wachtwoord te lang"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Wachtwoorden komen niet overeen",
  path: ["confirmPassword"],
});

// User Login Request
export const loginUserRequestSchema = z.object({
  username: z.string().min(1, "Gebruikersnaam is verplicht"),
  password: z.string().min(1, "Wachtwoord is verplicht"),
});

// Prompt Config Request - uses PromptConfig type from schema
export const savePromptConfigRequestSchema = z.object({
  name: z.string().min(1, "Naam is verplicht").max(100, "Naam te lang"),
  config: z.record(z.string(), z.unknown()), // PromptConfig object - validated separately
  isActive: z.boolean().default(false),
});

// ===== RESPONSE SCHEMAS =====

// Process Feedback Response
export const processFeedbackResponseSchema = z.object({
  success: z.boolean(),
  newVersion: z.number(),
  conceptContent: z.string(),
  userInstructions: z.string(),
  message: z.string()
});

// Report List Response
export const reportListResponseSchema = z.array(z.object({
  id: z.string(),
  title: z.string(),
  clientName: z.string(),
  status: z.string(),
  currentStage: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
}));

// Dossier data schema for responses
const dossierDataResponseSchema = z.object({
  klant: z.object({
    naam: z.string(),
    situatie: z.string(),
  }),
  fiscale_gegevens: z.object({
    vermogen: z.number(),
    inkomsten: z.number(),
  }),
  datum: z.string().optional(),
  rawText: z.string().optional(),
  context: z.string().optional(),
}).passthrough(); // Allow extra fields

// Bouwplan data schema for responses
const bouwplanDataResponseSchema = z.object({
  denkwijze_samenvatting: z.string().optional(),
  fiscale_kernthemas: z.array(z.unknown()).optional(),
  geidentificeerde_risicos: z.array(z.unknown()).optional(),
  bouwplan_voor_rapport: z.record(z.unknown()).optional(),
}).passthrough(); // Allow extra fields

// Report Detail Response
export const reportDetailResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  clientName: z.string(),
  dossierData: dossierDataResponseSchema,
  bouwplanData: bouwplanDataResponseSchema,
  generatedContent: z.string().nullable(),
  stageResults: z.record(z.string(), z.union([z.string(), z.object({
    review: z.string().optional(),
    metadata: z.object({
      model: z.string().optional(),
      timestamp: z.string().optional(),
      duration: z.number().optional(),
      tokensUsed: z.number().optional(),
    }).optional(),
  })])).nullable(),
  conceptReportVersions: conceptReportVersionsSchema.nullable(),
  substepResults: z.record(z.string(), substepResultEntrySchema).nullable(),
  currentStage: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Stage Execution Response
export const stageExecutionResponseSchema = z.object({
  stage: z.string(),
  success: z.boolean(),
  output: z.string().optional(),
  nextStage: z.string().optional(),
  metadata: z.object({
    model: z.string().optional(),
    duration: z.number().optional(),
    tokensUsed: z.number().optional(),
  }).optional(),
});

// User Profile Response
export const userProfileResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
  createdAt: z.string().optional(),
});

// ===== INFERRED TYPES =====

export type CreateReportRequest = z.infer<typeof createReportRequestSchema>;
export type GenerateReportRequest = z.infer<typeof generateReportRequestSchema>;
export type UpdateReportRequest = z.infer<typeof updateReportRequestSchema>;
export type ExecuteStageRequest = z.infer<typeof executeStageRequestSchema>;
export type ProcessFeedbackRequest = z.infer<typeof processFeedbackRequestSchema>;
export type RegisterUserRequest = z.infer<typeof registerUserRequestSchema>;
export type LoginUserRequest = z.infer<typeof loginUserRequestSchema>;
export type SavePromptConfigRequest = z.infer<typeof savePromptConfigRequestSchema>;

// ===== STEP-BACK CAPABILITY SCHEMAS =====

export const overrideConceptRequestSchema = z.object({
  content: z.string().min(1, "Content is vereist"),
  fromStage: z.string().optional(),
  reason: z.string().optional()
});

export const promoteSnapshotRequestSchema = z.object({
  stageId: z.string().min(1, "Stage ID is vereist"), 
  reason: z.string().optional()
});

export const stepBackResponseSchema = z.object({
  success: z.boolean(),
  newLatestStage: z.string(),
  newLatestVersion: z.number(),
  message: z.string()
});

// Express Mode Request - Auto-run all review stages with auto-accept
export const expressModeRequestSchema = z.object({
  stages: z.array(z.string()).optional(), // Default: all review stages (4a-4f)
  autoAccept: z.boolean().default(true), // Auto-accept all feedback
  includeGeneration: z.boolean().default(false), // Also run stage 3 (Generatie) first
});

// Express Mode Change Summary - per change
export const expressModeChangeSchema = z.object({
  type: z.enum(['add', 'modify', 'delete', 'restructure']),
  description: z.string(),
  severity: z.enum(['critical', 'important', 'suggestion']).default('suggestion'),
  section: z.string().optional(), // e.g., "§2.3 Vermogen"
  original: z.string().optional(), // Original text that was changed
  reasoning: z.string().optional(), // Why the change was made
});

// Express Mode Stage Summary - per reviewer stage
export const expressModeStageSummarySchema = z.object({
  stageId: z.string(),
  stageName: z.string(),
  changesCount: z.number(),
  changes: z.array(expressModeChangeSchema),
  processingTimeMs: z.number().optional(),
});

// Express Mode Complete Summary - SSE event data
export const expressModeSummarySchema = z.object({
  stages: z.array(expressModeStageSummarySchema),
  totalChanges: z.number(),
  finalVersion: z.number(),
  totalProcessingTimeMs: z.number(),
  finalContent: z.string(), // The final report content for editing
  fiscaleBriefing: z.string().optional(), // Stage 7: Executive summary for fiscalist
});

export type ExpressModeChange = z.infer<typeof expressModeChangeSchema>;
export type ExpressModeStageSummary = z.infer<typeof expressModeStageSummarySchema>;
export type ExpressModeSummary = z.infer<typeof expressModeSummarySchema>;

// ===== RAPPORT AANPASSEN (POST-WORKFLOW ADJUSTMENTS) =====

// Request to generate an adjustment proposal
export const adjustReportRequestSchema = z.object({
  instruction: z.string()
    .min(10, "Instructie moet minimaal 10 karakters bevatten")
    .max(10000, "Instructie mag niet langer zijn dan 10000 karakters"),
  // Optional: specify which version to adjust (default: latest)
  baseVersion: z.string().optional()
});

// Response with proposed adjustment (not yet committed)
export const adjustReportResponseSchema = z.object({
  success: z.boolean(),
  adjustmentId: z.string(), // e.g., "adjustment_1"
  proposedContent: z.string(), // The new version (not yet committed)
  previousContent: z.string(), // For diff comparison
  metadata: z.object({
    version: z.number(),
    instruction: z.string(),
    createdAt: z.string()
  })
});

// Request to accept an adjustment proposal
export const acceptAdjustmentRequestSchema = z.object({
  adjustmentId: z.string(),
  proposedContent: z.string(),
  instruction: z.string() // For audit trail
});

// Response after accepting adjustment
export const acceptAdjustmentResponseSchema = z.object({
  success: z.boolean(),
  newVersion: z.number(),
  stageId: z.string(),
  message: z.string()
});

export type OverrideConceptRequest = z.infer<typeof overrideConceptRequestSchema>;
export type PromoteSnapshotRequest = z.infer<typeof promoteSnapshotRequestSchema>;
export type StepBackResponse = z.infer<typeof stepBackResponseSchema>;
export type ExpressModeRequest = z.infer<typeof expressModeRequestSchema>;
export type AdjustReportRequest = z.infer<typeof adjustReportRequestSchema>;
export type AdjustReportResponse = z.infer<typeof adjustReportResponseSchema>;
export type AcceptAdjustmentRequest = z.infer<typeof acceptAdjustmentRequestSchema>;
export type AcceptAdjustmentResponse = z.infer<typeof acceptAdjustmentResponseSchema>;

// ===== EXTERNAL REPORT SESSIONS =====

// Create external report session
export const createExternalReportSessionSchema = z.object({
  title: z.string().min(1, "Titel is verplicht").max(200),
  originalContent: z.string().min(10, "Rapport moet minimaal 10 karakters bevatten")
});

// Request adjustment for external report
export const externalReportAdjustRequestSchema = z.object({
  instruction: z.string()
    .min(10, "Instructie moet minimaal 10 karakters bevatten")
    .max(10000, "Instructie mag niet langer zijn dan 10000 karakters")
});

// Response with proposed adjustment
export const externalReportAdjustResponseSchema = z.object({
  success: z.boolean(),
  proposedContent: z.string(),
  previousContent: z.string(),
  version: z.number()
});

// Accept adjustment (legacy)
export const externalReportAcceptSchema = z.object({
  proposedContent: z.string(),
  instruction: z.string()
});

// New two-step flow schemas

// Step 1: Analyze - generates JSON with proposed adjustments
export const externalReportAnalyzeRequestSchema = z.object({
  instruction: z.string()
    .min(10, "Instructie moet minimaal 10 karakters bevatten")
    .max(10000, "Instructie mag niet langer zijn dan 10000 karakters")
});

// Single adjustment item in the analysis response
// Supports 3 types: replace (default), insert, delete
export const adjustmentItemSchema = z.object({
  id: z.string(), // Generated ID for tracking
  type: z.enum(["replace", "insert", "delete"]).default("replace"), // Operation type
  context: z.string(), // Location in report (e.g., "Paragraaf Box 3")
  oud: z.string().optional(), // Text to replace/delete (not used for insert)
  nieuw: z.string().optional(), // New/replacement text (not used for delete)
  anker: z.string().optional(), // For insert: text AFTER which to insert new content
  reden: z.string() // Reason for change
});

// Step 1 response: array of adjustments
export const externalReportAnalyzeResponseSchema = z.object({
  success: z.boolean(),
  adjustments: z.array(adjustmentItemSchema),
  instruction: z.string(),
  version: z.number()
});

// Step 2: Apply - user sends accepted/modified adjustments
export const externalReportApplyRequestSchema = z.object({
  adjustments: z.array(z.object({
    id: z.string(),
    type: z.enum(["replace", "insert", "delete"]).default("replace"),
    context: z.string(),
    oud: z.string().optional(), // Not used for insert
    nieuw: z.string().optional(), // Not used for delete
    anker: z.string().optional(), // For insert: text AFTER which to insert
    reden: z.string(),
    status: z.enum(["accepted", "modified"]) // Only accepted/modified items are sent
  })),
  instruction: z.string() // Original instruction for history
});

// Step 2 response: final adjusted report
export const externalReportApplyResponseSchema = z.object({
  success: z.boolean(),
  newContent: z.string(),
  appliedCount: z.number(),
  version: z.number()
});

export type CreateExternalReportSession = z.infer<typeof createExternalReportSessionSchema>;
export type ExternalReportAdjustRequest = z.infer<typeof externalReportAdjustRequestSchema>;
export type ExternalReportAdjustResponse = z.infer<typeof externalReportAdjustResponseSchema>;
export type ExternalReportAcceptRequest = z.infer<typeof externalReportAcceptSchema>;
export type AdjustmentItem = z.infer<typeof adjustmentItemSchema>;
export type ExternalReportAnalyzeRequest = z.infer<typeof externalReportAnalyzeRequestSchema>;
export type ExternalReportAnalyzeResponse = z.infer<typeof externalReportAnalyzeResponseSchema>;
export type ExternalReportApplyRequest = z.infer<typeof externalReportApplyRequestSchema>;
export type ExternalReportApplyResponse = z.infer<typeof externalReportApplyResponseSchema>;

export type ReportListResponse = z.infer<typeof reportListResponseSchema>;
export type ReportDetailResponse = z.infer<typeof reportDetailResponseSchema>;
export type StageExecutionResponse = z.infer<typeof stageExecutionResponseSchema>;
export type ProcessFeedbackResponse = z.infer<typeof processFeedbackResponseSchema>;
export type UserProfileResponse = z.infer<typeof userProfileResponseSchema>;

// ===== API ENDPOINT TYPES =====

export interface ReportEndpoints {
  'GET /api/reports': {
    request: void;
    response: ReportListResponse;
  };
  'POST /api/reports/generate': {
    request: GenerateReportRequest;
    response: ReportDetailResponse;
  };
  'GET /api/reports/:id': {
    request: { id: string };
    response: ReportDetailResponse;
  };
  'PUT /api/reports/:id': {
    request: { id: string } & UpdateReportRequest;
    response: ReportDetailResponse;
  };
  'DELETE /api/reports/:id': {
    request: { id: string };
    response: { success: boolean };
  };
  'POST /api/reports/:id/execute/:stage': {
    request: { id: string; stage: string } & ExecuteStageRequest;
    response: StageExecutionResponse;
  };
  'POST /api/reports/:id/stage/:stageId/process-feedback': {
    request: { id: string; stageId: string } & ProcessFeedbackRequest;
    response: ProcessFeedbackResponse;
  };
  'POST /api/reports/:id/stage/:stageId/override-concept': {
    request: { id: string; stageId: string } & OverrideConceptRequest;
    response: StepBackResponse;
  };
  'POST /api/reports/:id/snapshots/promote': {
    request: { id: string } & PromoteSnapshotRequest;
    response: StepBackResponse;
  };
}

export interface UserEndpoints {
  'POST /api/auth/register': {
    request: RegisterUserRequest;
    response: UserProfileResponse;
  };
  'POST /api/auth/login': {
    request: LoginUserRequest;
    response: UserProfileResponse;
  };
  'GET /api/auth/profile': {
    request: void;
    response: UserProfileResponse;
  };
  'POST /api/auth/logout': {
    request: void;
    response: { success: boolean };
  };
}

export interface PromptConfigEndpoints {
  'GET /api/prompts': {
    request: void;
    response: PromptConfig[];
  };
  'GET /api/prompts/active': {
    request: void;
    response: PromptConfig;
  };
  'POST /api/prompts': {
    request: SavePromptConfigRequest;
    response: PromptConfig;
  };
  'PUT /api/prompts/:id/activate': {
    request: { id: string };
    response: PromptConfig;
  };
}

// Combined API type map
export type ApiEndpoints = ReportEndpoints & UserEndpoints & PromptConfigEndpoints;

// Helper type for extracting request/response types
export type ApiRequest<T extends keyof ApiEndpoints> = ApiEndpoints[T]['request'];
export type ApiResponseData<T extends keyof ApiEndpoints> = ApiEndpoints[T]['response'];