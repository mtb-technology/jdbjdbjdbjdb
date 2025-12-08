import { sql } from "drizzle-orm";
import { pgTable, text, varchar, json, jsonb, timestamp, boolean, index, serial, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * ===== DATABASE SCHEMA =====
 *
 * Dit bestand definieert de volledige database structuur voor het AI Pipeline Orchestrator systeem.
 * Het systeem gebruikt Drizzle ORM met PostgreSQL voor type-safe database interacties.
 *
 * ## Architectuur Overzicht
 *
 * De database ondersteunt een **multi-stage AI workflow** die een fiscaal advies rapport genereert:
 *
 * 1. **Reports**: Het 'reizende data-object' - doorloopt alle stages en verzamelt resultaten
 * 2. **Concept Versioning**: Elk stage kan het concept rapport transformeren (versie tracking)
 * 3. **Stage Results**: Output van elke specialist (bronnen, fiscaal, vertaling, etc.)
 * 4. **Prompt Configs**: Configureerbare AI prompts per stage (swap tussen configuraties)
 * 5. **Jobs**: Asynchrone task tracking voor langlopende AI operaties
 */

/**
 * ## USERS TABLE
 *
 * **Verantwoordelijkheid**: Authenticatie en gebruikersbeheer
 *
 * **Data Flow**:
 * - Passwords worden gehashed met bcrypt voordat ze worden opgeslagen (zie auth middleware)
 * - Gebruikt voor session-based authentication
 *
 * **Security**:
 * - Wachtwoorden NOOIT in plaintext opslaan
 * - Username is uniek (database constraint)
 */
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

/**
 * ## REPORTS TABLE - Het "Reizende Data-Object"
 *
 * **Verantwoordelijkheid**: Central nervous system van de AI pipeline
 *
 * Dit is het **kerntabel** van het hele systeem. Elk rapport is een "dossier"
 * dat door de lopende band (AI pipeline) reist en bij elke stage wordt verrijkt.
 *
 * ### Data Flow (De "Lopende Band"):
 *
 * ```
 * START → Stage 1 (Info Check) → Stage 2 (Complexiteit) → Stage 3 (Generatie)
 *   ↓
 * Stage 4a (Bronnen) → 4b (Fiscaal) → 4c (Scenario) → 4d (Vertaler)
 *   ↓
 * Stage 4e (Advocaat) → 4f (Psycholoog) → Stage 6 (Summary) → KLAAR
 * ```
 *
 * ### Belangrijke Velden:
 *
 * **Input Data** (verzameld bij start):
 * - `dossierData`: Klant info, fiscale gegevens (de "order" die binnenkomt)
 * - `bouwplanData`: Rapport structuur configuratie
 *
 * **Stage Outputs** (verzameld tijdens flow):
 * - `stageResults`: AI output per stage (bv. "4a_BronnenSpecialist" → feedback)
 * - `stagePrompts`: Exacte prompts die naar AI gestuurd zijn (audit trail)
 * - `substepResults`: Reviewer feedback + processing results
 *
 * **Concept Versioning** (het evoluerende rapport):
 * - `conceptReportVersions`: Versie geschiedenis per stage (voor step-back)
 * - `generatedContent`: Huidige rapport content voor preview/export
 *
 * **Rich Document System** (TipTap-based):
 * - `documentState`: TipTap JSON voor WYSIWYG editing
 * - `pendingChanges`: Change proposals van specialists (actief gebruikt)
 * - `documentSnapshots`: Audit trail van document wijzigingen (actief gebruikt)
 *
 * **Status Tracking**:
 * - `currentStage`: Waar staat het rapport nu? (bv. "4a_BronnenSpecialist")
 * - `status`: Lifecycle state (draft → processing → generated → exported)
 *
 * @see {@link ConceptReportVersions} voor versie tracking structuur
 * @see {@link StageResults} voor stage output formaat
 */
export const reports = pgTable("reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dossierNumber: integer("dossier_number").notNull().unique(), // Auto-incrementing dossier number
  title: text("title").notNull(),
  clientName: text("client_name").notNull(),
  dossierData: json("dossier_data").notNull(),
  bouwplanData: json("bouwplan_data").notNull(),
  generatedContent: text("generated_content"),
  stageResults: json("stage_results"), // Store stage-specific outputs from each specialist
  conceptReportVersions: json("concept_report_versions"), // Store evolving concept report through stages
  substepResults: json("substep_results"), // Store substep results for reviewers (review + processing)
  stagePrompts: json("stage_prompts"), // Store the exact prompts sent to AI for each stage - for input tracking

  // New document system - structured living document (TipTap-based)
  documentState: jsonb("document_state"), // TipTap JSON document state
  pendingChanges: jsonb("pending_changes"), // Structured change proposals from specialists
  documentSnapshots: jsonb("document_snapshots"), // Snapshots per stage for audit trail

  // Dossier context summary - AI-generated summary for quick reference
  dossierContextSummary: text("dossier_context_summary"), // Compact summary of case context

  // Rollback tracking - which changes have been rolled back
  rolledBackChanges: jsonb("rolled_back_changes"), // { "stageId-changeIndex": { rolledBackAt: string } }

  currentStage: text("current_stage").default("1a_informatiecheck"),
  status: text("status").notNull().default("draft"), // draft, processing, generated, exported
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  statusIdx: index("reports_status_idx").on(table.status),
  createdAtIdx: index("reports_created_at_idx").on(table.createdAt),
  clientNameIdx: index("reports_client_name_idx").on(table.clientName),
  currentStageIdx: index("reports_current_stage_idx").on(table.currentStage),
  dossierNumberIdx: index("reports_dossier_number_idx").on(table.dossierNumber),
}));

