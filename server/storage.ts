import { type User, type InsertUser, type Report, type InsertReport, type Source, type InsertSource, type PromptConfigRecord, type InsertPromptConfig, type FollowUpSession, type InsertFollowUpSession, type FollowUpThread, type InsertFollowUpThread, type Attachment, type InsertAttachment, type ExternalReportSession, type InsertExternalReportSession, type ExternalReportAdjustment, type InsertExternalReportAdjustment, type Job, type InsertJob, type Box3Dossier, type InsertBox3Dossier, type Box3Document, type InsertBox3Document, type Box3BlueprintRecord, type InsertBox3BlueprintRecord, type Box3Blueprint } from "@shared/schema";

import { users, reports, sources, promptConfigs, followUpSessions, followUpThreads, attachments, externalReportSessions, externalReportAdjustments, jobs, box3Dossiers, box3Documents, box3Blueprints } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, or, ilike, count, sql, inArray } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./services/logger";

// Lighter type for list views - excludes large JSON fields
export interface ReportListItem {
  id: string;
  dossierNumber: number;
  title: string;
  clientName: string;
  status: string;
  currentStage: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  stageResults: unknown;
  conceptReportVersions: unknown;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getReport(id: string): Promise<Report | undefined>;
  getAllReports(options?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }): Promise<{ reports: ReportListItem[]; total: number; page: number; totalPages: number }>;
  getReportsByAutomailConversation(conversationId: number): Promise<Report[]>;
  createReport(report: InsertReport): Promise<Report>;
  updateReport(id: string, report: Partial<Report>): Promise<Report | undefined>;
  updateReportStatus(id: string, status: string): Promise<void>;
  deleteReport(id: string): Promise<void>;

  getSource(id: string): Promise<Source | undefined>;
  getAllSources(): Promise<Source[]>;
  createSource(source: InsertSource): Promise<Source>;

  getPromptConfig(id: string): Promise<PromptConfigRecord | undefined>;
  getActivePromptConfig(): Promise<PromptConfigRecord | undefined>;
  getAllPromptConfigs(): Promise<PromptConfigRecord[]>;
  createPromptConfig(config: InsertPromptConfig): Promise<PromptConfigRecord>;
  updatePromptConfig(id: string, config: Partial<PromptConfigRecord>): Promise<PromptConfigRecord | undefined>;

  // Follow-up sessions
  getFollowUpSession(id: string): Promise<FollowUpSession | undefined>;
  getAllFollowUpSessions(): Promise<FollowUpSession[]>;
  getFollowUpSessionWithThreads(id: string): Promise<(FollowUpSession & { threads: FollowUpThread[] }) | undefined>;
  createFollowUpSession(session: InsertFollowUpSession): Promise<FollowUpSession>;
  deleteFollowUpSession(id: string): Promise<void>;

  // Follow-up threads
  createFollowUpThread(thread: InsertFollowUpThread): Promise<FollowUpThread>;
  getThreadsForSession(sessionId: string): Promise<FollowUpThread[]>;

  // Attachments
  createAttachment(attachment: InsertAttachment): Promise<Attachment>;
  getAttachment(id: string): Promise<Attachment | undefined>;
  getAttachmentsForReport(reportId: string): Promise<Attachment[]>;
  updateAttachmentUsage(id: string, stageId: string): Promise<Attachment | undefined>;
  updateAttachment(id: string, data: Partial<Attachment>): Promise<Attachment | undefined>;
  deleteAttachment(id: string): Promise<void>;

  // Box 3 Validator V1 Sessions - REMOVED (see V2 methods below)

  // External Report Sessions
  getExternalReportSession(id: string): Promise<ExternalReportSession | undefined>;
  getAllExternalReportSessions(): Promise<ExternalReportSession[]>;
  createExternalReportSession(session: InsertExternalReportSession): Promise<ExternalReportSession>;
  updateExternalReportSession(id: string, data: Partial<ExternalReportSession>): Promise<ExternalReportSession | undefined>;
  deleteExternalReportSession(id: string): Promise<void>;

  // External Report Adjustments
  createExternalReportAdjustment(adjustment: InsertExternalReportAdjustment): Promise<ExternalReportAdjustment>;
  getAdjustmentsForSession(sessionId: string): Promise<ExternalReportAdjustment[]>;

  // Jobs - Background task management
  createJob(job: InsertJob): Promise<Job>;
  getJob(id: string): Promise<Job | undefined>;
  getJobsByStatus(status: string | string[]): Promise<Job[]>;
  getJobsForReport(reportId: string, status?: string | string[]): Promise<Job[]>;
  getJobsForBox3Dossier(dossierId: string, status?: string | string[]): Promise<Job[]>;
  updateJobProgress(id: string, progress: Record<string, any>): Promise<Job | undefined>;
  startJob(id: string): Promise<Job | undefined>;
  completeJob(id: string, result: Record<string, any>): Promise<Job | undefined>;
  failJob(id: string, error: string): Promise<Job | undefined>;
  cancelJob(id: string): Promise<Job | undefined>;

  // ═══════════════════════════════════════════════════════════════════════════
  // BOX 3 V2 - New canonical data model
  // ═══════════════════════════════════════════════════════════════════════════

  // Dossiers
  getBox3Dossier(id: string): Promise<Box3Dossier | undefined>;
  getAllBox3Dossiers(): Promise<Box3Dossier[]>;
  getAllBox3DossiersLight(): Promise<Omit<Box3Dossier, 'intakeText'>[]>;
  createBox3Dossier(dossier: InsertBox3Dossier): Promise<Box3Dossier>;
  updateBox3Dossier(id: string, data: Partial<Box3Dossier>): Promise<Box3Dossier | undefined>;
  deleteBox3Dossier(id: string): Promise<void>;

  // Documents
  getBox3Document(id: string): Promise<Box3Document | undefined>;
  getBox3DocumentsForDossier(dossierId: string): Promise<Box3Document[]>;
  getBox3DocumentsForDossierLight(dossierId: string): Promise<Omit<Box3Document, 'fileData'>[]>;
  createBox3Document(doc: InsertBox3Document): Promise<Box3Document>;
  updateBox3Document(id: string, data: Partial<Box3Document>): Promise<Box3Document | undefined>;
  updateBox3DocumentsBatch(updates: Array<{ id: string; data: Partial<Box3Document> }>): Promise<number>;
  deleteBox3Document(id: string): Promise<void>;

  // Blueprints
  getBox3Blueprint(id: string): Promise<Box3BlueprintRecord | undefined>;
  getLatestBox3Blueprint(dossierId: string): Promise<Box3BlueprintRecord | undefined>;
  getAllBox3Blueprints(dossierId: string): Promise<Box3BlueprintRecord[]>;
  createBox3Blueprint(blueprint: InsertBox3BlueprintRecord): Promise<Box3BlueprintRecord>;

  // Combined operations
  getBox3DossierWithLatestBlueprint(dossierId: string): Promise<{ dossier: Box3Dossier; blueprint: Box3BlueprintRecord | null; documents: Omit<Box3Document, 'fileData'>[] } | undefined>;
}

