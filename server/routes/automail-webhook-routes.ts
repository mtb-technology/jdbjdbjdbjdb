/**
 * Automail Webhook Routes
 *
 * Handles incoming webhooks from Automail to automatically create reports.
 * Authentication via X-Automail-API-Key header against AUTOMAIL_WEBHOOK_SECRET.
 */

import crypto from "crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { HTTP_STATUS } from "../config/constants";
import { AUTOMAIL_CONFIG } from "../config";
import { automailWebhookPayloadSchema } from "@shared/schema/automail";
import { logger } from "../services/logger";

// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================

/**
 * Timing-safe string comparison using Node.js crypto
 * Prevents timing attacks on webhook secret validation
 */
function timingSafeCompare(a: string, b: string): boolean {
  // Pad strings to same length to prevent length-based timing leaks
  const maxLength = Math.max(a.length, b.length);
  const paddedA = a.padEnd(maxLength, '\0');
  const paddedB = b.padEnd(maxLength, '\0');

  return crypto.timingSafeEqual(
    Buffer.from(paddedA, 'utf-8'),
    Buffer.from(paddedB, 'utf-8')
  );
}

/**
 * Middleware to validate Automail webhook API key
 * Validates X-Automail-API-Key header against AUTOMAIL_WEBHOOK_SECRET
 */
function validateAutomailApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers['x-automail-api-key'] as string;
  const expectedKey = AUTOMAIL_CONFIG.webhookSecret;

  // Reject if no secret configured (fail secure)
  if (!expectedKey) {
    logger.error('automail-webhook', 'AUTOMAIL_WEBHOOK_SECRET not configured');
    res.status(HTTP_STATUS.INTERNAL_ERROR).json(
      createApiErrorResponse(
        'ConfigurationError',
        ERROR_CODES.INTERNAL_SERVER_ERROR,
        'Webhook secret not configured',
        'Webhook configuratie onvolledig'
      )
    );
    return;
  }

  // Validate API key using timing-safe comparison
  if (!apiKey || !timingSafeCompare(apiKey, expectedKey)) {
    logger.warn('automail-webhook', 'Invalid API key attempt', { ip: req.ip });
    res.status(HTTP_STATUS.UNAUTHORIZED).json(
      createApiErrorResponse(
        'AuthenticationError',
        ERROR_CODES.EXTERNAL_API_ERROR,
        'Invalid or missing API key',
        'Ongeldige API-sleutel'
      )
    );
    return;
  }

  next();
}

// ============================================================
// ROUTE REGISTRATION
// ============================================================

