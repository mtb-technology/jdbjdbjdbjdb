import { type User, type InsertUser, type Report, type InsertReport, type Source, type InsertSource, type PromptConfigRecord, type InsertPromptConfig } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getReport(id: string): Promise<Report | undefined>;
  getAllReports(): Promise<Report[]>;
  createReport(report: InsertReport): Promise<Report>;
  updateReport(id: string, report: Partial<Report>): Promise<Report | undefined>;
  
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

  constructor() {
    this.users = new Map();
    this.reports = new Map();
    this.sources = new Map();
    this.promptConfigs = new Map();
    
    // Initialize with verified Dutch government sources
    this.initializeDefaultSources();
    // Initialize with default prompt configuration
    this.initializeDefaultPromptConfig();
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

  async getAllReports(): Promise<Report[]> {
    return Array.from(this.reports.values()).sort(
      (a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
    );
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
      currentStage: insertReport.currentStage || "1_informatiecheck",
    };
    this.reports.set(id, report);
    return report;
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
        "1_informatiecheck": "PLACEHOLDER: Voer hier de informatiecheck prompt in",
        "2_complexiteitscheck": "PLACEHOLDER: Voer hier de complexiteitscheck prompt in",
        "3_generatie": "PLACEHOLDER: Voer hier de generatie prompt in",
        "4a_BronnenSpecialist": "PLACEHOLDER: Voer hier de BronnenSpecialist prompt in",
        "4b_FiscaalTechnischSpecialist": "PLACEHOLDER: Voer hier de FiscaalTechnischSpecialist prompt in",
        "4c_ScenarioGatenAnalist": "PLACEHOLDER: Voer hier de ScenarioGatenAnalist prompt in", 
        "4d_DeVertaler": "PLACEHOLDER: Voer hier de DeVertaler prompt in",
        "4e_DeAdvocaat": "PLACEHOLDER: Voer hier de DeAdvocaat prompt in",
        "4f_DeKlantpsycholoog": "PLACEHOLDER: Voer hier de DeKlantpsycholoog prompt in",
        "4g_ChefEindredactie": "PLACEHOLDER: Voer hier de ChefEindredactie prompt in",
        "final_check": "PLACEHOLDER: Voer hier de final check prompt in"
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
    return updatedConfig;
  }
}

export const storage = new MemStorage();
