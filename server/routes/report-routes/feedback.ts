/**
 * Feedback Processing Routes
 *
 * ## Wat doet deze module?
 *
 * Verwerkt feedback van reviewer stages (4a-4f) en past deze toe op het rapport.
 *
 * ## Data Flow (BELANGRIJK om te begrijpen!)
 *
 * ```
 * 1. Reviewer stage (4a-4f) draait
 *    ↓
 *    Output: stageResults[stageId] = { review: "...", changeProposals: [...] }
 *
 * 2. User klikt "Process Feedback" in UI
 *    ↓
 *    POST /api/reports/:id/stage/:stageId/process-feedback
 *
 * 3. Deze route haalt op:
 *    - rawFeedback: stageResults[stageId] (reviewer output)
 *    - conceptReport: getLatestConceptText(conceptReportVersions)
 *
 * 4. Roept "editor" stage aan (NIET een reviewer!)
 *    ↓
 *    reportGenerator.executeStage('editor', ...)
 *
 * 5. Editor stage past feedback toe
 *    ↓
 *    Output: Gewijzigd rapport
 *
 * 6. Sla nieuwe versie op
 *    ↓
 *    conceptReportVersions[stageId] = { v: N+1, content: "...", from: "..." }
 * ```
 *
 * ## Waarom "editor" stage?
 *
 * De "editor" is een speciale helper stage die:
 * - Feedback van reviewers ontvangt
 * - Het concept rapport aanpast
 * - NIET in STAGE_ORDER staat (het is geen workflow stage)
 *
 * @see docs/STAGES.md voor uitgebreide uitleg
 */

import type { Request, Response, Express } from "express";
import { storage } from "../../storage";
import type { PromptConfig, StageId } from "@shared/schema";
import { REVIEW_STAGES, getLatestConceptText } from "@shared/constants";
import { processFeedbackRequestSchema } from "@shared/types/api";
import { PromptBuilder } from "../../services/prompt-builder";
import { asyncHandler, getErrorMessage, isErrorWithMessage } from "../../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { HTTP_STATUS } from "../../config/constants";
import { logger } from "../../services/logger";
import type { ReportRouteDependencies } from "./types";

