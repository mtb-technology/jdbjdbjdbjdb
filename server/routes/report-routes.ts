/**
 * Report Management Routes
 *
 * All routes related to report generation workflow including:
 * - Dossier extraction
 * - Report creation and lifecycle
 * - Stage execution and management
 * - Feedback processing
 * - Version management and snapshots
 * - Prompt preview and templates
 * - Source validation
 */

import type { Express, Request, Response } from "express";
import { promises as fs } from "fs";
import * as path from "path";
import { storage } from "../storage";
import { ReportGenerator } from "../services/report-generator";
import { SourceValidator } from "../services/source-validator";
import { dossierSchema, bouwplanSchema } from "@shared/schema";
import type { DossierData, BouwplanData, StageId, PromptConfig } from "@shared/schema";
import { createReportRequestSchema, processFeedbackRequestSchema, overrideConceptRequestSchema, promoteSnapshotRequestSchema, expressModeRequestSchema } from "@shared/types/api";
import { ReportProcessor } from "../services/report-processor";
import { SSEHandler } from "../services/streaming/sse-handler";
import { StreamingSessionManager } from "../services/streaming/streaming-session-manager";
import { PromptBuilder } from "../services/prompt-builder";
import { z } from "zod";
import { ServerError, asyncHandler, getErrorMessage, isErrorWithMessage } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { deduplicateRequests } from "../middleware/deduplicate";

/**
 * Register all report-related routes
 *
 * @param app Express application
 * @param dependencies Object containing required services:
 *   - reportGenerator: ReportGenerator - For AI-based report generation
 *   - reportProcessor: ReportProcessor - For feedback processing
 *   - sourceValidator: SourceValidator - For source URL validation
 *   - sseHandler: SSEHandler - For server-sent events
 *   - sessionManager: StreamingSessionManager - For managing streaming sessions
 */
