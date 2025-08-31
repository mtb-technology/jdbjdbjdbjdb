import { type User, type InsertUser, type Report, type InsertReport, type Source, type InsertSource, type PromptConfigRecord, type InsertPromptConfig } from "@shared/schema";
import { users, reports, sources, promptConfigs } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, or, ilike, count, sql } from "drizzle-orm";

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

    return {
      reports: reportList,
      total: Number(total),
      page,
      totalPages,
    };
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
    } catch (error) {
      // If source already exists, return existing one
      const [existing] = await db.select().from(sources).where(eq(sources.url, insertSource.url));
      if (existing) return existing;
      throw error;
    }
  }

  async getPromptConfig(id: string): Promise<PromptConfigRecord | undefined> {
    const [config] = await db.select().from(promptConfigs).where(eq(promptConfigs.id, id));
    return config || undefined;
  }

  async getActivePromptConfig(): Promise<PromptConfigRecord | undefined> {
    const [config] = await db.select().from(promptConfigs).where(eq(promptConfigs.isActive, true));
    return config || undefined;
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
    // Check if any configs exist
    const existing = await this.getAllPromptConfigs();
    if (existing.length > 0) {
      return;
    }
    
    // Create default config
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
        "4g_ChefEindredactie": { prompt: "", useGrounding: false },
        "final_check": { prompt: "", useGrounding: false },
        aiConfig: {
          model: "gemini-2.5-pro",
          temperature: 0.1,
          topP: 0.95,
          topK: 20,
          maxOutputTokens: 4096,
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
}

export const storage = new DatabaseStorage();