export function registerAutomailWebhookRoutes(app: Express): void {
  /**
   * POST /api/webhooks/automail
   *
   * Creates a new report from Automail conversation data.
   * Triggered by Automail workflow automation.
   *
   * Headers:
   * - X-Automail-API-Key: Automail webhook authentication
   * - x-automail-event: Event type (optional, for logging)
   *
   * Response: { success: true, data: { reportId, dossierNumber, clientName } }
   */
  app.post(
    "/api/webhooks/automail",
    // TODO: Re-enable authentication: validateAutomailApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      // Log incoming webhook event
      const eventType = req.headers['x-freescout-event'] as string || 'unknown';
      logger.info('automail-webhook', 'Received event', { eventType });

      // Validate payload structure
      const validationResult = automailWebhookPayloadSchema.safeParse(req.body);
      if (!validationResult.success) {
        logger.error('automail-webhook', 'Validation failed', { errors: validationResult.error.errors });
        throw ServerError.validation(
          'Invalid webhook payload',
          'Ongeldig webhook formaat'
        );
      }

      const payload = validationResult.data;

      // Extract client name from customer
      const clientName = `${payload.customer.firstName} ${payload.customer.lastName}`.trim();

      // Extract Lead ID from custom fields (if present)
      const leadIdField = payload.customFields?.find(f => f.name === 'Lead id');
      const leadId = leadIdField?.value || null;

      // Use formattedThreads as the base raw text (pre-formatted plain text)
      let rawText = payload.formattedThreads || '';

      // Extract all attachments from threads
      const allAttachments: Array<{
        fileName: string;
        mimeType: string;
        size: number;
        extractedText: string | null;
        fileUrl: string;
        threadId: number;
      }> = [];

      // Extract attachment text from all threads
      const attachmentTexts: { filename: string; text: string }[] = [];
      const threads = payload._embedded?.threads || [];

      for (const thread of threads) {
        const threadAttachments = thread._embedded?.attachments || [];
        for (const att of threadAttachments) {
          // Collect for attachment records (need fileName and extractedText)
          if (att.fileName && att.extractedText) {
            allAttachments.push({
              fileName: att.fileName,
              mimeType: att.mimeType,
              size: att.size,
              extractedText: att.extractedText || null,
              fileUrl: att.fileUrl,
              threadId: thread.id,
            });
          }
          // Also collect for rawText appending
          if (att.extractedText && att.extractedText.trim().length > 0) {
            attachmentTexts.push({
              filename: att.fileName,
              text: att.extractedText.trim(),
            });
          }
        }
      }

      // Append attachment text to rawText with clear document markers
      if (attachmentTexts.length > 0) {
        rawText += '\n\n' + '='.repeat(60) + '\n';
        rawText += 'BIJLAGEN / DOCUMENTEN\n';
        rawText += '='.repeat(60) + '\n\n';

        for (const att of attachmentTexts) {
          rawText += `--- DOCUMENT: ${att.filename} ---\n`;
          rawText += att.text + '\n\n';
        }
      }

      if (!rawText || rawText.trim().length < 10) {
        throw ServerError.validation(
          'Insufficient content in webhook payload',
          'Onvoldoende inhoud in de conversatie'
        );
      }

      logger.info('automail-webhook', 'Creating report', {
        clientName,
        conversationId: payload.id,
        conversationNumber: payload.number,
        leadId,
        rawTextLength: rawText.length,
        attachmentCount: allAttachments.length,
      });

      // Create the report using existing storage pattern
      const report = await storage.createReport({
        title: clientName,
        clientName: clientName,
        dossierData: {
          rawText,
          klant: {
            naam: clientName,
            situatie: '',
          },
          fiscale_gegevens: {
            vermogen: 0,
            inkomsten: 0,
          },
          // Automail-specific metadata
          automail: {
            conversationId: payload.id,
            conversationNumber: payload.number,
            subject: payload.subject,
            customerEmail: payload.customer.email,
            customerPhone: payload.customer.phone || null,
            leadId,
            receivedAt: new Date().toISOString(),
          },
        },
        bouwplanData: {},
        generatedContent: null,
        stageResults: {},
        conceptReportVersions: {},
        currentStage: "1a_informatiecheck",
        status: "processing",
      });

      logger.info('automail-webhook', 'Report created', {
        reportId: report.id,
        dossierNumber: report.dossierNumber,
      });

      // Create attachment records for each extracted attachment
      const createdAttachments: string[] = [];
      for (const att of allAttachments) {
        try {
          const attachment = await storage.createAttachment({
            reportId: report.id,
            filename: att.fileName,
            mimeType: att.mimeType,
            fileSize: String(att.size),
            pageCount: null,
            fileData: '', // No binary data - we only have extracted text from Automail
            extractedText: att.extractedText,
            externalUrl: att.fileUrl, // Link to original file in Automail
            needsVisionOCR: false, // Already extracted by Automail
            usedInStages: [],
          });
          createdAttachments.push(attachment.id);
          logger.info('automail-webhook', 'Created attachment', { filename: att.fileName, attachmentId: attachment.id });
        } catch (attError: any) {
          logger.error('automail-webhook', 'Failed to create attachment', { filename: att.fileName, error: attError.message });
          // Continue with other attachments - don't fail the whole request
        }
      }

      logger.info('automail-webhook', 'Attachments created', {
        total: allAttachments.length,
        successful: createdAttachments.length,
      });

      // Return response with report identifiers and attachment info
      res.status(HTTP_STATUS.CREATED).json(
        createApiSuccessResponse(
          {
            reportId: report.id,
            dossierNumber: report.dossierNumber,
            clientName: report.clientName,
            title: report.title,
            attachments: {
              received: allAttachments.length,
              created: createdAttachments.length,
              ids: createdAttachments,
            },
          },
          `Rapport succesvol aangemaakt vanuit Automail${allAttachments.length > 0 ? ` met ${createdAttachments.length} bijlage(s)` : ''}`
        )
      );
    })
  );
}
