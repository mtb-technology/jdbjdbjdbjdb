import { sql } from "drizzle-orm";
import { pgTable, text, varchar, json, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const reports = pgTable("reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  clientName: text("client_name").notNull(),
  dossierData: json("dossier_data").notNull(),
  bouwplanData: json("bouwplan_data").notNull(),
  generatedContent: text("generated_content"),
  stageResults: json("stage_results"), // Store stage-specific outputs from each specialist
  conceptReportVersions: json("concept_report_versions"), // Store evolving concept report through stages (legacy)
  substepResults: json("substep_results"), // Store substep results for reviewers (review + processing)
  stagePrompts: json("stage_prompts"), // Store the exact prompts sent to AI for each stage - for input tracking
  
  // New document system - structured living document
  documentState: jsonb("document_state"), // TipTap JSON document state
  pendingChanges: jsonb("pending_changes"), // Structured change proposals from specialists
  documentSnapshots: jsonb("document_snapshots"), // Snapshots per stage for audit trail
  
  currentStage: text("current_stage").default("1_informatiecheck"),
  status: text("status").notNull().default("draft"), // draft, processing, generated, exported
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const promptConfigs = pgTable("prompt_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  config: json("config").notNull(), // PromptConfig object
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const sources = pgTable("sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  url: text("url").notNull(),
  domain: text("domain").notNull(),
  isVerified: boolean("is_verified").notNull().default(false),
  lastChecked: timestamp("last_checked").defaultNow(),
});

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // "report_generation"
  status: text("status").notNull().default("queued"), // queued, processing, completed, failed
  reportId: varchar("report_id").references(() => reports.id),
  progress: text("progress"), // JSON object with current stage and progress info
  result: json("result"), // Final result when completed
  error: text("error"), // Error message if failed
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Enhanced Zod schemas for validation with strict type safety
export const dossierSchema = z.object({
  klant: z.object({
    naam: z.string()
      .min(1, "Naam is verplicht")
      .max(200, "Naam mag niet langer zijn dan 200 karakters")
      .trim()
      .refine(name => name.length > 0, "Naam mag niet leeg zijn na trimming"),
    situatie: z.string()
      .min(10, "Situatie moet minimaal 10 karakters bevatten")
      .max(2000, "Situatie mag niet langer zijn dan 2000 karakters")
      .trim(),
  }),
  fiscale_gegevens: z.object({
    vermogen: z.number()
      .min(0, "Vermogen moet positief zijn")
      .max(100000000, "Vermogen mag niet hoger zijn dan €100.000.000")
      .finite("Vermogen moet een geldig getal zijn"),
    inkomsten: z.number()
      .min(0, "Inkomsten moeten positief zijn")
      .max(10000000, "Inkomsten mogen niet hoger zijn dan €10.000.000")
      .finite("Inkomsten moeten een geldig getal zijn"),
  }),
  datum: z.string()
    .datetime("Datum moet een geldige ISO datetime zijn")
    .optional()
    .or(z.literal("")),
}).strict();

export const bouwplanSchema = z.object({
  taal: z.enum(["nl", "en"], {
    errorMap: () => ({ message: "Taal moet 'nl' of 'en' zijn" })
  }).default("nl"),
  structuur: z.object({
    inleiding: z.boolean().default(true),
    knelpunten: z.array(
      z.string()
        .min(1, "Knelpunt mag niet leeg zijn")
        .max(500, "Knelpunt mag niet langer zijn dan 500 karakters")
        .trim()
    )
      .min(1, "Minimaal één knelpunt vereist")
      .max(10, "Maximaal 10 knelpunten toegestaan")
      .refine(
        (knelpunten) => new Set(knelpunten).size === knelpunten.length,
        "Knelpunten moeten uniek zijn"
      ),
    scenario_analyse: z.boolean().default(true),
    vervolgstappen: z.boolean().default(true),
  }).strict(),
}).strict();

// AI Provider and Model Configuration schemas
export const aiProviderSchema = z.enum(["google", "openai"]);

export const googleModelSchema = z.enum(["gemini-2.5-pro", "gemini-2.5-flash"]);
export const openaiModelSchema = z.enum(["gpt-5", "gpt-4o", "gpt-4o-mini", "o3-mini", "o3", "o3-deep-research-2025-06-26", "o4-mini-deep-research-2025-06-26"]);

export const aiConfigSchema = z.object({
  provider: aiProviderSchema
    .default("google")
    .refine((provider) => ["google", "openai"].includes(provider), {
      message: "Provider moet 'google' of 'openai' zijn"
    }),
  model: z.string()
    .min(1, "Model naam is verplicht")
    .default("gemini-2.5-pro")
    .refine((model) => model.trim().length > 0, "Model naam mag niet leeg zijn"),
  temperature: z.number()
    .min(0, "Temperature moet tussen 0 en 2 liggen")
    .max(2, "Temperature moet tussen 0 en 2 liggen")
    .default(0.1)
    .refine((temp) => !isNaN(temp), "Temperature moet een geldig getal zijn"),
  topP: z.number()
    .min(0, "TopP moet tussen 0 en 1 liggen")
    .max(1, "TopP moet tussen 0 en 1 liggen")
    .default(0.95)
    .refine((topP) => !isNaN(topP), "TopP moet een geldig getal zijn"),
  topK: z.number()
    .int("TopK moet een geheel getal zijn")
    .min(1, "TopK moet minimaal 1 zijn")
    .max(40, "TopK mag maximaal 40 zijn")
    .default(20),
  maxOutputTokens: z.number()
    .int("MaxOutputTokens moet een geheel getal zijn")
    .min(100, "MaxOutputTokens moet minimaal 100 zijn")
    .max(32768, "MaxOutputTokens mag maximaal 32768 zijn")
    .default(2048),
  // OpenAI-specific parameters
  reasoning: z.object({
    effort: z.enum(["minimal", "low", "medium", "high"], {
      errorMap: () => ({ message: "Reasoning effort moet 'minimal', 'low', 'medium' of 'high' zijn" })
    }).optional(),
  }).strict().optional(),
  verbosity: z.enum(["low", "medium", "high"], {
    errorMap: () => ({ message: "Verbosity moet 'low', 'medium' of 'high' zijn" })
  }).optional(),
}).strict()
.refine((config) => {
  // Cross-validation: check if model is compatible with provider
  const { provider, model } = config;
  return validateModelForProvider(provider, model);
}, {
  message: "Het gekozen model is niet compatibel met de geselecteerde provider",
  path: ["model"]
});

// Provider-specific validation
export const validateModelForProvider = (provider: string, model: string): boolean => {
  if (provider === "google") {
    return googleModelSchema.safeParse(model).success;
  }
  if (provider === "openai") {
    return openaiModelSchema.safeParse(model).success;
  }
  return false;
};

// Stage-specific configuration with per-stage AI provider choice
export const stageConfigSchema = z.object({
  prompt: z.string()
    .trim()
    .default("")
    .refine((prompt) => {
      if (prompt.length === 0) return true; // Empty is allowed as default
      return prompt.length >= 10;
    }, "Prompt moet minimaal 10 karakters bevatten wanneer opgegeven"),
  useGrounding: z.boolean().default(false), // For Google/Gemini models only
  useWebSearch: z.boolean().default(false), // For OpenAI models only
  stepType: z.enum(["generator", "reviewer", "processor"], {
    errorMap: () => ({ message: "StepType moet 'generator', 'reviewer' of 'processor' zijn" })
  }).default("generator"),
  aiConfig: aiConfigSchema.optional(), // Per-stage AI configuration override
}).strict()
.refine((config) => {
  // Validation: useGrounding should only be true for Google models
  if (config.useGrounding && config.aiConfig?.provider === "openai") {
    return false;
  }
  return true;
}, {
  message: "Grounding kan alleen gebruikt worden met Google/Gemini modellen",
  path: ["useGrounding"]
})
.refine((config) => {
  // Validation: useWebSearch should only be true for OpenAI models
  if (config.useWebSearch && config.aiConfig?.provider === "google") {
    return false;
  }
  return true;
}, {
  message: "Web search kan alleen gebruikt worden met OpenAI modellen",
  path: ["useWebSearch"]
});

// Multi-stage prompting workflow schema
export const promptConfigSchema = z.object({
  "1_informatiecheck": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }),
  "2_complexiteitscheck": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }),
  "3_generatie": stageConfigSchema.default({ prompt: "", useGrounding: true, useWebSearch: false }),
  "4a_BronnenSpecialist": stageConfigSchema.default({ prompt: "", useGrounding: true, useWebSearch: false }),
  "4b_FiscaalTechnischSpecialist": stageConfigSchema.default({ prompt: "", useGrounding: true, useWebSearch: false }),
  "4c_ScenarioGatenAnalist": stageConfigSchema.default({ prompt: "", useGrounding: true, useWebSearch: false }),
  "4d_DeVertaler": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }),
  "4e_DeAdvocaat": stageConfigSchema.default({ prompt: "", useGrounding: true, useWebSearch: false }),
  "4f_DeKlantpsycholoog": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }),
  "4g_ChefEindredactie": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }),
  "editor": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }), // Chirurgische Redacteur - past wijzigingen toe
  "5_feedback_verwerker": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }),
  "6_change_summary": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }),
  "final_check": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }),
  aiConfig: aiConfigSchema.optional(),
});

