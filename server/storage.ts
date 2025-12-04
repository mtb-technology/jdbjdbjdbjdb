import { type User, type InsertUser, type Report, type InsertReport, type Source, type InsertSource, type PromptConfigRecord, type InsertPromptConfig, type FollowUpSession, type InsertFollowUpSession, type FollowUpThread, type InsertFollowUpThread, type Attachment, type InsertAttachment, type Box3ValidatorSession, type InsertBox3ValidatorSession } from "@shared/schema";
import { users, reports, sources, promptConfigs, followUpSessions, followUpThreads, attachments, box3ValidatorSessions } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, or, ilike, count, sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

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
  }): Promise<{ reports: Report[]; total: number; page: number; totalPages: number }>;
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

  // Box 3 Validator Sessions
  getBox3ValidatorSession(id: string): Promise<Box3ValidatorSession | undefined>;
  getAllBox3ValidatorSessions(): Promise<Box3ValidatorSession[]>;
  createBox3ValidatorSession(session: InsertBox3ValidatorSession): Promise<Box3ValidatorSession>;
  updateBox3ValidatorSession(id: string, data: Partial<Box3ValidatorSession>): Promise<Box3ValidatorSession | undefined>;
  deleteBox3ValidatorSession(id: string): Promise<void>;
}

// Flag to track if dossier number migration has been checked
let dossierNumberMigrationChecked = false;

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

        END $$;
      `);
      console.log('✅ [Storage] Dossier number schema verified');
    } catch (migrationError) {
      console.log('ℹ️ [Storage] Dossier number migration skipped (already exists or error):', migrationError);
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
  }): Promise<{ reports: Report[]; total: number; page: number; totalPages: number }> {
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

      // Get paginated results
      const reportList = await db
        .select()
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
      console.error(`❌ Error in getAllReports:`, error);
      throw error;
    }
  }

  async createReport(insertReport: InsertReport): Promise<Report> {
    // Ensure dossier_number column and sequence exist (runs once per server start)
    await this.ensureDossierNumberMigration();

    // Get next dossier number from sequence
    const result = await db.execute(sql`SELECT nextval('dossier_number_seq')`);
    const nextval = (result as any)[0]?.nextval;
    const dossierNumber = parseInt(String(nextval), 10);

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
        console.log('ℹ️ [Storage] Source URL already exists (race condition), fetching existing:', insertSource.url);
        // Another process likely inserted the same URL, try to fetch it
        const [existing] = await db.select().from(sources).where(eq(sources.url, insertSource.url));
        if (existing) {
          return existing;
        }
        // ✅ FIX: If still not found, this is an error that should be logged
        console.error('❌ [Storage] Race condition: constraint violation but source not found!', {
          url: insertSource.url,
          error: error.message
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
      '1_informatiecheck',
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
      console.log(`Using existing prompt configs from database (${existing.length} configs found)`);
      return;
    }

    // Only create default config if database is completely empty (first run)
    console.log('No prompt configs found - creating empty default configuration...');
    console.log('Configure your prompts via Settings UI');

    const defaultConfig = {
      name: "Default Fiscal Analysis",
      isActive: true,
      config: {
        "1_informatiecheck": { prompt: "", useGrounding: false },
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

  // Box 3 Validator Session methods
  async getBox3ValidatorSession(id: string): Promise<Box3ValidatorSession | undefined> {
    const [session] = await db.select().from(box3ValidatorSessions).where(eq(box3ValidatorSessions.id, id));
    return session || undefined;
  }

  async getAllBox3ValidatorSessions(): Promise<Box3ValidatorSession[]> {
    return await db.select().from(box3ValidatorSessions).orderBy(desc(box3ValidatorSessions.createdAt));
  }

  async createBox3ValidatorSession(insertSession: InsertBox3ValidatorSession): Promise<Box3ValidatorSession> {
    const [session] = await db.insert(box3ValidatorSessions).values(insertSession).returning();
    return session;
  }

  async updateBox3ValidatorSession(id: string, updateData: Partial<Box3ValidatorSession>): Promise<Box3ValidatorSession | undefined> {
    const [updated] = await db
      .update(box3ValidatorSessions)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(box3ValidatorSessions.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteBox3ValidatorSession(id: string): Promise<void> {
    await db.delete(box3ValidatorSessions).where(eq(box3ValidatorSessions.id, id));
  }

  /**
   * Restore client names from dossier_context_summary for all reports
   * This fixes the mass-update mistake where all cases got "Mike Nauheimer" as client_name
   */
  async restoreClientNamesFromContext(): Promise<{ updated: number; failed: number; details: Array<{ id: string; oldName: string; newName: string | null; success: boolean }> }> {
    console.log('🔧 Starting client name restoration from dossier_context_summary...');

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

          console.log(`✅ [${report.id}] Updated: "${currentClientName}" -> "${extractedName}"`);
          details.push({ id: report.id, oldName: currentClientName, newName: extractedName, success: true });
          updated++;
        } catch (error) {
          console.error(`❌ [${report.id}] Failed to update:`, error);
          details.push({ id: report.id, oldName: currentClientName, newName: extractedName, success: false });
          failed++;
        }
      } else {
        // No change needed or couldn't extract
        if (!extractedName) {
          console.log(`⚠️ [${report.id}] Could not extract client name from context`);
          details.push({ id: report.id, oldName: currentClientName, newName: null, success: false });
          failed++;
        } else {
          console.log(`ℹ️ [${report.id}] Already correct: "${currentClientName}"`);
          details.push({ id: report.id, oldName: currentClientName, newName: extractedName, success: true });
        }
      }
    }

    console.log(`🔧 Client name restoration complete: ${updated} updated, ${failed} failed/skipped`);
    return { updated, failed, details };
  }
}

export const storage = new DatabaseStorage();

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