/**
 * ## PROMPT CONFIGS TABLE
 *
 * **Verantwoordelijkheid**: Swappable AI prompts - de "programma" voor elke specialist
 *
 * Dit systeem maakt A/B testing mogelijk: je kunt meerdere prompt configuraties maken
 * en switchen tussen ze zonder code te wijzigen.
 *
 * ### Gebruik:
 * 1. Maak een nieuwe config met prompts voor alle stages (1-6, 4a-4f, editor)
 * 2. Activeer de config → deze wordt gebruikt voor ALLE nieuwe rapporten
 * 3. Test de resultaten, tweak de prompts, herhaal
 *
 * ### Structuur van `config` veld:
 * ```typescript
 * {
 *   "1a_informatiecheck": { prompt: "...", useGrounding: false },
 *   "1b_informatiecheck_email": { prompt: "...", useGrounding: false },
 *   "2_complexiteitscheck": { prompt: "...", useGrounding: false },
 *   "4a_BronnenSpecialist": { prompt: "...", useGrounding: true },
 *   // ... etc voor alle stages
 *   aiConfig: { provider: "google", model: "gemini-2.5-pro", ... }
 * }
 * ```
 *
 * **Voordelen**:
 * - Versie controle van prompts (elk rapport weet welke config gebruikt is)
 * - Rollback mogelijk (switch terug naar oude config)
 * - Experimentatie zonder downtime
 *
 * @see {@link PromptConfig} voor het complete schema
 */
export const promptConfigs = pgTable("prompt_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  config: json("config").notNull(), // PromptConfig object
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  isActiveIdx: index("prompt_configs_is_active_idx").on(table.isActive),
}));

/**
 * ## SOURCES TABLE
 *
 * **Verantwoordelijkheid**: Bronnen database voor AI grounding en verificatie
 *
 * Wanneer AI stages "grounding" gebruiken (vooral Stage 4a - BronnenSpecialist),
 * zoeken ze in deze database naar relevante juridische/fiscale bronnen.
 *
 * ### Gebruik in AI Pipeline:
 * - Stage 4a (BronnenSpecialist) gebruikt deze bronnen voor fact-checking
 * - Verificatie van fiscale claims en juridische statements
 * - Toevoegen van bronverwijzingen aan het rapport
 *
 * **Future Enhancement**: Automatische crawling en verificatie van bronnen
 */
export const sources = pgTable("sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  url: text("url").notNull(),
  domain: text("domain").notNull(),
  isVerified: boolean("is_verified").notNull().default(false),
  lastChecked: timestamp("last_checked").defaultNow(),
}, (table) => ({
  domainIdx: index("sources_domain_idx").on(table.domain),
  isVerifiedIdx: index("sources_is_verified_idx").on(table.isVerified),
}));

/**
 * ## JOBS TABLE
 *
 * **Verantwoordelijkheid**: Async task tracking voor langlopende AI operaties
 *
 * AI stages kunnen minuten (of langer) duren. Jobs maken het mogelijk om:
 * - Progress tracking (welke stage wordt nu uitgevoerd?)
 * - Error handling (wat ging er mis en waarom?)
 * - Retry logic (opnieuw proberen bij failures)
 * - User feedback (real-time updates in de UI)
 *
 * ### Lifecycle:
 * ```
 * queued → processing → completed (success)
 *                    ↓
 *                   failed (error) → retry → queued
 * ```
 *
 * ### Progress Tracking:
 * Het `progress` veld bevat JSON zoals:
 * ```json
 * {
 *   "currentStage": "4b_FiscaalTechnischSpecialist",
 *   "completedStages": ["1_informatiecheck", "2_complexiteitscheck", "3_generatie", "4a_BronnenSpecialist"],
 *   "percentage": 65
 * }
 * ```
 */
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

