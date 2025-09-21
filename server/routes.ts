import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { promises as fs } from "fs";
import * as path from "path";
import { storage } from "./storage";
import { ReportGenerator } from "./services/report-generator";
import { SourceValidator } from "./services/source-validator";
import { PDFGenerator } from "./services/pdf-generator";
import { AIHealthService } from "./services/ai-models/health-service";
import { AIMonitoringService } from "./services/ai-models/monitoring";
import { checkDatabaseConnection } from "./db";
import { dossierSchema, bouwplanSchema, insertPromptConfigSchema } from "@shared/schema";
import type { DossierData, BouwplanData, StageId } from "@shared/schema";
import { processFeedbackRequestSchema } from "@shared/types/api";
import { ReportProcessor } from "./services/report-processor";
import { SSEHandler } from "./services/streaming/sse-handler";
import { StreamingSessionManager } from "./services/streaming/streaming-session-manager";
import { DecomposedStages } from "./services/streaming/decomposed-stages";
import { registerStreamingRoutes } from "./routes/streaming-routes";
import { z } from "zod";
import { ServerError, asyncHandler } from "./middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";

// Track active stage requests to prevent duplicates - using Map for better race condition handling
const activeStageRequests = new Map<string, Promise<any>>();

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
  const pdfGenerator = new PDFGenerator();
  const healthService = new AIHealthService(AIMonitoringService.getInstance());
  const sseHandler = new SSEHandler();
  const sessionManager = StreamingSessionManager.getInstance();
  const decomposedStages = new DecomposedStages();
  
  // Create AI handler for ReportProcessor using same approach as ReportGenerator
  const aiHandler = {
    generateContent: async (params: { prompt: string; temperature: number; topP: number; maxOutputTokens: number }) => {
      return await reportGenerator.testAI(params.prompt);
    }
  };
  const reportProcessor = new ReportProcessor(aiHandler);
  
  // Start periodic health checks and run immediate warm-up
  healthService.startPeriodicHealthChecks();
  
  // Warm up health cache immediately
  healthService.getSystemHealth().catch(error => {
    console.warn('Initial health check failed:', error);
  });

  // Test route voor AI - simpele test om te verifieren dat API werkt
  app.get("/api/test-ai", asyncHandler(async (req: Request, res: Response) => {
    const result = await reportGenerator.testAI("Say hello in Dutch in 5 words");
    res.json(createApiSuccessResponse({ response: result }, "AI test succesvol uitgevoerd"));
  }));

  // Health check endpoints - use cached results for efficiency
  app.get("/api/health", asyncHandler(async (req: Request, res: Response) => {
    const health = healthService.getCachedHealth();
    const statusCode = health.overall === 'healthy' ? 200 : 503;
    
    // Redact sensitive details for public health check
    const publicHealth = {
      status: health.overall,
      timestamp: health.timestamp,
      services: health.services.map(s => ({
        service: s.service,
        status: s.status,
        lastChecked: s.lastChecked
      }))
    };
    
    res.status(statusCode).json(createApiSuccessResponse(publicHealth, `System is ${health.overall}`));
  }));

  app.get("/api/health/detailed", asyncHandler(async (req: Request, res: Response) => {
    // Strict admin authentication - require exact API key match
    const adminKey = req.headers['x-admin-key'] as string;
    const authHeader = req.headers['authorization'] as string;
    
    const isValidKey = adminKey === process.env.ADMIN_API_KEY;
    const isValidBearer = authHeader?.startsWith('Bearer ') && 
                         authHeader.substring(7) === process.env.ADMIN_API_KEY;
    
    if (!isValidKey && !isValidBearer) {
      res.status(401).json(createApiErrorResponse(
        'AUTHENTICATION_ERROR', 
        ERROR_CODES.AI_AUTHENTICATION_FAILED,
        'Valid admin authentication required for detailed health status',
        'Access denied - invalid credentials'
      ));
      return;
    }
    
    // Detailed health check with full metrics
    const health = await healthService.getSystemHealth();
    const statusCode = health.overall === 'healthy' ? 200 : 503;
    res.status(statusCode).json(createApiSuccessResponse(health, "Detailed health status retrieved"));
  }));

  app.get("/api/health/database", asyncHandler(async (req: Request, res: Response) => {
    const isHealthy = await checkDatabaseConnection();
    const statusCode = isHealthy ? 200 : 503;
    res.status(statusCode).json(createApiSuccessResponse({ 
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString()
    }, `Database is ${isHealthy ? 'healthy' : 'unhealthy'}`));
  }));

  app.get("/api/health/ai", asyncHandler(async (req: Request, res: Response) => {
    // Use cached health data to avoid cost and rate limits
    const health = healthService.getCachedHealth();
    const statusCode = health.overall === 'healthy' ? 200 : 503;
    
    // Return only AI service status without sensitive details
    const aiHealth = {
      overall: health.overall,
      services: health.services.map(s => ({
        service: s.service,
        status: s.status,
        lastChecked: s.lastChecked
      })),
      timestamp: health.timestamp
    };

    res.status(statusCode).json(createApiSuccessResponse(aiHealth, "AI services health status retrieved"));
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

      res.json(createApiSuccessResponse(report, "Rapport succesvol aangemaakt"));
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

  // Get prompt preview for a stage without executing it
  app.get("/api/reports/:id/stage/:stage/preview", async (req, res) => {
    try {
      const { id, stage } = req.params;
      const report = await storage.getReport(id);
      
      if (!report) {
        return res.status(404).json({ message: "Rapport niet gevonden" });
      }

      // Generate the prompt without executing the stage
      const prompt = await reportGenerator.generatePromptForStage(
        stage,
        report.dossierData as DossierData,
        report.bouwplanData as BouwplanData,
        report.stageResults as Record<string, string> || {},
        report.conceptReportVersions as Record<string, string> || {},
        undefined // No custom input for preview
      );

      res.json(createApiSuccessResponse({ prompt }, "Prompt preview succesvol opgehaald"));
    } catch (error: any) {
      console.error("Error generating prompt preview:", error);
      res.status(500).json({ 
        message: "Fout bij het genereren van prompt preview",
        error: error.message 
      });
    }
  });

  // Execute specific stage of report generation
  app.post("/api/reports/:id/stage/:stage", async (req, res) => {
    const requestKey = `${req.params.id}-${req.params.stage}`;
    
    // More robust deduplication to prevent race conditions
    if (activeStageRequests.has(requestKey)) {
      // Wait for the existing request to complete, then return its result
      try {
        await activeStageRequests.get(requestKey);
        // Fetch the updated report to return current state
        const report = await storage.getReport(req.params.id);
        if (report) {
          res.json(createApiSuccessResponse(report, "Stage reeds uitgevoerd"));
        } else {
          res.status(404).json({ message: "Rapport niet gevonden" });
        }
        return;
      } catch (error) {
        res.status(500).json({ message: "Fout bij het wachten op actieve stage uitvoering" });
        return;
      }
    }
    
    // Create a promise for this stage execution  
    const stageExecutionPromise = (async () => {
      const { id, stage } = req.params;
      const { customInput } = req.body;

      const report = await storage.getReport(id);
      if (!report) {
        throw new Error("Rapport niet gevonden");
      }

      // Execute the specific stage with error recovery
      let stageExecution;
      try {
        stageExecution = await reportGenerator.executeStage(
          stage,
          report.dossierData as DossierData,
          report.bouwplanData as BouwplanData,
          report.stageResults as Record<string, string> || {},
          report.conceptReportVersions as Record<string, string> || {},
          customInput,
          id // Pass reportId as jobId for logging
        );
      } catch (stageError: any) {
        console.error(`🚨 Stage execution failed but recovering gracefully:`, stageError.message);
        // Return a recoverable error response instead of crashing
        res.status(200).json(createApiSuccessResponse({
          ...report,
          error: `Stage ${stage} kon niet volledig worden uitgevoerd: ${stageError.message}`,
          partialResult: true
        }));
        return;
      }

      // Update report with stage output, concept report version, and prompt
      // Ensure we always overwrite with the latest result
      const currentStageResults = report.stageResults as Record<string, string> || {};
      const updatedStageResults = {
        ...currentStageResults,
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
      
      // *** REVIEW STAGES (4a-4g): NO AUTOMATIC CONCEPT PROCESSING ***  
      // These stages now require user feedback selection - only store raw feedback
      if (stage.startsWith('4')) {
        console.log(`📋 [${id}-${stage}] Review stage completed - storing raw feedback for user review (NO auto-processing)`);
        // Do NOT update generatedContent - let user control this through manual feedback processing
        // The stageResults will contain the raw feedback for user selection
      }

      const updatedReport = await storage.updateReport(id, updateData);
      
      return {
        report: updatedReport,
        stageResult: stageExecution.stageOutput,
        conceptReport: stageExecution.conceptReport,
        prompt: stageExecution.prompt,
      };
    })();
    
    // Store the promise to prevent concurrent executions
    activeStageRequests.set(requestKey, stageExecutionPromise.then(() => {}));
    
    try {
      const result = await stageExecutionPromise;
      res.json(createApiSuccessResponse(result, "Stage succesvol uitgevoerd"));
    } catch (error) {
      console.error(`Error executing stage ${req.params.stage}:`, error);
      if (error instanceof Error && error.message === "Rapport niet gevonden") {
        res.status(404).json({ message: error.message });
      } else {
        res.status(500).json({ 
          message: `Fout bij uitvoeren van stap ${req.params.stage}` 
        });
      }
    } finally {
      // Always clean up the tracking
      activeStageRequests.delete(requestKey);
    }
  });

  // Process manual stage content
  app.post("/api/reports/:id/manual-stage", async (req, res) => {
    try {
      const { id } = req.params;
      
      // Validate request body with zod
      const manualStageSchema = z.object({
        stage: z.literal("3_generatie", { 
          errorMap: () => ({ message: "Alleen generatie stap (3_generatie) ondersteunt handmatige input" })
        }),
        content: z.string().min(1, "Content mag niet leeg zijn"),
        isManual: z.boolean()
      });

      const validatedData = manualStageSchema.parse(req.body);
      const { stage, content } = validatedData;

      const report = await storage.getReport(id);
      if (!report) {
        return res.status(404).json({ message: "Rapport niet gevonden" });
      }

      // Update the report with manual content
      const currentStageResults = (report.stageResults as Record<string, string>) || {};
      const currentConceptVersions = (report.conceptReportVersions as Record<string, string>) || {};

      currentStageResults[stage] = content;
      
      // For generation stage, set concept report with versioned key
      const versionKey = `${stage}_${new Date().toISOString()}`;
      currentConceptVersions[versionKey] = content;
      // Also maintain the stage key for backward compatibility
      currentConceptVersions[stage] = content;

      const updatedReport = await storage.updateReport(id, {
        stageResults: currentStageResults,
        conceptReportVersions: currentConceptVersions,
        // Don't update currentStage here, let the frontend handle progression
      });

      res.json(createApiSuccessResponse({
        report: updatedReport,
        stageResult: content,
        conceptReport: content,
        isManual: true
      }, "Handmatige content succesvol verwerkt"));

    } catch (error) {
      console.error("Error processing manual stage:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ 
          message: "Validatiefout in invoergegevens", 
          errors: error.errors 
        });
      } else {
        res.status(500).json({ 
          message: "Fout bij verwerken van handmatige content" 
        });
      }
    }
  });

  // Manual feedback processing endpoint - user-controlled feedback selection and processing
  app.post("/api/reports/:id/stage/:stageId/process-feedback", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId, stageId } = req.params;
    
    console.log(`🔧 [${reportId}-${stageId}] Manual feedback processing requested`);

    // Validate request body
    const validatedData = processFeedbackRequestSchema.parse(req.body);
    const { selectedItems, additionalFeedback, processingStrategy } = validatedData;

    // Check if report exists
    const report = await storage.getReport(reportId);
    if (!report) {
      return res.status(404).json(createApiErrorResponse(
        'REPORT_NOT_FOUND',
        'VALIDATION_FAILED',
        'Rapport niet gevonden',
        'Het rapport kon niet worden gevonden voor feedback processing'
      ));
    }

    // Validate stage ID for review stages only
    const validReviewStages = [
      '4a_BronnenSpecialist', '4b_FiscaalTechnischSpecialist', 
      '4c_ScenarioGatenAnalist', '4d_DeVertaler', '4e_DeAdvocaat', 
      '4f_DeKlantpsycholoog', '4g_ChefEindredactie'
    ];

    if (!validReviewStages.includes(stageId)) {
      return res.status(400).json(createApiErrorResponse(
        'INVALID_STAGE',
        'VALIDATION_FAILED',
        'Ongeldige stap voor feedback processing',
        `Stage ${stageId} ondersteunt geen feedback processing`
      ));
    }

    try {
      // Filter only selected feedback items
      const selectedFeedback = selectedItems.filter(item => item.selected);
      
      if (selectedFeedback.length === 0 && !additionalFeedback) {
        return res.status(400).json(createApiErrorResponse(
          'NO_FEEDBACK_SELECTED',
          'VALIDATION_FAILED',
          'Geen feedback geselecteerd',
          'Selecteer minimaal één feedback item of voeg aanvullende feedback toe'
        ));
      }

      // Combine selected feedback and additional feedback into one string
      const feedbackParts: string[] = [];
      
      // Add selected feedback items
      selectedFeedback.forEach((item, index) => {
        feedbackParts.push(`${index + 1}. ${item.content}`);
      });
      
      // Add additional user feedback if provided
      if (additionalFeedback?.trim()) {
        feedbackParts.push(`\nAanvullende feedback:\n${additionalFeedback.trim()}`);
      }

      const combinedFeedback = feedbackParts.join('\n\n');
      
      console.log(`📝 [${reportId}-${stageId}] Processing ${selectedFeedback.length} selected items + ${additionalFeedback ? 'additional feedback' : 'no additional feedback'}`);

      // Process feedback with ReportProcessor
      const processingResult = await reportProcessor.processStage(
        reportId,
        stageId as StageId,
        combinedFeedback,
        processingStrategy
      );

      console.log(`✅ [${reportId}-${stageId}] Manual feedback processing completed - v${processingResult.snapshot.v}`);

      // Emit SSE event for real-time feedback (if client is listening)
      sseHandler.broadcast(reportId, stageId, {
        type: 'step_complete',
        stageId: stageId,
        substepId: 'manual_feedback_processing',
        percentage: 100,
        message: `Geselecteerde feedback verwerkt - concept rapport bijgewerkt naar versie ${processingResult.snapshot.v}`,
        data: {
          version: processingResult.snapshot.v,
          conceptContent: processingResult.newConcept,
          processedItems: selectedFeedback.length,
          hasAdditionalFeedback: !!additionalFeedback
        },
        timestamp: new Date().toISOString()
      });

      return res.json(createApiSuccessResponse({
        success: true,
        newVersion: processingResult.snapshot.v,
        conceptContent: processingResult.newConcept,
        processedItems: selectedFeedback.length,
        message: `Feedback succesvol verwerkt - concept rapport bijgewerkt naar versie ${processingResult.snapshot.v}`
      }, 'Feedback processing succesvol voltooid'));

    } catch (error: any) {
      console.error(`❌ [${reportId}-${stageId}] Manual feedback processing failed:`, error);
      
      // Emit SSE error event
      sseHandler.broadcast(reportId, stageId, {
        type: 'step_error',
        stageId: stageId,
        substepId: 'manual_feedback_processing',
        percentage: 0,
        message: 'Manual feedback processing gefaald',
        data: { error: error.message },
        timestamp: new Date().toISOString()
      });

      return res.status(500).json(createApiErrorResponse(
        'PROCESSING_FAILED',
        'INTERNAL_SERVER_ERROR',
        'Feedback processing gefaald',
        error.message || 'Onbekende fout tijdens feedback processing'
      ));
    }
  }));

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

      res.json(createApiSuccessResponse(finalizedReport, "Rapport succesvol gefinaliseerd"));

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
      res.json(createApiSuccessResponse(reports));
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
      res.json(createApiSuccessResponse(report));
    } catch (error) {
      console.error("Error fetching report:", error);
      res.status(500).json({ message: "Fout bij ophalen rapport" });
    }
  });

  // Get prompt template for a stage (for new cases without existing report)
  app.get("/api/prompt-templates/:stageKey", async (req, res) => {
    try {
      const { stageKey } = req.params;
      const { rawText, clientName } = req.query;
      
      // Get active prompt configuration
      const promptConfig = await storage.getActivePromptConfig();
      if (!promptConfig?.config?.[stageKey as keyof typeof promptConfig.config]) {
        res.status(404).json({ message: "Prompt template niet gevonden voor deze stap" });
        return;
      }
      
      const stageConfig = promptConfig.config[stageKey as keyof typeof promptConfig.config] as any;
      const prompt = stageConfig?.prompt || "";
      
      // Create the current date
      const currentDate = new Date().toLocaleDateString('nl-NL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long', 
        day: 'numeric'
      });
      
      // Use real data if provided, otherwise placeholder text
      const dossierContent = rawText 
        ? `Ruwe klantinformatie:\n${rawText}\n\nKlantnaam: ${clientName || 'Client'}`
        : '[Uw klantgegevens en fiscale situatie zullen hier worden ingevuld]';
      
      const bouwplanContent = '[De rapport structuur en gewenste onderwerpen zullen hier worden ingevuld]';
      
      // Create a template prompt with real or placeholder data
      const templatePrompt = `${prompt}

### Datum: ${currentDate}

### Dossier:
${dossierContent}

### Bouwplan:
${bouwplanContent}`;

      res.json(createApiSuccessResponse({ prompt: templatePrompt }));
    } catch (error) {
      console.error("Error fetching prompt template:", error);
      res.status(500).json({ message: "Fout bij ophalen prompt template" });
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
      res.json(createApiSuccessResponse({ valid: isValid }));
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
      res.json(createApiSuccessResponse(sources));
    } catch (error) {
      console.error("Error fetching sources:", error);
      res.status(500).json({ message: "Fout bij ophalen bronnen" });
    }
  });

  // Prompt configuration endpoints
  app.get("/api/prompts", async (req, res) => {
    try {
      const prompts = await storage.getAllPromptConfigs();
      res.json(createApiSuccessResponse(prompts));
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
        // Strip timestamp fields to avoid date conversion issues - let DB handle these automatically
        const { createdAt, updatedAt, ...cleanConfig } = config;
        
        if (config.id) {
          // Probeer eerst te updaten
          const existing = await storage.getPromptConfig(config.id);
          if (existing) {
            await storage.updatePromptConfig(config.id, cleanConfig);
            restored++;
          } else {
            // Als het niet bestaat, maak het aan
            await storage.createPromptConfig(cleanConfig);
            created++;
          }
        } else {
          // Zonder ID, altijd nieuwe aanmaken
          await storage.createPromptConfig(cleanConfig);
          created++;
        }
      }
      
      res.json(createApiSuccessResponse({ 
        message: `Restore voltooid: ${restored} bijgewerkt, ${created} aangemaakt`,
        restored,
        created
      }, "Backup restore succesvol voltooid"));
    } catch (error: any) {
      console.error("Error restoring backup:", error);
      res.status(500).json({ message: "Restore failed: " + error.message });
    }
  });


  // Admin endpoint to force-ingest prompts from storage/prompts.json
  app.post("/api/prompts/ingest-from-json", asyncHandler(async (req: Request, res: Response) => {
    // Strict admin authentication - require exact API key match
    const adminKey = req.headers['x-admin-key'] as string;
    const authHeader = req.headers['authorization'] as string;
    
    const isValidKey = adminKey === process.env.ADMIN_API_KEY;
    const isValidBearer = authHeader?.startsWith('Bearer ') && 
                         authHeader.substring(7) === process.env.ADMIN_API_KEY;
    
    if (!isValidKey && !isValidBearer) {
      res.status(401).json(createApiErrorResponse(
        'AUTHENTICATION_ERROR', 
        ERROR_CODES.AI_AUTHENTICATION_FAILED,
        'Valid admin authentication required for prompt ingestion',
        'Access denied - invalid admin credentials'
      ));
      return;
    }
    
    // Force-ingest prompts from JSON file
    const result = await (storage as any).forceIngestPromptsFromJson();
    
    if (result.success) {
      res.json(createApiSuccessResponse(result, `Successfully ingested ${result.configsLoaded} prompt configurations`));
    } else {
      res.status(500).json(createApiErrorResponse(
        'INGESTION_ERROR',
        ERROR_CODES.DATABASE_ERROR, 
        result.message,
        'Failed to ingest prompts from JSON file'
      ));
    }
  }));


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
      res.json(createApiSuccessResponse(cases));
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
      
      res.json(createApiSuccessResponse(report));
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
      res.json(createApiSuccessResponse({ success: true }, "Status succesvol bijgewerkt"));
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
      res.json(createApiSuccessResponse({ success: true }, "Case succesvol verwijderd"));
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
        res.json(createApiSuccessResponse(report));
      } else if (format === "pdf") {
        const pdfBuffer = await pdfGenerator.generatePDF(report);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="rapport-${report.clientName.replace(/[^a-zA-Z0-9]/g, '-')}-${id.slice(0, 8)}.pdf"`);
        res.send(pdfBuffer);
      } else {
        res.status(400).json({ message: "Ongeldige export format" });
      }
    } catch (error: any) {
      console.error("Error exporting case:", error);
      res.status(500).json({ message: "Fout bij exporteren case" });
    }
  });


  
  // Register streaming routes
  registerStreamingRoutes(app, sseHandler, sessionManager, decomposedStages);

  const httpServer = createServer(app);
  return httpServer;
}
