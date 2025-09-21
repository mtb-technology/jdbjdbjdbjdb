// Streaming routes for real-time workflow updates

import type { Express, Request, Response } from "express";
import { SSEHandler } from "../services/streaming/sse-handler";
import { StreamingSessionManager } from "../services/streaming/streaming-session-manager";
import { DecomposedStages } from "../services/streaming/decomposed-stages";
import { ReportProcessor } from "../services/report-processor";
import { asyncHandler } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse } from "@shared/errors";
import { storage } from "../storage";
import type { DossierData, BouwplanData, StageId } from "@shared/schema";

export function registerStreamingRoutes(
  app: Express, 
  sseHandler: SSEHandler, 
  sessionManager: StreamingSessionManager,
  decomposedStages: DecomposedStages
): void {
  
  // Initialize ReportProcessor with AI handler for incremental concept report versioning  
  const reportProcessor = new ReportProcessor(); // Uses default AI implementation (no constructor args needed)

  // Server-Sent Events endpoint for real-time progress updates
  app.get("/api/reports/:reportId/stage/:stageId/stream", (req: Request, res: Response) => {
    console.log(`📡 [${req.params.reportId}-${req.params.stageId}] SSE connection requested`);
    sseHandler.handleConnection(req, res);
  });

  // Execute stage with streaming support (decomposed into substeps)
  app.post("/api/reports/:reportId/stage/:stageId/stream", asyncHandler(async (req: Request, res: Response) => {
    const { reportId, stageId } = req.params;
    const { customInput } = req.body;

    console.log(`🌊 [${reportId}-${stageId}] Starting streaming stage execution`);

    // Check if report exists
    const report = await storage.getReport(reportId);
    if (!report) {
      return res.status(404).json(createApiErrorResponse(
        'REPORT_NOT_FOUND',
        'VALIDATION_FAILED',
        'Rapport niet gevonden',
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
      // Execute decomposed stage asynchronously (supports all stages)
      if (['4a_BronnenSpecialist', '4b_FiscaalTechnischSpecialist', '4c_ScenarioGatenAnalist', '4d_DeVertaler', '4e_DeAdvocaat', '4f_DeKlantpsycholoog', '4g_ChefEindredactie', '1_informatiecheck', '2_bouwplananalyse', '3_generatie', '5_eindredactie'].includes(stageId)) {
        // Start execution in background
        setTimeout(async () => {
          try {
            const result = await decomposedStages.executeStreamingStage(
              reportId,
              stageId,
              report.dossierData as DossierData,
              report.bouwplanData as BouwplanData,
              report.stageResults as Record<string, string> || {},
              report.conceptReportVersions as Record<string, string> || {},
              customInput
            );

            // *** CRITICAL INTEGRATION *** Use ReportProcessor for proper versioning
            
            // 1. Update stage results first (raw feedback storage)  
            const currentStageResults = report.stageResults as Record<string, string> || {};
            const updatedStageResults = {
              ...currentStageResults,
              [stageId]: result.stageOutput
            };
            
            // 2. Store stage prompts for traceability
            await storage.updateReport(reportId, {
              stageResults: updatedStageResults,
              stagePrompts: {
                ...(report.stagePrompts as Record<string, string> || {}),
                [stageId]: result.prompt
              }
            });

            // 3. Handle concept report processing based on stage type
            if (stageId === '3_generatie') {
              // *** SPECIAL CASE: Initial concept creation (not feedback processing) ***
              console.log(`📝 [${reportId}-${stageId}] Creating initial concept report...`);
              
              const initialConceptVersions = {
                '3_generatie': {
                  v: 1,
                  content: result.stageOutput,
                  createdAt: new Date().toISOString()
                },
                latest: { pointer: '3_generatie' as StageId, v: 1 },
                history: [{ 
                  stageId: '3_generatie' as StageId, 
                  v: 1, 
                  timestamp: new Date().toISOString() 
                }]
              };
              
              await storage.updateReport(reportId, {
                generatedContent: result.stageOutput,
                conceptReportVersions: initialConceptVersions as any
              });
              
              console.log(`✅ [${reportId}-${stageId}] Initial concept report created (v1)`);
              
            } else if (stageId.startsWith('4')) { 
              // *** REVIEW STAGES: Prepare feedback for user review (NO automatic processing) ***
              
              const validReviewStages = [
                '4a_BronnenSpecialist', '4b_FiscaalTechnischSpecialist', 
                '4c_ScenarioGatenAnalist', '4d_DeVertaler', '4e_DeAdvocaat', 
                '4f_DeKlantpsycholoog', '4g_ChefEindredactie'
              ];
              
              if (validReviewStages.includes(stageId)) {
                console.log(`📋 [${reportId}-${stageId}] Feedback ready for user review - NO automatic processing`);
                
                // Simple: Just store raw feedback for user review (no complex parsing)
                console.log(`✅ [${reportId}-${stageId}] Raw feedback ready for user review`);
                
                // Emit SSE event: Raw feedback ready for user instructions
                sseHandler.broadcast(reportId, stageId, {
                  type: 'stage_complete',
                  stageId: stageId,
                  substepId: 'feedback_ready',
                  percentage: 100,
                  message: `Feedback van ${stageId} klaar - geef instructies wat je wilt verwerken`,
                  data: {
                    rawFeedback: result.stageOutput,
                    requiresUserAction: true,
                    actionType: 'feedback_instructions'
                  },
                  timestamp: new Date().toISOString()
                });
                
                console.log(`✅ [${reportId}-${stageId}] Raw feedback prepared for user instructions`);
                
              } else {
                console.warn(`⚠️ [${reportId}-${stageId}] Stage not supported for feedback review - skipping`);
              }
            }

            console.log(`✅ [${reportId}-${stageId}] Complete streaming stage execution finished`);

          } catch (error: any) {
            console.error(`❌ [${reportId}-${stageId}] Streaming stage execution failed:`, error);
            sessionManager.errorStage(reportId, stageId, error.message, true);
          }
        }, 100); // Small delay to return response first

        // Return immediately with session info
        return res.json(createApiSuccessResponse({
          message: 'Streaming stage execution gestart',
          streamUrl: `/api/reports/${reportId}/stage/${stageId}/stream`
        }));
      } else {
        return res.status(400).json(createApiErrorResponse(
          'STAGE_NOT_STREAMABLE',
          'VALIDATION_FAILED',
          'Deze stage ondersteunt nog geen streaming',
          'Alleen bepaalde stages ondersteunen streaming uitvoering'
        ));
      }
    } catch (error: any) {
      console.error(`❌ [${reportId}-${stageId}] Failed to start streaming execution:`, error);
      return res.status(500).json(createApiErrorResponse(
        'EXECUTION_FAILED',
        'INTERNAL_SERVER_ERROR',
        'Fout bij starten streaming uitvoering',
        'Er is een interne fout opgetreden bij het starten van de streaming'
      ));
    }
  }));

  // Get current session status
  app.get("/api/reports/:reportId/stage/:stageId/status", asyncHandler(async (req: Request, res: Response) => {
    const { reportId, stageId } = req.params;
    
    const session = sessionManager.getSession(reportId, stageId);
    if (!session) {
      return res.status(404).json(createApiErrorResponse(
        'SESSION_NOT_FOUND',
        'VALIDATION_FAILED',
        'Geen actieve sessie gevonden',
        'Er is geen actieve streaming sessie voor deze stage'
      ));
    }

    res.json(createApiSuccessResponse(session));
  }));

  // Cancel stage execution
  app.post("/api/reports/:reportId/stage/:stageId/cancel", asyncHandler(async (req: Request, res: Response) => {
    const { reportId, stageId } = req.params;

    const session = sessionManager.getSession(reportId, stageId);
    if (!session) {
      return res.status(404).json(createApiErrorResponse(
        'SESSION_NOT_FOUND',
        'VALIDATION_FAILED',
        'Geen actieve sessie gevonden om te annuleren',
        'Er is geen actieve streaming sessie om te annuleren'
      ));
    }

    if (session.status !== 'active') {
      return res.status(400).json(createApiErrorResponse(
        'SESSION_NOT_ACTIVE',
        'VALIDATION_FAILED',
        'Sessie is niet actief en kan niet geannuleerd worden',
        'De streaming sessie is niet in actieve staat'
      ));
    }

    try {
      await decomposedStages.cancelStage(reportId, stageId);
      console.log(`🛑 [${reportId}-${stageId}] Stage execution cancelled`);
      
      res.json(createApiSuccessResponse({
        message: 'Stage uitvoering geannuleerd'
      }));
    } catch (error: any) {
      console.error(`❌ [${reportId}-${stageId}] Failed to cancel stage:`, error);
      res.status(500).json(createApiErrorResponse(
        'CANCEL_FAILED',
        'INTERNAL_SERVER_ERROR',
        'Fout bij annuleren stage uitvoering',
        'Er is een fout opgetreden bij het annuleren van de streaming'
      ));
    }
  }));

  // Retry failed substep
  app.post("/api/reports/:reportId/stage/:stageId/substep/:substepId/retry", asyncHandler(async (req: Request, res: Response) => {
    const { reportId, stageId, substepId } = req.params;

    const session = sessionManager.getSession(reportId, stageId);
    if (!session) {
      return res.status(404).json(createApiErrorResponse(
        'SESSION_NOT_FOUND',
        'VALIDATION_FAILED',
        'Geen actieve sessie gevonden voor retry',
        'Er is geen actieve streaming sessie voor retry'
      ));
    }

    const substep = session.progress.substeps.find(s => s.substepId === substepId);
    if (!substep) {
      return res.status(404).json(createApiErrorResponse(
        'SUBSTEP_NOT_FOUND',
        'VALIDATION_FAILED',
        'Substep niet gevonden',
        'De opgegeven substep bestaat niet in deze stage'
      ));
    }

    if (substep.status !== 'error') {
      return res.status(400).json(createApiErrorResponse(
        'SUBSTEP_NOT_FAILED',
        'VALIDATION_FAILED',
        'Substep heeft geen fout en hoeft niet opnieuw uitgevoerd te worden',
        'Alleen gefaalde substeps kunnen opnieuw uitgevoerd worden'
      ));
    }

    try {
      await decomposedStages.retrySubstep(reportId, stageId, substepId);
      console.log(`🔄 [${reportId}-${stageId}] Substep ${substepId} retry initiated`);
      
      res.json(createApiSuccessResponse({
        message: `Substep ${substepId} wordt opnieuw uitgevoerd`
      }));
    } catch (error: any) {
      console.error(`❌ [${reportId}-${stageId}] Failed to retry substep ${substepId}:`, error);
      res.status(500).json(createApiErrorResponse(
        'RETRY_FAILED',
        'INTERNAL_SERVER_ERROR',
        'Fout bij opnieuw uitvoeren substep',
        'Er is een fout opgetreden bij het opnieuw uitvoeren van de substep'
      ));
    }
  }));

  // Get all active streaming sessions (for monitoring)
  app.get("/api/streaming/sessions", asyncHandler(async (req: Request, res: Response) => {
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
  app.post("/api/streaming/cleanup", asyncHandler(async (req: Request, res: Response) => {
    sessionManager.cleanup();
    sseHandler.cleanup();
    
    console.log('🧹 Streaming sessions cleanup performed');
    res.json(createApiSuccessResponse({
      message: 'Cleanup voltooid'
    }));
  }));

  console.log('📡 Streaming routes registered successfully');
}