// Flag to track if dossier number migration has been checked
let dossierNumberMigrationChecked = false;
let sequenceSyncChecked = false;

/**
 * Extract client name from dossier_context_summary text
 * Looks for patterns like:
 * - "Klant naam/type: Mike Nauheimer (Particulier)"
 * - "Klant: Jan de Vries"
 * - "Client: Company Name B.V."
 * - "**Klant naam/type:** Mike Nauheimer"
 */
function extractClientNameFromContext(contextSummary: string | null): string | null {
  if (!contextSummary) return null;

  // Helper to clean up extracted name (remove markdown, extra whitespace, trailing slashes)
  const cleanName = (name: string): string => {
    return name
      .replace(/^\*+\s*/, '') // Remove leading asterisks
      .replace(/\s*\*+$/, '') // Remove trailing asterisks
      .replace(/\s*\/\s*$/, '') // Remove trailing slash
      .replace(/\s*\/\s*Particulier.*$/i, '') // Remove "/ Particulier" suffix
      .replace(/\s*\(Particulier\).*$/i, '') // Remove "(Particulier)" suffix
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  };

  // Pattern 1: "**Klant naam/type:** Name (Type)" - with markdown bold
  const pattern1a = /\*\*Klant\s+naam\/type:\*\*\s*([^(\n]+?)(?:\s*\(|$|\n)/i;
  const match1a = contextSummary.match(pattern1a);
  if (match1a?.[1]) {
    const cleaned = cleanName(match1a[1]);
    if (cleaned && cleaned.length > 2 && cleaned.length < 50) return cleaned;
  }

  // Pattern 1b: "Klant naam/type: Name (Type)" without markdown
  const pattern1b = /Klant\s+naam\/type:\s*([^(\n]+?)(?:\s*\(|$|\n)/i;
  const match1b = contextSummary.match(pattern1b);
  if (match1b?.[1]) {
    const cleaned = cleanName(match1b[1]);
    if (cleaned && cleaned.length > 2 && cleaned.length < 50) return cleaned;
  }

  // Pattern 2: "- Klant: Name" or "• Klant: Name" with optional markdown
  const pattern2 = /(?:^|\n)\s*[-•*]\s*\*{0,2}Klant:?\*{0,2}\s*([^\n(]+?)(?:\s*\(|$|\n)/i;
  const match2 = contextSummary.match(pattern2);
  if (match2?.[1]) {
    const cleaned = cleanName(match2[1]);
    if (cleaned && cleaned.length > 2 && cleaned.length < 50) return cleaned;
  }

  // Pattern 3: "Client: Name"
  const pattern3 = /(?:^|\n)\s*[-•*]?\s*\*{0,2}Client:?\*{0,2}\s*([^\n(]+?)(?:\s*\(|$|\n)/i;
  const match3 = contextSummary.match(pattern3);
  if (match3?.[1]) {
    const cleaned = cleanName(match3[1]);
    if (cleaned && cleaned.length > 2 && cleaned.length < 50) return cleaned;
  }

  return null;
}

// DatabaseStorage - permanente opslag in PostgreSQL
export class DatabaseStorage implements IStorage {
  /**
   * Ensure dossier_number column and sequence exist (auto-migration for production)
   * Only runs once per server start
   */
  private async ensureDossierNumberMigration(): Promise<void> {
    if (dossierNumberMigrationChecked) return;

    try {
      await db.execute(sql`
        DO $$
        BEGIN
          -- Create sequence if not exists
          IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'dossier_number_seq') THEN
            CREATE SEQUENCE dossier_number_seq START WITH 1;
          END IF;

          -- Add column if not exists
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reports' AND column_name = 'dossier_number') THEN
            ALTER TABLE reports ADD COLUMN dossier_number integer;

            -- Set existing reports to have sequential numbers
            UPDATE reports SET dossier_number = subquery.row_num
            FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as row_num FROM reports) AS subquery
            WHERE reports.id = subquery.id AND reports.dossier_number IS NULL;

            -- Update sequence to continue from highest
            PERFORM setval('dossier_number_seq', COALESCE((SELECT MAX(dossier_number) FROM reports), 0));

            -- Add constraints
            ALTER TABLE reports ALTER COLUMN dossier_number SET NOT NULL;
            ALTER TABLE reports ADD CONSTRAINT reports_dossier_number_unique UNIQUE (dossier_number);

            RAISE NOTICE 'Dossier number column migration completed';
          END IF;

          -- Always fix titles that don't have the dossier number prefix (runs every time)
          -- Prepend dossier number to existing title instead of using client_name
          UPDATE reports
          SET title = 'D-' || LPAD(dossier_number::text, 4, '0') || ' - ' || title
          WHERE dossier_number IS NOT NULL
            AND title NOT LIKE 'D-____% - %';

          -- Always sync sequence with max dossier_number to prevent unique constraint violations
          -- This handles cases where reports were deleted or sequence got out of sync
          PERFORM setval('dossier_number_seq', COALESCE((SELECT MAX(dossier_number) FROM reports), 0));

        END $$;
      `);
      logger.info('storage', 'Dossier number schema verified');
    } catch (migrationError) {
      logger.info('storage', 'Dossier number migration skipped (already exists or error)', { error: String(migrationError) });
    }

    dossierNumberMigrationChecked = true;
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getReport(id: string): Promise<Report | undefined> {
    // Ensure dossier_number column exists before querying
    await this.ensureDossierNumberMigration();
    const [report] = await db.select().from(reports).where(eq(reports.id, id));
    return report || undefined;
  }

  async getAllReports(options?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }): Promise<{ reports: ReportListItem[]; total: number; page: number; totalPages: number }> {
    // Ensure dossier_number column exists before querying
    await this.ensureDossierNumberMigration();

    try {
      const page = options?.page || 1;
      const limit = options?.limit || 10;
      const offset = (page - 1) * limit;

      // Build where conditions
      const conditions = [];
      if (options?.status) {
        conditions.push(eq(reports.status, options.status));
      }
      if (options?.search) {
        const searchTerm = `%${options.search}%`;
        conditions.push(
          or(
            ilike(reports.title, searchTerm),
            ilike(reports.clientName, searchTerm)
          )
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Get total count
      const [{ total }] = await db
        .select({ total: count() })
        .from(reports)
        .where(whereClause);

      // Get paginated results - only select fields needed for list view
      // Excludes large JSON fields like dossierData, generatedContent, documentState, etc.
      const reportList = await db
        .select({
          id: reports.id,
          dossierNumber: reports.dossierNumber,
          title: reports.title,
          clientName: reports.clientName,
          status: reports.status,
          currentStage: reports.currentStage,
          createdAt: reports.createdAt,
          updatedAt: reports.updatedAt,
          // For progress calculation - only keys are used, not full content
          stageResults: reports.stageResults,
          conceptReportVersions: reports.conceptReportVersions,
        })
        .from(reports)
        .where(whereClause)
        .orderBy(desc(reports.createdAt))
        .limit(limit)
        .offset(offset);

      const totalPages = Math.ceil(Number(total) / limit);

      const result = {
        reports: reportList,
        total: Number(total),
        page,
        totalPages,
      };
      return result;
    } catch (error) {
      logger.error('storage', 'Error in getAllReports', {}, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Get reports by Automail conversation ID
   * Uses PostgreSQL JSONB path filtering for efficient querying
   */
  async getReportsByAutomailConversation(conversationId: number): Promise<Report[]> {
    try {
      const result = await db
        .select()
        .from(reports)
        .where(
          sql`(${reports.dossierData}->'automail'->>'conversationId')::integer = ${conversationId}`
        )
        .orderBy(desc(reports.createdAt));

      return result;
    } catch (error) {
      logger.error('storage', 'Error in getReportsByAutomailConversation', { conversationId }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Sync dossier_number_seq with actual max dossier_number (runs once per server start)
   */
  private async syncDossierSequence(): Promise<void> {
    if (sequenceSyncChecked) return;

    try {
      // First get the current max to log it
      const maxResult = await db.execute(sql`SELECT COALESCE(MAX(dossier_number), 0) as max_num FROM reports`);
      const maxRows = maxResult as any;
      const currentMax = maxRows?.rows?.[0]?.max_num ?? maxRows?.[0]?.max_num ?? 0;

      // Set sequence to current max (nextval will return max+1)
      await db.execute(sql`
        SELECT setval('dossier_number_seq', ${currentMax})
      `);
      logger.info('storage', `Dossier sequence synced: set to ${currentMax} (next will be ${currentMax + 1})`);
      sequenceSyncChecked = true;
    } catch (error) {
      logger.error('storage', 'Failed to sync dossier sequence', {}, error instanceof Error ? error : undefined);
      // Don't set flag to true so it can retry on next create
    }
  }

  async createReport(insertReport: InsertReport): Promise<Report> {
    // Ensure dossier_number column and sequence exist (runs once per server start)
    await this.ensureDossierNumberMigration();

    // Sync sequence with actual max dossier_number (runs once per server start)
    await this.syncDossierSequence();

    // Try to create report with retry on constraint violation
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Get next dossier number from sequence - cast to integer for proper handling
        const result = await db.execute(sql`SELECT nextval('dossier_number_seq')::integer as nextval`);
        const rows = result as any;
        const nextval = rows?.rows?.[0]?.nextval ?? rows?.[0]?.nextval;
        const dossierNumber = typeof nextval === 'number' ? nextval : parseInt(String(nextval), 10);

        // Safety check - if we still get NaN, throw a clear error
        if (isNaN(dossierNumber)) {
          logger.error('storage', 'Failed to get next dossier number', { result: String(result), nextval: String(nextval) });
          throw new Error('Kon geen dossiernummer genereren. Neem contact op met support.');
        }

        // Format title with dossier number: "D-0001 - [original title or client name]"
        const formattedNumber = String(dossierNumber).padStart(4, '0');
        const baseTitle = insertReport.title || insertReport.clientName;
        const title = `D-${formattedNumber} - ${baseTitle}`;

        const [report] = await db.insert(reports).values({
          ...insertReport,
          dossierNumber,
          title,
        }).returning();
        return report;
      } catch (error: any) {
        // Check for unique constraint violation on dossier_number
        if (error?.code === '23505' && error?.constraint?.includes('dossier_number')) {
          logger.warn('storage', `Dossier number collision (attempt ${attempt}/${maxRetries}), re-syncing sequence...`);

          // Reset sync flag and re-sync sequence
          sequenceSyncChecked = false;
          await this.syncDossierSequence();

          if (attempt === maxRetries) {
            logger.error('storage', 'Max retries reached for dossier number generation');
            throw error;
          }
          continue; // Retry with new sequence value
        }
        // For other errors, throw immediately
        throw error;
      }
    }

    // This should never be reached, but TypeScript needs it
    throw new Error('Kon geen rapport aanmaken na meerdere pogingen');
  }

  async updateReport(id: string, updateData: Partial<Report>): Promise<Report | undefined> {
    const [updated] = await db
      .update(reports)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(reports.id, id))
      .returning();
    return updated || undefined;
  }

  async updateReportStatus(id: string, status: string): Promise<void> {
    await db
      .update(reports)
      .set({ status, updatedAt: new Date() })
      .where(eq(reports.id, id));
  }

  async deleteReport(id: string): Promise<void> {
    await db.delete(reports).where(eq(reports.id, id));
  }

  async getSource(id: string): Promise<Source | undefined> {
    const [source] = await db.select().from(sources).where(eq(sources.id, id));
    return source || undefined;
  }

  async getAllSources(): Promise<Source[]> {
    return await db.select().from(sources).orderBy(desc(sources.lastChecked));
  }

  async createSource(insertSource: InsertSource): Promise<Source> {
    try {
      const [source] = await db.insert(sources).values(insertSource).returning();
      return source;
    } catch (error: any) {
      // Handle unique constraint violation (race condition scenario)
      if (error?.code === '23505' || error?.constraint?.includes('url')) {
        logger.info('storage', 'Source URL already exists (race condition), fetching existing', { url: insertSource.url });
        // Another process likely inserted the same URL, try to fetch it
        const [existing] = await db.select().from(sources).where(eq(sources.url, insertSource.url));
        if (existing) {
          return existing;
        }
        // If still not found, this is an error that should be logged
        logger.error('storage', 'Race condition: constraint violation but source not found!', {
          url: insertSource.url,
          errorMessage: error.message
        });
      }
      throw error;
    }
  }

  async getPromptConfig(id: string): Promise<PromptConfigRecord | undefined> {
    const [config] = await db.select().from(promptConfigs).where(eq(promptConfigs.id, id));
    return config || undefined;
  }

  async getActivePromptConfig(): Promise<PromptConfigRecord | undefined> {
    const [config] = await db.select().from(promptConfigs).where(eq(promptConfigs.isActive, true));

    if (config) {
      // Validate that there are no placeholder prompts
      this.validatePromptConfig(config);
    }

    return config || undefined;
  }

  /**
   * Validate that prompt config has no placeholder prompts
   * THROWS errors for missing/placeholder prompts - NO SOFT WARNINGS!
   * Quality depends on proper configuration, so we fail hard.
   */
  private validatePromptConfig(config: PromptConfigRecord): void {
    const configData = config.config as any;
    const criticalStages = [
      '1a_informatiecheck',
      '2_complexiteitscheck',
      '3_generatie',
      'editor'  // Editor is CRITICAL for feedback processing
    ];

    const errors: string[] = [];

    for (const stage of criticalStages) {
      const stageConfig = configData[stage];

      if (!stageConfig || !stageConfig.prompt) {
        errors.push(`Stage "${stage}" heeft geen prompt geconfigureerd`);
        continue;
      }

      const prompt = stageConfig.prompt.trim();

      if (prompt.length === 0) {
        errors.push(`Stage "${stage}" heeft een lege prompt`);
        continue;
      }

      // Check for placeholder text - FAIL HARD
      if (prompt.includes('PLACEHOLDER') || prompt.toLowerCase().includes('voer hier')) {
        errors.push(`Stage "${stage}" bevat nog PLACEHOLDER tekst - moet worden vervangen met een echte prompt`);
      }
    }

    // If there are errors, throw with clear instructions
    if (errors.length > 0) {
      throw new Error(
        `❌ PROMPT CONFIGURATIE INCOMPLETE:\n\n` +
        errors.map(e => `  • ${e}`).join('\n') +
        `\n\n` +
        `Ga naar Settings en configureer alle ontbrekende prompts. ` +
        `Het systeem kan niet draaien met incomplete prompt configuratie.`
      );
    }
  }

  async getAllPromptConfigs(): Promise<PromptConfigRecord[]> {
    return await db.select().from(promptConfigs).orderBy(desc(promptConfigs.createdAt));
  }

  async createPromptConfig(insertConfig: InsertPromptConfig): Promise<PromptConfigRecord> {
    // Set all other configs to inactive first
    if (insertConfig.isActive) {
      await db.update(promptConfigs).set({ isActive: false });
    }

    const [config] = await db.insert(promptConfigs).values(insertConfig).returning();
    return config;
  }

  async initializeDefaultPrompts(): Promise<void> {
    // Check if any configs exist - if so, use what's in database (managed via Settings UI)
    const existing = await this.getAllPromptConfigs();
    if (existing.length > 0) {
      logger.info('storage', `Using existing prompt configs from database (${existing.length} configs found)`);
      return;
    }

    // Only create default config if database is completely empty (first run)
    logger.info('storage', 'No prompt configs found - creating empty default configuration');
    logger.info('storage', 'Configure your prompts via Settings UI');

    const defaultConfig = {
      name: "Default Fiscal Analysis",
      isActive: true,
      config: {
        "1a_informatiecheck": { prompt: "", useGrounding: false },
        "1b_informatiecheck_email": { prompt: "", useGrounding: false },
        "2_complexiteitscheck": { prompt: "", useGrounding: false },
        "3_generatie": { prompt: "", useGrounding: true },
        "4a_BronnenSpecialist": { prompt: "", useGrounding: true },
        "4b_FiscaalTechnischSpecialist": { prompt: "", useGrounding: true },
        "4c_ScenarioGatenAnalist": { prompt: "", useGrounding: true },
        "4e_DeAdvocaat": { prompt: "", useGrounding: true },
        "4f_HoofdCommunicatie": { prompt: "", useGrounding: false },
        "editor": { prompt: "", useGrounding: false },
        aiConfig: {
          model: "gemini-2.5-pro",
          temperature: 0.1,
          topP: 0.95,
          topK: 20,
          maxOutputTokens: 8192,
          provider: "google"
        }
      }
    };

    await this.createPromptConfig(defaultConfig);
  }

  async updatePromptConfig(id: string, updateData: Partial<PromptConfigRecord>): Promise<PromptConfigRecord | undefined> {
    const [updated] = await db
      .update(promptConfigs)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(promptConfigs.id, id))
      .returning();
    return updated || undefined;
  }


  // Follow-up session methods
  async getFollowUpSession(id: string): Promise<FollowUpSession | undefined> {
    const [session] = await db.select().from(followUpSessions).where(eq(followUpSessions.id, id));
    return session || undefined;
  }

  async getAllFollowUpSessions(limit: number = 50): Promise<FollowUpSession[]> {
    return await db.select().from(followUpSessions)
      .orderBy(desc(followUpSessions.createdAt))
      .limit(limit);
  }

  async getFollowUpSessionWithThreads(id: string): Promise<(FollowUpSession & { threads: FollowUpThread[] }) | undefined> {
    const session = await this.getFollowUpSession(id);
    if (!session) return undefined;

    const threads = await this.getThreadsForSession(id);
    return {
      ...session,
      threads
    };
  }

  async createFollowUpSession(insertSession: InsertFollowUpSession): Promise<FollowUpSession> {
    const [session] = await db.insert(followUpSessions).values(insertSession).returning();
    return session;
  }

  async deleteFollowUpSession(id: string): Promise<void> {
    // Cascade delete will handle threads automatically
    await db.delete(followUpSessions).where(eq(followUpSessions.id, id));
  }

  // Follow-up thread methods
  async createFollowUpThread(insertThread: InsertFollowUpThread): Promise<FollowUpThread> {
    const [thread] = await db.insert(followUpThreads).values(insertThread).returning();
    return thread;
  }

  async getThreadsForSession(sessionId: string): Promise<FollowUpThread[]> {
    return await db.select().from(followUpThreads)
      .where(eq(followUpThreads.sessionId, sessionId))
      .orderBy(followUpThreads.createdAt);
  }

  // Attachment methods
  async createAttachment(insertAttachment: InsertAttachment): Promise<Attachment> {
    const [attachment] = await db.insert(attachments).values(insertAttachment).returning();
    return attachment;
  }

  async getAttachment(id: string): Promise<Attachment | undefined> {
    const [attachment] = await db.select().from(attachments).where(eq(attachments.id, id));
    return attachment || undefined;
  }

  async getAttachmentsForReport(reportId: string): Promise<Attachment[]> {
    return await db.select().from(attachments)
      .where(eq(attachments.reportId, reportId))
      .orderBy(attachments.uploadedAt);
  }

  async updateAttachmentUsage(id: string, stageId: string): Promise<Attachment | undefined> {
    // First get current attachment to check existing usedInStages
    const existing = await this.getAttachment(id);
    if (!existing) return undefined;

    const currentStages = (existing.usedInStages as string[]) || [];
    if (!currentStages.includes(stageId)) {
      currentStages.push(stageId);
    }

    const [updated] = await db
      .update(attachments)
      .set({ usedInStages: currentStages })
      .where(eq(attachments.id, id))
      .returning();
    return updated || undefined;
  }

  async updateAttachment(id: string, data: Partial<Attachment>): Promise<Attachment | undefined> {
    const [updated] = await db
      .update(attachments)
      .set(data)
      .where(eq(attachments.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteAttachment(id: string): Promise<void> {
    await db.delete(attachments).where(eq(attachments.id, id));
  }

  // Box 3 Validator V1 Session methods - REMOVED
  // Use Box 3 V2 methods below: getBox3Dossier, createBox3Dossier, etc.

  // External Report Session methods
  async getExternalReportSession(id: string): Promise<ExternalReportSession | undefined> {
    const [session] = await db.select().from(externalReportSessions).where(eq(externalReportSessions.id, id));
    return session || undefined;
  }

  async getAllExternalReportSessions(): Promise<ExternalReportSession[]> {
    return await db.select().from(externalReportSessions).orderBy(desc(externalReportSessions.createdAt));
  }

  async createExternalReportSession(insertSession: InsertExternalReportSession): Promise<ExternalReportSession> {
    const [session] = await db.insert(externalReportSessions).values(insertSession).returning();
    return session;
  }

  async updateExternalReportSession(id: string, updateData: Partial<ExternalReportSession>): Promise<ExternalReportSession | undefined> {
    const [updated] = await db
      .update(externalReportSessions)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(externalReportSessions.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteExternalReportSession(id: string): Promise<void> {
    // Cascade delete will handle adjustments automatically
    await db.delete(externalReportSessions).where(eq(externalReportSessions.id, id));
  }

  // External Report Adjustment methods
  async createExternalReportAdjustment(insertAdjustment: InsertExternalReportAdjustment): Promise<ExternalReportAdjustment> {
    const [adjustment] = await db.insert(externalReportAdjustments).values(insertAdjustment).returning();
    return adjustment;
  }

  async getAdjustmentsForSession(sessionId: string): Promise<ExternalReportAdjustment[]> {
    return await db.select().from(externalReportAdjustments)
      .where(eq(externalReportAdjustments.sessionId, sessionId))
      .orderBy(externalReportAdjustments.version);
  }

  // ===== JOBS - Background Task Management =====

  async createJob(insertJob: InsertJob): Promise<Job> {
    const [job] = await db.insert(jobs).values(insertJob).returning();
    const targetId = job.reportId || job.box3DossierId || 'n/a';
    logger.info('jobs', `Created job ${job.id} of type "${job.type}" for ${job.box3DossierId ? 'dossier' : 'report'} ${targetId}`);
    return job;
  }

  async getJob(id: string): Promise<Job | undefined> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    return job || undefined;
  }

  async getJobsByStatus(status: string | string[]): Promise<Job[]> {
    const statuses = Array.isArray(status) ? status : [status];
    return await db.select().from(jobs)
      .where(inArray(jobs.status, statuses))
      .orderBy(jobs.createdAt);
  }

  async getJobsForReport(reportId: string, status?: string | string[]): Promise<Job[]> {
    if (status) {
      const statuses = Array.isArray(status) ? status : [status];
      return await db.select().from(jobs)
        .where(and(
          eq(jobs.reportId, reportId),
          inArray(jobs.status, statuses)
        ))
        .orderBy(desc(jobs.createdAt));
    }
    return await db.select().from(jobs)
      .where(eq(jobs.reportId, reportId))
      .orderBy(desc(jobs.createdAt));
  }

  async getJobsForBox3Dossier(dossierId: string, status?: string | string[]): Promise<Job[]> {
    if (status) {
      const statuses = Array.isArray(status) ? status : [status];
      return await db.select().from(jobs)
        .where(and(
          eq(jobs.box3DossierId, dossierId),
          inArray(jobs.status, statuses)
        ))
        .orderBy(desc(jobs.createdAt));
    }
    return await db.select().from(jobs)
      .where(eq(jobs.box3DossierId, dossierId))
      .orderBy(desc(jobs.createdAt));
  }

  async updateJobProgress(id: string, progress: Record<string, any>): Promise<Job | undefined> {
    // Retry logic for database operations during long-running jobs
    // Neon serverless can timeout connections during extended pipeline operations
    const maxRetries = 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const [updated] = await db
          .update(jobs)
          .set({ progress: JSON.stringify(progress) })
          .where(eq(jobs.id, id))
          .returning();
        return updated || undefined;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff: 1s, 2s, 4s)
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
        }
      }
    }

    // Log but don't throw - job progress update is not critical enough to crash the pipeline
    console.error(`[storage] Failed to update job progress after ${maxRetries} attempts:`, lastError?.message);
    return undefined;
  }

  async startJob(id: string): Promise<Job | undefined> {
    const [updated] = await db
      .update(jobs)
      .set({
        status: 'processing',
        startedAt: new Date()
      })
      .where(eq(jobs.id, id))
      .returning();
    if (updated) {
      logger.info('jobs', `Started job ${id}`);
    }
    return updated || undefined;
  }

  async completeJob(id: string, result: Record<string, any>): Promise<Job | undefined> {
    const [updated] = await db
      .update(jobs)
      .set({
        status: 'completed',
        result,
        completedAt: new Date()
      })
      .where(eq(jobs.id, id))
      .returning();
    if (updated) {
      logger.info('jobs', `Completed job ${id}`);
    }
    return updated || undefined;
  }

  async failJob(id: string, error: string): Promise<Job | undefined> {
    const [updated] = await db
      .update(jobs)
      .set({
        status: 'failed',
        error,
        completedAt: new Date()
      })
      .where(eq(jobs.id, id))
      .returning();
    if (updated) {
      logger.error('jobs', `Failed job ${id}: ${error}`);
    }
    return updated || undefined;
  }

  async cancelJob(id: string): Promise<Job | undefined> {
    const [updated] = await db
      .update(jobs)
      .set({
        status: 'failed',
        error: 'Job cancelled by user',
        completedAt: new Date()
      })
      .where(eq(jobs.id, id))
      .returning();
    if (updated) {
      logger.info('jobs', `Cancelled job ${id}`);
    }
    return updated || undefined;
  }

  /**
   * Restore client names from dossier_context_summary for all reports
   * This fixes the mass-update mistake where all cases got "Mike Nauheimer" as client_name
   */
  async restoreClientNamesFromContext(): Promise<{ updated: number; failed: number; details: Array<{ id: string; oldName: string; newName: string | null; success: boolean }> }> {
    logger.info('storage', 'Starting client name restoration from dossier_context_summary...');

    const allReports = await db.select().from(reports).orderBy(desc(reports.createdAt));
    const details: Array<{ id: string; oldName: string; newName: string | null; success: boolean }> = [];
    let updated = 0;
    let failed = 0;

    for (const report of allReports) {
      const contextSummary = report.dossierContextSummary;
      const currentClientName = report.clientName;
      const extractedName = extractClientNameFromContext(contextSummary);

      if (extractedName && extractedName !== currentClientName) {
        try {
          // Update client_name and title with the extracted name
          const dossierNumber = report.dossierNumber;
          const formattedNumber = String(dossierNumber).padStart(4, '0');
          const newTitle = `D-${formattedNumber} - ${extractedName}`;

          await db.update(reports)
            .set({
              clientName: extractedName,
              title: newTitle,
              updatedAt: new Date()
            })
            .where(eq(reports.id, report.id));

          logger.info('storage', `[${report.id}] Updated: "${currentClientName}" -> "${extractedName}"`);
          details.push({ id: report.id, oldName: currentClientName, newName: extractedName, success: true });
          updated++;
        } catch (error) {
          logger.error('storage', `[${report.id}] Failed to update`, {}, error instanceof Error ? error : undefined);
          details.push({ id: report.id, oldName: currentClientName, newName: extractedName, success: false });
          failed++;
        }
      } else {
        // No change needed or couldn't extract
        if (!extractedName) {
          logger.warn('storage', `[${report.id}] Could not extract client name from context`);
          details.push({ id: report.id, oldName: currentClientName, newName: null, success: false });
          failed++;
        } else {
          logger.info('storage', `[${report.id}] Already correct: "${currentClientName}"`);
          details.push({ id: report.id, oldName: currentClientName, newName: extractedName, success: true });
        }
      }
    }

    logger.info('storage', `Client name restoration complete: ${updated} updated, ${failed} failed/skipped`);
    return { updated, failed, details };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOX 3 V2 - New canonical data model implementation
  // ═══════════════════════════════════════════════════════════════════════════

  // --- Dossiers ---

  async getBox3Dossier(id: string): Promise<Box3Dossier | undefined> {
    const [dossier] = await db.select().from(box3Dossiers).where(eq(box3Dossiers.id, id));
    return dossier;
  }

  async getAllBox3Dossiers(): Promise<Box3Dossier[]> {
    return db.select().from(box3Dossiers).orderBy(desc(box3Dossiers.createdAt));
  }

  async getAllBox3DossiersLight(): Promise<Omit<Box3Dossier, 'intakeText'>[]> {
    return db.select({
      id: box3Dossiers.id,
      dossierNummer: box3Dossiers.dossierNummer,
      clientName: box3Dossiers.clientName,
      clientEmail: box3Dossiers.clientEmail,
      status: box3Dossiers.status,
      taxYears: box3Dossiers.taxYears,
      hasFiscalPartner: box3Dossiers.hasFiscalPartner,
      createdAt: box3Dossiers.createdAt,
      updatedAt: box3Dossiers.updatedAt,
    }).from(box3Dossiers).orderBy(desc(box3Dossiers.createdAt));
  }

  async createBox3Dossier(dossier: InsertBox3Dossier): Promise<Box3Dossier> {
    const [created] = await db.insert(box3Dossiers).values(dossier).returning();
    return created;
  }

  async updateBox3Dossier(id: string, data: Partial<Box3Dossier>): Promise<Box3Dossier | undefined> {
    const [updated] = await db
      .update(box3Dossiers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(box3Dossiers.id, id))
      .returning();
    return updated;
  }

  async deleteBox3Dossier(id: string): Promise<void> {
    await db.delete(box3Dossiers).where(eq(box3Dossiers.id, id));
  }

  // --- Documents ---

  async getBox3Document(id: string): Promise<Box3Document | undefined> {
    const [doc] = await db.select().from(box3Documents).where(eq(box3Documents.id, id));
    return doc;
  }

  async getBox3DocumentsForDossier(dossierId: string): Promise<Box3Document[]> {
    return db.select().from(box3Documents).where(eq(box3Documents.dossierId, dossierId));
  }

  async getBox3DocumentsForDossierLight(dossierId: string): Promise<Omit<Box3Document, 'fileData'>[]> {
    return db.select({
      id: box3Documents.id,
      dossierId: box3Documents.dossierId,
      filename: box3Documents.filename,
      mimeType: box3Documents.mimeType,
      fileSize: box3Documents.fileSize,
      uploadedAt: box3Documents.uploadedAt,
      uploadedVia: box3Documents.uploadedVia,
      extractedText: box3Documents.extractedText,
      extractionStatus: box3Documents.extractionStatus,
      extractionCharCount: box3Documents.extractionCharCount,
      classification: box3Documents.classification,
      extractionSummary: box3Documents.extractionSummary,
      extractedValues: box3Documents.extractedValues,
    }).from(box3Documents).where(eq(box3Documents.dossierId, dossierId));
  }

  async createBox3Document(doc: InsertBox3Document): Promise<Box3Document> {
    const [created] = await db.insert(box3Documents).values(doc).returning();
    return created;
  }

  async updateBox3Document(id: string, data: Partial<Box3Document>): Promise<Box3Document | undefined> {
    const [updated] = await db
      .update(box3Documents)
      .set(data)
      .where(eq(box3Documents.id, id))
      .returning();
    return updated;
  }

  async updateBox3DocumentsBatch(updates: Array<{ id: string; data: Partial<Box3Document> }>): Promise<number> {
    if (updates.length === 0) return 0;

    // Execute all updates in a single transaction
    let updatedCount = 0;
    await db.transaction(async (tx) => {
      for (const update of updates) {
        const [result] = await tx
          .update(box3Documents)
          .set(update.data)
          .where(eq(box3Documents.id, update.id))
          .returning({ id: box3Documents.id });
        if (result) updatedCount++;
      }
    });

    return updatedCount;
  }

  async deleteBox3Document(id: string): Promise<void> {
    await db.delete(box3Documents).where(eq(box3Documents.id, id));
  }

  // --- Blueprints ---

  async getBox3Blueprint(id: string): Promise<Box3BlueprintRecord | undefined> {
    const [blueprint] = await db.select().from(box3Blueprints).where(eq(box3Blueprints.id, id));
    return blueprint;
  }

  async getLatestBox3Blueprint(dossierId: string): Promise<Box3BlueprintRecord | undefined> {
    const [blueprint] = await db
      .select()
      .from(box3Blueprints)
      .where(eq(box3Blueprints.dossierId, dossierId))
      .orderBy(desc(box3Blueprints.version))
      .limit(1);
    return blueprint;
  }

  async getAllBox3Blueprints(dossierId: string): Promise<Box3BlueprintRecord[]> {
    return db
      .select()
      .from(box3Blueprints)
      .where(eq(box3Blueprints.dossierId, dossierId))
      .orderBy(desc(box3Blueprints.version));
  }

  async createBox3Blueprint(blueprint: InsertBox3BlueprintRecord): Promise<Box3BlueprintRecord> {
    const [created] = await db.insert(box3Blueprints).values(blueprint).returning();
    return created;
  }

  async updateBox3BlueprintGeneratedEmail(blueprintId: string, generatedEmail: Box3BlueprintRecord['generatedEmail']): Promise<Box3BlueprintRecord | undefined> {
    const [updated] = await db
      .update(box3Blueprints)
      .set({ generatedEmail })
      .where(eq(box3Blueprints.id, blueprintId))
      .returning();
    return updated;
  }

  // --- Combined operations ---

  async getBox3DossierWithLatestBlueprint(dossierId: string): Promise<{ dossier: Box3Dossier; blueprint: Box3BlueprintRecord | null; documents: Omit<Box3Document, 'fileData'>[] } | undefined> {
    const dossier = await this.getBox3Dossier(dossierId);
    if (!dossier) return undefined;

    const blueprint = await this.getLatestBox3Blueprint(dossierId);
    // Use light version to exclude large file_data column
    const documents = await this.getBox3DocumentsForDossierLight(dossierId);

    return { dossier, blueprint: blueprint || null, documents };
  }
}

export const storage = new DatabaseStorage();

/**
 * Force sync dossier sequence on server startup
 * Call this early in the server boot process
 */
export async function initializeDossierSequence() {
  // Reset the flag to ensure fresh sync
  sequenceSyncChecked = false;

  try {
    // First, ensure the sequence exists
    await db.execute(sql`
      CREATE SEQUENCE IF NOT EXISTS dossier_number_seq START WITH 1
    `);

    // Get current max to log it
    const maxResult = await db.execute(sql`SELECT COALESCE(MAX(dossier_number), 0) as max_num FROM reports`);
    const maxRows = maxResult as any;
    const currentMax = maxRows?.rows?.[0]?.max_num ?? maxRows?.[0]?.max_num ?? 0;

    // Set sequence to current max (nextval will return max+1)
    // Only set if currentMax > 0 to avoid resetting to 0
    if (currentMax > 0) {
      await db.execute(sql`
        SELECT setval('dossier_number_seq', ${currentMax})
      `);
      logger.info('storage', `Dossier sequence initialized: set to ${currentMax} (next will be ${currentMax + 1})`);
    } else {
      logger.info('storage', 'Dossier sequence created (no existing reports)');
    }
    sequenceSyncChecked = true;
  } catch (error) {
    logger.error('storage', 'Failed to initialize dossier sequence', {}, error instanceof Error ? error : undefined);
  }
}

/**
 * Helper function to get active prompt config
 * Convenience export for use in other modules
 */
export async function getActivePromptConfig() {
  const config = await storage.getActivePromptConfig();
  if (!config) {
    throw new Error('No active prompt configuration found');
  }
  return config.config as any; // Cast to PromptConfig type
}