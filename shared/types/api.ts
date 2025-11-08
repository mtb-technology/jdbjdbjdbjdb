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

// ===== REQUEST SCHEMAS =====

// Report Creation Request (NEW - for /api/reports/create)
export const createReportRequestSchema = z.object({
  clientName: z.string()
    .min(1, "Clientnaam is verplicht")
    .max(200, "Clientnaam mag niet langer zijn dan 200 karakters")
    .regex(/^[a-zA-Z0-9\s\-\.,']+$/, "Clientnaam bevat ongeldige karakters"),
  rawText: z.string()
    .min(10, "Ruwe tekst moet minimaal 10 karakters bevatten")
    .max(100000, "Ruwe tekst mag niet langer zijn dan 100KB (100.000 karakters)")
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
    taal: z.enum(["nl", "en"]).default("nl"),
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
  dossierData: z.record(z.any()).optional(),
  bouwplanData: z.record(z.any()).optional(),
  generatedContent: z.string().optional(),
  status: z.enum(["draft", "processing", "generated", "exported"]).optional(),
});

// Stage Execution Request
export const executeStageRequestSchema = z.object({
  stage: z.string().min(1),
  input: z.record(z.any()).optional(),
  overrideConfig: z.object({
    aiConfig: z.record(z.any()).optional(),
    prompt: z.string().optional(),
  }).optional(),
});

// Manual Feedback Processing Request - Simplified approach
export const processFeedbackRequestSchema = z.object({
  userInstructions: z.string()
    .min(1, "Geef instructies over welke feedback je wilt verwerken")
    .max(2000, "Instructies mogen niet langer zijn dan 2000 karakters"),
  processingStrategy: z.enum(["merge", "append", "sectional", "replace"]).default("merge")
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

// Prompt Config Request
export const savePromptConfigRequestSchema = z.object({
  name: z.string().min(1, "Naam is verplicht").max(100, "Naam te lang"),
  config: z.record(z.any()), // PromptConfig object
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

// Report Detail Response
export const reportDetailResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  clientName: z.string(),
  dossierData: z.record(z.any()),
  bouwplanData: z.record(z.any()),
  generatedContent: z.string().nullable(),
  stageResults: z.record(z.any()).nullable(),
  conceptReportVersions: z.record(z.string()).nullable(),
  substepResults: z.record(z.object({
    review: z.string().optional(),
    processing: z.string().optional(),
  })).nullable(),
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
  metadata: z.record(z.any()).optional(),
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

export type OverrideConceptRequest = z.infer<typeof overrideConceptRequestSchema>;
export type PromoteSnapshotRequest = z.infer<typeof promoteSnapshotRequestSchema>;
export type StepBackResponse = z.infer<typeof stepBackResponseSchema>;

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