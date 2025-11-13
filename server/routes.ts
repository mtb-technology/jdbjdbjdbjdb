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
import { dossierSchema, bouwplanSchema, insertPromptConfigSchema, insertFollowUpSessionSchema, insertFollowUpThreadSchema } from "@shared/schema";
import type { DossierData, BouwplanData, StageId, ConceptReportVersions, PromptConfig } from "@shared/schema";
import { createReportRequestSchema, processFeedbackRequestSchema, overrideConceptRequestSchema, promoteSnapshotRequestSchema } from "@shared/types/api";
import { ReportProcessor } from "./services/report-processor";
import { SSEHandler } from "./services/streaming/sse-handler";
import { StreamingSessionManager } from "./services/streaming/streaming-session-manager";
import { PromptBuilder } from "./services/prompt-builder";
import { registerStreamingRoutes } from "./routes/streaming-routes";
import { documentRouter } from "./routes/document-routes";
import { fileUploadRouter } from "./routes/file-upload-routes";
import { registerHealthRoutes } from "./routes/health-routes";
import { registerPromptRoutes } from "./routes/prompt-routes";
import { registerCaseRoutes } from "./routes/case-routes";
import { z } from "zod";
import { ServerError, asyncHandler } from "./middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { deduplicateRequests } from "./middleware/deduplicate";

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
  
  // Create AI handler for ReportProcessor using same approach as ReportGenerator
  const aiHandler = {
    generateContent: async (params: { prompt: string; temperature: number; topP: number; maxOutputTokens: number }) => {
      const result = await reportGenerator.testAI(params.prompt);
      return { content: result };
    }
  };
  const reportProcessor = new ReportProcessor(aiHandler);

  // ====== REGISTER EXTRACTED ROUTE MODULES ======
  // Phase 1: Health, Prompt, and Case routes moved to separate files
  registerHealthRoutes(app);
  registerPromptRoutes(app);
  registerCaseRoutes(app, pdfGenerator);
  // ==============================================

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

  // NOTE: Health routes moved to server/routes/health-routes.ts

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
  app.post("/api/reports/create", asyncHandler(async (req: Request, res: Response) => {
    // ✅ SECURITY: Validate and sanitize input with Zod
    const validatedData = createReportRequestSchema.parse(req.body);
    const { clientName, rawText } = validatedData;

    console.log("📝 Creating new report:", {
      clientName,
      rawTextLength: rawText.length,
      validated: true
    });

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

    console.log("✅ Report created successfully:", { reportId: report.id });
    res.json(createApiSuccessResponse(report, "Rapport succesvol aangemaakt"));
  }));

  // Get prompt preview for a stage without executing it
  app.get("/api/reports/:id/stage/:stage/preview", async (req, res) => {
    try {
      const { id, stage } = req.params;
      const report = await storage.getReport(id);

      if (!report) {
        throw ServerError.notFound("Report");
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
      res.status(500).json(createApiErrorResponse(
        'PREVIEW_GENERATION_FAILED',
        ERROR_CODES.INTERNAL_SERVER_ERROR,
        'Fout bij het genereren van prompt preview',
        error.message
      ));
    }
  });

  // Generate prompt for a stage (without executing AI)
  app.get("/api/reports/:id/stage/:stage/prompt", asyncHandler(async (req, res) => {
    const { id, stage } = req.params;

    const report = await storage.getReport(id);
    if (!report) {
      throw new Error("Rapport niet gevonden");
    }

    // Generate the prompt without executing
    const prompt = await reportGenerator.generatePromptOnly(
      stage,
      report.dossierData as DossierData,
      report.bouwplanData as BouwplanData,
      report.stageResults as Record<string, string> || {},
      report.conceptReportVersions as Record<string, string> || {}
    );

    // Store the prompt
    const updatedStagePrompts = {
      ...(report.stagePrompts as Record<string, string> || {}),
      [stage]: prompt
    };

    await storage.updateReport(id, {
      stagePrompts: updatedStagePrompts
    });

    res.json(createApiSuccessResponse({ prompt }, "Prompt gegenereerd"));
  }));

  // Execute specific stage of report generation
  app.post("/api/reports/:id/stage/:stage",
    deduplicateRequests({
      keyFn: (req) => `${req.params.id}-${req.params.stage}`,
      timeout: 300000 // 5 minutes for long AI operations
    }),
    asyncHandler(async (req, res) => {
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

      // *** STAGE 1 CLEANUP: Strip rawText after successful completion ***
      if (stage === '1_informatiecheck' && stageExecution.stageOutput) {
        try {
          const parsed = JSON.parse(stageExecution.stageOutput);
          if (parsed.status === 'COMPLEET' && parsed.dossier) {
            console.log(`🧹 [${id}] Stage 1 COMPLEET - stripping rawText from dossierData`);
            // Replace dossierData with structured data from AI (no rawText)
            updateData.dossierData = {
              klant: {
                naam: report.clientName,
                situatie: parsed.dossier.samenvatting_onderwerp || ''
              },
              gestructureerde_data: parsed.dossier.gestructureerde_data,
              samenvatting_onderwerp: parsed.dossier.samenvatting_onderwerp
            };
          }
        } catch (parseError) {
          console.warn(`⚠️ [${id}] Could not parse Stage 1 output for rawText cleanup:`, parseError);
          // Don't fail the request - just log warning
        }
      }

      // *** REVIEW STAGES (4a-4g): NO AUTOMATIC CONCEPT PROCESSING ***
      // These stages now require user feedback selection - only store raw feedback
      if (stage.startsWith('4')) {
        console.log(`📋 [${id}-${stage}] Review stage completed - storing raw feedback for user review (NO auto-processing)`);
        // Do NOT update generatedContent - let user control this through manual feedback processing
        // The stageResults will contain the raw feedback for user selection
      }

      const updatedReport = await storage.updateReport(id, updateData);

      const result = {
        report: updatedReport,
        stageResult: stageExecution.stageOutput,
        conceptReport: stageExecution.conceptReport,
        prompt: stageExecution.prompt,
      };

      res.json(createApiSuccessResponse(result, "Stage succesvol uitgevoerd"));
    })
  );

  // Process manual stage content for any stage
  app.post("/api/reports/:id/manual-stage", async (req, res) => {
    try {
      const { id } = req.params;

      // Validate request body with zod - accept any stage now
      const manualStageSchema = z.object({
        stage: z.string().min(1, "Stage mag niet leeg zijn"),
        content: z.string().min(1, "Content mag niet leeg zijn"),
        isManual: z.boolean().optional()
      });

      const validatedData = manualStageSchema.parse(req.body);
      const { stage, content } = validatedData;

      const report = await storage.getReport(id);
      if (!report) {
        throw ServerError.notFound("Report");
      }

      // Update the report with manual content
      const currentStageResults = (report.stageResults as Record<string, string>) || {};
      const currentConceptVersions = (report.conceptReportVersions as Record<string, string>) || {};

      currentStageResults[stage] = content;

      // For generation stages (3_generatie),
      // also update concept report versions
      if (["3_generatie"].includes(stage)) {
        const versionKey = `${stage}_${new Date().toISOString()}`;
        currentConceptVersions[versionKey] = content;
        // Also maintain the stage key for backward compatibility
        currentConceptVersions[stage] = content;
      }

      const updatedReport = await storage.updateReport(id, {
        stageResults: currentStageResults,
        conceptReportVersions: currentConceptVersions,
        // Don't update currentStage here, let the frontend handle progression
      });

      res.json(createApiSuccessResponse({
        report: updatedReport,
        stageResult: content,
        conceptReport: ["3_generatie"].includes(stage) ? content : undefined,
        isManual: true
      }, "Handmatige content succesvol verwerkt"));

    } catch (error) {
      console.error("Error processing manual stage:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json(createApiErrorResponse(
          'VALIDATION_ERROR',
          ERROR_CODES.VALIDATION_FAILED,
          'Validatiefout in invoergegevens',
          JSON.stringify(error.errors)
        ));
      } else if (error instanceof ServerError) {
        throw error;
      } else {
        res.status(500).json(createApiErrorResponse(
          'PROCESSING_FAILED',
          ERROR_CODES.INTERNAL_SERVER_ERROR,
          'Fout bij verwerken van handmatige content',
          error instanceof Error ? error.message : 'Unknown error'
        ));
      }
    }
  });

  // Delete/clear a specific stage result to allow re-running
  app.delete("/api/reports/:id/stage/:stage", asyncHandler(async (req: Request, res: Response) => {
    const { id, stage } = req.params;

    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // Remove the stage from stageResults
    const currentStageResults = (report.stageResults as Record<string, string>) || {};
    delete currentStageResults[stage];

    // Also remove from conceptReportVersions if it's a generation stage
    const currentConceptVersions = (report.conceptReportVersions as Record<string, string>) || {};
    if (["3_generatie"].includes(stage)) {
      delete currentConceptVersions[stage];
      // Also remove timestamped versions
      Object.keys(currentConceptVersions).forEach(key => {
        if (key.startsWith(`${stage}_`)) {
          delete currentConceptVersions[key];
        }
      });
    }

    const updatedReport = await storage.updateReport(id, {
      stageResults: currentStageResults,
      conceptReportVersions: currentConceptVersions,
    });

    if (!updatedReport) {
      throw ServerError.notFound("Updated report not found");
    }

    res.json(createApiSuccessResponse({
      report: updatedReport,
      clearedStage: stage
    }, `Stage ${stage} resultaat verwijderd - kan nu opnieuw worden uitgevoerd`));
  }));

  // Preview the exact prompt that would be sent for feedback processing
  app.get("/api/reports/:id/stage/:stageId/prompt-preview", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId, stageId } = req.params;
    const { userInstructions = "Pas alle feedback toe om het concept rapport te verbeteren. Neem alle suggesties over die de kwaliteit, accuratesse en leesbaarheid van het rapport verbeteren." } = req.query;

    console.log(`👁️ [${reportId}-${stageId}] Prompt preview requested`);
    console.log(`👁️ Query params:`, req.query);
    console.log(`👁️ userInstructions type:`, typeof userInstructions, userInstructions);

    // Check if report exists
    const report = await storage.getReport(reportId);
    if (!report) {
      res.status(404).json(createApiErrorResponse(
        'REPORT_NOT_FOUND',
        'VALIDATION_FAILED',
        'Rapport niet gevonden',
        'Het rapport kon niet worden gevonden voor prompt preview'
      ));
      return;
    }

    // Validate stage ID for review stages only
    const validReviewStages = [
      '4a_BronnenSpecialist', '4b_FiscaalTechnischSpecialist',
      '4c_ScenarioGatenAnalist', '4d_DeVertaler', '4e_DeAdvocaat',
      '4f_DeKlantpsycholoog'
    ];

    if (!validReviewStages.includes(stageId)) {
      res.status(400).json(createApiErrorResponse(
        'INVALID_STAGE',
        'VALIDATION_FAILED',
        'Ongeldige stap voor prompt preview',
        `Stage ${stageId} ondersteunt geen prompt preview`
      ));
      return;
    }

    try {
      // Get the raw feedback from stageResults
      const stageResults = (report.stageResults as Record<string, string>) || {};
      const rawFeedback = stageResults[stageId];

      if (!rawFeedback) {
        res.status(400).json(createApiErrorResponse(
          'NO_FEEDBACK_FOUND',
          'VALIDATION_FAILED',
          'Geen feedback gevonden',
          `Geen feedback beschikbaar voor stage ${stageId}`
        ));
        return;
      }

      // Get the latest concept report (same as process-feedback endpoint)
      const conceptReportVersions = (report.conceptReportVersions as Record<string, any>) || {};

      // The 'latest' field is a pointer { pointer: stageId, v: version }
      // We need to resolve it to get the actual content
      let latestConceptText = '';
      const latest = conceptReportVersions?.['latest'];

      if (latest && latest.pointer) {
        // Resolve the pointer to get the actual snapshot
        const snapshot = conceptReportVersions[latest.pointer];
        if (snapshot && snapshot.content) {
          latestConceptText = snapshot.content;
        }
      }

      // Fallback: Try direct stage snapshots
      if (!latestConceptText) {
        const snapshot = conceptReportVersions?.['4a_BronnenSpecialist']
          || conceptReportVersions?.['3_generatie']
          || Object.values(conceptReportVersions).find((v: any) => v && v.content);

        if (snapshot && snapshot.content) {
          latestConceptText = snapshot.content;
        }
      }

      if (!latestConceptText) {
        res.status(400).json(createApiErrorResponse(
          'NO_CONCEPT_FOUND',
          'VALIDATION_FAILED',
          'Geen concept rapport gevonden',
          'Er is geen concept rapport beschikbaar om feedback op te verwerken'
        ));
        return;
      }

      // Get the Editor prompt from active config (same as process-feedback endpoint)
      const activeConfig = await storage.getActivePromptConfig();
      if (!activeConfig || !activeConfig.config) {
        res.status(400).json(createApiErrorResponse(
          'NO_EDITOR_CONFIG',
          'INTERNAL_SERVER_ERROR',
          'Editor configuratie ontbreekt',
          'Er is geen actieve Editor prompt configuratie gevonden'
        ));
        return;
      }

      // Parse the config JSON to get the stages
      const parsedConfig = activeConfig.config as PromptConfig;
      const editorPromptConfig = parsedConfig.editor;

      // Parse the raw feedback as JSON
      let feedbackJSON;
      try {
        feedbackJSON = JSON.parse(rawFeedback);
      } catch (e) {
        feedbackJSON = rawFeedback;
      }

      // Build the Editor prompt using PromptBuilder (same as process-feedback endpoint)
      // The Editor prompt itself contains the instructions - we only provide data
      const promptBuilder = new PromptBuilder();
      const editorInput = JSON.stringify({
        BASISTEKST: latestConceptText,
        WIJZIGINGEN_JSON: feedbackJSON
      }, null, 2);

      const { systemPrompt, userInput } = promptBuilder.build(
        'editor',
        editorPromptConfig,
        () => editorInput
      );

      const combinedPrompt = `${systemPrompt}\n\n### USER INPUT:\n${userInput}`;
      const fullPrompt = combinedPrompt;
      const promptLength = fullPrompt.length;

      res.json(createApiSuccessResponse({
        stageId,
        userInstructions,
        combinedPrompt: combinedPrompt.trim(),
        fullPrompt: fullPrompt,
        promptLength: promptLength,
        rawFeedback: rawFeedback
      }, 'Prompt preview gegenereerd'));

    } catch (error: any) {
      console.error(`❌ [${reportId}-${stageId}] Prompt preview failed:`, error);
      console.error(`❌ Error details:`, {
        message: error.message,
        stack: error.stack,
        name: error.name
      });

      res.status(500).json(createApiErrorResponse(
        'PREVIEW_FAILED',
        'INTERNAL_SERVER_ERROR',
        'Prompt preview gefaald',
        error.message || 'Onbekende fout tijdens prompt preview'
      ));
    }
  }));

  // Manual feedback processing endpoint - user-controlled feedback selection and processing
  app.post("/api/reports/:id/stage/:stageId/process-feedback", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId, stageId } = req.params;

    console.log(`🔧 [${reportId}-${stageId}] Manual feedback processing requested`);

    // Validate request body - SIMPLIFIED approach
    const validatedData = processFeedbackRequestSchema.parse(req.body);
    const { userInstructions, processingStrategy, filteredChanges } = validatedData;

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
      '4f_DeKlantpsycholoog'
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
      // Use filtered changes if provided, otherwise fall back to raw feedback
      let feedbackJSON;

      if (filteredChanges) {
        // Client sent pre-filtered changes (only accepted/modified proposals)
        console.log(`📝 [${reportId}-${stageId}] Using filtered changes from client`);
        try {
          feedbackJSON = JSON.parse(filteredChanges);
        } catch (e) {
          return res.status(400).json(createApiErrorResponse(
            'INVALID_FILTERED_CHANGES',
            'VALIDATION_FAILED',
            'Ongeldige filtered changes JSON',
            'De gefilterde wijzigingen konden niet worden geparseerd als JSON'
          ));
        }
      } else {
        // Legacy fallback: Get the raw feedback from stageResults
        console.log(`📝 [${reportId}-${stageId}] Using raw feedback from stageResults (legacy mode)`);
        const stageResults = (report.stageResults as Record<string, string>) || {};
        const rawFeedback = stageResults[stageId];

        if (!rawFeedback) {
          return res.status(400).json(createApiErrorResponse(
            'NO_FEEDBACK_FOUND',
            'VALIDATION_FAILED',
            'Geen feedback gevonden',
            `Geen feedback beschikbaar voor stage ${stageId}`
          ));
        }

        // Parse the raw feedback as JSON (it should already be JSON from the specialist)
        try {
          feedbackJSON = JSON.parse(rawFeedback);
        } catch (e) {
          // If it's not valid JSON, use it as-is
          feedbackJSON = rawFeedback;
        }
      }

      // Get the latest concept report to send to the editor
      const conceptReportVersions = (report.conceptReportVersions as Record<string, any>) || {};

      // The 'latest' field is a pointer { pointer: stageId, v: version }
      // We need to resolve it to get the actual content
      let latestConceptText = '';
      const latest = conceptReportVersions?.['latest'];

      if (latest && latest.pointer) {
        // Resolve the pointer to get the actual snapshot
        const snapshot = conceptReportVersions[latest.pointer];
        if (snapshot && snapshot.content) {
          latestConceptText = snapshot.content;
        }
      }

      // Fallback: Try direct stage snapshots
      if (!latestConceptText) {
        const snapshot = conceptReportVersions?.['4a_BronnenSpecialist']
          || conceptReportVersions?.['3_generatie']
          || Object.values(conceptReportVersions).find((v: any) => v && v.content);

        if (snapshot && snapshot.content) {
          latestConceptText = snapshot.content;
        }
      }

      if (!latestConceptText) {
        return res.status(400).json(createApiErrorResponse(
          'NO_CONCEPT_FOUND',
          'VALIDATION_FAILED',
          'Geen concept rapport gevonden',
          'Er is geen concept rapport beschikbaar om feedback op te verwerken'
        ));
      }

      // Get the Editor prompt from active config
      const activeConfig = await storage.getActivePromptConfig();
      if (!activeConfig || !activeConfig.config) {
        return res.status(400).json(createApiErrorResponse(
          'NO_EDITOR_CONFIG',
          'INTERNAL_SERVER_ERROR',
          'Editor configuratie ontbreekt',
          'Er is geen actieve Editor prompt configuratie gevonden'
        ));
      }

      // Parse the config JSON to get the stages
      const parsedConfig = activeConfig.config as PromptConfig;
      const editorPromptConfig = parsedConfig.editor;

      // Build the Editor prompt using PromptBuilder
      // The Editor prompt itself contains the instructions on what to do
      // We only need to provide: BASISTEKST + WIJZIGINGEN_JSON
      // Note: filteredChanges already contains only accepted/modified proposals
      const promptBuilder = new PromptBuilder();
      const editorInput = JSON.stringify({
        BASISTEKST: latestConceptText,
        WIJZIGINGEN_JSON: feedbackJSON
      }, null, 2);

      const { systemPrompt, userInput } = promptBuilder.build(
        'editor',
        editorPromptConfig,
        () => editorInput
      );

      const combinedPrompt = `${systemPrompt}\n\n### USER INPUT:\n${userInput}`;

      console.log(`📝 [${reportId}-${stageId}] Editor Input:`, {
        basistekstLength: latestConceptText.length,
        wijzigingenCount: Array.isArray(feedbackJSON) ? feedbackJSON.length : 'not an array',
        instructiesPreview: userInstructions.substring(0, 100) + '...'
      });

      // Process with ReportProcessor (use editor as the processing stage)
      // Note: We're borrowing the editor stage ID, but this is actually processing feedback for stageId
      const processingResult = await reportProcessor.processStage(
        reportId,
        stageId as StageId, // Use the original stageId for versioning purposes
        combinedPrompt,
        processingStrategy
      );

      console.log(`✅ [${reportId}-${stageId}] Feedback processing completed using Editor prompt - v${processingResult.snapshot.v}`);

      // Emit SSE event for feedback processing complete
      sseHandler.broadcast(reportId, stageId, {
        type: 'step_complete',
        stageId: stageId,
        substepId: 'manual_feedback_processing',
        percentage: 100,
        message: `Feedback verwerkt met Editor prompt - nieuw concept v${processingResult.snapshot.v} gegenereerd`,
        data: {
          version: processingResult.snapshot.v,
          conceptContent: processingResult.newConcept,
          userInstructions: userInstructions
        },
        timestamp: new Date().toISOString()
      });

      // Return success - ReportProcessor has already done all the work!
      return res.json(createApiSuccessResponse({
        success: true,
        newVersion: processingResult.snapshot.v,
        conceptContent: processingResult.newConcept,
        userInstructions: userInstructions,
        message: `Feedback succesvol verwerkt - nieuw concept v${processingResult.snapshot.v} gegenereerd`
      }, 'Feedback processing succesvol voltooid'));

    } catch (error: any) {
      console.error(`❌ [${reportId}-${stageId}] Simple feedback processing failed:`, error);
      
      // Emit SSE error event
      sseHandler.broadcast(reportId, stageId, {
        type: 'step_error',
        stageId: stageId,
        substepId: 'manual_feedback_processing',
        percentage: 0,
        message: 'Feedback processing gefaald',
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
  app.post("/api/reports/:id/finalize", asyncHandler(async (req, res) => {
    const { id } = req.params;

    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // ✅ REFACTORED: Use conceptReportVersions directly (modern approach)
    const conceptVersions = report.conceptReportVersions as Record<string, string> || {};
    const latestConceptKeys = Object.keys(conceptVersions).filter(key => key !== 'latest' && key !== 'history');

    if (latestConceptKeys.length === 0) {
      throw ServerError.business(
        ERROR_CODES.REPORT_NOT_FOUND,
        'Geen concept rapport versies gevonden - voer minimaal stap 3 (Generatie) uit'
      );
    }

    const finalContent = conceptVersions[latestConceptKeys[latestConceptKeys.length - 1]];

    const finalizedReport = await storage.updateReport(id, {
      generatedContent: finalContent,
      status: "generated",
    });

    res.json(createApiSuccessResponse(finalizedReport, "Rapport succesvol gefinaliseerd"));
  }));

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

      // ✅ FIX #4: Add caching headers with ETag for conditional requests
      const lastModified = report.updatedAt || report.createdAt || new Date();
      const etag = `"report-${report.id}-${lastModified.getTime()}"`;

      // Check if client has fresh copy (conditional request)
      const clientETag = req.headers['if-none-match'];
      if (clientETag === etag) {
        res.status(304).end(); // Not Modified - client can use cached version
        return;
      }

      // Set caching headers - short cache for active reports (5s max, 15s stale-while-revalidate)
      res.set('Cache-Control', 'public, max-age=5, stale-while-revalidate=15');
      res.set('ETag', etag);
      res.set('Last-Modified', lastModified.toUTCString());

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
      
      // Create a template prompt
      const templatePrompt = `${prompt}

### Datum: ${currentDate}`;

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

  // NOTE: Prompt configuration endpoints moved to server/routes/prompt-routes.ts
  // Includes: GET /api/prompts, GET /api/prompts/active, POST /api/prompts, PUT /api/prompts/:id,
  //           GET /api/prompts/backup, POST /api/prompts/restore, POST /api/prompts/ingest-from-json,
  //           GET /api/prompt-templates/:stageKey

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


  // ===== STEP-BACK CAPABILITY ENDPOINTS =====

  // Override concept content for a specific stage
  app.post("/api/reports/:id/stage/:stageId/override-concept", asyncHandler(async (req: Request, res: Response) => {
    const { id, stageId } = req.params;
    const payload = overrideConceptRequestSchema.parse(req.body);
    
    console.log(`🔄 [${id}] Overriding concept for stage ${stageId}:`, { 
      contentLength: payload.content.length,
      fromStage: payload.fromStage,
      reason: payload.reason 
    });

    // Get current report to access existing versions
    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // Create new snapshot for the stage
    const snapshot = await reportProcessor.createSnapshot(
      id,
      stageId as StageId,
      payload.content
    );

    // Update the concept versions with the new snapshot
    const updatedVersions = await reportProcessor.updateConceptVersions(
      id,
      stageId as StageId,
      snapshot
    );

    // Update report's current stage, latest pointer, AND generatedContent for immediate preview
    await storage.updateReport(id, {
      currentStage: stageId as StageId,
      conceptReportVersions: updatedVersions,
      generatedContent: payload.content, // ✅ CRITICAL: Update the content shown in preview
      updatedAt: new Date()
    });

    console.log(`✅ [${id}] Concept overridden for ${stageId} - new version ${snapshot.v}`);

    res.json(createApiSuccessResponse({
      success: true,
      newLatestStage: stageId,
      newLatestVersion: snapshot.v,
      message: `Concept voor ${stageId} succesvol overschreven`
    }, "Concept rapport overschreven"));
  }));

  // Promote a previous stage snapshot to be the latest
  app.post("/api/reports/:id/snapshots/promote", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { stageId, reason } = promoteSnapshotRequestSchema.parse(req.body);
    
    console.log(`📈 [${id}] Promoting stage ${stageId} to latest:`, { reason });

    // Get current report to access existing versions
    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    const conceptVersions = (report.conceptReportVersions as any) || {};
    const targetStageSnapshot = conceptVersions[stageId as StageId];
    
    if (!targetStageSnapshot) {
      throw ServerError.business(ERROR_CODES.REPORT_NOT_FOUND, `Geen snapshot gevonden voor stage ${stageId}`);
    }

    // Update the latest pointer to this stage
    const updatedVersions = {
      ...conceptVersions,
      latest: {
        pointer: stageId as StageId,
        v: targetStageSnapshot.v
      },
      history: [
        ...(conceptVersions.history || []),
        {
          stageId: stageId as StageId,
          v: targetStageSnapshot.v,
          timestamp: new Date().toISOString(),
          action: 'promote',
          reason: reason || 'Promoted to latest'
        }
      ]
    };

    // Update report with new latest pointer and content from the promoted stage  
    await storage.updateReport(id, {
      currentStage: stageId as StageId,
      conceptReportVersions: updatedVersions,
      generatedContent: targetStageSnapshot.content || targetStageSnapshot, // ✅ Handle both object and string formats
      updatedAt: new Date()
    });

    console.log(`✅ [${id}] Stage ${stageId} promoted to latest - version ${targetStageSnapshot.v}`);

    res.json(createApiSuccessResponse({
      success: true,
      newLatestStage: stageId,
      newLatestVersion: targetStageSnapshot.v,
      message: `Stage ${stageId} is nu de actieve versie`
    }, "Stage gepromoveerd naar latest"));
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

  // Update case metadata (title and clientName)
  app.patch("/api/cases/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { title, clientName } = req.body;

      // Validate input
      const updates: any = {};

      if (title !== undefined) {
        if (typeof title !== 'string' || title.trim().length === 0) {
          res.status(400).json({ message: "Titel mag niet leeg zijn" });
          return;
        }
        updates.title = title.trim();
      }

      if (clientName !== undefined) {
        if (typeof clientName !== 'string' || clientName.trim().length === 0) {
          res.status(400).json({ message: "Clientnaam mag niet leeg zijn" });
          return;
        }
        updates.clientName = clientName.trim();
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ message: "Geen velden om bij te werken" });
        return;
      }

      const updatedReport = await storage.updateReport(id, updates);

      if (!updatedReport) {
        res.status(404).json({ message: "Case niet gevonden" });
        return;
      }

      res.json(createApiSuccessResponse(updatedReport, "Case succesvol bijgewerkt"));
    } catch (error: any) {
      console.error("Error updating case:", error);
      res.status(500).json({ message: "Fout bij updaten case" });
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

  // Follow-up Assistant - Generate AI response for customer follow-up questions
  app.post("/api/assistant/generate", asyncHandler(async (req: Request, res: Response) => {
    const { systemPrompt, userInput, model } = req.body;

    // Validate inputs
    if (!systemPrompt || !userInput || !model) {
      throw new ServerError(
        "Ontbrekende verplichte velden: systemPrompt, userInput, en model zijn vereist",
        400,
        ERROR_CODES.VALIDATION_FAILED
      );
    }

    // Validate input lengths
    if (userInput.length > 200000) {
      throw new ServerError(
        "User input is te lang (max 200KB)",
        400,
        ERROR_CODES.VALIDATION_FAILED
      );
    }

    // Call AI with the system prompt and user input
    const aiResult = await reportGenerator.generateWithCustomPrompt({
      systemPrompt,
      userPrompt: userInput,
      model,
    });

    // Parse the JSON response from AI
    let parsedResult;
    try {
      // The AI should return JSON - try multiple extraction strategies
      // Strategy 1: Look for JSON code block
      let jsonText = aiResult.match(/```json\s*([\s\S]*?)\s*```/)?.[1];

      // Strategy 2: Look for first complete JSON object
      if (!jsonText) {
        jsonText = aiResult.match(/\{[\s\S]*\}/)?.[0];
      }

      // Strategy 3: Try the whole response if it looks like JSON
      if (!jsonText && aiResult.trim().startsWith('{')) {
        jsonText = aiResult.trim();
      }

      if (!jsonText) {
        console.error("AI response does not contain JSON. Raw response:", aiResult);
        throw new Error("AI response does not contain valid JSON");
      }

      parsedResult = JSON.parse(jsonText);
    } catch (parseError: any) {
      console.error("Failed to parse AI response:", parseError);
      console.error("Raw AI response:", aiResult.substring(0, 500));
      throw new ServerError(
        `AI antwoord kon niet worden geparseerd als JSON: ${parseError.message}`,
        500,
        ERROR_CODES.AI_PROCESSING_FAILED
      );
    }

    // Validate the structure
    if (!parsedResult.analyse || !parsedResult.concept_email) {
      throw new ServerError(
        "AI antwoord heeft niet de verwachte structuur (ontbrekende 'analyse' of 'concept_email')",
        500,
        ERROR_CODES.AI_PROCESSING_FAILED
      );
    }

    res.json(createApiSuccessResponse(parsedResult, "Concept antwoord succesvol gegenereerd"));
  }));

  // Follow-up session management endpoints

  // Get all sessions
  app.get("/api/follow-up/sessions", asyncHandler(async (req: Request, res: Response) => {
    const sessions = await storage.getAllFollowUpSessions();
    res.json(createApiSuccessResponse(sessions, "Sessies succesvol opgehaald"));
  }));

  // Get single session with all threads
  app.get("/api/follow-up/sessions/:id", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const sessionWithThreads = await storage.getFollowUpSessionWithThreads(id);

    if (!sessionWithThreads) {
      throw ServerError.notFound("Follow-up session");
    }

    res.json(createApiSuccessResponse(sessionWithThreads, "Sessie succesvol opgehaald"));
  }));

  // Create new session
  app.post("/api/follow-up/sessions", asyncHandler(async (req: Request, res: Response) => {
    const validatedData = insertFollowUpSessionSchema.parse(req.body);
    const session = await storage.createFollowUpSession(validatedData);
    res.json(createApiSuccessResponse(session, "Sessie succesvol aangemaakt"));
  }));

  // Delete session (cascade deletes threads)
  app.delete("/api/follow-up/sessions/:id", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Check if session exists
    const session = await storage.getFollowUpSession(id);
    if (!session) {
      throw ServerError.notFound("Follow-up session");
    }

    await storage.deleteFollowUpSession(id);
    res.json(createApiSuccessResponse(null, "Sessie succesvol verwijderd"));
  }));

  // Add thread to existing session
  app.post("/api/follow-up/sessions/:id/threads", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Check if session exists
    const session = await storage.getFollowUpSession(id);
    if (!session) {
      throw ServerError.notFound("Follow-up session");
    }

    const validatedData = insertFollowUpThreadSchema.parse({
      ...req.body,
      sessionId: id,
    });

    const thread = await storage.createFollowUpThread(validatedData);
    res.json(createApiSuccessResponse(thread, "Thread succesvol toegevoegd"));
  }));


  // Register streaming routes
  registerStreamingRoutes(app, sseHandler, sessionManager);

  // Register document management routes
  app.use("/api/documents", documentRouter);

  // Register file upload routes
  app.use("/api/upload", fileUploadRouter);

  const httpServer = createServer(app);
  return httpServer;
}
