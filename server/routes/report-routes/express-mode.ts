/**
 * Express Mode & Deep Research Routes
 *
 * Handles automated bulk stage execution and deep research functionality.
 */

import type { Request, Response, Express } from "express";
import { storage } from "../../storage";
import type { DossierData, BouwplanData, PromptConfig, StageId } from "@shared/schema";
import { getLatestConceptText } from "@shared/constants";
import { expressModeRequestSchema } from "@shared/types/api";
import { PromptBuilder } from "../../services/prompt-builder";
import { AIModelFactory } from "../../services/ai-models/ai-model-factory";
import { asyncHandler, ServerError } from "../../middleware/errorHandler";
import { ERROR_CODES } from "@shared/errors";
import type { ReportRouteDependencies } from "./types";

export function registerExpressModeRoutes(
  app: Express,
  dependencies: ReportRouteDependencies
): void {
  const { reportGenerator, reportProcessor } = dependencies;

  // ============================================================
  // EXPRESS MODE
  // ============================================================

  /**
   * Express Mode - Auto-run all review stages with auto-accept
   * POST /api/reports/:id/express-mode
   */
  app.post("/api/reports/:id/express-mode", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const validatedData = expressModeRequestSchema.parse(req.body);

    console.log(`[${id}] Express Mode started`, { includeGeneration: validatedData.includeGeneration });

    const expressStartTime = Date.now();

    let report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    const conceptVersions = (report.conceptReportVersions as Record<string, any>) || {};
    const stageResultsData = (report.stageResults as Record<string, any>) || {};

    if (validatedData.includeGeneration) {
      const hasStage2 = !!stageResultsData['2_complexiteitscheck'];
      if (!hasStage2) {
        throw ServerError.business(
          ERROR_CODES.VALIDATION_FAILED,
          'Stage 2 (Complexiteitscheck) moet eerst voltooid zijn voordat Express Mode met Generatie kan worden gebruikt'
        );
      }
    } else {
      const hasStage3 =
        conceptVersions['3_generatie'] ||
        conceptVersions['latest'] ||
        report.generatedContent ||
        (stageResultsData['3_generatie']?.conceptReport);

      if (!hasStage3) {
        console.log(`[${id}] Express Mode validation failed: No stage 3 concept found`, {
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

    let stages: string[] = [];

    if (validatedData.includeGeneration) {
      stages.push('3_generatie');
    }

    const reviewStages = validatedData.stages || [
      '4a_BronnenSpecialist',
      '4b_FiscaalTechnischSpecialist',
      '4c_ScenarioGatenAnalist',
      '4e_DeAdvocaat',
      '4f_HoofdCommunicatie'
    ];
    stages = stages.concat(reviewStages);

    const { summarizeFeedback } = await import('../../utils/feedback-summarizer');

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
      for (let i = 0; i < stages.length; i++) {
        const stageId = stages[i];
        const stageNumber = i + 1;
        const totalStages = stages.length;
        const stageStartTime = Date.now();

        sendEvent({
          type: 'stage_start',
          stageId,
          stageNumber,
          totalStages,
          message: `Starting ${stageId}...`,
          timestamp: new Date().toISOString()
        });

        try {
          const isGenerationStage = stageId === '3_generatie';

          if (isGenerationStage) {
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

            const updatedStageResults = {
              ...(report.stageResults as Record<string, string> || {}),
              [stageId]: stageExecution.stageOutput
            };

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

            report = await storage.getReport(id) || report;

          } else {
            // Reviewer stages
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

            if (validatedData.autoAccept) {
              sendEvent({
                type: 'step_progress',
                stageId,
                substepId: 'process_feedback',
                percentage: 75,
                message: `Auto-processing feedback for ${stageId}...`,
                timestamp: new Date().toISOString()
              });

              let feedbackJSON;
              try {
                feedbackJSON = JSON.parse(stageExecution.stageOutput);
              } catch (e) {
                feedbackJSON = stageExecution.stageOutput;
              }

              let latestConceptText = getLatestConceptText(report.conceptReportVersions as Record<string, any>);

              if (!latestConceptText && report.generatedContent) {
                latestConceptText = report.generatedContent.toString();
              }

              if (!latestConceptText) {
                throw new Error('No concept report found to process feedback');
              }

              const activeConfig = await storage.getActivePromptConfig();
              if (!activeConfig || !activeConfig.config) {
                throw new Error('No active Editor prompt configuration found');
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

              report = await storage.getReport(id) || report;

              const stageSummary = summarizeFeedback(
                stageId,
                stageExecution.stageOutput,
                Date.now() - stageStartTime
              );
              stageSummaries.push(stageSummary);
            }
          }

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
          console.error(`[${id}] Express Mode failed at ${stageId}:`, stageError);

          sendEvent({
            type: 'stage_error',
            stageId,
            error: stageError.message || 'Unknown error',
            canRetry: false,
            timestamp: new Date().toISOString()
          });

          break;
        }
      }

      const finalReport = await storage.getReport(id);
      const finalConceptVersions = (finalReport?.conceptReportVersions as Record<string, any>) || {};
      const latestPointer = finalConceptVersions.latest?.pointer;
      const finalVersion = finalConceptVersions.latest?.v || 1;
      const finalContent = latestPointer
        ? (finalConceptVersions[latestPointer]?.content || finalReport?.generatedContent || '')
        : (finalReport?.generatedContent || '');

      const totalChanges = stageSummaries.reduce((sum, s) => sum + s.changesCount, 0);
      const totalProcessingTimeMs = Date.now() - expressStartTime;

      // Generate Fiscale Briefing (Stage 7) - executive summary for fiscalist
      let fiscaleBriefing: string | null = null;
      try {
        sendEvent({
          type: 'stage_start',
          stageId: '7_fiscale_briefing',
          stageNumber: stages.length + 1,
          totalStages: stages.length + 1,
          message: 'Generating Fiscale Briefing...',
          timestamp: new Date().toISOString()
        });

        const briefingResult = await reportGenerator.generateFiscaleBriefing({
          dossier: finalReport?.dossierData as DossierData,
          bouwplan: finalReport?.bouwplanData as BouwplanData,
          conceptReport: finalContent,
          stageResults: finalReport?.stageResults as Record<string, string> || {},
          jobId: `${id}-briefing`
        });

        fiscaleBriefing = briefingResult.briefing;

        // Save briefing to stageResults
        const updatedStageResults = {
          ...(finalReport?.stageResults as Record<string, string> || {}),
          '7_fiscale_briefing': fiscaleBriefing
        };
        await storage.updateReport(id, { stageResults: updatedStageResults });

        sendEvent({
          type: 'stage_complete',
          stageId: '7_fiscale_briefing',
          stageNumber: stages.length + 1,
          totalStages: stages.length + 1,
          message: 'Fiscale Briefing generated',
          timestamp: new Date().toISOString()
        });

        console.log(`[${id}] Fiscale Briefing generated successfully`);
      } catch (briefingError: any) {
        console.error(`[${id}] Failed to generate Fiscale Briefing:`, briefingError.message);
        // Non-fatal - continue without briefing
        sendEvent({
          type: 'stage_error',
          stageId: '7_fiscale_briefing',
          error: briefingError.message || 'Briefing generation failed',
          canRetry: true,
          timestamp: new Date().toISOString()
        });
      }

      sendEvent({
        type: 'express_summary',
        stages: stageSummaries,
        totalChanges,
        finalVersion,
        totalProcessingTimeMs,
        finalContent,
        fiscaleBriefing, // Include briefing in summary
        timestamp: new Date().toISOString()
      });

      sendEvent({
        type: 'express_complete',
        message: 'Express Mode completed successfully',
        totalChanges,
        finalVersion,
        timestamp: new Date().toISOString()
      });

      res.end();

    } catch (error: any) {
      console.error(`[${id}] Express Mode failed:`, error);

      sendEvent({
        type: 'express_error',
        error: error.message || 'Unknown error',
        timestamp: new Date().toISOString()
      });

      res.end();
    }
  }));

  // ============================================================
  // FISCALE BRIEFING (STANDALONE)
  // ============================================================

  /**
   * Generate Fiscale Briefing standalone (Stage 7)
   * POST /api/reports/:id/fiscale-briefing
   */
  app.post("/api/reports/:id/fiscale-briefing", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    console.log(`[${id}] Generating Fiscale Briefing standalone`);

    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // Get the latest concept report content
    const conceptVersions = (report.conceptReportVersions as Record<string, any>) || {};
    const latestPointer = conceptVersions.latest?.pointer;
    const finalContent = latestPointer
      ? (conceptVersions[latestPointer]?.content || report.generatedContent || "")
      : (report.generatedContent || "");

    if (!finalContent) {
      throw ServerError.validation(
        "No report content available",
        "Er is geen rapport content beschikbaar. Genereer eerst een rapport."
      );
    }

    // Generate the briefing
    const briefingResult = await reportGenerator.generateFiscaleBriefing({
      dossier: report.dossierData as DossierData,
      bouwplan: report.bouwplanData as BouwplanData,
      conceptReport: finalContent,
      stageResults: report.stageResults as Record<string, string> || {},
      jobId: `${id}-briefing-standalone`
    });

    // Save briefing to stageResults
    const updatedStageResults = {
      ...(report.stageResults as Record<string, string> || {}),
      '7_fiscale_briefing': briefingResult.briefing
    };
    await storage.updateReport(id, { stageResults: updatedStageResults });

    console.log(`[${id}] Fiscale Briefing generated and saved`);

    res.json({
      success: true,
      briefing: briefingResult.briefing
    });
  }));

  // ============================================================
  // DEEP RESEARCH
  // ============================================================

  /**
   * Conduct automatic deep research with Gemini 3 Pro
   * POST /api/reports/:id/deep-research
   */
  app.post("/api/reports/:id/deep-research", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { query, maxQuestions, parallelExecutors } = req.body;

    if (!query || typeof query !== 'string') {
      throw ServerError.validation("Query is required", "Onderzoeksvraag is verplicht");
    }

    console.log(`[${id}] Starting deep research:`, { query, maxQuestions, parallelExecutors });

    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

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
          jobId: `deep-research-${id}-${Date.now()}`
        }
      );

      sendProgress('complete', 'Deep research voltooid', 100);

      res.write(`data: ${JSON.stringify({
        stage: 'result',
        report: response.content,
        metadata: response.metadata,
        duration: response.duration
      })}\n\n`);

      console.log(`[${id}] Deep research completed`, {
        duration: response.duration,
        contentLength: response.content.length,
        metadata: response.metadata
      });

    } catch (error: any) {
      console.error(`[${id}] Deep research failed:`, error);

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
   * Standalone deep research endpoint (not tied to a report)
   * POST /api/deep-research
   */
  app.post("/api/deep-research", asyncHandler(async (req: Request, res: Response) => {
    const { query, maxQuestions, parallelExecutors } = req.body;

    if (!query || typeof query !== 'string') {
      throw ServerError.validation("Query is required", "Onderzoeksvraag is verplicht");
    }

    console.log(`Starting standalone deep research:`, { query, maxQuestions, parallelExecutors });

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

      console.log(`Standalone deep research completed`, {
        duration: response.duration,
        contentLength: response.content.length
      });

    } catch (error: any) {
      console.error(`Standalone deep research failed:`, error);

      res.write(`data: ${JSON.stringify({
        stage: 'error',
        message: error.message || 'Deep research is mislukt',
        error: true
      })}\n\n`);
    } finally {
      res.end();
    }
  }));
}
