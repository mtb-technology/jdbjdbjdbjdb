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
import { STAGE_ORDER, REVIEW_STAGES, getLatestConceptText } from "@shared/constants";
import { createReportRequestSchema, processFeedbackRequestSchema, overrideConceptRequestSchema, promoteSnapshotRequestSchema, expressModeRequestSchema, adjustReportRequestSchema, acceptAdjustmentRequestSchema } from "@shared/types/api";
import { ReportProcessor } from "../services/report-processor";
import { SSEHandler } from "../services/streaming/sse-handler";
import { StreamingSessionManager } from "../services/streaming/streaming-session-manager";
import { PromptBuilder } from "../services/prompt-builder";
import { AIModelFactory } from "../services/ai-models/ai-model-factory";
import { AIConfigResolver } from "../services/ai-config-resolver";
import { z } from "zod";
import { ServerError, asyncHandler, getErrorMessage, isErrorWithMessage } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { deduplicateRequests } from "../middleware/deduplicate";

/**
 * Helper function to parse JSON that may be wrapped in markdown code blocks
 * Handles responses like: ```json\n{...}\n```
 */
function parseJsonWithMarkdown(text: string): any {
  // First try direct parse
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      return JSON.parse(jsonMatch[1].trim());
    }
    // Try to find a JSON object in the text
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }
    // Re-throw if nothing worked
    throw new Error('No valid JSON found in response');
  }
}

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
    // Title will be automatically formatted by storage with dossier number: "D-0001 - [clientName]"
    const report = await storage.createReport({
      title: clientName, // Base title - storage will add dossier number prefix
      clientName: clientName,
      dossierData: { rawText, klant: { naam: clientName } }, // Ruwe tekst + klantnaam voor fallback prompts
      bouwplanData: {},
      generatedContent: null,
      stageResults: {},
      conceptReportVersions: {},
      currentStage: "1a_informatiecheck",
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
      const { customInput, reportDepth } = req.body;

      const report = await storage.getReport(id);
      if (!report) {
        throw new Error("Rapport niet gevonden");
      }

      // For Stage 1a (informatiecheck analyse): Include attachment extracted text AND vision attachments
      let dossierWithAttachments = report.dossierData as DossierData;
      let visionAttachments: Array<{ mimeType: string; data: string; filename: string }> = [];

      if (stage === '1a_informatiecheck') {
        const attachments = await storage.getAttachmentsForReport(id);
        if (attachments.length > 0) {
          // Separate attachments into text-extracted and vision-needed
          const textAttachments = attachments.filter(att => att.extractedText && !att.needsVisionOCR);
          const visionNeededAttachments = attachments.filter(att => att.needsVisionOCR);

          // Add text from successfully extracted attachments to rawText
          if (textAttachments.length > 0) {
            const attachmentTexts = textAttachments
              .map(att => `\n\n=== BIJLAGE: ${att.filename} ===\n${att.extractedText}`)
              .join('');

            const existingRawText = (dossierWithAttachments as any).rawText || '';
            dossierWithAttachments = {
              ...dossierWithAttachments,
              rawText: existingRawText + attachmentTexts
            };
            console.log(`📎 [${id}] Stage 1a: Added ${textAttachments.length} text attachment(s) to dossier`);
          }

          // Prepare scanned PDFs for Gemini Vision OCR
          if (visionNeededAttachments.length > 0) {
            visionAttachments = visionNeededAttachments.map(att => ({
              mimeType: att.mimeType,
              data: att.fileData, // base64 encoded
              filename: att.filename
            }));
            console.log(`📄 [${id}] Stage 1a: Sending ${visionNeededAttachments.length} scanned PDF(s) to Gemini Vision for OCR`);
          }

          // Mark all attachments as used in this stage
          for (const att of attachments) {
            await storage.updateAttachmentUsage(att.id, stage);
          }
        }
      }

      // Execute the specific stage with error recovery
      let stageExecution;
      try {
        stageExecution = await reportGenerator.executeStage(
          stage,
          dossierWithAttachments,
          report.bouwplanData as BouwplanData,
          report.stageResults as Record<string, string> || {},
          report.conceptReportVersions as Record<string, string> || {},
          customInput,
          id, // Pass reportId as jobId for logging
          undefined, // onProgress - not used in non-streaming
          visionAttachments.length > 0 ? visionAttachments : undefined,
          reportDepth // Report depth for Stage 3
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

      // *** STAGE 1a CLEANUP: Strip rawText after successful completion ***
      if (stage === '1a_informatiecheck' && stageExecution.stageOutput) {
        try {
          const parsed = parseJsonWithMarkdown(stageExecution.stageOutput);
          if (parsed.status === 'COMPLEET' && parsed.dossier) {
            console.log(`🧹 [${id}] Stage 1a COMPLEET - stripping rawText from dossierData`);
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
          console.warn(`⚠️ [${id}] Could not parse Stage 1a output for rawText cleanup:`, parseError);
          // Don't fail the request - just log warning
        }
      }

      // *** STAGE 2 UPDATE: Update dossierData with corrected data from origineel_dossier ***
      if (stage === '2_complexiteitscheck' && stageExecution.stageOutput) {
        try {
          const parsed = parseJsonWithMarkdown(stageExecution.stageOutput);
          if (parsed.next_action === 'PROCEED_TO_GENERATION' && parsed.origineel_dossier) {
            console.log(`🔄 [${id}] Stage 2 COMPLEET - updating dossierData with corrected data from origineel_dossier`);
            // Update dossierData with the corrected/enriched data from stage 2
            const currentDossier = (report.dossierData as Record<string, any>) || {};
            updateData.dossierData = {
              ...currentDossier,
              klant: {
                naam: report.clientName,
                situatie: parsed.origineel_dossier.samenvatting_onderwerp || parsed.samenvatting_onderwerp || ''
              },
              gestructureerde_data: parsed.origineel_dossier.gestructureerde_data || parsed.origineel_dossier.relevante_data,
              samenvatting_onderwerp: parsed.origineel_dossier.samenvatting_onderwerp || parsed.samenvatting_onderwerp
            };
          }
        } catch (parseError) {
          console.warn(`⚠️ [${id}] Could not parse Stage 2 output for dossierData update:`, parseError);
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

    const deletedStageIndex = STAGE_ORDER.indexOf(stage as typeof STAGE_ORDER[number]);

    // Remove the stage from stageResults
    const currentStageResults = (report.stageResults as Record<string, string>) || {};
    delete currentStageResults[stage];

    // Cascade delete: remove all stages that come after this one
    if (deletedStageIndex >= 0) {
      for (let i = deletedStageIndex + 1; i < STAGE_ORDER.length; i++) {
        const laterStage = STAGE_ORDER[i];
        delete currentStageResults[laterStage];
      }
    }

    // Also remove from conceptReportVersions
    const currentConceptVersions = (report.conceptReportVersions as Record<string, any>) || {};

    // Delete the stage's snapshot
    delete currentConceptVersions[stage];

    // Delete all later stages' snapshots
    if (deletedStageIndex >= 0) {
      for (let i = deletedStageIndex + 1; i < STAGE_ORDER.length; i++) {
        const laterStage = STAGE_ORDER[i];
        delete currentConceptVersions[laterStage];
      }
    }

    // Also remove from history array
    if (currentConceptVersions.history && Array.isArray(currentConceptVersions.history)) {
      currentConceptVersions.history = currentConceptVersions.history.filter((entry: any) => {
        // Keep only entries that are NOT the deleted stage or later stages
        if (entry.stageId === stage) return false;
        if (deletedStageIndex >= 0) {
          const entryStageIndex = STAGE_ORDER.indexOf(entry.stageId);
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
        const earlierStage = STAGE_ORDER[i];
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
      cascadeDeleted: deletedStageIndex >= 0 ? STAGE_ORDER.slice(deletedStageIndex + 1) : []
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
    if (!REVIEW_STAGES.includes(stageId as typeof REVIEW_STAGES[number])) {
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

      // Get the latest concept report
      const latestConceptText = getLatestConceptText(report.conceptReportVersions as Record<string, any>);

      if (!latestConceptText) {
        res.status(400).json(createApiErrorResponse(
          'NO_CONCEPT_FOUND',
          'VALIDATION_FAILED',
          'Geen concept rapport gevonden',
          'Er is geen concept rapport beschikbaar om feedback op te verwerken'
        ));
        return;
      }

      // Get the Editor prompt from active config
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
    if (!REVIEW_STAGES.includes(stageId as typeof REVIEW_STAGES[number])) {
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
      const latestConceptText = getLatestConceptText(report.conceptReportVersions as Record<string, any>);

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

      // Persist proposal decisions to substepResults for historical viewing
      if (filteredChanges) {
        const currentSubstepResults = (report.substepResults as Record<string, any>) || {};
        await storage.updateReport(reportId, {
          substepResults: {
            ...currentSubstepResults,
            [stageId]: {
              ...currentSubstepResults[stageId],
              processedAt: new Date().toISOString(),
              proposalDecisions: feedbackJSON
            }
          }
        });
        console.log(`💾 [${reportId}-${stageId}] Saved proposal decisions to substepResults`);
      }

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

  /**
   * POST /api/reports/restore-client-names
   * Restore client names from dossier_context_summary for all reports
   * Must be defined BEFORE /api/reports/:id to avoid route conflict
   */
  app.post("/api/reports/restore-client-names", asyncHandler(async (req: Request, res: Response) => {
    console.log('🔧 Starting client name restoration...');
    const result = await storage.restoreClientNamesFromContext();
    console.log(`🔧 Restoration complete:`, result);
    res.json(createApiSuccessResponse(result, `Client names restored: ${result.updated} updated, ${result.failed} failed/skipped`));
  }));

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

    console.log(`🚀 [${id}] Express Mode started`, { includeGeneration: validatedData.includeGeneration });

    const expressStartTime = Date.now();

    // Get report
    let report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // Check prerequisites based on mode
    const conceptVersions = (report.conceptReportVersions as Record<string, any>) || {};
    const stageResultsData = (report.stageResults as Record<string, any>) || {};

    if (validatedData.includeGeneration) {
      // For includeGeneration mode, we need stage 2 (complexiteitscheck) completed
      const hasStage2 = !!stageResultsData['2_complexiteitscheck'];
      if (!hasStage2) {
        throw ServerError.business(
          ERROR_CODES.VALIDATION_FAILED,
          'Stage 2 (Complexiteitscheck) moet eerst voltooid zijn voordat Express Mode met Generatie kan worden gebruikt'
        );
      }
    } else {
      // Standard mode: need stage 3 completed
      const hasStage3 =
        conceptVersions['3_generatie'] ||
        conceptVersions['latest'] ||
        report.generatedContent ||
        (stageResultsData['3_generatie']?.conceptReport);

      if (!hasStage3) {
        console.log(`❌ [${id}] Express Mode validation failed: No stage 3 concept found`, {
          hasConceptVersions: !!report.conceptReportVersions,
          conceptVersionKeys: Object.keys(conceptVersions),
          hasGeneratedContent: !!report.generatedContent,
          generatedContentLength: report.generatedContent?.toString().length,
          hasStageResults: !!report.stageResults,
          stageResultKeys: Object.keys(stageResultsData),
          has3generatie: !!stageResultsData['3_generatie'],
          has3generatieConceptReport: !!stageResultsData['3_generatie']?.conceptReport
        });
        throw ServerError.business(
          ERROR_CODES.VALIDATION_FAILED,
          'Stage 3 (Generatie) moet eerst voltooid zijn voordat Express Mode kan worden gebruikt'
        );
      }
    }

    // Build stages list
    let stages: string[] = [];

    if (validatedData.includeGeneration) {
      // Include generation stage first
      stages.push('3_generatie');
    }

    // Add review stages
    const reviewStages = validatedData.stages || [
      '4a_BronnenSpecialist',
      '4b_FiscaalTechnischSpecialist',
      '4c_ScenarioGatenAnalist',
      '4e_DeAdvocaat',
      '4f_HoofdCommunicatie'
    ];
    stages = stages.concat(reviewStages);

    // Import summarizer for change tracking
    const { summarizeFeedback } = await import('../utils/feedback-summarizer');

    // Track stage summaries for final report
    const stageSummaries: Array<{
      stageId: string;
      stageName: string;
      changesCount: number;
      changes: Array<{ type: string; description: string; severity: string; section?: string }>;
      processingTimeMs?: number;
    }> = [];

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
        const stageStartTime = Date.now();

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
          // Stage 3 (generatie) is different - it generates the report directly
          // Reviewer stages (4a-4f) generate feedback that needs to be processed
          const isGenerationStage = stageId === '3_generatie';

          if (isGenerationStage) {
            // Stage 3: Generate the concept report
            sendEvent({
              type: 'step_progress',
              stageId,
              substepId: 'generate',
              percentage: 50,
              message: `Generating concept report...`,
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

            // Update stageResults
            const updatedStageResults = {
              ...(report.stageResults as Record<string, string> || {}),
              [stageId]: stageExecution.stageOutput
            };

            // Store the generated report as first concept version
            const existingConceptVersions = (report.conceptReportVersions as Record<string, any>) || {};
            const timestamp = new Date().toISOString();
            const newConceptVersions = {
              ...existingConceptVersions,
              '3_generatie': {
                content: stageExecution.stageOutput,
                v: 1,
                timestamp,
                source: 'express_mode_generation'
              },
              latest: {
                pointer: '3_generatie',
                v: 1
              },
              history: [
                ...(existingConceptVersions.history || []),
                { stageId: '3_generatie', v: 1, timestamp }
              ]
            };

            await storage.updateReport(id, {
              stageResults: updatedStageResults,
              conceptReportVersions: newConceptVersions,
              generatedContent: stageExecution.stageOutput,
              currentStage: stageId as StageId
            });

            sendEvent({
              type: 'step_complete',
              stageId,
              substepId: 'generate',
              percentage: 100,
              message: `Concept report generated`,
              timestamp: new Date().toISOString()
            });

            // Refresh report for next iteration
            report = await storage.getReport(id) || report;

          } else {
            // Reviewer stages (4a-4f): Generate feedback then process it

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
              let latestConceptText = getLatestConceptText(report.conceptReportVersions as Record<string, any>);

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

              // Summarize feedback for this stage
              const stageSummary = summarizeFeedback(
                stageId,
                stageExecution.stageOutput,
                Date.now() - stageStartTime
              );
              stageSummaries.push(stageSummary);
            }
          }

          // Send stage complete event
          const stageProcessingTime = Date.now() - stageStartTime;
          sendEvent({
            type: 'stage_complete',
            stageId,
            stageNumber,
            totalStages,
            message: `${stageId} completed successfully`,
            processingTimeMs: stageProcessingTime,
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

      // Get final report state for summary
      const finalReport = await storage.getReport(id);
      const finalConceptVersions = (finalReport?.conceptReportVersions as Record<string, any>) || {};
      const latestPointer = finalConceptVersions.latest?.pointer;
      const finalVersion = finalConceptVersions.latest?.v || 1;
      const finalContent = latestPointer
        ? (finalConceptVersions[latestPointer]?.content || finalReport?.generatedContent || '')
        : (finalReport?.generatedContent || '');

      // Calculate totals
      const totalChanges = stageSummaries.reduce((sum, s) => sum + s.changesCount, 0);
      const totalProcessingTimeMs = Date.now() - expressStartTime;

      // Send summary event with all change data
      sendEvent({
        type: 'express_summary',
        stages: stageSummaries,
        totalChanges,
        finalVersion,
        totalProcessingTimeMs,
        finalContent,
        timestamp: new Date().toISOString()
      });

      // Send final complete event
      sendEvent({
        type: 'express_complete',
        message: 'Express Mode completed successfully',
        totalChanges,
        finalVersion,
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

  /**
   * POST /api/reports/:id/dossier-context
   * Generate or regenerate dossier context summary
   */
  app.post("/api/reports/:id/dossier-context", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { customPrompt } = req.body;

    console.log(`📋 [${id}] Generating dossier context summary`);

    // Get report
    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // Get raw text from dossier data - gracefully handle missing rawText for older reports
    const rawText = (report.dossierData as any)?.rawText || "";
    if (!rawText) {
      // Return empty summary instead of error for backwards compatibility
      return res.json({
        summary: "Geen ruwe tekst beschikbaar voor dit rapport. Dit is een ouder rapport zonder opgeslagen brondata.",
        generated: false
      });
    }

    // Get Stage 1 output (if available)
    const stage1Output = (report.stageResults as any)?.["1a_informatiecheck"] || "";

    // Build prompt template with placeholder replacement
    let promptTemplate = customPrompt || `Je bent een fiscaal assistent. Maak een compacte samenvatting van deze casus voor snelle referentie.

Geef alleen de essentie:
- Klant naam/type
- Kern van de vraag (1 zin)
- Belangrijkste bedragen/feiten
- Status (COMPLEET of INCOMPLEET + wat ontbreekt)

Gebruik bullet points. Max 150 woorden.

{stage1Output}RAW INPUT:
{rawText}`;

    // Replace placeholders
    const stage1Section = stage1Output ? `STAP 1 ANALYSE:\n${stage1Output}\n\n` : '';
    const finalPrompt = promptTemplate
      .replace('{stage1Output}', stage1Section)
      .replace('{rawText}', rawText);

    // Generate summary using reportGenerator
    let summary;
    try {
      summary = await reportGenerator.generateWithCustomPrompt({
        systemPrompt: "Je bent een fiscaal assistent die compacte samenvattingen maakt van klantcases.",
        userPrompt: finalPrompt,
        model: "gemini-3-pro-preview", // Gemini 3 Pro Preview
        customConfig: {
          provider: "google",
          temperature: 1.0, // Keep default for Gemini 3
          maxOutputTokens: 2000, // Plenty of room for thinking + summary (can optimize later)
          thinkingLevel: "low" // Fast thinking for simple summarization tasks
        },
        operationId: "dossier-context"
      });
    } catch (error: any) {
      console.error(`❌ [${id}] Dossier context generation failed:`, {
        error: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details
      });
      throw error; // Re-throw for proper error handling
    }

    // Save to database
    await storage.updateReport(id, {
      dossierContextSummary: summary,
      updatedAt: new Date()
    });

    console.log(`✅ [${id}] Dossier context generated (${summary.length} chars)`);

    res.json(createApiSuccessResponse({
      summary,
      reportId: id
    }));
  }));

  /**
   * POST /api/reports/:id/deep-research
   * Conduct automatic deep research with Gemini 3 Pro
   *
   * Body: {
   *   query: string,           // Research query
   *   maxQuestions?: number,   // Optional: number of sub-questions (default: 5)
   *   parallelExecutors?: number // Optional: parallel execution limit (default: 3)
   * }
   */
  app.post("/api/reports/:id/deep-research", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { query, maxQuestions, parallelExecutors } = req.body;

    if (!query || typeof query !== 'string') {
      throw ServerError.validation("Query is required", "Onderzoeksvraag is verplicht");
    }

    console.log(`🔬 [${id}] Starting deep research:`, { query, maxQuestions, parallelExecutors });

    // Get report (for context and validation)
    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // Set SSE headers for streaming progress updates
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendProgress = (stage: string, message: string, progress: number) => {
      res.write(`data: ${JSON.stringify({ stage, message, progress })}\n\n`);
    };

    try {
      sendProgress('planning', 'Initialiseren van deep research...', 0);

      // Call AIModelFactory with gemini-3-pro-deep-research
      const response = await AIModelFactory.getInstance().callModel(
        {
          provider: 'google',
          model: 'gemini-3-pro-deep-research',
          temperature: 1.0,
          maxOutputTokens: 32768,
          thinkingLevel: 'high',
          ...(maxQuestions && { maxQuestions }),
          ...(parallelExecutors && { parallelExecutors })
        },
        query,
        {
          useGrounding: true,
          timeout: 1800000, // 30 minutes
          jobId: `deep-research-${id}-${Date.now()}`
        }
      );

      sendProgress('complete', 'Deep research voltooid', 100);

      // Send final result
      res.write(`data: ${JSON.stringify({
        stage: 'result',
        report: response.content,
        metadata: response.metadata,
        duration: response.duration
      })}\n\n`);

      // Store research result in report (optional - add field to schema)
      // For now, we'll just return it without storing

      console.log(`✅ [${id}] Deep research completed`, {
        duration: response.duration,
        contentLength: response.content.length,
        metadata: response.metadata
      });

    } catch (error: any) {
      console.error(`❌ [${id}] Deep research failed:`, error);

      res.write(`data: ${JSON.stringify({
        stage: 'error',
        message: error.message || 'Deep research is mislukt',
        error: true
      })}\n\n`);
    } finally {
      res.end();
    }
  }));

  /**
   * POST /api/deep-research
   * Standalone deep research endpoint (not tied to a report)
   *
   * Body: {
   *   query: string,
   *   maxQuestions?: number,
   *   parallelExecutors?: number
   * }
   */
  app.post("/api/deep-research", asyncHandler(async (req: Request, res: Response) => {
    const { query, maxQuestions, parallelExecutors } = req.body;

    if (!query || typeof query !== 'string') {
      throw ServerError.validation("Query is required", "Onderzoeksvraag is verplicht");
    }

    console.log(`🔬 Starting standalone deep research:`, { query, maxQuestions, parallelExecutors });

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendProgress = (stage: string, message: string, progress: number) => {
      res.write(`data: ${JSON.stringify({ stage, message, progress })}\n\n`);
    };

    try {
      sendProgress('planning', 'Initialiseren van deep research...', 0);

      const response = await AIModelFactory.getInstance().callModel(
        {
          provider: 'google',
          model: 'gemini-3-pro-deep-research',
          temperature: 1.0,
          maxOutputTokens: 32768,
          thinkingLevel: 'high',
          ...(maxQuestions && { maxQuestions }),
          ...(parallelExecutors && { parallelExecutors })
        },
        query,
        {
          useGrounding: true,
          timeout: 1800000,
          jobId: `deep-research-${Date.now()}`
        }
      );

      sendProgress('complete', 'Deep research voltooid', 100);

      res.write(`data: ${JSON.stringify({
        stage: 'result',
        report: response.content,
        metadata: response.metadata,
        duration: response.duration
      })}\n\n`);

      console.log(`✅ Standalone deep research completed`, {
        duration: response.duration,
        contentLength: response.content.length
      });

    } catch (error: any) {
      console.error(`❌ Standalone deep research failed:`, error);

      res.write(`data: ${JSON.stringify({
        stage: 'error',
        message: error.message || 'Deep research is mislukt',
        error: true
      })}\n\n`);
    } finally {
      res.end();
    }
  }));

  // ============================================================
  // PDF EXPORT & PREVIEW
  // ============================================================

  /**
   * Preview report as HTML (for debugging/previewing before PDF export)
   * GET /api/reports/:id/preview-pdf
   *
   * Returns the HTML that would be used to generate the PDF.
   * Opens in browser for visual inspection.
   */
  app.get("/api/reports/:id/preview-pdf", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    const report = await storage.getReport(reportId);

    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    const { getHtmlPdfGenerator } = await import('../services/html-pdf-generator.js');
    const pdfGenerator = getHtmlPdfGenerator();

    try {
      const html = await pdfGenerator.generateHTMLPreview(report);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);

      console.log(`👁️ PDF preview generated for report ${reportId}`);

    } catch (error: any) {
      console.error(`❌ PDF preview failed for report ${reportId}:`, error);
      throw ServerError.internal(
        'PDF preview failed',
        error.message || 'Er is een fout opgetreden bij het genereren van de preview'
      );
    }
  }));

  /**
   * Export report as PDF
   * GET /api/reports/:id/export-pdf
   *
   * Generates a professionally formatted PDF document from the report content.
   * Uses HTML template with Playwright for pixel-perfect rendering.
   */
  app.get("/api/reports/:id/export-pdf", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    // Fetch the report
    const report = await storage.getReport(reportId);

    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    // Import and use HTML PDF generator
    const { getHtmlPdfGenerator } = await import('../services/html-pdf-generator.js');
    const pdfGenerator = getHtmlPdfGenerator();

    try {
      const pdfBuffer = await pdfGenerator.generatePDF(report);

      // Create safe filename
      const safeClientName = (report.clientName || 'rapport')
        .replace(/[^a-zA-Z0-9\-_\s]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50);

      const filename = `JDB-${report.dossierNumber || '00000'}-${safeClientName}.pdf`;

      // Set headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);

      res.send(pdfBuffer);

      console.log(`📄 PDF exported for report ${reportId}:`, {
        filename,
        size: pdfBuffer.length,
        clientName: report.clientName
      });

    } catch (error: any) {
      console.error(`❌ PDF generation failed for report ${reportId}:`, error);
      throw ServerError.internal(
        'PDF generation failed',
        error.message || 'Er is een fout opgetreden bij het genereren van de PDF'
      );
    }
  }));

  /**
   * Export report as Word document (.docx)
   * GET /api/reports/:id/export-docx
   *
   * Generates a Word document from the report content.
   * Uses the same HTML template as PDF for consistent styling.
   */
  app.get("/api/reports/:id/export-docx", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    // Fetch the report
    const report = await storage.getReport(reportId);

    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    // Import and use DOCX generator
    const { getDocxGenerator } = await import('../services/docx-generator.js');
    const docxGenerator = getDocxGenerator();

    try {
      const docxBuffer = await docxGenerator.generateDocx(report);
      const filename = docxGenerator.generateFilename(report);

      // Set headers for DOCX download
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', docxBuffer.length);

      res.send(docxBuffer);

      console.log(`📄 DOCX exported for report ${reportId}:`, {
        filename,
        size: docxBuffer.length,
        clientName: report.clientName
      });

    } catch (error: any) {
      console.error(`❌ DOCX generation failed for report ${reportId}:`, error);
      throw ServerError.internal(
        'DOCX generation failed',
        error.message || 'Er is een fout opgetreden bij het genereren van het Word document'
      );
    }
  }));

  /**
   * Get TipTap-formatted content for editor
   * GET /api/reports/:id/tiptap-content
   *
   * Converts markdown content to TipTap JSON format for the editor
   */
  app.get("/api/reports/:id/tiptap-content", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    const report = await storage.getReport(reportId);

    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    // If documentState already exists, return it
    if (report.documentState && Object.keys(report.documentState).length > 0) {
      return res.json(report.documentState);
    }

    // Get markdown content from conceptReportVersions
    const versions = report.conceptReportVersions as any;
    let markdownContent = '';

    if (versions?.latest?.pointer) {
      const latestSnapshot = versions[versions.latest.pointer];
      if (latestSnapshot?.content) {
        markdownContent = latestSnapshot.content;
      }
    }

    // Fallback to generatedContent
    if (!markdownContent && report.generatedContent) {
      markdownContent = report.generatedContent;
    }

    if (!markdownContent) {
      return res.json({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Geen content beschikbaar' }] }]
      });
    }

    // Import TextStyler and convert markdown to TipTap
    const { TextStyler } = await import('../services/text-styler.js');
    const reportGenerator = new ReportGenerator();
    const textStyler = new TextStyler(reportGenerator);

    const tipTapContent = textStyler.markdownToTipTap(markdownContent);

    res.json(tipTapContent);
  }));

  /**
   * Save document state (TipTap content)
   * PATCH /api/reports/:id/document-state
   *
   * Saves the TipTap editor content to the database
   */
  app.patch("/api/reports/:id/document-state", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;
    const { documentState } = req.body;

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    if (!documentState) {
      throw ServerError.validation('Document state is required', 'Document state is verplicht');
    }

    const report = await storage.getReport(reportId);

    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    // Update the report with new document state
    await storage.updateReport(reportId, {
      documentState: documentState
    });

    console.log(`📝 Document state saved for report ${reportId}`);

    res.json(createApiSuccessResponse({ success: true }));
  }));

  /**
   * PATCH /api/reports/:id/concept-content
   * Save manual edits to the concept report content
   *
   * This updates the conceptReportVersions with a new 'manual_edit' version
   * and updates the latest pointer to point to it.
   */
  app.patch("/api/reports/:id/concept-content", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;
    const { content } = req.body;

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    if (!content || typeof content !== 'string') {
      throw ServerError.validation('Content is required', 'Content is verplicht');
    }

    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    // Get current concept versions
    const existingVersions = (report.conceptReportVersions as Record<string, any>) || {};
    const currentLatest = existingVersions.latest;
    const nextVersion = (currentLatest?.v || 0) + 1;
    const timestamp = new Date().toISOString();

    // Create new manual edit version
    const stageId = `manual_edit_${nextVersion}`;
    const updatedVersions = {
      ...existingVersions,
      [stageId]: {
        content,
        v: nextVersion,
        timestamp,
        source: 'manual_edit'
      },
      latest: {
        pointer: stageId,
        v: nextVersion
      },
      history: [
        ...(existingVersions.history || []),
        { stageId, v: nextVersion, timestamp }
      ]
    };

    // Update the report
    await storage.updateReport(reportId, {
      conceptReportVersions: updatedVersions,
      generatedContent: content // Also update legacy field for compatibility
    });

    console.log(`📝 Manual concept edit saved for report ${reportId} (v${nextVersion})`);

    res.json(createApiSuccessResponse({
      success: true,
      version: nextVersion,
      stageId
    }));
  }));

  // ============================================================
  // RAPPORT AANPASSEN (POST-WORKFLOW ADJUSTMENTS)
  // ============================================================

  /**
   * POST /api/reports/:id/adjust
   * Generate an adjustment proposal based on user instruction
   *
   * This does NOT commit the change - it returns a proposed version
   * that the user can preview (with diff) and then accept or reject.
   */
  app.post("/api/reports/:id/adjust", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId } = req.params;

    console.log(`✏️ [${reportId}] Adjustment requested`);

    // Validate request
    const validatedData = adjustReportRequestSchema.parse(req.body);
    const { instruction } = validatedData;

    // Get report
    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // Get the latest concept report content
    const previousContent = getLatestConceptText(report.conceptReportVersions as Record<string, any>);

    if (!previousContent) {
      throw ServerError.business(
        ERROR_CODES.VALIDATION_FAILED,
        'Geen concept rapport gevonden om aan te passen. Voer eerst de generatie stap uit.'
      );
    }

    // Count existing adjustments to generate unique ID
    const conceptVersions = (report.conceptReportVersions as Record<string, any>) || {};
    const existingAdjustments = Object.keys(conceptVersions).filter(k => k.startsWith('adjustment_'));
    const adjustmentNumber = existingAdjustments.length + 1;
    const adjustmentId = `adjustment_${adjustmentNumber}`;

    // Get adjustment prompt from config - NO FALLBACK, must be configured
    const activeConfig = await storage.getActivePromptConfig();

    // Debug: log what we got from config
    console.log(`🔍 [${reportId}] Active config ID: ${activeConfig?.id}`);
    console.log(`🔍 [${reportId}] Config keys:`, activeConfig?.config ? Object.keys(activeConfig.config as object) : 'no config');

    const adjustmentConfig = (activeConfig?.config as PromptConfig)?.adjustment;

    // Debug: log adjustment config
    console.log(`🔍 [${reportId}] Adjustment config exists: ${!!adjustmentConfig}`);
    console.log(`🔍 [${reportId}] Adjustment prompt length: ${adjustmentConfig?.prompt?.length || 0}`);

    // Require prompt to be configured - no defaults
    if (!adjustmentConfig?.prompt || adjustmentConfig.prompt.trim().length === 0) {
      throw ServerError.business(
        ERROR_CODES.VALIDATION_FAILED,
        'Adjustment prompt niet geconfigureerd. Ga naar Instellingen → Rapport Aanpassen en vul de prompt in.'
      );
    }

    // Replace placeholders in prompt
    const adjustmentPrompt = adjustmentConfig.prompt
      .replace(/{HUIDIGE_RAPPORT}/g, previousContent)
      .replace(/{INSTRUCTIE}/g, instruction);

    console.log(`📝 [${reportId}] Adjustment prompt loaded from config (${adjustmentConfig.prompt.length} chars)`);

    // Get AI config via AIConfigResolver - GEEN hardcoded defaults
    const configResolver = new AIConfigResolver();
    const aiConfig = configResolver.resolveForStage(
      'adjustment',
      adjustmentConfig ? { aiConfig: adjustmentConfig.aiConfig } : undefined,
      { aiConfig: (activeConfig?.config as PromptConfig)?.aiConfig },
      `adjust-${reportId}`
    );

    console.log(`📝 [${reportId}] Using AI config from database:`, aiConfig.provider, aiConfig.model);

    // Call AI to generate JSON adjustments (like reviewers)
    const aiFactory = AIModelFactory.getInstance();
    const response = await aiFactory.callModel(
      aiConfig,
      adjustmentPrompt,
      {
        timeout: 300000, // 5 minutes
        jobId: `adjust-${reportId}-${adjustmentNumber}`
      }
    );

    // Parse JSON response from AI (same as external-report-routes)
    let adjustments: Array<{ context: string; oud: string; nieuw: string; reden: string }> = [];
    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      let jsonStr = response.content;
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);
      adjustments = parsed.aanpassingen || parsed.adjustments || [];

      // Add IDs to each adjustment
      adjustments = adjustments.map((adj, idx) => ({
        id: `adj-${reportId}-${adjustmentNumber}-${idx}`,
        ...adj
      }));
    } catch (parseError) {
      console.error(`❌ [${reportId}] Failed to parse AI response as JSON:`, parseError);
      console.error(`❌ [${reportId}] Raw AI response:`, response.content.substring(0, 500));
      // Return empty adjustments with debug info so user can see what went wrong
      res.json(createApiSuccessResponse({
        success: true,
        adjustmentId,
        adjustments: [],
        previousContent,
        metadata: {
          version: adjustmentNumber,
          instruction,
          createdAt: new Date().toISOString()
        },
        _debug: {
          promptUsed: adjustmentPrompt,
          promptLength: adjustmentPrompt.length,
          aiConfig,
          stage: "adjustment",
          parseError: String(parseError),
          rawResponse: response.content.substring(0, 2000) // First 2000 chars of raw response
        }
      }, 'AI response kon niet worden geparsed als JSON - bekijk Developer Tools voor details'));
      return;
    }

    console.log(`✅ [${reportId}] Adjustment analysis complete: ${adjustments.length} adjustments proposed`);

    // Return JSON adjustments for review (NOT committed yet)
    res.json(createApiSuccessResponse({
      success: true,
      adjustmentId,
      adjustments,
      previousContent,
      metadata: {
        version: adjustmentNumber,
        instruction,
        createdAt: new Date().toISOString()
      },
      // Debug info: include prompt details
      _debug: {
        promptUsed: adjustmentPrompt,
        promptLength: adjustmentPrompt.length,
        aiConfig,
        stage: "adjustment"
      }
    }, `${adjustments.length} aanpassingen gevonden - beoordeel en pas toe`));
  }));

  /**
   * POST /api/reports/:id/adjust/apply
   * Step 2: Apply accepted adjustments using Editor prompt (Chirurgische Redacteur)
   *
   * This takes the reviewed adjustments and uses the Editor to apply them to the report.
   */
  app.post("/api/reports/:id/adjust/apply", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId } = req.params;

    console.log(`✏️ [${reportId}] Applying adjustments`);

    // Validate request - expect adjustments array and instruction
    const { adjustments, instruction, adjustmentId } = req.body;

    if (!adjustments || !Array.isArray(adjustments) || adjustments.length === 0) {
      throw ServerError.business(
        ERROR_CODES.VALIDATION_FAILED,
        'Geen aanpassingen om toe te passen. Selecteer minimaal één aanpassing.'
      );
    }

    // Get report
    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // Get the latest concept report content
    const currentContent = getLatestConceptText(report.conceptReportVersions as Record<string, any>);
    if (!currentContent) {
      throw ServerError.business(
        ERROR_CODES.VALIDATION_FAILED,
        'Geen concept rapport gevonden om aan te passen.'
      );
    }

    // Get editor prompt from config (Chirurgische Redacteur)
    const activeConfig = await storage.getActivePromptConfig();
    const editorConfig = (activeConfig?.config as PromptConfig)?.editor;

    if (!editorConfig?.prompt || editorConfig.prompt.trim().length === 0) {
      throw ServerError.business(
        ERROR_CODES.VALIDATION_FAILED,
        'Editor (Chirurgische Redacteur) prompt niet geconfigureerd. Ga naar Instellingen en vul de "Editor" prompt in.'
      );
    }

    // Format adjustments for the editor prompt (same format as reviewer feedback)
    const adjustmentsText = adjustments.map((adj: { context: string; oud: string; nieuw: string; reden: string }, idx: number) =>
      `${idx + 1}. [${adj.context}]\n   OUD: "${adj.oud}"\n   NIEUW: "${adj.nieuw}"\n   REDEN: ${adj.reden}`
    ).join('\n\n');

    // Replace placeholders (editor prompt uses these placeholders)
    const editorPrompt = editorConfig.prompt
      .replace(/{HUIDIGE_RAPPORT}/g, currentContent)
      .replace(/{CONCEPT_RAPPORT}/g, currentContent)
      .replace(/{AANPASSINGEN}/g, adjustmentsText)
      .replace(/{FEEDBACK}/g, adjustmentsText)
      .replace(/{AANTAL_AANPASSINGEN}/g, String(adjustments.length));

    // Get AI config via AIConfigResolver - GEEN hardcoded defaults
    const editorConfigResolver = new AIConfigResolver();
    const aiConfig = editorConfigResolver.resolveForStage(
      'editor',
      editorConfig ? { aiConfig: editorConfig.aiConfig } : undefined,
      { aiConfig: (activeConfig?.config as PromptConfig)?.aiConfig },
      `apply-${reportId}`
    );

    console.log(`✏️ [${reportId}] Applying ${adjustments.length} adjustments with ${aiConfig.provider}/${aiConfig.model}`);

    // Call AI (Editor)
    const aiFactory = AIModelFactory.getInstance();
    const response = await aiFactory.callModel(
      aiConfig,
      editorPrompt,
      {
        timeout: 300000, // 5 minutes
        jobId: `adjust-apply-${reportId}`
      }
    );

    const newContent = response.content;

    // Create snapshot for the adjustment
    const snapshot = await reportProcessor.createSnapshot(
      reportId,
      adjustmentId as StageId,
      newContent
    );

    // Update concept versions with the new adjustment
    const updatedVersions = await reportProcessor.updateConceptVersions(
      reportId,
      adjustmentId as StageId,
      snapshot
    );

    // Update report with new version and content
    await storage.updateReport(reportId, {
      conceptReportVersions: updatedVersions,
      generatedContent: newContent, // Update preview content
      updatedAt: new Date()
    });

    console.log(`✅ [${reportId}] Applied ${adjustments.length} adjustments - v${snapshot.v}`);

    res.json(createApiSuccessResponse({
      success: true,
      newContent,
      appliedCount: adjustments.length,
      newVersion: snapshot.v,
      stageId: adjustmentId,
      // Debug info
      _debug: {
        promptUsed: editorPrompt,
        promptLength: editorPrompt.length,
        aiConfig,
        stage: "editor"
      }
    }, `${adjustments.length} aanpassingen toegepast - nieuwe versie ${snapshot.v}`));
  }));

  /**
   * POST /api/reports/:id/adjust/accept
   * LEGACY: Accept a previously generated adjustment proposal (direct content)
   *
   * Kept for backwards compatibility. New flow uses /adjust/apply instead.
   */
  app.post("/api/reports/:id/adjust/accept", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId } = req.params;

    console.log(`✅ [${reportId}] Accepting adjustment (legacy)`);

    // Validate request
    const validatedData = acceptAdjustmentRequestSchema.parse(req.body);
    const { adjustmentId, proposedContent, instruction } = validatedData;

    // Get report
    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // Create snapshot for the adjustment
    const snapshot = await reportProcessor.createSnapshot(
      reportId,
      adjustmentId as StageId,
      proposedContent
    );

    // Update concept versions with the new adjustment
    const updatedVersions = await reportProcessor.updateConceptVersions(
      reportId,
      adjustmentId as StageId,
      snapshot
    );

    // Update report with new version and content
    await storage.updateReport(reportId, {
      conceptReportVersions: updatedVersions,
      generatedContent: proposedContent, // Update preview content
      updatedAt: new Date()
    });

    console.log(`✅ [${reportId}] Adjustment ${adjustmentId} accepted - v${snapshot.v}`);

    res.json(createApiSuccessResponse({
      success: true,
      newVersion: snapshot.v,
      stageId: adjustmentId,
      message: `Aanpassing succesvol toegepast - nieuwe versie ${snapshot.v}`
    }, 'Aanpassing geaccepteerd'));
  }));

  // ==========================================
  // DOSSIER EXPORT/IMPORT (Dev/Prod Sync)
  // ==========================================

  /**
   * Export complete dossier as JSON
   * GET /api/reports/:id/export-json
   *
   * Exports the complete report with all stage results, concept versions,
   * and optionally attachments for importing into another environment.
   *
   * Query params:
   * - includeAttachments: boolean (default: true) - Include base64 file data
   */
  app.get("/api/reports/:id/export-json", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;
    const includeAttachments = req.query.includeAttachments !== 'false';

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    // Fetch the report
    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    // Fetch attachments if requested
    let reportAttachments: any[] = [];
    if (includeAttachments) {
      reportAttachments = await storage.getAttachmentsForReport(reportId);
    }

    // Build export object - exclude id and dossierNumber (will be regenerated on import)
    const { id, dossierNumber, createdAt, updatedAt, ...reportData } = report;

    const exportData = {
      _exportMeta: {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        originalId: id,
        originalDossierNumber: dossierNumber,
        source: process.env.NODE_ENV || 'development'
      },
      report: reportData,
      attachments: reportAttachments.map(att => {
        const { id: attId, reportId: attReportId, uploadedAt, ...attData } = att;
        return attData;
      })
    };

    // Set headers for JSON download
    const safeClientName = report.clientName.replace(/[^a-zA-Z0-9]/g, '-');
    const filename = `dossier-D${String(dossierNumber).padStart(4, '0')}-${safeClientName}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    console.log(`📦 Dossier exported: ${filename} (${includeAttachments ? 'with' : 'without'} attachments)`);

    res.json(exportData);
  }));

  /**
   * Import dossier from JSON
   * POST /api/reports/import-json
   *
   * Imports a previously exported dossier, creating a new report
   * with a new ID and dossier number.
   *
   * Body: The exported JSON object from export-json endpoint
   */
  app.post("/api/reports/import-json", asyncHandler(async (req: Request, res: Response) => {
    const importData = req.body;

    // Validate import structure
    if (!importData?._exportMeta || !importData?.report) {
      throw ServerError.validation(
        'Invalid import format',
        'Ongeldig import formaat. Gebruik een JSON bestand geëxporteerd via /export-json'
      );
    }

    const { _exportMeta, report: reportData, attachments = [] } = importData;

    console.log(`📥 Importing dossier from ${_exportMeta.source || 'unknown'} (original: D-${String(_exportMeta.originalDossierNumber || 0).padStart(4, '0')})`);

    // Create the report (new id and dossierNumber will be generated)
    const newReport = await storage.createReport({
      title: reportData.title?.replace(/^D-\d{4}\s*-\s*/, '') || reportData.clientName, // Strip old dossier prefix
      clientName: reportData.clientName,
      dossierData: reportData.dossierData,
      bouwplanData: reportData.bouwplanData,
      generatedContent: reportData.generatedContent,
      stageResults: reportData.stageResults,
      conceptReportVersions: reportData.conceptReportVersions,
      substepResults: reportData.substepResults,
      stagePrompts: reportData.stagePrompts,
      documentState: reportData.documentState,
      pendingChanges: reportData.pendingChanges,
      documentSnapshots: reportData.documentSnapshots,
      dossierContextSummary: reportData.dossierContextSummary,
      currentStage: reportData.currentStage,
      status: reportData.status
    });

    console.log(`✅ Report imported: ${newReport.id} (D-${String(newReport.dossierNumber).padStart(4, '0')})`);

    // Import attachments if present
    let importedAttachments = 0;
    for (const att of attachments) {
      try {
        await storage.createAttachment({
          reportId: newReport.id,
          filename: att.filename,
          mimeType: att.mimeType,
          fileSize: att.fileSize,
          pageCount: att.pageCount,
          fileData: att.fileData,
          extractedText: att.extractedText,
          needsVisionOCR: att.needsVisionOCR,
          usedInStages: att.usedInStages || []
        });
        importedAttachments++;
      } catch (attError) {
        console.warn(`⚠️ Failed to import attachment ${att.filename}:`, attError);
      }
    }

    if (importedAttachments > 0) {
      console.log(`📎 Imported ${importedAttachments} attachment(s)`);
    }

    res.json(createApiSuccessResponse({
      id: newReport.id,
      dossierNumber: newReport.dossierNumber,
      title: newReport.title,
      importedFrom: {
        originalId: _exportMeta.originalId,
        originalDossierNumber: _exportMeta.originalDossierNumber,
        source: _exportMeta.source,
        exportedAt: _exportMeta.exportedAt
      },
      attachmentsImported: importedAttachments
    }, `Dossier geïmporteerd als D-${String(newReport.dossierNumber).padStart(4, '0')}`));
  }));
}
