import { type User, type InsertUser, type Report, type InsertReport, type Source, type InsertSource } from "@shared/schema";
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
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private reports: Map<string, Report>;
  private sources: Map<string, Source>;

  constructor() {
    this.users = new Map();
    this.reports = new Map();
    this.sources = new Map();
    
    // Initialize with verified Dutch government sources
    this.initializeDefaultSources();
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
}

export const storage = new MemStorage();