export const reportStageSchema = z.object({
  stage: z.string()
    .min(1, "Stage naam is verplicht")
    .trim()
    .refine((stage) => /^[a-zA-Z0-9_-]+$/.test(stage), "Stage naam mag alleen letters, cijfers, _ en - bevatten"),
  input: z.record(z.any()).default({}),
  output: z.string()
    .min(1, "Output mag niet leeg zijn")
    .max(50000, "Output mag niet langer zijn dan 50000 karakters"),
  timestamp: z.date().default(() => new Date()),
  metadata: z.record(z.any()).default({}),
  duration: z.number().min(0).optional(),
  success: z.boolean().default(true),
  errors: z.array(z.string()).default([]),
}).strict();

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertReportSchema = createInsertSchema(reports).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  conceptReportVersions: z.record(z.string()).optional(),
  substepResults: z.record(z.object({
    review: z.string().optional(),
    processing: z.string().optional(),
    changeProposals: z.array(z.object({
      id: z.string(),
      type: z.enum(["content_addition", "text_replacement", "content_removal", "structure_change", "source_addition"]),
      section: z.string(),
      description: z.string(),
      reasoning: z.string(),
      impact: z.enum(["low", "medium", "high"]),
      specificText: z.string().optional(),
      currentText: z.string().optional(),
      newText: z.string().optional(),
      location: z.string().optional(),
      approved: z.boolean().optional(), // User approval status
    })).optional(),
  })).optional(),
});