// Follow-up Assistant Sessions
export const followUpSessions = pgTable("follow_up_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").references(() => reports.id), // Optional: link to original report
  clientName: text("client_name").notNull(),
  dossierData: jsonb("dossier_data").notNull(), // Stored once per session
  rapportContent: text("rapport_content").notNull(), // Stored once per session
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Follow-up Email Threads (multiple per session)
export const followUpThreads = pgTable("follow_up_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => followUpSessions.id, { onDelete: 'cascade' }),
  emailThread: text("email_thread").notNull(), // The customer's email(s)
  aiAnalysis: jsonb("ai_analysis").notNull(), // { vraag_van_klant, scope_status, inhoudelijke_samenvatting_antwoord }
  conceptEmail: jsonb("concept_email").notNull(), // { onderwerp, body }
  threadNumber: text("thread_number"), // e.g., "1", "2", "3" for ordering
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
  // ✅ rawText: Alleen nodig in Stage 1 (informatiecheck), daarna niet meer
  // Wordt gefilterd in buildReviewerData() om niet in Stage 4+ validatie te komen
  rawText: z.string().optional(),
}).strict();

export const bouwplanSchema = z.object({
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

export const googleModelSchema = z.enum(["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-pro-preview"]);
export const openaiModelSchema = z.enum(["gpt-5", "gpt-4o", "gpt-4o-mini", "o3-mini", "o3", "o3-deep-research-2025-06-26", "o4-mini-deep-research-2025-06-26"]);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LAYER 2: STAGE/OPERATION CONFIG (Database Schema)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dit schema definieert de runtime AI configuratie die in de database wordt
 * opgeslagen (prompt_configs tabel). Per-stage of per-operation overrides.
 *
 * Dit is NIET hetzelfde als AI_MODELS in server/config/index.ts (Layer 1).
 * Layer 1 = statische model capabilities
 * Layer 2 = dynamische runtime configuratie (dit schema)
 * Layer 3 = merged config (AIConfigResolver)
 *
 * @see docs/ARCHITECTURE.md voor het 3-layer config model
 * @see server/config/index.ts voor Layer 1 (Model Capabilities)
 * @see server/services/ai-config-resolver.ts voor Layer 3 (Runtime Resolver)
 */
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
  // Gemini 3-specific parameters
  thinkingLevel: z.enum(["low", "medium", "high"], {
    errorMap: () => ({ message: "Thinking level moet 'low', 'medium' of 'high' zijn" })
  }).optional(),
  // Deep research workflow (GPT Researcher pattern)
  useDeepResearch: z.boolean({
    errorMap: () => ({ message: "Deep research moet een boolean zijn" })
  }).optional(),
  maxQuestions: z.number().min(1).max(10).optional(),
  parallelExecutors: z.number().min(1).max(5).optional(),
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
  polishPrompt: z.string().optional(), // Polish instructies voor deep research output (Stage 3)
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

// Schema voor tool-specifieke AI configuratie (zonder prompt)
export const toolAiConfigSchema = z.object({
  aiConfig: aiConfigSchema.optional(),
  description: z.string().optional(), // Voor UI weergave
});

// Multi-stage prompting workflow schema
export const promptConfigSchema = z.object({
  // === RAPPORT STAGES ===
  "1a_informatiecheck": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }), // Analyse only - JSON output
  "1b_informatiecheck_email": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }), // Email generation - only runs if 1a returns INCOMPLEET
  "2_complexiteitscheck": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }),
  "3_generatie": stageConfigSchema.default({ prompt: "", useGrounding: true, useWebSearch: false }),
  "4a_BronnenSpecialist": stageConfigSchema.default({ prompt: "", useGrounding: true, useWebSearch: false }),
  "4b_FiscaalTechnischSpecialist": stageConfigSchema.default({ prompt: "", useGrounding: true, useWebSearch: false }),
  "4c_ScenarioGatenAnalist": stageConfigSchema.default({ prompt: "", useGrounding: true, useWebSearch: false }),
  "4e_DeAdvocaat": stageConfigSchema.default({ prompt: "", useGrounding: true, useWebSearch: false }),
  "4f_HoofdCommunicatie": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }),
  "editor": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }), // Chirurgische Redacteur - past wijzigingen toe
  "adjustment": stageConfigSchema.default({ prompt: "", useGrounding: true, useWebSearch: true }), // Rapport Aanpassen - genereert JSON aanpassingen (zoals reviewers)
  "6_change_summary": stageConfigSchema.default({ prompt: "", useGrounding: false, useWebSearch: false }),

  // === TOOLS (alleen AI config, geen prompts) ===
  "test_ai": toolAiConfigSchema.optional(), // AI Test functionaliteit
  "follow_up_assistant": toolAiConfigSchema.optional(), // Email assistant
  "box3_validator": toolAiConfigSchema.optional(), // Box3 fiscaal validator

  // === GLOBAL DEFAULTS ===
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
  dossierNumber: true, // Auto-generated by storage layer
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

