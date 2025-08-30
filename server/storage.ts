import { type User, type InsertUser, type Report, type InsertReport, type Source, type InsertSource, type PromptConfigRecord, type InsertPromptConfig } from "@shared/schema";
import { users, reports, sources, promptConfigs } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, or, ilike, count, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { join } from "path";

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

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private reports: Map<string, Report>;
  private sources: Map<string, Source>;
  private promptConfigs: Map<string, PromptConfigRecord>;
  private readonly STORAGE_DIR = join(process.cwd(), 'storage');
  private readonly PROMPTS_FILE = join(this.STORAGE_DIR, 'prompts.json');

  constructor() {
    this.users = new Map();
    this.reports = new Map();
    this.sources = new Map();
    this.promptConfigs = new Map();
    
    // Initialize storage directory and load persistent data
    this.initializeStorage();
  }

  private async initializeStorage() {
    await this.ensureStorageDirectory();
    await this.loadPromptConfigs();
    
    // Initialize defaults only if no configs exist
    if (this.promptConfigs.size === 0) {
      await this.initializeDefaultPromptConfig();
    }
    
    // Initialize with verified Dutch government sources
    this.initializeDefaultSources();
  }

  private async ensureStorageDirectory() {
    try {
      await fs.mkdir(this.STORAGE_DIR, { recursive: true });
    } catch (error) {
      console.warn('Could not create storage directory:', error);
    }
  }

  private async loadPromptConfigs() {
    try {
      const data = await fs.readFile(this.PROMPTS_FILE, 'utf8');
      const configs: PromptConfigRecord[] = JSON.parse(data);
      
      for (const config of configs) {
        this.promptConfigs.set(config.id, config);
      }
      
      console.log(`Loaded ${configs.length} prompt configurations from storage`);
    } catch (error) {
      console.log('No existing prompt configurations found, will create defaults');
    }
  }

  private async savePromptConfigs() {
    try {
      const configs = Array.from(this.promptConfigs.values());
      await fs.writeFile(this.PROMPTS_FILE, JSON.stringify(configs, null, 2));
      console.log('Prompt configurations saved to storage');
    } catch (error) {
      console.error('Failed to save prompt configurations:', error);
    }
  }

  private async initializeDefaultSources() {
    const defaultSources = [
      {
        title: "Belastingdienst - Officiële informatie",
        url: "https://www.belastingdienst.nl",
        domain: "belastingdienst.nl",
        isVerified: true,
      },
      {
        title: "Wetten.overheid.nl - Nederlandse wetgeving",
        url: "https://wetten.overheid.nl",
        domain: "wetten.overheid.nl", 
        isVerified: true,
      },
      {
        title: "Rijksoverheid.nl - Officiële overheidsinfo",
        url: "https://www.rijksoverheid.nl",
        domain: "rijksoverheid.nl",
        isVerified: true,
      },
    ];

    for (const source of defaultSources) {
      await this.createSource(source);
    }
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getReport(id: string): Promise<Report | undefined> {
    return this.reports.get(id);
  }

  async getAllReports(options?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }): Promise<{ reports: Report[]; total: number; page: number; totalPages: number }> {
    let allReports = Array.from(this.reports.values());
    
    // Filter by status
    if (options?.status) {
      allReports = allReports.filter(r => r.status === options.status);
    }
    
    // Filter by search (client name or title)
    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      allReports = allReports.filter(r => 
        r.title.toLowerCase().includes(searchLower) ||
        r.clientName.toLowerCase().includes(searchLower)
      );
    }
    
    // Sort by creation date (newest first)
    allReports.sort((a, b) => 
      new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
    );
    
    const total = allReports.length;
    const page = options?.page || 1;
    const limit = options?.limit || 10;
    const totalPages = Math.ceil(total / limit);
    
    // Paginate
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const reports = allReports.slice(startIndex, endIndex);
    
    return { reports, total, page, totalPages };
  }

  async createReport(insertReport: InsertReport): Promise<Report> {
    const id = randomUUID();
    const now = new Date();
    const report: Report = { 
      ...insertReport, 
      id, 
      createdAt: now,
      updatedAt: now,
      status: insertReport.status || "draft",
      generatedContent: insertReport.generatedContent || null,
      stageResults: insertReport.stageResults || null,
      conceptReportVersions: insertReport.conceptReportVersions || null,
      currentStage: insertReport.currentStage || "1_informatiecheck",
    };
    this.reports.set(id, report);
    return report;
  }

  async updateReportStatus(id: string, status: string): Promise<void> {
    const existing = this.reports.get(id);
    if (!existing) throw new Error("Report not found");
    
    const updated: Report = { 
      ...existing, 
      status, 
      updatedAt: new Date() 
    };
    this.reports.set(id, updated);
  }

  async deleteReport(id: string): Promise<void> {
    this.reports.delete(id);
  }

  async updateReport(id: string, updateData: Partial<Report>): Promise<Report | undefined> {
    const existingReport = this.reports.get(id);
    if (!existingReport) return undefined;

    const updatedReport: Report = {
      ...existingReport,
      ...updateData,
      updatedAt: new Date(),
    };
    this.reports.set(id, updatedReport);
    return updatedReport;
  }

  async getSource(id: string): Promise<Source | undefined> {
    return this.sources.get(id);
  }

  async getAllSources(): Promise<Source[]> {
    return Array.from(this.sources.values());
  }

  async createSource(insertSource: InsertSource): Promise<Source> {
    const id = randomUUID();
    const source: Source = { 
      ...insertSource, 
      id,
      lastChecked: new Date(),
      isVerified: insertSource.isVerified || false,
    };
    this.sources.set(id, source);
    return source;
  }

  private async initializeDefaultPromptConfig() {
    const defaultConfig = {
      name: "Default Fiscal Analysis",
      isActive: true,
      config: {
        "1_informatiecheck": { prompt: "PLACEHOLDER: Voer hier de informatiecheck prompt in", useGrounding: false },
        "2_complexiteitscheck": { prompt: "PLACEHOLDER: Voer hier de complexiteitscheck prompt in", useGrounding: false },
        "3_generatie": { prompt: "PLACEHOLDER: Voer hier de generatie prompt in", useGrounding: true },
        "4a_BronnenSpecialist": { prompt: "PLACEHOLDER: Voer hier de BronnenSpecialist prompt in", useGrounding: true },
        "4b_FiscaalTechnischSpecialist": { prompt: "PLACEHOLDER: Voer hier de FiscaalTechnischSpecialist prompt in", useGrounding: true },
        "4c_ScenarioGatenAnalist": { prompt: "PLACEHOLDER: Voer hier de ScenarioGatenAnalist prompt in", useGrounding: true }, 
        "4d_DeVertaler": { prompt: "PLACEHOLDER: Voer hier de DeVertaler prompt in", useGrounding: false },
        "4e_DeAdvocaat": { prompt: "PLACEHOLDER: Voer hier de DeAdvocaat prompt in", useGrounding: true },
        "4f_DeKlantpsycholoog": { prompt: "PLACEHOLDER: Voer hier de DeKlantpsycholoog prompt in", useGrounding: false },
        "4g_ChefEindredactie": { prompt: "PLACEHOLDER: Voer hier de ChefEindredactie prompt in", useGrounding: false },
        "final_check": { prompt: "PLACEHOLDER: Voer hier de final check prompt in", useGrounding: false },
        aiConfig: {
          model: "gemini-2.5-pro",
          temperature: 0.1,
          topP: 0.95,
          topK: 20,
          maxOutputTokens: 2048,
        }
      }
    };
    
    await this.createPromptConfig(defaultConfig);
  }

  async getPromptConfig(id: string): Promise<PromptConfigRecord | undefined> {
    return this.promptConfigs.get(id);
  }

  async getActivePromptConfig(): Promise<PromptConfigRecord | undefined> {
    return Array.from(this.promptConfigs.values()).find(
      (config) => config.isActive
    );
  }

  async getAllPromptConfigs(): Promise<PromptConfigRecord[]> {
    return Array.from(this.promptConfigs.values());
  }

  async createPromptConfig(insertConfig: InsertPromptConfig): Promise<PromptConfigRecord> {
    const id = randomUUID();
    const now = new Date();
    const config: PromptConfigRecord = {
      ...insertConfig,
      id,
      createdAt: now,
      updatedAt: now,
      isActive: insertConfig.isActive !== undefined ? insertConfig.isActive : false,
    };
    this.promptConfigs.set(id, config);
    await this.savePromptConfigs(); // Persist to storage
    return config;
  }

  async updatePromptConfig(id: string, updateData: Partial<PromptConfigRecord>): Promise<PromptConfigRecord | undefined> {
    const existingConfig = this.promptConfigs.get(id);
    if (!existingConfig) return undefined;

    const updatedConfig: PromptConfigRecord = {
      ...existingConfig,
      ...updateData,
      updatedAt: new Date(),
    };
    this.promptConfigs.set(id, updatedConfig);
    await this.savePromptConfigs(); // Persist to storage
    return updatedConfig;
  }
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
    const [config] = await db.insert(promptConfigs).values(insertConfig).returning();
    return config;
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
