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
  status: text("status").notNull().default("draft"), // draft, generated, exported
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
    bsn: z.string().optional(),
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

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertReportSchema = createInsertSchema(reports).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSourceSchema = createInsertSchema(sources).omit({
  id: true,
  lastChecked: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Source = typeof sources.$inferSelect;
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type DossierData = z.infer<typeof dossierSchema>;
export type BouwplanData = z.infer<typeof bouwplanSchema>;