/**
 * ===== CORE TYPE EXPORTS =====
 *
 * Deze types worden afgeleid van de Zod schemas en Drizzle tables hierboven.
 * Ze zorgen voor type-safety door de hele applicatie (client + server).
 */

/** User types - voor authenticatie en sessies */
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

/** Report types - het 'reizende data-object' in de pipeline */
export type Report = typeof reports.$inferSelect;
export type InsertReport = z.infer<typeof insertReportSchema>;

/** Source types - bronnen voor grounding/verificatie */
export type Source = typeof sources.$inferSelect;
export type InsertSource = z.infer<typeof insertSourceSchema>;

/** Prompt configuration types - swappable AI prompts per stage */
export type InsertPromptConfig = z.infer<typeof insertPromptConfigSchema>;
export type PromptConfigRecord = typeof promptConfigs.$inferSelect;
export type PromptConfig = z.infer<typeof promptConfigSchema>;

/** Job types - async task tracking */
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;

/**
 * Dossier input schema - de initiële klant data die het systeem ontvangt
 * BELANGRIJK: Dit is NIET hetzelfde als BouwplanData (dat is Stage 2 output)
 */
export type DossierData = z.infer<typeof dossierSchema>;

/** AI configuration types */
export type AiConfig = z.infer<typeof aiConfigSchema>;
export type StageConfig = z.infer<typeof stageConfigSchema>;

/** Stage execution tracking */
export type ReportStage = z.infer<typeof reportStageSchema>;

// NOTE: BouwplanData type is exported later (line ~510) from bouwplanDataSchema
// (the AI-generated output from Stage 2), distinct from bouwplanSchema (user input)

/**
 * ===== STRUCTURED CONCEPT REPORT VERSIONING SYSTEM =====
 *
 * ## KRITIEKE ARCHITECTUUR COMPONENT
 *
 * Dit systeem is de **sleutel tot onderhoudbaarheid** van de AI pipeline.
 * Het lost een fundamenteel probleem op: "Hoe weet ik wat elke AI specialist heeft veranderd?"
 *
 * ### Het Probleem (Zonder Versioning):
 * ```
 * Stage 3 genereert rapport v1 (5000 woorden)
 *   ↓
 * Stage 4a voegt bronnen toe → rapport v2 (5200 woorden)
 *   ↓
 * Stage 4b verbetert fiscaal → rapport v3 (5300 woorden)
 *   ↓
 * Probleem: Wat is het verschil tussen v2 en v3? Wat deed 4b precies?
 * Probleem: Kan ik terug naar v2? (Step-back functionality)
 * ```
 *
 * ### De Oplossing (Met Versioning):
 * Elk stage slaat een **snapshot** op van het concept rapport OP DAT MOMENT:
 *
 * ```typescript
 * conceptReportVersions: {
 *   "3_generatie": { v: 1, content: "...", createdAt: "..." },
 *   "4a_BronnenSpecialist": { v: 2, content: "...", from: "3_generatie", processedFeedback: "..." },
 *   "4b_FiscaalTechnischSpecialist": { v: 3, content: "...", from: "4a_BronnenSpecialist", processedFeedback: "..." },
 *   latest: { pointer: "4b_FiscaalTechnischSpecialist", v: 3 }
 * }
 * ```
 *
 * ### Voordelen:
 * 1. **Audit Trail**: Zie exact wat elke specialist heeft veranderd
 * 2. **Step-Back**: Keer terug naar een eerdere versie als een specialist iets verpest
 * 3. **Debugging**: Begrijp waarom het finale rapport er zo uitziet
 * 4. **Re-processing**: Run een stage opnieuw met nieuwe prompts (version increment)
 *
 * ### Data Flow Voorbeeld:
 * ```
 * Gebruiker drukt "Execute Stage 4a"
 *   ↓
 * 1. Haal base concept op (van "3_generatie" snapshot)
 * 2. AI voert 4a uit → feedback
 * 3. ReportProcessor merget feedback met base concept → nieuwe versie
 * 4. Sla snapshot op: conceptReportVersions["4a_BronnenSpecialist"] = { v: 2, content: "...", from: "3_generatie" }
 * 5. Update latest pointer: latest = { pointer: "4a_BronnenSpecialist", v: 2 }
 * ```
 *
 * @see {@link ReportProcessor} voor de merge logica
 * @see {@link ConceptReportSnapshot} voor snapshot structuur
 */

/**
 * Stage identifiers - komt overeen met promptConfig namen
 *
 * Deze enum definieert ALLE mogelijke stages in de workflow.
 * Elke stage kan een snapshot van het concept rapport opslaan.
 */
