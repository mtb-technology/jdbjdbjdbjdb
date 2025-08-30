import { sql } from "drizzle-orm";
import { pgTable, text, varchar, json, timestamp, boolean } from "drizzle-orm/pg-core";
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
  conceptReportVersions: json("concept_report_versions"), // Store evolving concept report through stages
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

// Zod schemas for validation
export const dossierSchema = z.object({
  klant: z.object({
    naam: z.string().min(1, "Naam is verplicht"),
    situatie: z.string().min(1, "Situatie is verplicht"),
  }),
  fiscale_gegevens: z.object({
    vermogen: z.number().min(0, "Vermogen moet positief zijn"),
    inkomsten: z.number().min(0, "Inkomsten moeten positief zijn"),
  }),
  datum: z.string().optional(),
});

export const bouwplanSchema = z.object({
  taal: z.enum(["nl", "en"]).default("nl"),
  structuur: z.object({
    inleiding: z.boolean().default(true),
    knelpunten: z.array(z.string()).min(1, "Minimaal één knelpunt vereist"),
    scenario_analyse: z.boolean().default(true),
    vervolgstappen: z.boolean().default(true),
  }),
});

// AI Configuration schema
export const aiConfigSchema = z.object({
  model: z.enum(["gemini-2.5-pro", "gemini-2.5-flash"]).default("gemini-2.5-pro"),
  temperature: z.number().min(0).max(2).default(0.1),
  topP: z.number().min(0).max(1).default(0.95),
  topK: z.number().min(1).max(40).default(20),
  maxOutputTokens: z.number().min(100).max(8192).default(2048),
});

// Stage-specific configuration
export const stageConfigSchema = z.object({
  prompt: z.string().default(""),
  useGrounding: z.boolean().default(false),
});

// Multi-stage prompting workflow schema  
export const promptConfigSchema = z.object({
  "1_informatiecheck": stageConfigSchema.default({ prompt: "", useGrounding: false }),
  "2_complexiteitscheck": stageConfigSchema.default({ prompt: "", useGrounding: false }),
  "3_generatie": stageConfigSchema.default({ prompt: "", useGrounding: true }),
  "4a_BronnenSpecialist": stageConfigSchema.default({ prompt: "", useGrounding: true }),
  "4b_FiscaalTechnischSpecialist": stageConfigSchema.default({ prompt: "", useGrounding: true }),
  "4c_ScenarioGatenAnalist": stageConfigSchema.default({ prompt: "", useGrounding: true }),
  "4d_DeVertaler": stageConfigSchema.default({ prompt: "", useGrounding: false }),
  "4e_DeAdvocaat": stageConfigSchema.default({ prompt: "", useGrounding: true }),
  "4f_DeKlantpsycholoog": stageConfigSchema.default({ prompt: "", useGrounding: false }),
  "4g_ChefEindredactie": stageConfigSchema.default({ prompt: "", useGrounding: false }),
  "final_check": stageConfigSchema.default({ prompt: "", useGrounding: false }),
  aiConfig: aiConfigSchema.optional(),
});

export const reportStageSchema = z.object({
  stage: z.string(),
  input: z.any(),
  output: z.string(),
  timestamp: z.date(),
});

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

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Source = typeof sources.$inferSelect;
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type InsertPromptConfig = z.infer<typeof insertPromptConfigSchema>;
export type DossierData = z.infer<typeof dossierSchema>;
export type BouwplanData = z.infer<typeof bouwplanSchema>;
export type PromptConfig = z.infer<typeof promptConfigSchema>;
export type AiConfig = z.infer<typeof aiConfigSchema>;
export type StageConfig = z.infer<typeof stageConfigSchema>;
export type ReportStage = z.infer<typeof reportStageSchema>;
export type PromptConfigRecord = typeof promptConfigs.$inferSelect;