export function registerFeedbackRoutes(
  app: Express,
  dependencies: ReportRouteDependencies
): void {
  const { reportProcessor, sseHandler } = dependencies;

  // ============================================================
  // PROMPT PREVIEW
  // ============================================================

  /**
   * Preview the exact prompt that would be sent for feedback processing
   * POST /api/reports/:id/stage/:stageId/prompt-preview
   */
  app.post("/api/reports/:id/stage/:stageId/prompt-preview", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId, stageId } = req.params;
    const { userInstructions = "Pas alle feedback toe om het concept rapport te verbeteren. Neem alle suggesties over die de kwaliteit, accuratesse en leesbaarheid van het rapport verbeteren." } = req.body;

    logger.info(`${reportId}-${stageId}`, 'Prompt preview requested');

    const report = await storage.getReport(reportId);
    if (!report) {
      res.status(HTTP_STATUS.NOT_FOUND).json(createApiErrorResponse(
        'NotFound',
        ERROR_CODES.REPORT_NOT_FOUND,
        'Report not found',
        'Het rapport kon niet worden gevonden voor prompt preview'
      ));
      return;
    }

    if (!REVIEW_STAGES.includes(stageId as typeof REVIEW_STAGES[number])) {
      res.status(HTTP_STATUS.BAD_REQUEST).json(createApiErrorResponse(
        'ValidationError',
        ERROR_CODES.VALIDATION_FAILED,
        `Stage ${stageId} does not support prompt preview`,
        'Ongeldige stap voor prompt preview'
      ));
      return;
    }

    try {
      const stageResults = (report.stageResults as Record<string, string>) || {};
      const rawFeedback = stageResults[stageId];

      if (!rawFeedback) {
        res.status(HTTP_STATUS.BAD_REQUEST).json(createApiErrorResponse(
          'ValidationError',
          ERROR_CODES.VALIDATION_FAILED,
          `No feedback available for stage ${stageId}`,
          'Geen feedback gevonden'
        ));
        return;
      }

      const latestConceptText = getLatestConceptText(report.conceptReportVersions as Record<string, any>);

      if (!latestConceptText) {
        res.status(HTTP_STATUS.BAD_REQUEST).json(createApiErrorResponse(
          'ValidationError',
          ERROR_CODES.VALIDATION_FAILED,
          'No concept report available',
          'Geen concept rapport gevonden'
        ));
        return;
      }

      const activeConfig = await storage.getActivePromptConfig();
      if (!activeConfig || !activeConfig.config) {
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(createApiErrorResponse(
          'ConfigurationError',
          ERROR_CODES.INTERNAL_SERVER_ERROR,
          'Editor configuration missing',
          'Editor configuratie ontbreekt'
        ));
        return;
      }

      const parsedConfig = activeConfig.config as PromptConfig;
      const editorPromptConfig = parsedConfig.editor || (parsedConfig as any)['5_feedback_verwerker'];

      let feedbackJSON;
      try {
        feedbackJSON = JSON.parse(rawFeedback);
      } catch (e) {
        feedbackJSON = rawFeedback;
      }

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
      logger.error(`${reportId}-${stageId}`, 'Prompt preview failed', {
        message: getErrorMessage(error),
        stack: isErrorWithMessage(error) ? error.stack : undefined,
        name: isErrorWithMessage(error) ? error.name : 'Unknown'
      }, error instanceof Error ? error : undefined);

      res.status(HTTP_STATUS.INTERNAL_ERROR).json(createApiErrorResponse(
        'PreviewError',
        ERROR_CODES.INTERNAL_SERVER_ERROR,
        getErrorMessage(error) || 'Unknown error during prompt preview',
        'Prompt preview gefaald'
      ));
    }
  }));

  // ============================================================
  // FEEDBACK PROCESSING
  // ============================================================

  /**
   * Manual feedback processing - user-controlled feedback selection and processing
   * POST /api/reports/:id/stage/:stageId/process-feedback
   */
  app.post("/api/reports/:id/stage/:stageId/process-feedback", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId, stageId } = req.params;

    logger.info(`${reportId}-${stageId}`, 'Manual feedback processing requested');

    const validatedData = processFeedbackRequestSchema.parse(req.body);
    const { userInstructions, processingStrategy, filteredChanges } = validatedData;

    const report = await storage.getReport(reportId);
    if (!report) {
      return res.status(HTTP_STATUS.NOT_FOUND).json(createApiErrorResponse(
        'NotFound',
        ERROR_CODES.REPORT_NOT_FOUND,
        'Report not found',
        'Het rapport kon niet worden gevonden voor feedback processing'
      ));
    }

    if (!REVIEW_STAGES.includes(stageId as typeof REVIEW_STAGES[number])) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json(createApiErrorResponse(
        'ValidationError',
        ERROR_CODES.VALIDATION_FAILED,
        `Stage ${stageId} does not support feedback processing`,
        'Ongeldige stap voor feedback processing'
      ));
    }

    try {
      let feedbackJSON;

      if (filteredChanges) {
        logger.info(`${reportId}-${stageId}`, 'Using filtered changes from client');
        try {
          feedbackJSON = JSON.parse(filteredChanges);
        } catch (e) {
          return res.status(HTTP_STATUS.BAD_REQUEST).json(createApiErrorResponse(
            'ValidationError',
            ERROR_CODES.VALIDATION_FAILED,
            'Invalid filtered changes JSON',
            'Ongeldige filtered changes JSON'
          ));
        }
      } else {
        logger.info(`${reportId}-${stageId}`, 'Using raw feedback from stageResults (legacy mode)');
        const stageResults = (report.stageResults as Record<string, string>) || {};
        const rawFeedback = stageResults[stageId];

        if (!rawFeedback) {
          return res.status(HTTP_STATUS.BAD_REQUEST).json(createApiErrorResponse(
            'ValidationError',
            ERROR_CODES.VALIDATION_FAILED,
            `No feedback available for stage ${stageId}`,
            'Geen feedback gevonden'
          ));
        }

        try {
          feedbackJSON = JSON.parse(rawFeedback);
        } catch (e) {
          feedbackJSON = rawFeedback;
        }
      }

      const latestConceptText = getLatestConceptText(report.conceptReportVersions as Record<string, any>);

      if (!latestConceptText) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(createApiErrorResponse(
          'ValidationError',
          ERROR_CODES.VALIDATION_FAILED,
          'No concept report available',
          'Geen concept rapport gevonden'
        ));
      }

      const activeConfig = await storage.getActivePromptConfig();
      if (!activeConfig || !activeConfig.config) {
        return res.status(HTTP_STATUS.INTERNAL_ERROR).json(createApiErrorResponse(
          'ConfigurationError',
          ERROR_CODES.INTERNAL_SERVER_ERROR,
          'Editor configuration missing',
          'Editor configuratie ontbreekt'
        ));
      }

      const parsedConfig = activeConfig.config as PromptConfig;
      const editorPromptConfig = parsedConfig.editor || (parsedConfig as any)['5_feedback_verwerker'];

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

      const processingResult = await reportProcessor.processStageWithPrompt(
        reportId,
        stageId as StageId,
        combinedPrompt,
        feedbackJSON
      );

      logger.info(`${reportId}-${stageId}`, 'Feedback processing completed using Editor prompt', { version: processingResult.snapshot.v });

      // Persist proposal decisions to substepResults
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
        logger.info(`${reportId}-${stageId}`, 'Saved proposal decisions to substepResults');
      }

      // Emit SSE event
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

      return res.json(createApiSuccessResponse({
        success: true,
        newVersion: processingResult.snapshot.v,
        conceptContent: processingResult.newConcept,
        userInstructions: userInstructions,
        message: `Feedback succesvol verwerkt - nieuw concept v${processingResult.snapshot.v} gegenereerd`
      }, 'Feedback processing succesvol voltooid'));

    } catch (error: unknown) {
      logger.error(`${reportId}-${stageId}`, 'Feedback processing failed', {}, error instanceof Error ? error : undefined);

      sseHandler.broadcast(reportId, stageId, {
        type: 'step_error',
        stageId: stageId,
        substepId: 'manual_feedback_processing',
        percentage: 0,
        message: 'Feedback processing gefaald',
        data: { error: getErrorMessage(error) },
        timestamp: new Date().toISOString()
      });

      return res.status(HTTP_STATUS.INTERNAL_ERROR).json(createApiErrorResponse(
        'ProcessingError',
        ERROR_CODES.INTERNAL_SERVER_ERROR,
        getErrorMessage(error) || 'Unknown error during feedback processing',
        'Feedback processing gefaald'
      ));
    }
  }));
}