export const stageIdSchema = z.enum([
  "1a_informatiecheck",
  "1b_informatiecheck_email",
  "2_complexiteitscheck",
  "3_generatie",
  "4a_BronnenSpecialist",
  "4b_FiscaalTechnischSpecialist",
  "4c_ScenarioGatenAnalist",
  "4e_DeAdvocaat",
  "4f_HoofdCommunicatie"
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
  "4e_DeAdvocaat": conceptReportSnapshotSchema.optional(),
  "4f_HoofdCommunicatie": conceptReportSnapshotSchema.optional(),
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

/**
 * ===== STAGE 1: INFORMATIECHECK STRUCTURED OUTPUT =====
 *
 * ## De "Poortwachter" van de Pipeline
 *
 * Stage 1 is de EERSTE controle: heeft de klant alle benodigde informatie verstrekt?
 *
 * ### Gedrag:
 *
 * **Scenario A: INCOMPLEET** (ontbrekende informatie)
 * ```json
 * {
 *   "status": "INCOMPLEET",
 *   "email_subject": "Aanvullende informatie nodig voor uw advies",
 *   "email_body": "<p>Beste klant, we missen de volgende informatie: ...</p>"
 * }
 * ```
 * → De pipeline **STOPT** hier. Gebruiker moet de e-mail versturen en wachten op antwoord.
 * → Stage 2-6 zijn GEBLOKKEERD tot Stage 1 opnieuw wordt uitgevoerd met complete info.
 *
 * **Scenario B: COMPLEET** (alle informatie aanwezig)
 * ```json
 * {
 *   "status": "COMPLEET",
 *   "dossier": {
 *     "samenvatting_onderwerp": "Klant heeft vraag over box 3 heffing na emigratie",
 *     "klantvraag_verbatim": ["Wat zijn de fiscale gevolgen als ik naar Spanje verhuis?"],
 *     "gestructureerde_data": { ... }
 *   }
 * }
 * ```
 * → De pipeline mag DOORGAAN naar Stage 2 (Complexiteitscheck).
 *
 * ### Waarom deze structuur?
 * - **Automatische kwaliteitscontrole**: Voorkomt incomplete rapporten
 * - **Client interactie**: Genereert kant-en-klare e-mail voor ontbrekende info
 * - **Data extractie**: AI haalt gestructureerde data uit ruwe tekst
 *
 * @see {@link parseInformatieCheckOutput} in workflowParsers.ts voor parsing logic
 * @see {@link isInformatieCheckComplete} voor blokkeer logica
 */

/**
 * Schema voor Stage 1 (Informatiecheck) JSON output
 *
 * De AI MOET deze exacte structuur teruggeven (geen vrije tekst).
 */
export const informatieCheckOutputSchema = z.object({
  status: z.enum(["COMPLEET", "INCOMPLEET"], {
    errorMap: () => ({ message: "Status moet 'COMPLEET' of 'INCOMPLEET' zijn" })
  }),

  // Voor INCOMPLEET status - lijst van ontbrekende informatie
  ontbrekende_info: z.array(z.object({
    item: z.string(),
    reden: z.string(),
    prioriteit: z.enum(["KRITIEK", "BELANGRIJK", "OPTIONEEL"]).optional()
  })).optional(),

  // Voor INCOMPLEET status - e-mail naar klant (nu in apart 1b stage)
  email_subject: z.string().optional(),
  email_body: z.string().optional(), // HTML formatted email body

  // Voor COMPLEET status - gegenereerd dossier
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
})
.refine((data) => {
  // Validation: INCOMPLEET must have ontbrekende_info (email now generated in separate 1b stage)
  if (data.status === "INCOMPLEET") {
    return !!data.ontbrekende_info && data.ontbrekende_info.length > 0;
  }
  return true;
}, {
  message: "INCOMPLEET status vereist ontbrekende_info array",
  path: ["ontbrekende_info"]
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

// ===== FOLLOW-UP ASSISTANT TYPES =====

// TypeScript types for Follow-up Sessions
export type FollowUpSession = typeof followUpSessions.$inferSelect;
export type InsertFollowUpSession = typeof followUpSessions.$inferInsert;

export type FollowUpThread = typeof followUpThreads.$inferSelect;
export type InsertFollowUpThread = typeof followUpThreads.$inferInsert;

// Zod schemas for validation
export const insertFollowUpSessionSchema = createInsertSchema(followUpSessions, {
  clientName: z.string().min(1, "Client naam is verplicht"),
  dossierData: z.unknown(), // Will be validated as JSON - required field
  rapportContent: z.string().min(1, "Rapport content is verplicht"),
}).required({ dossierData: true });

export const insertFollowUpThreadSchema = createInsertSchema(followUpThreads, {
  sessionId: z.string().uuid("Ongeldige session ID"),
  emailThread: z.string().min(1, "E-mail thread is verplicht"),
  aiAnalysis: z.unknown(), // Will be validated as JSON - required field
  conceptEmail: z.unknown(), // Will be validated as JSON - required field
}).required({ aiAnalysis: true, conceptEmail: true });

// ===== ATTACHMENTS TABLE =====
/**
 * ## ATTACHMENTS TABLE
 *
 * **Verantwoordelijkheid**: Persistente opslag van bijlages (PDFs, etc.) bij cases
 *
 * In plaats van PDFs direct naar text te extracten en te verliezen, slaan we nu
 * de originele bestanden op zodat:
 * 1. Fiscalisten altijd terug kunnen naar het origineel
 * 2. Native PDF upload naar AI APIs mogelijk is (Gemini/OpenAI ondersteunen dit)
 * 3. Meerdere bijlages per case clean beheerd worden
 *
 * **Opslag**: Base64 encoded in database (simpele aanpak, max ~10MB per file)
 * **Future**: Migreer naar S3/R2 voor grotere bestanden
 */
export const attachments = pgTable("attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reportId: varchar("report_id").notNull().references(() => reports.id, { onDelete: 'cascade' }),

  // File metadata
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(), // application/pdf, text/plain, etc.
  fileSize: text("file_size").notNull(), // Size in bytes (stored as text for precision)
  pageCount: text("page_count"), // For PDFs: number of pages

  // File content
  fileData: text("file_data").notNull(), // Base64 encoded file content
  extractedText: text("extracted_text"), // Pre-extracted text for searching/indexing

  // Vision/OCR tracking
  needsVisionOCR: boolean("needs_vision_ocr").default(false), // True if PDF is scanned (little extractable text)

  // Usage tracking
  usedInStages: json("used_in_stages").$type<string[]>().default([]), // Which stages used this attachment

  // Timestamps
  uploadedAt: timestamp("uploaded_at").defaultNow(),
}, (table) => ({
  reportIdIdx: index("attachments_report_id_idx").on(table.reportId),
}));

// Attachment types
export type Attachment = typeof attachments.$inferSelect;
export type InsertAttachment = typeof attachments.$inferInsert;

export const insertAttachmentSchema = createInsertSchema(attachments, {
  reportId: z.string().uuid("Ongeldige report ID"),
  filename: z.string().min(1, "Filename is verplicht"),
  mimeType: z.string().min(1, "MIME type is verplicht"),
  fileSize: z.string().min(1, "File size is verplicht"),
  fileData: z.string().min(1, "File data is verplicht"),
}).omit({ id: true, uploadedAt: true });

// ===== BOX 3 VALIDATOR SESSIONS =====
/**
 * ## BOX 3 VALIDATOR SESSIONS TABLE
 *
 * **Verantwoordelijkheid**: Micro-module voor validatie van Box 3 bezwaar documenten
 *
 * Valideert of alle gevraagde documenten uit een informatieverzoek aanwezig zijn:
 * 1. Aangifte inkomstenbelasting
 * 2. Bankrekeningen (rente + valutaresultaten)
 * 3. Beleggingen (beginstand, eindstand, stortingen, dividenden)
 * 4. Vastgoed & overige bezittingen (WOZ-waarde, huuroverzicht)
 * 5. Schulden (overzicht + betaalde rente)
 *
 * Output: Checklist per categorie + concept reactie-mail
 */
// Type voor opgeslagen bijlages
export interface Box3Attachment {
  filename: string;
  mimeType: string;
  fileSize: number;
  fileData: string; // base64 encoded
}

// Type voor handmatige overrides per categorie
export interface Box3ManualOverride {
  status?: "nvt" | "compleet"; // Override de AI status
  value?: number; // Handmatig ingevoerde waarde (bijv. bankrente)
  note?: string; // Notitie/reden voor override
  updatedAt?: string; // Wanneer aangepast
}

export interface Box3ManualOverrides {
  aangifte_ib?: Box3ManualOverride;
  bankrekeningen?: Box3ManualOverride;
  beleggingen?: Box3ManualOverride;
  vastgoed?: Box3ManualOverride;
  schulden?: Box3ManualOverride;
  // Extra handmatige waarden voor berekening
  extraValues?: {
    bank_rente_ontvangen?: number;
    beleggingen_waarde_1jan?: number;
    beleggingen_waarde_31dec?: number;
    beleggingen_dividend?: number;
    schulden_rente_betaald?: number;
  };
}

export const box3ValidatorSessions = pgTable("box3_validator_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientName: text("client_name").notNull(),
  belastingjaar: text("belastingjaar"), // Gedetecteerd belastingjaar
  inputText: text("input_text").notNull(), // Mail tekst van klant
  attachmentNames: jsonb("attachment_names").$type<string[]>(), // Array van bestandsnamen (legacy)
  attachments: jsonb("attachments").$type<Box3Attachment[]>(), // Volledige bijlages met data
  validationResult: jsonb("validation_result").$type<Box3ValidationResult>(), // AI validatie output
  conceptMail: jsonb("concept_mail").$type<{ onderwerp: string; body: string }>(), // Concept reactie
  manualOverrides: jsonb("manual_overrides").$type<Box3ManualOverrides>(), // Handmatige correcties
  dossierStatus: text("dossier_status").default("in_behandeling"), // "in_behandeling" | "wacht_op_klant" | "compleet" | "afgewezen"
  notes: text("notes"), // Algemene notities bij dossier
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  clientNameIdx: index("box3_validator_client_name_idx").on(table.clientName),
  createdAtIdx: index("box3_validator_created_at_idx").on(table.createdAt),
}));

// Box 3 Validation Result Schema - Flexibel voor COG output
// De structuur is afhankelijk van de prompt die de gebruiker configureert

// Global status types
export const box3GlobalStatusSchema = z.enum([
  "REJECTED_LOW_VALUE",
  "REJECTED_SAVINGS_ONLY",
  "MISSING_IB_CRITICAL",
  "ACTION_REQUIRED",
  "READY_FOR_CALCULATION"
]);

// Document validatie status
export const box3DocumentStatusSchema = z.enum(["compleet", "onvolledig", "ontbreekt", "nvt"]);

// Flexibel schema dat alles accepteert wat de AI teruggeeft
export const box3ValidationResultSchema = z.object({
  // Geëxtraheerde data (flexibel)
  gevonden_data: z.object({
    algemeen: z.object({
      belastingjaar: z.union([z.number(), z.string()]).nullable().optional(),
      fiscaal_partnerschap_detectie: z.string().nullable().optional(),
    }).optional(),
    fiscus_box3: z.object({
      totaal_bezittingen_bruto: z.number().nullable().optional(),
      heffingsvrij_vermogen: z.number().nullable().optional(),
      belastbaar_inkomen_na_drempel: z.number().nullable().optional(),
      schulden_box3: z.number().nullable().optional(),
    }).optional(),
    werkelijk_rendement_input: z.object({
      bank_rente_ontvangen: z.number().nullable().optional(),
      beleggingen_waarde_1jan: z.number().nullable().optional(),
      beleggingen_waarde_31dec: z.number().nullable().optional(),
      beleggingen_dividend: z.number().nullable().optional(),
      beleggingen_mutaties_gevonden: z.boolean().nullable().optional(),
      schulden_rente_betaald: z.number().nullable().optional(),
    }).optional(),
  }).optional(),

  // Analyse resultaat
  analyse_box3: z.object({
    oordeel_basis_bedrag: z.number().nullable().optional(),
    conclusie_type: z.string().optional(),
  }).optional(),

  // Globale status
  global_status: z.string().optional(),

  // Document validatie per categorie
  document_validatie: z.object({
    bank: box3DocumentStatusSchema.optional(),
    beleggingen: box3DocumentStatusSchema.optional(),
    vastgoed: box3DocumentStatusSchema.optional(),
  }).optional(),

  // Concept mail
  draft_mail: z.object({
    onderwerp: z.string(),
    body: z.string(),
  }).optional(),

  // Bijlage analyse - per bestand wat de AI gevonden heeft
  bijlage_analyse: z.array(z.object({
    bestandsnaam: z.string(),
    document_type: z.string(),
    belastingjaar: z.union([z.number(), z.string()]).nullable().optional(),
    samenvatting: z.string(),
    geextraheerde_waarden: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    relevantie: z.string().optional(),
  })).optional(),

  // Legacy velden voor backward compatibility
  belastingjaar: z.string().optional(),
  validatie: z.object({
    aangifte_ib: z.object({
      status: z.enum(["compleet", "onvolledig", "ontbreekt"]),
      feedback: z.string(),
      gevonden_in: z.array(z.string()).optional(),
    }).optional(),
    bankrekeningen: z.object({
      status: z.enum(["compleet", "onvolledig", "ontbreekt"]),
      feedback: z.string(),
      gevonden_in: z.array(z.string()).optional(),
    }).optional(),
    beleggingen: z.object({
      status: z.enum(["compleet", "onvolledig", "ontbreekt"]),
      feedback: z.string(),
      gevonden_in: z.array(z.string()).optional(),
    }).optional(),
    vastgoed: z.object({
      status: z.enum(["compleet", "onvolledig", "ontbreekt"]),
      feedback: z.string(),
      gevonden_in: z.array(z.string()).optional(),
    }).optional(),
    schulden: z.object({
      status: z.enum(["compleet", "onvolledig", "ontbreekt"]),
      feedback: z.string(),
      gevonden_in: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
  concept_mail: z.object({
    onderwerp: z.string(),
    body: z.string(),
  }).optional(),
}).passthrough(); // Accepteer extra velden die niet in het schema staan

export type Box3ValidationResult = z.infer<typeof box3ValidationResultSchema>;
export type Box3GlobalStatus = z.infer<typeof box3GlobalStatusSchema>;
export type Box3DocumentStatus = z.infer<typeof box3DocumentStatusSchema>;
export type Box3ValidatorSession = typeof box3ValidatorSessions.$inferSelect;
export type InsertBox3ValidatorSession = typeof box3ValidatorSessions.$inferInsert;

export const box3AttachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  fileSize: z.number(),
  fileData: z.string(), // base64
});

// Zod schema for manual overrides
export const box3ManualOverrideSchema = z.object({
  status: z.enum(["nvt", "compleet"]).optional(),
  value: z.number().optional(),
  note: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const box3ManualOverridesSchema = z.object({
  aangifte_ib: box3ManualOverrideSchema.optional(),
  bankrekeningen: box3ManualOverrideSchema.optional(),
  beleggingen: box3ManualOverrideSchema.optional(),
  vastgoed: box3ManualOverrideSchema.optional(),
  schulden: box3ManualOverrideSchema.optional(),
  extraValues: z.object({
    bank_rente_ontvangen: z.number().optional(),
    beleggingen_waarde_1jan: z.number().optional(),
    beleggingen_waarde_31dec: z.number().optional(),
    beleggingen_dividend: z.number().optional(),
    schulden_rente_betaald: z.number().optional(),
  }).optional(),
});

export const insertBox3ValidatorSessionSchema = createInsertSchema(box3ValidatorSessions, {
  clientName: z.string().min(1, "Klantnaam is verplicht"),
  inputText: z.string().min(1, "Input tekst is verplicht"),
  attachmentNames: z.array(z.string()).nullable().optional(),
  attachments: z.array(box3AttachmentSchema).nullable().optional(),
  validationResult: box3ValidationResultSchema.nullable().optional(),
  conceptMail: z.object({
    onderwerp: z.string(),
    body: z.string()
  }).nullable().optional(),
  manualOverrides: box3ManualOverridesSchema.nullable().optional(),
  dossierStatus: z.string().optional(),
  notes: z.string().nullable().optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

// ===== EXTERNAL REPORT SESSIONS =====
/**
 * ## EXTERNAL REPORT SESSIONS TABLE
 *
 * **Verantwoordelijkheid**: Sessies voor het aanpassen van externe rapporten
 *
 * Fiscalisten kunnen bestaande rapporten (niet uit ons systeem) plakken,
 * feedback geven, en een aangepaste versie krijgen met diff preview.
 *
 * Flow:
 * 1. Fiscalist plakt bestaand rapport
 * 2. Geeft instructie/feedback
 * 3. AI genereert aangepaste versie
 * 4. Diff preview wordt getoond
 * 5. Na acceptatie wordt HTML preview beschikbaar
 */
export const externalReportSessions = pgTable("external_report_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(), // Sessie titel (bijv. "Rapport Klant X")
  originalContent: text("original_content").notNull(), // Originele tekst (paste)
  currentContent: text("current_content"), // Huidige versie na aanpassingen
  adjustmentCount: integer("adjustment_count").default(0), // Aantal aanpassingen
  lastInstruction: text("last_instruction"), // Laatste instructie
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  createdAtIdx: index("external_report_sessions_created_at_idx").on(table.createdAt),
}));

// External Report Adjustment History
export const externalReportAdjustments = pgTable("external_report_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => externalReportSessions.id, { onDelete: 'cascade' }),
  version: integer("version").notNull(), // 1, 2, 3, etc.
  instruction: text("instruction").notNull(), // Instructie van fiscalist
  previousContent: text("previous_content").notNull(), // Content voor aanpassing
  newContent: text("new_content").notNull(), // Content na aanpassing
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  sessionIdIdx: index("external_report_adjustments_session_id_idx").on(table.sessionId),
}));

// Types
export type ExternalReportSession = typeof externalReportSessions.$inferSelect;
export type InsertExternalReportSession = typeof externalReportSessions.$inferInsert;
export type ExternalReportAdjustment = typeof externalReportAdjustments.$inferSelect;
export type InsertExternalReportAdjustment = typeof externalReportAdjustments.$inferInsert;

// Zod schemas
export const insertExternalReportSessionSchema = createInsertSchema(externalReportSessions, {
  title: z.string().min(1, "Titel is verplicht"),
  originalContent: z.string().min(10, "Rapport moet minimaal 10 karakters bevatten"),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const insertExternalReportAdjustmentSchema = createInsertSchema(externalReportAdjustments, {
  sessionId: z.string().uuid("Ongeldige session ID"),
  version: z.number().int().positive(),
  instruction: z.string().min(10, "Instructie moet minimaal 10 karakters bevatten"),
  previousContent: z.string().min(1),
  newContent: z.string().min(1),
}).omit({ id: true, createdAt: true });
