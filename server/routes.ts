import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ReportGenerator } from "./services/report-generator";
import { SourceValidator } from "./services/source-validator";
import { dossierSchema, bouwplanSchema } from "@shared/schema";
import { z } from "zod";

const generateReportSchema = z.object({
  dossier: dossierSchema,
  bouwplan: bouwplanSchema,
  clientName: z.string().min(1),
});

export async function registerRoutes(app: Express): Promise<Server> {
  const reportGenerator = new ReportGenerator();
  const sourceValidator = new SourceValidator();

  // Generate report endpoint
  app.post("/api/reports/generate", async (req, res) => {
    try {
      const validatedData = generateReportSchema.parse(req.body);
      
      // Generate the report
      const generatedContent = await reportGenerator.generateReport(
        validatedData.dossier,
        validatedData.bouwplan
      );

      // Create report in storage
      const report = await storage.createReport({
        title: `Fiscaal Duidingsrapport - ${validatedData.clientName}`,
        clientName: validatedData.clientName,
        dossierData: validatedData.dossier,
        bouwplanData: validatedData.bouwplan,
        generatedContent,
        status: "generated",
      });

      res.json(report);
    } catch (error) {
      console.error("Error generating report:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ 
          message: "Validatiefout in invoergegevens", 
          errors: error.errors 
        });
      } else {
        res.status(500).json({ 
          message: "Fout bij het genereren van het rapport" 
        });
      }
    }
  });

  // Get reports endpoint
  app.get("/api/reports", async (req, res) => {
    try {
      const reports = await storage.getAllReports();
      res.json(reports);
    } catch (error) {
      console.error("Error fetching reports:", error);
      res.status(500).json({ message: "Fout bij ophalen rapporten" });
    }
  });

  // Get specific report
  app.get("/api/reports/:id", async (req, res) => {
    try {
      const report = await storage.getReport(req.params.id);
      if (!report) {
        res.status(404).json({ message: "Rapport niet gevonden" });
        return;
      }
      res.json(report);
    } catch (error) {
      console.error("Error fetching report:", error);
      res.status(500).json({ message: "Fout bij ophalen rapport" });
    }
  });

  // Validate sources endpoint
  app.post("/api/sources/validate", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        res.status(400).json({ message: "URL is verplicht" });
        return;
      }

      const isValid = await sourceValidator.validateSource(url);
      res.json({ valid: isValid });
    } catch (error) {
      console.error("Error validating source:", error);
      res.status(500).json({ message: "Fout bij valideren bron" });
    }
  });

  // Get verified sources
  app.get("/api/sources", async (req, res) => {
    try {
      const sources = await storage.getAllSources();
      res.json(sources);
    } catch (error) {
      console.error("Error fetching sources:", error);
      res.status(500).json({ message: "Fout bij ophalen bronnen" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
