import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { promises as fs } from "fs";
import * as path from "path";
import { storage } from "./storage";
import { ReportGenerator } from "./services/report-generator";
import { SourceValidator } from "./services/source-validator";
import { dossierSchema, bouwplanSchema, insertPromptConfigSchema } from "@shared/schema";
import type { DossierData, BouwplanData } from "@shared/schema";
import { z } from "zod";
import modelTestRoutes from "./routes/model-test";
import { ServerError, asyncHandler } from "./middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";

const generateReportSchema = z.object({
  dossier: dossierSchema,
  bouwplan: bouwplanSchema,
  clientName: z.string().min(1),
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize database with default prompts if needed
  try {
    await (storage as any).initializeDefaultPrompts?.();
  } catch (error) {
    console.warn("Could not initialize default prompts:", error);
  }
  const reportGenerator = new ReportGenerator();
  const sourceValidator = new SourceValidator();

  // Test route voor AI - simpele test om te verifieren dat API werkt
  app.get("/api/test-ai", asyncHandler(async (req: Request, res: Response) => {
    const result = await reportGenerator.testAI("Say hello in Dutch in 5 words");
    res.json(createApiSuccessResponse({ response: result }, "AI test succesvol uitgevoerd"));
  }));

  // Extract dossier data from raw text using AI
  app.post("/api/extract-dossier", asyncHandler(async (req: Request, res: Response) => {
    const { rawText } = req.body;
    
    if (!rawText || typeof rawText !== 'string') {
      throw ServerError.validation(
        'Missing or invalid rawText parameter',
        'Tekst is verplicht voor het extraheren van dossiergegevens'
      );
    }

    const parsedData = await reportGenerator.extractDossierData(rawText);
    
    // Validate extracted data against schemas - Zod errors are caught by error handler
    const validatedDossier = dossierSchema.parse(parsedData.dossier);
    const validatedBouwplan = bouwplanSchema.parse(parsedData.bouwplan);

    res.json(createApiSuccessResponse({
      dossier: validatedDossier,
      bouwplan: validatedBouwplan,
    }, "Dossiergegevens succesvol geëxtraheerd"));
  }));

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
        dossierData: { rawText, klant: { naam: clientName } }, // Ruwe tekst + klantnaam voor fallback prompts
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
        customInput,
        id // Pass reportId as jobId for logging
      );

      // Update report with stage output, concept report version, and prompt
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

      // Store the prompt used for this stage for input tracking
      const updatedStagePrompts = {
        ...(report.stagePrompts as Record<string, string> || {}),
        [stage]: stageExecution.prompt
      };

      // Special handling for stage 3 (generatie) and specialist stages
      let updateData: any = {
        stageResults: updatedStageResults,
        conceptReportVersions: updatedConceptVersions,
        stagePrompts: updatedStagePrompts,
        currentStage: stage,
      };

      // After stage 3 (generatie), make the first report version visible
      if (stage === '3_generatie' && stageExecution.conceptReport) {
        updateData.generatedContent = stageExecution.conceptReport;
        updateData.status = 'generated'; // Mark as having first version
      }
      
      // For specialist stages (4a-4g), continuously update the living report
      if (stage.startsWith('4') && stageExecution.conceptReport) {
        updateData.generatedContent = stageExecution.conceptReport;
      }

      const updatedReport = await storage.updateReport(id, updateData);

      res.json({
        report: updatedReport,
        stageResult: stageExecution.stageOutput,
        conceptReport: stageExecution.conceptReport,
        prompt: stageExecution.prompt,
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
      // Add caching headers for better performance
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
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
      // Cache sources for longer as they rarely change
      res.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=1200');
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
      // No caching to prevent stale IDs
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
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
      const activeConfig = configs.find(c => c.isActive);
      
      // Maak ook een automatische backup op de server
      const backupData = {
        backup_date: new Date().toISOString(),
        version: "2.0",
        prompt_configs: configs
      };
      
      // Sla backup op in JSON file
      const backupDir = path.join(process.cwd(), 'backups');
      await fs.mkdir(backupDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `prompts-backup-${timestamp}.json`);
      await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));
      
      // Behoud alleen laatste 10 backups
      const files = await fs.readdir(backupDir);
      const backupFiles = files.filter(f => f.startsWith('prompts-backup-')).sort();
      if (backupFiles.length > 10) {
        for (const oldFile of backupFiles.slice(0, backupFiles.length - 10)) {
          await fs.unlink(path.join(backupDir, oldFile));
        }
      }
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="prompt-backup.json"');
      res.json(backupData);
    } catch (error) {
      console.error("Error creating backup:", error);
      res.status(500).json({ message: "Backup failed" });
    }
  });

  app.post("/api/prompts/restore", async (req, res) => {
    try {
      // Accepteer beide formaten: met of zonder wrapper
      const data = req.body;
      let prompt_configs;
      
      if (data.prompt_configs && Array.isArray(data.prompt_configs)) {
        // Nieuw format met metadata
        prompt_configs = data.prompt_configs;
      } else if (Array.isArray(data)) {
        // Oud format - direct array
        prompt_configs = data;
      } else {
        res.status(400).json({ message: "Invalid backup format" });
        return;
      }

      // Maak eerst een backup van huidige staat
      const currentConfigs = await storage.getAllPromptConfigs();
      const backupDir = path.join(process.cwd(), 'backups');
      await fs.mkdir(backupDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const autoBackupPath = path.join(backupDir, `auto-backup-before-restore-${timestamp}.json`);
      await fs.writeFile(autoBackupPath, JSON.stringify({
        backup_date: new Date().toISOString(),
        type: 'auto-before-restore',
        prompt_configs: currentConfigs
      }, null, 2));

      // Restore from backup
      let restored = 0;
      let created = 0;
      
      for (const config of prompt_configs) {
        if (config.id) {
          // Probeer eerst te updaten
          const existing = await storage.getPromptConfig(config.id);
          if (existing) {
            await storage.updatePromptConfig(config.id, config);
            restored++;
          } else {
            // Als het niet bestaat, maak het aan
            await storage.createPromptConfig(config);
            created++;
          }
        }
      }
      
      res.json({ 
        message: `Restore voltooid: ${restored} bijgewerkt, ${created} aangemaakt`,
        restored,
        created
      });
    } catch (error: any) {
      console.error("Error restoring backup:", error);
      res.status(500).json({ message: "Restore failed: " + error.message });
    }
  });

  // Get laatste backup info
  app.get("/api/prompts/backup-status", async (req, res) => {
    try {
      const backupDir = path.join(process.cwd(), 'backups');
      
      try {
        const files = await fs.readdir(backupDir);
        const backupFiles = files.filter((f: string) => f.startsWith('prompts-backup-')).sort();
        
        if (backupFiles.length > 0) {
          const lastBackup = backupFiles[backupFiles.length - 1];
          const stats = await fs.stat(path.join(backupDir, lastBackup));
          res.json({
            hasBackup: true,
            lastBackupDate: stats.mtime,
            backupCount: backupFiles.length,
            fileName: lastBackup
          });
        } else {
          res.json({ hasBackup: false });
        }
      } catch {
        res.json({ hasBackup: false });
      }
    } catch (error) {
      console.error("Error checking backup status:", error);
      res.status(500).json({ message: "Could not check backup status" });
    }
  });

  // === CASE MANAGEMENT ENDPOINTS ===

  // Get all cases/reports with pagination and filtering
  app.get("/api/cases", async (req, res) => {
    try {
      const { page = 1, limit = 10, status, search } = req.query;
      
      const cases = await storage.getAllReports({
        page: Number(page),
        limit: Number(limit),
        status: status as string,
        search: search as string
      });
      
      // Add caching headers for case list
      res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
      res.json(cases);
    } catch (error: any) {
      console.error("Error fetching cases:", error);
      res.status(500).json({ message: "Fout bij ophalen cases" });
    }
  });

  // Get specific case by ID
  app.get("/api/cases/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const report = await storage.getReport(id);
      
      if (!report) {
        res.status(404).json({ message: "Case niet gevonden" });
        return;
      }
      
      res.json(report);
    } catch (error: any) {
      console.error("Error fetching case:", error);
      res.status(500).json({ message: "Fout bij ophalen case" });
    }
  });

  // Update case status
  app.patch("/api/cases/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      if (!["draft", "processing", "generated", "exported", "archived"].includes(status)) {
        res.status(400).json({ message: "Ongeldige status" });
        return;
      }
      
      await storage.updateReportStatus(id, status);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating case status:", error);
      res.status(500).json({ message: "Fout bij updaten status" });
    }
  });

  // Delete case
  app.delete("/api/cases/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteReport(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting case:", error);
      res.status(500).json({ message: "Fout bij verwijderen case" });
    }
  });

  // Export case as different formats
  app.get("/api/cases/:id/export/:format", async (req, res) => {
    try {
      const { id, format } = req.params;
      const report = await storage.getReport(id);
      
      if (!report) {
        res.status(404).json({ message: "Case niet gevonden" });
        return;
      }
      
      if (format === "html") {
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename="case-${id}.html"`);
        res.send(report.generatedContent || "Geen content beschikbaar");
      } else if (format === "json") {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="case-${id}.json"`);
        res.json(report);
      } else {
        res.status(400).json({ message: "Ongeldige export format" });
      }
    } catch (error: any) {
      console.error("Error exporting case:", error);
      res.status(500).json({ message: "Fout bij exporteren case" });
    }
  });


  // Register model test routes
  app.use(modelTestRoutes);

  const httpServer = createServer(app);
  return httpServer;
}
