// Streaming routes for real-time workflow updates

import type { Express, Request, Response } from "express";
import { SSEHandler } from "../services/streaming/sse-handler";
import { StreamingSessionManager } from "../services/streaming/streaming-session-manager";
import { asyncHandler } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { HTTP_STATUS } from "../config/constants";
import { storage } from "../storage";
import type { DossierData, BouwplanData, StageId } from "@shared/schema";
import type { SubstepDefinition } from "@shared/streaming-types";

// Track active AbortControllers per session voor graceful cancellation
const activeAbortControllers = new Map<string, AbortController>();

export function registerStreamingRoutes(
  app: Express,
  sseHandler: SSEHandler,
  sessionManager: StreamingSessionManager
): void {

  // Server-Sent Events endpoint for real-time progress updates
  app.get("/api/reports/:reportId/stage/:stageId/stream", (req: Request, res: Response) => {
    console.log(`📡 [${req.params.reportId}-${req.params.stageId}] SSE connection requested`);
    sseHandler.handleConnection(req, res);
  });

  // Execute stage with streaming support - ALL stages use single prompt from settings
  app.post("/api/reports/:reportId/stage/:stageId/stream", asyncHandler(async (req: Request, res: Response) => {
    const { reportId, stageId } = req.params;
    const { customInput } = req.body;

    console.log(`🌊 [${reportId}-${stageId}] Starting simple streaming stage execution`);

    // Check if report exists
    const report = await storage.getReport(reportId);
    if (!report) {
      return res.status(HTTP_STATUS.NOT_FOUND).json(createApiErrorResponse(
        'NotFound',
        ERROR_CODES.REPORT_NOT_FOUND,
        'Report not found',
        'Rapport niet gevonden voor streaming uitvoering'
      ));
    }

    // Check if streaming is already active
    const existingSession = sessionManager.getSession(reportId, stageId);
    if (existingSession && existingSession.status === 'active') {
      return res.json(createApiSuccessResponse({
        message: 'Stage wordt al uitgevoerd',
        session: existingSession
      }));
    }

    try {
      // All stages use simple single-prompt execution
      const { ReportGenerator } = await import('../services/report-generator');
      const reportGenerator = new ReportGenerator();

      // Create a simple session with single substep
      const simpleSubsteps: SubstepDefinition[] = [{
        substepId: 'execute',
        name: `Uitvoeren ${stageId}`,
        estimatedDuration: 30,
        isStreamable: true,
        canRetry: false
      }];

      // Maak AbortController voor graceful cancellation bij client disconnect
      const sessionKey = `${reportId}-${stageId}`;
      const abortController = new AbortController();
      activeAbortControllers.set(sessionKey, abortController);

      sessionManager.createSession(reportId, stageId, simpleSubsteps);

      // Start execution in background
      setTimeout(async () => {
        try {
          // Check of al geabort voordat we beginnen
          if (abortController.signal.aborted) {
            console.log(`🛑 [${reportId}-${stageId}] Stage was aborted before execution`);
            return;
          }

          // Update progress to show we're executing
          sessionManager.updateSubstepProgress(reportId, stageId, 'execute', 50, 'In uitvoering...');
          if (!abortController.signal.aborted) {
            sseHandler.broadcast(reportId, stageId, {
              type: 'step_progress',
              stageId,
              substepId: 'execute',
              percentage: 50,
              message: `${stageId} wordt uitgevoerd...`,
              timestamp: new Date().toISOString()
            });
          }

          // Progress callback for deep research - broadcasts to SSE (met abort check)
          const onProgress = (progress: { stage: string; message: string; progress: number }) => {
            if (!abortController.signal.aborted) {
              sseHandler.broadcast(reportId, stageId, {
                type: 'research_progress',
                stageId,
                researchStage: progress.stage,
                percentage: progress.progress,
                message: progress.message,
                timestamp: new Date().toISOString()
              });
            }
          };

          // For Stage 1a (informatiecheck analyse): Include attachment extracted text AND vision attachments
          let dossierWithAttachments = report.dossierData as DossierData;
          let visionAttachments: Array<{ mimeType: string; data: string; filename: string }> = [];

          if (stageId === '1a_informatiecheck') {
            const attachments = await storage.getAttachmentsForReport(reportId);
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
                console.log(`📎 [${reportId}] Stage 1a: Added ${textAttachments.length} text attachment(s) to dossier`);
              }

              // Prepare scanned PDFs for Gemini Vision OCR
              if (visionNeededAttachments.length > 0) {
                visionAttachments = visionNeededAttachments.map(att => ({
                  mimeType: att.mimeType,
                  data: att.fileData, // base64 encoded
                  filename: att.filename
                }));
                console.log(`📄 [${reportId}] Stage 1a: Sending ${visionNeededAttachments.length} scanned PDF(s) to Gemini Vision for OCR`);
              }

              // Mark all attachments as used in this stage
              for (const att of attachments) {
                await storage.updateAttachmentUsage(att.id, stageId);
              }
            }
          }

          // Execute using ReportGenerator (uses prompt from settings)
          const result = await reportGenerator.executeStage(
            stageId,
            dossierWithAttachments,
            report.bouwplanData as BouwplanData,
            report.stageResults as Record<string, string> || {},
            report.conceptReportVersions as Record<string, string> || {},
            customInput,
            reportId,
            onProgress,
            visionAttachments.length > 0 ? visionAttachments : undefined,
            undefined, // reportDepth
            abortController.signal // AbortSignal voor graceful cancellation
          );

          // Check of geabort tijdens uitvoering
          if (abortController.signal.aborted) {
            console.log(`🛑 [${reportId}-${stageId}] Stage was aborted during execution`);
            return;
          }

          // Update stage results
          const updatedStageResults = {
            ...(report.stageResults as Record<string, string> || {}),
            [stageId]: result.stageOutput
          };

          await storage.updateReport(reportId, {
            stageResults: updatedStageResults,
            stagePrompts: {
              ...(report.stagePrompts as Record<string, string> || {}),
              [stageId]: result.prompt
            }
          });

          // Handle concept report for stage 3
          if (stageId === '3_generatie') {
            const initialConceptVersions = {
              '3_generatie': {
                v: 1,
                content: result.stageOutput,
                createdAt: new Date().toISOString()
              },
              'latest': {
                v: 1,
                content: result.stageOutput,
                createdAt: new Date().toISOString()
              }
            };

            await storage.updateReport(reportId, {
              conceptReportVersions: initialConceptVersions
            });
          }

          // Handle reviewer stages (4a-4g) - broadcast feedback ready event
          if (stageId.startsWith('4') && !abortController.signal.aborted) {
            sseHandler.broadcast(reportId, stageId, {
              type: 'stage_complete',
              stageId: stageId,
              substepId: 'feedback_ready',
              percentage: 100,
              message: `Feedback van ${stageId} klaar`,
              data: {
                rawFeedback: result.stageOutput,
                requiresUserAction: true,
                actionType: 'feedback_instructions'
              },
              timestamp: new Date().toISOString()
            });
          }

          // Complete the session
          sessionManager.completeStage(reportId, stageId, result.stageOutput, result.conceptReport, result.prompt);

          // Broadcast completion (alleen als niet geabort)
          if (!abortController.signal.aborted) {
            sseHandler.broadcast(reportId, stageId, {
              type: 'stage_complete',
              stageId,
              substepId: 'execute',
              percentage: 100,
              message: `${stageId} voltooid`,
              timestamp: new Date().toISOString()
            });
          }

          console.log(`✅ [${reportId}-${stageId}] Simple streaming stage completed`);

        } catch (error: any) {
          // Check of dit een abort error is
          if (abortController.signal.aborted) {
            console.log(`🛑 [${reportId}-${stageId}] Stage was aborted`);
            return;
          }
          console.error(`❌ [${reportId}-${stageId}] Streaming stage failed:`, error);
          sessionManager.errorStage(reportId, stageId, error.message, true);
        } finally {
          // Cleanup de AbortController
          activeAbortControllers.delete(sessionKey);
        }
      }, 100);

      // Return immediately with session info
      return res.json(createApiSuccessResponse({
        message: 'Streaming stage execution gestart',
        streamUrl: `/api/reports/${reportId}/stage/${stageId}/stream`
      }));

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ [${reportId}-${stageId}] Failed to start streaming execution:`, message);
      return res.status(HTTP_STATUS.INTERNAL_ERROR).json(createApiErrorResponse(
        'ExecutionError',
        ERROR_CODES.INTERNAL_SERVER_ERROR,
        message,
        'Fout bij starten streaming uitvoering'
      ));
    }
  }));

  // Get current session status
  app.get("/api/reports/:reportId/stage/:stageId/status", asyncHandler(async (req: Request, res: Response) => {
    const { reportId, stageId } = req.params;

    const session = sessionManager.getSession(reportId, stageId);
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json(createApiErrorResponse(
        'NotFound',
        ERROR_CODES.REPORT_NOT_FOUND,
        'No active session found',
        'Geen actieve sessie gevonden'
      ));
    }

    res.json(createApiSuccessResponse(session));
  }));

  // Cancel stage execution
  app.post("/api/reports/:reportId/stage/:stageId/cancel", asyncHandler(async (req: Request, res: Response) => {
    const { reportId, stageId } = req.params;

    const session = sessionManager.getSession(reportId, stageId);
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json(createApiErrorResponse(
        'NotFound',
        ERROR_CODES.REPORT_NOT_FOUND,
        'No active session to cancel',
        'Geen actieve sessie gevonden om te annuleren'
      ));
    }

    if (session.status !== 'active') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json(createApiErrorResponse(
        'ValidationError',
        ERROR_CODES.VALIDATION_FAILED,
        'Session is not active',
        'Sessie is niet actief en kan niet geannuleerd worden'
      ));
    }

    try {
      // Abort de lopende AI call
      const sessionKey = `${reportId}-${stageId}`;
      const controller = activeAbortControllers.get(sessionKey);
      if (controller) {
        controller.abort();
        activeAbortControllers.delete(sessionKey);
        console.log(`🛑 [${reportId}-${stageId}] AbortController triggered`);
      }

      // Mark session as cancelled
      sessionManager.errorStage(reportId, stageId, 'Cancelled by user', true);
      console.log(`🛑 [${reportId}-${stageId}] Stage execution cancelled`);

      res.json(createApiSuccessResponse({
        message: 'Stage uitvoering geannuleerd'
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ [${reportId}-${stageId}] Failed to cancel stage:`, message);
      res.status(HTTP_STATUS.INTERNAL_ERROR).json(createApiErrorResponse(
        'CancelError',
        ERROR_CODES.INTERNAL_SERVER_ERROR,
        message,
        'Fout bij annuleren stage uitvoering'
      ));
    }
  }));

  // Get all active streaming sessions (for monitoring)
  app.get("/api/streaming/sessions", asyncHandler(async (_req: Request, res: Response) => {
    const sessions = sessionManager.getActiveSessions();
    const clientCount = sseHandler.getClientCount();

    res.json(createApiSuccessResponse({
      activeSessions: sessions.length,
      totalClients: clientCount,
      sessions: sessions.map(s => ({
        reportId: s.reportId,
        stageId: s.stageId,
        status: s.status,
        progress: s.progress.percentage,
        currentSubstep: s.progress.currentSubstep,
        startTime: s.startTime
      }))
    }));
  }));

  // Cleanup old sessions (maintenance endpoint)
  app.post("/api/streaming/cleanup", asyncHandler(async (_req: Request, res: Response) => {
    sessionManager.cleanup();
    sseHandler.cleanup();

    console.log('🧹 Streaming sessions cleanup performed');
    res.json(createApiSuccessResponse({
      message: 'Cleanup voltooid'
    }));
  }));

  console.log('📡 Streaming routes registered successfully');
}
