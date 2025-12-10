/**
 * Feedback Processing Routes
 *
 * Handles feedback preview and processing for review stages.
 */

import type { Request, Response, Express } from "express";
import { storage } from "../../storage";
import type { PromptConfig, StageId } from "@shared/schema";
import { REVIEW_STAGES, getLatestConceptText } from "@shared/constants";
import { processFeedbackRequestSchema } from "@shared/types/api";
import { PromptBuilder } from "../../services/prompt-builder";
import { asyncHandler, getErrorMessage, isErrorWithMessage } from "../../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
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

    console.log(`[${reportId}-${stageId}] Prompt preview requested`);

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
      console.error(`[${reportId}-${stageId}] Prompt preview failed:`, error);
      console.error(`Error details:`, {
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

  // ============================================================
  // FEEDBACK PROCESSING
  // ============================================================

  /**
   * Manual feedback processing - user-controlled feedback selection and processing
   * POST /api/reports/:id/stage/:stageId/process-feedback
   */
  app.post("/api/reports/:id/stage/:stageId/process-feedback", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId, stageId } = req.params;

    console.log(`[${reportId}-${stageId}] Manual feedback processing requested`);

    const validatedData = processFeedbackRequestSchema.parse(req.body);
    const { userInstructions, processingStrategy, filteredChanges } = validatedData;

    const report = await storage.getReport(reportId);
    if (!report) {
      return res.status(404).json(createApiErrorResponse(
        'REPORT_NOT_FOUND',
        'VALIDATION_FAILED',
        'Rapport niet gevonden',
        'Het rapport kon niet worden gevonden voor feedback processing'
      ));
    }

    if (!REVIEW_STAGES.includes(stageId as typeof REVIEW_STAGES[number])) {
      return res.status(400).json(createApiErrorResponse(
        'INVALID_STAGE',
        'VALIDATION_FAILED',
        'Ongeldige stap voor feedback processing',
        `Stage ${stageId} ondersteunt geen feedback processing`
      ));
    }

    try {
      let feedbackJSON;

      if (filteredChanges) {
        console.log(`[${reportId}-${stageId}] Using filtered changes from client`);
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
        console.log(`[${reportId}-${stageId}] Using raw feedback from stageResults (legacy mode)`);
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

        try {
          feedbackJSON = JSON.parse(rawFeedback);
        } catch (e) {
          feedbackJSON = rawFeedback;
        }
      }

      const latestConceptText = getLatestConceptText(report.conceptReportVersions as Record<string, any>);

      if (!latestConceptText) {
        return res.status(400).json(createApiErrorResponse(
          'NO_CONCEPT_FOUND',
          'VALIDATION_FAILED',
          'Geen concept rapport gevonden',
          'Er is geen concept rapport beschikbaar om feedback op te verwerken'
        ));
      }

      const activeConfig = await storage.getActivePromptConfig();
      if (!activeConfig || !activeConfig.config) {
        return res.status(400).json(createApiErrorResponse(
          'NO_EDITOR_CONFIG',
          'INTERNAL_SERVER_ERROR',
          'Editor configuratie ontbreekt',
          'Er is geen actieve Editor prompt configuratie gevonden'
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

      console.log(`[${reportId}-${stageId}] Feedback processing completed using Editor prompt - v${processingResult.snapshot.v}`);

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
        console.log(`[${reportId}-${stageId}] Saved proposal decisions to substepResults`);
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
      console.error(`[${reportId}-${stageId}] Simple feedback processing failed:`, error);

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
}