export function registerReportRoutes(
  app: Express,
  dependencies: {
    reportGenerator: ReportGenerator;
    reportProcessor: ReportProcessor;
    sourceValidator: SourceValidator;
    sseHandler: SSEHandler;
    sessionManager: StreamingSessionManager;
  }
): void {
  const { reportGenerator, reportProcessor, sourceValidator, sseHandler, sessionManager } = dependencies;

  // Extract dossier data from raw text using AI
  // 🔒 PROTECTED: Requires authentication (via global middleware)
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
  // 🔒 PROTECTED: Requires authentication (via global middleware)
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
    } catch (error: unknown) {
      console.error("Error generating prompt preview:", error);
      res.status(500).json(createApiErrorResponse(
        'PREVIEW_GENERATION_FAILED',
        ERROR_CODES.INTERNAL_SERVER_ERROR,
        'Fout bij het genereren van prompt preview',
        getErrorMessage(error)
      ));
    }
  });

  // Generate prompt for a stage (without executing AI)
  app.get("/api/reports/:id/stage/:stage/prompt", asyncHandler(async (req: Request, res: Response) => {
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
    asyncHandler(async (req: Request, res: Response) => {
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
      } catch (stageError: unknown) {
        console.error(`🚨 Stage execution failed but recovering gracefully:`, getErrorMessage(stageError));
        // Return a 500 error response for stage execution failure
        res.status(500).json(createApiErrorResponse(
          'ServerError',
          ERROR_CODES.AI_PROCESSING_FAILED,
          `Stage ${stage} kon niet volledig worden uitgevoerd`,
          getErrorMessage(stageError),
          { stage, reportId: id, originalError: getErrorMessage(stageError) }
        ));
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

    // Define stage order for cascading deletes
    const stageOrder = [
      '1_informatiecheck',
      '2_complexiteitscheck',
      '3_generatie',
      '4a_BronnenSpecialist',
      '4b_FiscaalTechnischSpecialist',
      '4c_ScenarioGatenAnalist',
      '4d_DeVertaler',
      '4e_DeAdvocaat',
      '4f_DeKlantpsycholoog'
    ];

    const deletedStageIndex = stageOrder.indexOf(stage);

    // Remove the stage from stageResults
    const currentStageResults = (report.stageResults as Record<string, string>) || {};
    delete currentStageResults[stage];

    // Cascade delete: remove all stages that come after this one
    if (deletedStageIndex >= 0) {
      for (let i = deletedStageIndex + 1; i < stageOrder.length; i++) {
        const laterStage = stageOrder[i];
        delete currentStageResults[laterStage];
      }
    }

    // Also remove from conceptReportVersions
    const currentConceptVersions = (report.conceptReportVersions as Record<string, any>) || {};

    // Delete the stage's snapshot
    delete currentConceptVersions[stage];

    // Delete all later stages' snapshots
    if (deletedStageIndex >= 0) {
      for (let i = deletedStageIndex + 1; i < stageOrder.length; i++) {
        const laterStage = stageOrder[i];
        delete currentConceptVersions[laterStage];
      }
    }

    // Also remove from history array
    if (currentConceptVersions.history && Array.isArray(currentConceptVersions.history)) {
      currentConceptVersions.history = currentConceptVersions.history.filter((entry: any) => {
        // Keep only entries that are NOT the deleted stage or later stages
        if (entry.stageId === stage) return false;
        if (deletedStageIndex >= 0) {
          const entryStageIndex = stageOrder.indexOf(entry.stageId);
          if (entryStageIndex > deletedStageIndex) return false;
        }
        return true;
      });
    }

    // Update or remove the 'latest' pointer
    // Find the most recent remaining stage from history array
    let newLatestStage: string | null = null;
    let newLatestVersion: number = 1;

    if (currentConceptVersions.history && Array.isArray(currentConceptVersions.history) && currentConceptVersions.history.length > 0) {
      // Find the most recent entry in history (last item after filtering)
      const sortedHistory = [...currentConceptVersions.history].sort((a: any, b: any) => {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      if (sortedHistory.length > 0) {
        newLatestStage = sortedHistory[0].stageId;
        newLatestVersion = sortedHistory[0].v || 1;
      }
    } else {
      // Fallback: search in stage keys (legacy behavior)
      for (let i = deletedStageIndex - 1; i >= 0; i--) {
        const earlierStage = stageOrder[i];
        if (currentConceptVersions[earlierStage]) {
          newLatestStage = earlierStage;
          newLatestVersion = currentConceptVersions[earlierStage].v || 1;
          break;
        }
      }
    }

    if (newLatestStage) {
      // Update latest pointer to previous stage
      currentConceptVersions.latest = {
        pointer: newLatestStage as StageId,
        v: newLatestVersion
      };
    } else {
      // No valid stages left, remove latest pointer
      delete currentConceptVersions.latest;
    }

    const updatedReport = await storage.updateReport(id, {
      stageResults: currentStageResults,
      conceptReportVersions: currentConceptVersions,
    });

    if (!updatedReport) {
      throw ServerError.notFound("Updated report not found");
    }

    console.log(`🗑️ Deleted stage ${stage} and all subsequent stages for report ${id}`);

    res.json(createApiSuccessResponse({
      report: updatedReport,
      clearedStage: stage,
      cascadeDeleted: deletedStageIndex >= 0 ? stageOrder.slice(deletedStageIndex + 1) : []
    }, `Stage ${stage} en alle volgende stages zijn verwijderd - workflow kan opnieuw vanaf hier worden uitgevoerd`));
  }));

  // Restore to a previous version by making it the "latest"
  app.post("/api/reports/:id/restore-version", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { stageKey } = req.body;

    if (!stageKey) {
      throw ServerError.validation("stageKey is required", "stageKey is verplicht");
    }

    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    const currentConceptVersions = (report.conceptReportVersions as Record<string, any>) || {};

    // Find the stage in history array
    const history = currentConceptVersions.history || [];
    const versionEntry = history.find((entry: any) => entry.stageId === stageKey);

    if (!versionEntry) {
      throw ServerError.validation(`Stage ${stageKey} not found in version history`, `Versie ${stageKey} niet gevonden in de geschiedenis`);
    }

    // Update the 'latest' pointer to point to this stage
    currentConceptVersions.latest = {
      pointer: stageKey as StageId,
      v: versionEntry.v || 1
    };

    const updatedReport = await storage.updateReport(id, {
      conceptReportVersions: currentConceptVersions,
    });

    if (!updatedReport) {
      throw ServerError.notFound("Updated report not found");
    }

    console.log(`🔄 Restored report ${id} to version ${stageKey}`);

    res.json(createApiSuccessResponse({
      report: updatedReport,
      restoredStage: stageKey
    }, `Versie ${stageKey} is nu de actieve versie`));
  }));

  // Preview the exact prompt that would be sent for feedback processing
  // ✅ FIX: Changed from GET to POST to avoid 431 Request Header Too Large errors
  // Large feedback instructions should be sent in request body, not URL query string
  app.post("/api/reports/:id/stage/:stageId/prompt-preview", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId, stageId } = req.params;
    const { userInstructions = "Pas alle feedback toe om het concept rapport te verbeteren. Neem alle suggesties over die de kwaliteit, accuratesse en leesbaarheid van het rapport verbeteren." } = req.body;

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
      // IMPORTANT: Skip reviewer stages (4a-4f) as they don't contain concept reports
      if (!latestConceptText) {
        // Try stage 3 first (the generation stage)
        let snapshot = conceptReportVersions?.['3_generatie'];

        // If not found, search for any valid snapshot (excluding reviewer stages 4a-4f)
        if (!snapshot || !snapshot.content) {
          snapshot = Object.entries(conceptReportVersions || {}).find(([key, v]: [string, any]) => {
            // Skip 'latest' pointer, skip reviewer stages, only take snapshots with content
            return key !== 'latest' && !key.startsWith('4') && v && v.content;
          })?.[1];
        }

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
      // Support both "editor" and "5_feedback_verwerker" for backwards compatibility
      const editorPromptConfig = parsedConfig.editor || (parsedConfig as any)['5_feedback_verwerker'];

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

      // ✅ FIX: Pass OBJECT to PromptBuilder, not pre-stringified JSON
      // PromptBuilder.build() will handle JSON.stringify internally via stringifyData()
      const { systemPrompt, userInput } = promptBuilder.build(
        'editor',
        editorPromptConfig,
        () => ({
          BASISTEKST: latestConceptText,
          WIJZIGINGEN_JSON: feedbackJSON
        })
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

    } catch (error: unknown) {
      console.error(`❌ [${reportId}-${stageId}] Prompt preview failed:`, error);
      console.error(`❌ Error details:`, {
        message: getErrorMessage(error),
        stack: isErrorWithMessage(error) ? error.stack : undefined,
        name: isErrorWithMessage(error) ? error.name : 'Unknown'
      });

      res.status(500).json(createApiErrorResponse(
        'PREVIEW_FAILED',
        'INTERNAL_SERVER_ERROR',
        'Prompt preview gefaald',
        getErrorMessage(error) || 'Onbekende fout tijdens prompt preview'
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
      // IMPORTANT: Skip reviewer stages (4a-4f) as they don't contain concept reports
      if (!latestConceptText) {
        // Try stage 3 first (the generation stage)
        let snapshot = conceptReportVersions?.['3_generatie'];

        // If not found, search for any valid snapshot (excluding reviewer stages 4a-4f)
        if (!snapshot || !snapshot.content) {
          snapshot = Object.entries(conceptReportVersions || {}).find(([key, v]: [string, any]) => {
            // Skip 'latest' pointer, skip reviewer stages, only take snapshots with content
            return key !== 'latest' && !key.startsWith('4') && v && v.content;
          })?.[1];
        }

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
      // Support both "editor" and "5_feedback_verwerker" for backwards compatibility
      const editorPromptConfig = parsedConfig.editor || (parsedConfig as any)['5_feedback_verwerker'];

      // Build the Editor prompt using PromptBuilder
      // The Editor prompt itself contains the instructions on what to do
      // We only need to provide: BASISTEKST + WIJZIGINGEN_JSON
      // Note: filteredChanges already contains only accepted/modified proposals
      const promptBuilder = new PromptBuilder();

      // ✅ FIX: Pass OBJECT to PromptBuilder, not pre-stringified JSON
      // PromptBuilder.build() will handle JSON.stringify internally via stringifyData()
      const { systemPrompt, userInput } = promptBuilder.build(
        'editor',
        editorPromptConfig,
        () => ({
          BASISTEKST: latestConceptText,
          WIJZIGINGEN_JSON: feedbackJSON
        })
      );

      const combinedPrompt = `${systemPrompt}\n\n### USER INPUT:\n${userInput}`;

      // 🔍 DEBUG: Log the ACTUAL prompt being sent to LLM
      console.log(`📝 [${reportId}-${stageId}] Editor Prompt being sent to LLM:`, {
        systemPromptLength: systemPrompt.length,
        userInputLength: userInput.length,
        combinedPromptLength: combinedPrompt.length,
        basistekstLength: latestConceptText.length,
        wijzigingenCount: Array.isArray(feedbackJSON) ? feedbackJSON.length : 'not an array',
        userInstructionsLength: userInstructions.length,
        systemPromptPreview: systemPrompt.substring(0, 200) + '...',
        userInputPreview: userInput.substring(0, 200) + '...'
      });

      // ✅ CRITICAL FIX: Use processStageWithPrompt to bypass double prompt wrapping
      // We've already built the FULL prompt above with PromptBuilder
      // The old processStage() would re-build it causing truncation
      const processingResult = await reportProcessor.processStageWithPrompt(
        reportId,
        stageId as StageId,
        combinedPrompt,  // The FULL pre-built prompt (40,000+ chars)
        feedbackJSON     // For audit trail only
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

    } catch (error: unknown) {
      console.error(`❌ [${reportId}-${stageId}] Simple feedback processing failed:`, error);

      // Emit SSE error event
      sseHandler.broadcast(reportId, stageId, {
        type: 'step_error',
        stageId: stageId,
        substepId: 'manual_feedback_processing',
        percentage: 0,
        message: 'Feedback processing gefaald',
        data: { error: getErrorMessage(error) },
        timestamp: new Date().toISOString()
      });

      return res.status(500).json(createApiErrorResponse(
        'PROCESSING_FAILED',
        'INTERNAL_SERVER_ERROR',
        'Feedback processing gefaald',
        getErrorMessage(error) || 'Onbekende fout tijdens feedback processing'
      ));
    }
  }));

  // Generate final report from all stages
  app.post("/api/reports/:id/finalize", asyncHandler(async (req: Request, res: Response) => {
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

  // Express Mode - Auto-run all review stages with auto-accept
  app.post("/api/reports/:id/express-mode", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const validatedData = expressModeRequestSchema.parse(req.body);

    console.log(`🚀 [${id}] Express Mode started`);

    // Get report
    let report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // Check if stage 3 is completed (has concept report)
    // Check conceptReportVersions (new versioning), generatedContent (legacy), or stageResults (legacy)
    const conceptVersions = (report.conceptReportVersions as Record<string, any>) || {};
    const stageResults = (report.stageResults as Record<string, any>) || {};
    const hasStage3 =
      conceptVersions['3_generatie'] ||
      conceptVersions['latest'] ||
      report.generatedContent || // Legacy: direct content field
      (stageResults['3_generatie']?.conceptReport);

    if (!hasStage3) {
      console.log(`❌ [${id}] Express Mode validation failed: No stage 3 concept found`, {
        hasConceptVersions: !!report.conceptReportVersions,
        conceptVersionKeys: Object.keys(conceptVersions),
        hasGeneratedContent: !!report.generatedContent,
        generatedContentLength: report.generatedContent?.toString().length,
        hasStageResults: !!report.stageResults,
        stageResultKeys: Object.keys(stageResults),
        has3generatie: !!stageResults['3_generatie'],
        has3generatieConceptReport: !!stageResults['3_generatie']?.conceptReport
      });
      throw ServerError.business(
        ERROR_CODES.VALIDATION_FAILED,
        'Stage 3 (Generatie) moet eerst voltooid zijn voordat Express Mode kan worden gebruikt'
      );
    }

    // Default stages: all review stages (4a-4f)
    const stages = validatedData.stages || [
      '4a_BronnenSpecialist',
      '4b_FiscaalTechnischSpecialist',
      '4c_ScenarioGatenAnalist',
      '4d_DeVertaler',
      '4e_DeAdvocaat',
      '4f_DeKlantpsycholoog'
    ];

    // Set response headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      // Process each stage sequentially
      for (let i = 0; i < stages.length; i++) {
        const stageId = stages[i];
        const stageNumber = i + 1;
        const totalStages = stages.length;

        // Send start event
        sendEvent({
          type: 'stage_start',
          stageId,
          stageNumber,
          totalStages,
          message: `Starting ${stageId}...`,
          timestamp: new Date().toISOString()
        });

        try {
          // Step 1: Execute review stage (generate feedback)
          sendEvent({
            type: 'step_progress',
            stageId,
            substepId: 'review',
            percentage: 25,
            message: `Generating review feedback for ${stageId}...`,
            timestamp: new Date().toISOString()
          });

          const stageExecution = await reportGenerator.executeStage(
            stageId,
            report.dossierData as DossierData,
            report.bouwplanData as BouwplanData,
            report.stageResults as Record<string, string> || {},
            report.conceptReportVersions as Record<string, string> || {},
            undefined,
            id
          );

          // Update stageResults with the feedback
          const updatedStageResults = {
            ...(report.stageResults as Record<string, string> || {}),
            [stageId]: stageExecution.stageOutput
          };

          await storage.updateReport(id, {
            stageResults: updatedStageResults,
            currentStage: stageId as StageId
          });

          sendEvent({
            type: 'step_complete',
            stageId,
            substepId: 'review',
            percentage: 50,
            message: `Review feedback generated for ${stageId}`,
            timestamp: new Date().toISOString()
          });

          // Step 2: Auto-accept and process feedback
          if (validatedData.autoAccept) {
            sendEvent({
              type: 'step_progress',
              stageId,
              substepId: 'process_feedback',
              percentage: 75,
              message: `Auto-processing feedback for ${stageId}...`,
              timestamp: new Date().toISOString()
            });

            // Parse feedback JSON
            let feedbackJSON;
            try {
              feedbackJSON = JSON.parse(stageExecution.stageOutput);
            } catch (e) {
              feedbackJSON = stageExecution.stageOutput;
            }

            // Get latest concept report
            const conceptReportVersions = (report.conceptReportVersions as Record<string, any>) || {};
            let latestConceptText = '';
            const latest = conceptReportVersions?.['latest'];

            if (latest && latest.pointer) {
              const snapshot = conceptReportVersions[latest.pointer];
              if (snapshot && snapshot.content) {
                latestConceptText = snapshot.content;
              }
            }

            if (!latestConceptText) {
              let snapshot = conceptReportVersions?.['3_generatie'];
              if (!snapshot || !snapshot.content) {
                snapshot = Object.entries(conceptReportVersions || {}).find(([key, v]: [string, any]) => {
                  return key !== 'latest' && !key.startsWith('4') && v && v.content;
                })?.[1];
              }
              if (snapshot && snapshot.content) {
                latestConceptText = snapshot.content;
              }
            }

            // Legacy fallback: use generatedContent if no versioned concept found
            if (!latestConceptText && report.generatedContent) {
              latestConceptText = report.generatedContent.toString();
            }

            if (!latestConceptText) {
              throw new Error('No concept report found to process feedback');
            }

            // Get Editor prompt
            const activeConfig = await storage.getActivePromptConfig();
            if (!activeConfig || !activeConfig.config) {
              throw new Error('No active Editor prompt configuration found');
            }

            const parsedConfig = activeConfig.config as PromptConfig;
            const editorPromptConfig = parsedConfig.editor || (parsedConfig as any)['5_feedback_verwerker'];

            // Build Editor prompt
            const promptBuilder = new PromptBuilder();
            const { systemPrompt, userInput } = promptBuilder.build(
              'editor',
              editorPromptConfig,
              () => ({
                BASISTEKST: latestConceptText,
                WIJZIGINGEN_JSON: feedbackJSON
              })
            );

            const combinedPrompt = `${systemPrompt}\n\n### USER INPUT:\n${userInput}`;

            // Process with Editor prompt
            const processingResult = await reportProcessor.processStageWithPrompt(
              id,
              stageId as StageId,
              combinedPrompt,
              feedbackJSON
            );

            sendEvent({
              type: 'step_complete',
              stageId,
              substepId: 'process_feedback',
              percentage: 100,
              message: `Feedback processed - new concept v${processingResult.snapshot.v}`,
              data: {
                version: processingResult.snapshot.v
              },
              timestamp: new Date().toISOString()
            });

            // Refresh report for next iteration
            report = await storage.getReport(id) || report;
          }

          // Send stage complete event
          sendEvent({
            type: 'stage_complete',
            stageId,
            stageNumber,
            totalStages,
            message: `${stageId} completed successfully`,
            timestamp: new Date().toISOString()
          });

        } catch (stageError: any) {
          console.error(`❌ [${id}] Express Mode failed at ${stageId}:`, stageError);

          sendEvent({
            type: 'stage_error',
            stageId,
            error: stageError.message || 'Unknown error',
            canRetry: false,
            timestamp: new Date().toISOString()
          });

          // Stop processing on error
          break;
        }
      }

      // Send final complete event
      sendEvent({
        type: 'express_complete',
        message: 'Express Mode completed successfully',
        timestamp: new Date().toISOString()
      });

      res.end();

    } catch (error: any) {
      console.error(`❌ [${id}] Express Mode failed:`, error);

      sendEvent({
        type: 'express_error',
        error: error.message || 'Unknown error',
        timestamp: new Date().toISOString()
      });

      res.end();
    }
  }));
}
