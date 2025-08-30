import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ReportGenerator } from "./services/report-generator";
import { SourceValidator } from "./services/source-validator";
import { dossierSchema, bouwplanSchema, insertPromptConfigSchema } from "@shared/schema";
import type { DossierData, BouwplanData } from "@shared/schema";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const generateReportSchema = z.object({
  dossier: dossierSchema,
  bouwplan: bouwplanSchema,
  clientName: z.string().min(1),
});

export async function registerRoutes(app: Express): Promise<Server> {
  const reportGenerator = new ReportGenerator();
  const sourceValidator = new SourceValidator();
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

  // Test route voor AI - simpele test om te verifieren dat API werkt
  app.get("/api/test-ai", async (req, res) => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: "Say hello in Dutch in 5 words"
      });
      res.json({ success: true, response: response.text });
    } catch (error: any) {
      console.error("Test AI error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Extract dossier data from raw text using AI
  app.post("/api/extract-dossier", async (req, res) => {
    try {
      const { rawText } = req.body;
      
      if (!rawText || typeof rawText !== 'string') {
        res.status(400).json({ message: "Tekst is verplicht" });
        return;
      }

      const extractionPrompt = `Extraheer uit de volgende tekst de belangrijkste klant- en fiscale gegevens en structureer deze in JSON formaat.

Gegeven tekst:
${rawText}

Extraheer de volgende informatie:

1. KLANT GEGEVENS:
- naam: Volledige naam van de klant (voor- en achternaam)
- situatie: Korte samenvatting van de fiscale situatie/vraag

2. FISCALE GEGEVENS:
- vermogen: Geschat vermogen in euro's (gebruik 0 als niet bekend)
- inkomsten: Geschat jaarinkomen in euro's (gebruik 0 als niet bekend)

3. RAPPORT STRUCTUUR:
- Bepaal welke knelpunten/problemen er zijn (minimaal 1)

Geef het resultaat terug als JSON in dit exacte formaat:
{
  "dossier": {
    "klant": {
      "naam": "...",
      "situatie": "..."
    },
    "fiscale_gegevens": {
      "vermogen": 0,
      "inkomsten": 0
    }
  },
  "bouwplan": {
    "taal": "nl",
    "structuur": {
      "inleiding": true,
      "knelpunten": ["knelpunt 1", "knelpunt 2"],
      "scenario_analyse": true,
      "vervolgstappen": true
    }
  }
}

ALLEEN JSON TERUGGEVEN, GEEN ANDERE TEKST.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: extractionPrompt,
        temperature: 0.1,
        topP: 0.95,
        topK: 20,
        maxOutputTokens: 2048,
        responseMimeType: "application/json"
      });

      const extractedJson = response.text?.trim();
      if (!extractedJson) {
        res.status(500).json({ message: "Geen data geëxtraheerd" });
        return;
      }

      const parsedData = JSON.parse(extractedJson);
      
      // Validate extracted data against schemas
      const validatedDossier = dossierSchema.parse(parsedData.dossier);
      const validatedBouwplan = bouwplanSchema.parse(parsedData.bouwplan);

      res.json({
        dossier: validatedDossier,
        bouwplan: validatedBouwplan,
      });

    } catch (error) {
      console.error("Error extracting dossier data:", error);
      res.status(500).json({ 
        message: "Fout bij extraheren van dossiergegevens uit tekst" 
      });
    }
  });

  // Create new report (start workflow)
  app.post("/api/reports/create", async (req, res) => {
    try {
      const { clientName, rawText } = req.body;
      
      if (!rawText || !clientName) {
        res.status(400).json({ message: "Ruwe tekst en klantnaam zijn verplicht" });
        return;
      }
      
      // Create report in draft state - sla alleen ruwe tekst op
      const report = await storage.createReport({
        title: `Fiscaal Duidingsrapport - ${clientName}`,
        clientName: clientName,
        dossierData: { rawText }, // Alleen ruwe tekst, geen schemas
        bouwplanData: {},
        generatedContent: null,
        stageResults: {},
        conceptReportVersions: {},
        currentStage: "1_informatiecheck",
        status: "processing",
      });

      res.json(report);
    } catch (error) {
      console.error("Error creating report:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ 
          message: "Validatiefout in invoergegevens", 
          errors: error.errors 
        });
      } else {
        res.status(500).json({ 
          message: "Fout bij het aanmaken van het rapport" 
        });
      }
    }
  });

  // Execute specific stage of report generation
  app.post("/api/reports/:id/stage/:stage", async (req, res) => {
    try {
      const { id, stage } = req.params;
      const { customInput } = req.body;

      const report = await storage.getReport(id);
      if (!report) {
        res.status(404).json({ message: "Rapport niet gevonden" });
        return;
      }

      // Execute the specific stage
      const stageExecution = await reportGenerator.executeStage(
        stage,
        report.dossierData as DossierData,
        report.bouwplanData as BouwplanData,
        report.stageResults as Record<string, string> || {},
        report.conceptReportVersions as Record<string, string> || {},
        customInput
      );

      // Update report with both stage output and concept report version
      const updatedStageResults = {
        ...(report.stageResults as Record<string, string> || {}),
        [stage]: stageExecution.stageOutput
      };

      const updatedConceptVersions = stageExecution.conceptReport 
        ? {
            ...(report.conceptReportVersions as Record<string, string> || {}),
            [stage]: stageExecution.conceptReport
          }
        : report.conceptReportVersions;

      const updatedReport = await storage.updateReport(id, {
        stageResults: updatedStageResults,
        conceptReportVersions: updatedConceptVersions,
        currentStage: stage,
      });

      res.json({
        report: updatedReport,
        stageResult: stageExecution.stageOutput,
        conceptReport: stageExecution.conceptReport,
      });

    } catch (error) {
      console.error(`Error executing stage ${req.params.stage}:`, error);
      res.status(500).json({ 
        message: `Fout bij uitvoeren van stap ${req.params.stage}` 
      });
    }
  });

  // Generate final report from all stages
  app.post("/api/reports/:id/finalize", async (req, res) => {
    try {
      const { id } = req.params;
      
      const report = await storage.getReport(id);
      if (!report) {
        res.status(404).json({ message: "Rapport niet gevonden" });
        return;
      }

      // Use the latest concept report version as the final content
      const conceptVersions = report.conceptReportVersions as Record<string, string> || {};
      const latestConceptKeys = Object.keys(conceptVersions);
      
      const finalContent = latestConceptKeys.length > 0 
        ? conceptVersions[latestConceptKeys[latestConceptKeys.length - 1]]
        : await reportGenerator.finalizeReport(report.stageResults as Record<string, string> || {});

      const finalizedReport = await storage.updateReport(id, {
        generatedContent: finalContent,
        status: "generated",
      });

      res.json(finalizedReport);

    } catch (error) {
      console.error("Error finalizing report:", error);
      res.status(500).json({ 
        message: "Fout bij finaliseren van het rapport" 
      });
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

  // Backup en restore endpoints voor prompt veiligheid
  app.get("/api/prompts/backup", async (req, res) => {
    try {
      const configs = await storage.getAllPromptConfigs();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="prompt-backup.json"');
      res.json({
        backup_date: new Date().toISOString(),
        prompt_configs: configs
      });
    } catch (error) {
      console.error("Error creating backup:", error);
      res.status(500).json({ message: "Backup failed" });
    }
  });

  app.post("/api/prompts/restore", async (req, res) => {
    try {
      const { prompt_configs } = req.body;
      
      if (!Array.isArray(prompt_configs)) {
        res.status(400).json({ message: "Invalid backup format" });
        return;
      }

      // Restore from backup by updating existing configs
      let restored = 0;
      for (const config of prompt_configs) {
        if (config.id) {
          await storage.updatePromptConfig(config.id, config);
          restored++;
        }
      }
      
      res.json({ message: `${restored} prompt configuraties hersteld` });
    } catch (error) {
      console.error("Error restoring backup:", error);
      res.status(500).json({ message: "Restore failed" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
