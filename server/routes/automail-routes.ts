/**
 * Automail Routes
 *
 * API endpoints for interacting with Automail:
 * - Create draft replies in conversations
 * - Get cases by conversation ID
 * - Check API status
 */

import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse } from "@shared/errors";
import { HTTP_STATUS } from "../config/constants";
import { automailCreateDraftRequestSchema } from "@shared/schema/automail";
import { createDraft, isAutomailConfigured } from "../services/automail-api";
import { logger } from "../services/logger";

// ============================================================
// ROUTE REGISTRATION
// ============================================================

export function registerAutomailRoutes(app: Express): void {
  /**
   * POST /api/reports/:reportId/automail/draft
   *
   * Creates a draft reply in the Automail conversation associated with this report.
   *
   * Body:
   * - text: string - The draft reply content (HTML supported)
   * - subject: string (optional) - Subject line (not used in replies)
   *
   * Response: { success: true, data: { threadId, conversationId } }
   */
  app.post(
    "/api/reports/:reportId/automail/draft",
    asyncHandler(async (req: Request, res: Response) => {
      const { reportId } = req.params;

      // Check if Automail is configured
      if (!isAutomailConfigured()) {
        throw ServerError.internal('Automail API is niet geconfigureerd');
      }

      // Validate request body
      const validationResult = automailCreateDraftRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw ServerError.validation(
          'Invalid request body',
          'Ongeldige aanvraag'
        );
      }

      const { text } = validationResult.data;

      // Get the report
      const report = await storage.getReport(reportId);
      if (!report) {
        throw ServerError.notFound('Rapport');
      }

      // Get the Automail conversation ID from dossierData
      const dossierData = report.dossierData as any;
      const conversationId = dossierData?.automail?.conversationId;

      if (!conversationId) {
        throw ServerError.validation(
          'Report does not have an associated Automail conversation',
          'Rapport heeft geen gekoppelde Automail conversatie'
        );
      }

      logger.info('automail-routes', 'Creating draft', { reportId, conversationId });

      // Create the draft
      const result = await createDraft({
        conversationId: Number(conversationId),
        body: text,
      });

      logger.info('automail-routes', 'Draft created', { threadId: result.threadId });

      res.status(HTTP_STATUS.CREATED).json(
        createApiSuccessResponse(
          {
            threadId: result.threadId,
            conversationId: result.conversationId,
          },
          'Draft succesvol aangemaakt in Automail'
        )
      );
    })
  );

  /**
   * GET /api/automail/status
   *
   * Check if Automail API is configured and available.
   *
   * Response: { success: true, data: { configured: boolean } }
   */
  app.get(
    "/api/automail/status",
    asyncHandler(async (_req: Request, res: Response) => {
      const configured = isAutomailConfigured();

      res.status(HTTP_STATUS.OK).json(
        createApiSuccessResponse(
          { configured },
          configured ? 'Automail API is geconfigureerd' : 'Automail API is niet geconfigureerd'
        )
      );
    })
  );

  /**
   * GET /api/automail/conversations/:conversationId/cases
   *
   * Get all cases/reports belonging to a specific Automail conversation.
   * Uses efficient database JSONB filtering.
   *
   * Response: { success: true, data: { conversationId, cases: [...], count } }
   */
  app.get(
    "/api/automail/conversations/:conversationId/cases",
    asyncHandler(async (req: Request, res: Response) => {
      const { conversationId } = req.params;
      const conversationIdNum = parseInt(conversationId, 10);

      if (isNaN(conversationIdNum)) {
        throw ServerError.validation(
          'Invalid conversation ID',
          'Ongeldig conversatie ID'
        );
      }

      logger.info('automail-routes', 'Fetching cases', { conversationId: conversationIdNum });

      // Use efficient database query with JSONB filtering
      const reports = await storage.getReportsByAutomailConversation(conversationIdNum);

      const cases = reports.map(report => {
        const dossierData = report.dossierData as any;
        return {
          id: report.id,
          dossierNumber: report.dossierNumber,
          title: report.title,
          clientName: report.clientName,
          status: report.status,
          currentStage: report.currentStage,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
          automail: {
            conversationId: dossierData?.automail?.conversationId,
            conversationNumber: dossierData?.automail?.conversationNumber,
            subject: dossierData?.automail?.subject,
            leadId: dossierData?.automail?.leadId,
          },
        };
      });

      logger.info('automail-routes', 'Cases found', { conversationId: conversationIdNum, count: cases.length });

      res.status(HTTP_STATUS.OK).json(
        createApiSuccessResponse(
          {
            conversationId: conversationIdNum,
            cases,
            count: cases.length,
          },
          cases.length > 0
            ? `${cases.length} dossier(s) gevonden voor deze conversatie`
            : 'Geen dossiers gevonden voor deze conversatie'
        )
      );
    })
  );
}
