/**
 * Automail Routes
 *
 * API endpoints for interacting with Automail:
 * - Create draft replies in conversations
 * - Get cases by conversation ID
 * - Check API status
 */

import crypto from "crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { HTTP_STATUS } from "../config/constants";
import { AUTOMAIL_CONFIG } from "../config";
import { automailCreateDraftRequestSchema } from "@shared/schema/automail";
import { createDraft, isAutomailConfigured } from "../services/automail-api";
import { logger } from "../services/logger";

// ============================================================
// EMBED TOKEN VALIDATION
// ============================================================

/**
 * Timing-safe token comparison
 */
function timingSafeCompare(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  const paddedA = a.padEnd(maxLength, '\0');
  const paddedB = b.padEnd(maxLength, '\0');
  return crypto.timingSafeEqual(
    Buffer.from(paddedA, 'utf-8'),
    Buffer.from(paddedB, 'utf-8')
  );
}

/**
 * Validates embed access token from query parameter
 */
function validateEmbedToken(req: Request, res: Response, next: NextFunction): void {
  const token = req.query.token as string;
  const expectedToken = AUTOMAIL_CONFIG.embedAccessToken;

  // If no token configured, allow access (for development)
  if (!expectedToken) {
    logger.warn('automail-routes', 'EMBED_ACCESS_TOKEN not configured - allowing unauthenticated access');
    next();
    return;
  }

  // Validate token
  if (!token || !timingSafeCompare(token, expectedToken)) {
    logger.warn('automail-routes', 'Invalid embed token attempt', { ip: req.ip });
    res.status(HTTP_STATUS.UNAUTHORIZED).json(
      createApiErrorResponse(
        'AuthenticationError',
        ERROR_CODES.EXTERNAL_API_ERROR,
        'Invalid or missing access token',
        'Ongeldige toegangstoken'
      )
    );
    return;
  }

  next();
}

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
   * GET /api/embed/verify
   *
   * Verify embed access token. Used by frontend to check if access is allowed.
   *
   * Query params:
   * - token: string - The embed access token
   *
   * Response: { success: true, data: { valid: true } }
   */
  app.get(
    "/api/embed/verify",
    validateEmbedToken,
    asyncHandler(async (_req: Request, res: Response) => {
      res.status(HTTP_STATUS.OK).json(
        createApiSuccessResponse(
          { valid: true },
          'Token is geldig'
        )
      );
    })
  );

  /**
   * GET /api/automail/conversations/:conversationId/cases
   *
   * Get all cases/reports belonging to a specific Automail conversation.
   * Uses efficient database JSONB filtering.
   * Protected by embed token when accessed from embed view.
   *
   * Query params:
   * - token: string (optional) - Embed access token
   *
   * Response: { success: true, data: { conversationId, cases: [...], count } }
   */
  app.get(
    "/api/automail/conversations/:conversationId/cases",
    validateEmbedToken,
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