export const insertSourceSchema = createInsertSchema(sources).omit({
  id: true,
  lastChecked: true,
});

export const insertPromptConfigSchema = createInsertSchema(promptConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Source = typeof sources.$inferSelect;
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type InsertPromptConfig = z.infer<typeof insertPromptConfigSchema>;
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type DossierData = z.infer<typeof dossierSchema>;
export type BouwplanData = z.infer<typeof bouwplanSchema>;
export type PromptConfig = z.infer<typeof promptConfigSchema>;
export type AiConfig = z.infer<typeof aiConfigSchema>;
export type StageConfig = z.infer<typeof stageConfigSchema>;
export type ReportStage = z.infer<typeof reportStageSchema>;
export type PromptConfigRecord = typeof promptConfigs.$inferSelect;

// ===== STRUCTURED CONCEPT REPORT VERSIONING SYSTEM =====

// Stage identifier for the workflow - matching promptConfig names
export const stageIdSchema = z.enum([
  "1_informatiecheck",
  "2_bouwplananalyse", 
  "3_generatie",
  "4a_BronnenSpecialist",
  "4b_FiscaalTechnischSpecialist",
  "4c_ScenarioGatenAnalist", 
  "4d_DeVertaler",
  "4e_DeAdvocaat",
  "4f_DeKlantpsycholoog",
  "4g_ChefEindredactie",
  "5_eindredactie"
]);

// Individual concept report snapshot for a specific stage
export const conceptReportSnapshotSchema = z.object({
  v: z.number().int().positive(), // Version number (incremental)
  content: z.string(), // Full concept report content at this stage
  from: stageIdSchema.optional(), // Which stage this was derived from
  createdAt: z.string().datetime().optional(), // When this version was created
  processedFeedback: z.string().optional(), // The feedback that was processed to create this version
}).strict();

// Complete concept report versions structure - with all stages
export const conceptReportVersionsSchema = z.object({
  "3_generatie": conceptReportSnapshotSchema.optional(),
  "4a_BronnenSpecialist": conceptReportSnapshotSchema.optional(),
  "4b_FiscaalTechnischSpecialist": conceptReportSnapshotSchema.optional(), 
  "4c_ScenarioGatenAnalist": conceptReportSnapshotSchema.optional(),
  "4d_DeVertaler": conceptReportSnapshotSchema.optional(),
  "4e_DeAdvocaat": conceptReportSnapshotSchema.optional(),
  "4f_DeKlantpsycholoog": conceptReportSnapshotSchema.optional(),
  "4g_ChefEindredactie": conceptReportSnapshotSchema.optional(),
  "5_eindredactie": conceptReportSnapshotSchema.optional(),
  latest: z.object({
    pointer: stageIdSchema, // Points to the most recent completed stage
    v: z.number().int().positive() // Version number of the latest stage
  }).optional(),
  history: z.array(z.object({
    stageId: stageIdSchema,
    v: z.number().int().positive(),
    timestamp: z.string().datetime()
  })).optional()
}).strict();

// Stage results structure for individual feedback outputs
export const stageResultSchema = z.object({
  review: z.string(), // The review/feedback output from the AI specialist
  metadata: z.object({
    model: z.string().optional(),
    timestamp: z.string().datetime().optional(),
    duration: z.number().optional(),
    tokensUsed: z.number().optional()
  }).optional()
}).strict();

export const stageResultsSchema = z.record(stageIdSchema, stageResultSchema);

// ReportProcessor interface types
export const reportProcessorInputSchema = z.object({
  baseConcept: z.string(), // The current concept report content
  feedback: z.string(), // The feedback to be processed/merged
  stageId: stageIdSchema, // Which stage is being processed
  strategy: z.enum(["sectional", "replace", "append", "merge"]).default("merge") // How to merge
}).strict();

export const reportProcessorOutputSchema = z.object({
  newConcept: z.string(), // The updated concept report content
  diff: z.string().optional(), // Optional diff showing changes made
  summary: z.string().optional() // Summary of what was changed
}).strict();

export type StageId = z.infer<typeof stageIdSchema>;
export type ConceptReportSnapshot = z.infer<typeof conceptReportSnapshotSchema>;
export type ConceptReportVersions = z.infer<typeof conceptReportVersionsSchema>;
export type StageResult = z.infer<typeof stageResultSchema>;
export type StageResults = z.infer<typeof stageResultsSchema>;
export type ReportProcessorInput = z.infer<typeof reportProcessorInputSchema>;
export type ReportProcessorOutput = z.infer<typeof reportProcessorOutputSchema>;

// ===== STAGE 1: INFORMATIECHECK STRUCTURED OUTPUT =====

// Schema for Stage 1 (Informatiecheck) structured JSON output
export const informatieCheckOutputSchema = z.object({
  status: z.enum(["COMPLEET", "INCOMPLEET"], {
    errorMap: () => ({ message: "Status moet 'COMPLEET' of 'INCOMPLEET' zijn" })
  }),

  // For INCOMPLEET status - email to client
  email_subject: z.string().optional(),
  email_body: z.string().optional(), // HTML formatted email body

  // For COMPLEET status - generated dossier
  dossier: z.object({
    samenvatting_onderwerp: z.string(),
    klantvraag_verbatim: z.array(z.string()),
    gestructureerde_data: z.object({
      partijen: z.array(z.string()),
      fiscale_partner: z.boolean(),
      relevante_bedragen: z.record(z.string(), z.union([z.string(), z.number()])),
      overige_info: z.array(z.string())
    })
  }).optional()
}).strict()
.refine((data) => {
  // Validation: INCOMPLEET must have email fields
  if (data.status === "INCOMPLEET") {
    return !!data.email_subject && !!data.email_body;
  }
  return true;
}, {
  message: "INCOMPLEET status vereist email_subject en email_body",
  path: ["email_subject"]
})
.refine((data) => {
  // Validation: COMPLEET must have dossier field
  if (data.status === "COMPLEET") {
    return !!data.dossier;
  }
  return true;
}, {
  message: "COMPLEET status vereist dossier object",
  path: ["dossier"]
});

export type InformatieCheckOutput = z.infer<typeof informatieCheckOutputSchema>;

// ===== STAGE 2: COMPLEXITEITSCHECK (BOUWPLAN) STRUCTURED OUTPUT =====

// Schema for Stage 2 (Complexiteitscheck) structured JSON output
export const bouwplanDataSchema = z.object({
  fiscale_kernthemas: z.array(z.string()).describe("Gedetecteerde fiscale kernthema's"),
  geidentificeerde_risicos: z.array(z.string()).describe("Geïdentificeerde risico's"),
  bouwplan_voor_rapport: z.record(z.string(), z.object({
    koptekst: z.string(),
    subdoelen: z.array(z.string()).optional()
  })).describe("Voorgestelde rapportstructuur met secties")
}).strict();

export type BouwplanData = z.infer<typeof bouwplanDataSchema>;
