import { type User, type InsertUser, type Report, type InsertReport, type Source, type InsertSource, type PromptConfigRecord, type InsertPromptConfig, type FollowUpSession, type InsertFollowUpSession, type FollowUpThread, type InsertFollowUpThread } from "@shared/schema";
import { users, reports, sources, promptConfigs, followUpSessions, followUpThreads } from "@shared/schema";
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
}

// DatabaseStorage - permanente opslag in PostgreSQL
export class DatabaseStorage implements IStorage {
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
    const [report] = await db.select().from(reports).where(eq(reports.id, id));
    return report || undefined;
  }

  async getAllReports(options?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }): Promise<{ reports: Report[]; total: number; page: number; totalPages: number }> {
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
    const [report] = await db.insert(reports).values(insertReport).returning();
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
        // Another process likely inserted the same URL, try to fetch it
        const [existing] = await db.select().from(sources).where(eq(sources.url, insertSource.url));
        if (existing) return existing;
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
    // Check for production sync mode - if enabled, always sync from JSON regardless of existing configs
    const syncMode = process.env.PROMPTS_SYNC_MODE;
    if (process.env.NODE_ENV === 'production' && syncMode === 'upsert') {
      console.log('Production mode: Force syncing prompts from storage/prompts.json...');
      const result = await this.forceIngestPromptsFromJson();
      if (result.success) {
        console.log(`✅ Production sync completed: ${result.message}`);
        return;
      } else {
        console.error(`❌ Production sync failed: ${result.message}, falling back to default initialization`);
      }
    }

    // Check if any configs exist
    const existing = await this.getAllPromptConfigs();
    if (existing.length > 0) {
      return;
    }
    
    try {
      // Try to load prompts from storage/prompts.json file
      const promptsFilePath = path.join(process.cwd(), 'storage', 'prompts.json');
      
      if (fs.existsSync(promptsFilePath)) {
        console.log('Loading prompts from storage/prompts.json...');
        const promptsFileContent = fs.readFileSync(promptsFilePath, 'utf8');
        const promptsData = JSON.parse(promptsFileContent);
        
        // Load all prompt configurations from the JSON file
        if (Array.isArray(promptsData)) {
          for (const promptConfig of promptsData) {
            // Remove id, createdAt, updatedAt from JSON if they exist to avoid conflicts
            const { id, createdAt, updatedAt, ...configToInsert } = promptConfig;
            await this.createPromptConfig(configToInsert);
            console.log(`Loaded prompt config: ${configToInsert.name}`);
          }
          console.log(`Successfully loaded ${promptsData.length} prompt configurations from JSON file`);
          return;
        }
      }
    } catch (error) {
      console.error('Failed to load prompts from JSON file, falling back to defaults:', error);
    }
    
    // Fallback: Create empty default config if JSON loading failed
    console.log('Creating fallback default prompt configuration...');
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
        "4d_DeVertaler": { prompt: "", useGrounding: false },
        "4e_DeAdvocaat": { prompt: "", useGrounding: true },
        "4f_DeKlantpsycholoog": { prompt: "", useGrounding: false },
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

  async forceIngestPromptsFromJson(): Promise<{ success: boolean; message: string; configsLoaded: number }> {
    try {
      // Try to load prompts from storage/prompts.json file
      const promptsFilePath = path.join(process.cwd(), 'storage', 'prompts.json');
      
      if (!fs.existsSync(promptsFilePath)) {
        return { success: false, message: 'storage/prompts.json file not found', configsLoaded: 0 };
      }

      console.log('Force loading prompts from storage/prompts.json...');
      const promptsFileContent = fs.readFileSync(promptsFilePath, 'utf8');
      const promptsData = JSON.parse(promptsFileContent);
      
      // Load all prompt configurations from the JSON file
      if (Array.isArray(promptsData)) {
        // Deactivate existing configs first
        await db.update(promptConfigs).set({ isActive: false });
        
        let loadedCount = 0;
        for (const promptConfig of promptsData) {
          // Remove id, createdAt, updatedAt from JSON if they exist to avoid conflicts
          const { id, createdAt, updatedAt, ...configToInsert } = promptConfig;
          
          // Create new config with timestamp suffix to avoid name conflicts
          const configName = `${configToInsert.name} (Ingested ${new Date().toISOString().slice(0, 16).replace('T', ' ')})`;
          const configToCreate = {
            ...configToInsert,
            name: configName,
            isActive: loadedCount === 0 // Make first one active
          };
          
          await this.createPromptConfig(configToCreate);
          console.log(`Force loaded prompt config: ${configName}`);
          loadedCount++;
        }
        
        return { 
          success: true, 
          message: `Successfully force-loaded ${loadedCount} prompt configurations from JSON file`, 
          configsLoaded: loadedCount 
        };
      } else {
        return { success: false, message: 'JSON file does not contain valid prompt array', configsLoaded: 0 };
      }
    } catch (error) {
      console.error('Failed to force-load prompts from JSON file:', error);
      return { 
        success: false, 
        message: `Failed to load prompts: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        configsLoaded: 0 
      };
    }
  }

  // Follow-up session methods
  async getFollowUpSession(id: string): Promise<FollowUpSession | undefined> {
    const [session] = await db.select().from(followUpSessions).where(eq(followUpSessions.id, id));
    return session || undefined;
  }

  async getAllFollowUpSessions(): Promise<FollowUpSession[]> {
    return await db.select().from(followUpSessions).orderBy(desc(followUpSessions.createdAt));
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