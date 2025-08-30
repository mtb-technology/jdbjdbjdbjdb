import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ReportGenerator } from "./services/report-generator";
import { SourceValidator } from "./services/source-validator";
import { dossierSchema, bouwplanSchema, insertPromptConfigSchema } from "@shared/schema";
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

  // Prompt configuration endpoints
  app.get("/api/prompts", async (req, res) => {
    try {
      const prompts = await storage.getAllPromptConfigs();
      res.json(prompts);
    } catch (error) {
      console.error("Error fetching prompt configs:", error);
      res.status(500).json({ message: "Fout bij ophalen prompt configuraties" });
    }
  });

  app.get("/api/prompts/active", async (req, res) => {
    try {
      const activeConfig = await storage.getActivePromptConfig();
      res.json(activeConfig);
    } catch (error) {
      console.error("Error fetching active prompt config:", error);
      res.status(500).json({ message: "Fout bij ophalen actieve prompt configuratie" });
    }
  });

  app.post("/api/prompts", async (req, res) => {
    try {
      const validatedData = insertPromptConfigSchema.parse(req.body);
      
      // Deactivate all other configs if this one is set as active
      if (validatedData.isActive) {
        const allConfigs = await storage.getAllPromptConfigs();
        for (const config of allConfigs) {
          if (config.isActive) {
            await storage.updatePromptConfig(config.id, { isActive: false });
          }
        }
      }
      
      const promptConfig = await storage.createPromptConfig(validatedData);
      res.json(promptConfig);
    } catch (error) {
      console.error("Error creating prompt config:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ 
          message: "Validatiefout in prompt configuratie", 
          errors: error.errors 
        });
      } else {
        res.status(500).json({ 
          message: "Fout bij aanmaken prompt configuratie" 
        });
      }
    }
  });

  app.put("/api/prompts/:id", async (req, res) => {
    try {
      const updates = req.body;
      
      // Deactivate all other configs if this one is set as active
      if (updates.isActive) {
        const allConfigs = await storage.getAllPromptConfigs();
        for (const config of allConfigs) {
          if (config.isActive && config.id !== req.params.id) {
            await storage.updatePromptConfig(config.id, { isActive: false });
          }
        }
      }
      
      const updatedConfig = await storage.updatePromptConfig(req.params.id, updates);
      if (!updatedConfig) {
        res.status(404).json({ message: "Prompt configuratie niet gevonden" });
        return;
      }
      res.json(updatedConfig);
    } catch (error) {
      console.error("Error updating prompt config:", error);
      res.status(500).json({ message: "Fout bij bijwerken prompt configuratie" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
