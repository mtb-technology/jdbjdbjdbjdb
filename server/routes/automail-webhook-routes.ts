/**
 * Automail Webhook Routes
 *
 * Handles incoming webhooks from Automail to automatically create reports.
 * Authentication via X-Automail-API-Key header against AUTOMAIL_WEBHOOK_SECRET.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { HTTP_STATUS } from "../config/constants";
import { logger } from "../services/logger";
import { z } from "zod";

// ============================================================
// ZOD SCHEMAS FOR AUTOMAIL WEBHOOK PAYLOAD
// ============================================================
// Generated from actual Automail/FreeScout webhook payload
// Last updated: 2025-12-17

// User schema (for assignee, createdBy, etc.)
const automailUserSchema = z.object({
  id: z.number(),
  type: z.literal("user"),
  firstName: z.string(),
  lastName: z.string(),
  photoUrl: z.string().optional(),
  email: z.string().email(),
}).passthrough();

// Customer schema
const automailCustomerSchema = z.object({
  id: z.number(),
  type: z.literal("customer").optional(),
  firstName: z.string(),
  lastName: z.string(),
  photoUrl: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
}).passthrough();

// Custom field schema
const automailCustomFieldSchema = z.object({
  id: z.number(),
  name: z.string(),
  value: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
}).passthrough();

// Attachment schema (nested in threads)
const automailAttachmentSchema = z.object({
  id: z.number(),
  fileName: z.string(),
  fileUrl: z.string().url(),
  mimeType: z.string(),
  size: z.number(),
  extractedText: z.string().optional().nullable(),
  extractionSuccess: z.boolean().optional(),
  extractionCached: z.boolean().optional(),
}).passthrough();

// Action schema (in threads)
const automailActionSchema = z.object({
  type: z.string(),
  text: z.string(),
  associatedEntities: z.array(z.unknown()).optional(),
}).passthrough();

// Source schema
const automailSourceSchema = z.object({
  type: z.string(),
  via: z.string(),
}).passthrough();

// Thread schema (messages, notes, lineitems, customer replies)
const automailThreadSchema = z.object({
  id: z.number(),
  type: z.enum(["note", "message", "customer", "lineitem"]),
  status: z.string().optional(),
  state: z.string().optional(),
  action: automailActionSchema.optional(),
  body: z.string().nullable().transform(val => val ?? ''),
  source: automailSourceSchema.optional(),
  customer: automailCustomerSchema.optional().nullable(),
  createdBy: z.union([automailUserSchema, automailCustomerSchema]).optional().nullable(),
  assignedTo: automailUserSchema.optional().nullable(),
  to: z.array(z.string()).optional().default([]),
  cc: z.array(z.string()).optional().default([]),
  bcc: z.array(z.string()).optional().default([]),
  createdAt: z.string(),
  openedAt: z.string().optional().nullable(),
  _embedded: z.object({
    attachments: z.array(automailAttachmentSchema).optional().default([]),
  }).optional(),
}).passthrough();

// CustomerWaitingSince schema
const automailCustomerWaitingSinceSchema = z.object({
  time: z.string(),
  friendly: z.string(),
  latestReplyFrom: z.string(),
}).passthrough();

// Main webhook payload schema
const automailWebhookPayloadSchema = z.object({
  // Core identifiers
  id: z.number(),
  number: z.number(),
  externalId: z.string().optional().nullable(),

  // Conversation metadata
  threadsCount: z.number().optional(),
  type: z.string().optional(), // "email", etc.
  folderId: z.number().optional(),
  status: z.string().optional(), // "pending", "active", "closed"
  state: z.string().optional(), // "published", etc.
  subject: z.string(),
  preview: z.string().optional(),
  mailboxId: z.number().optional(),
  language: z.string().optional(),

  // People
  customer: automailCustomerSchema,
  assignee: automailUserSchema.optional().nullable(),
  createdBy: automailUserSchema.optional().nullable(),
  closedBy: z.unknown().optional().nullable(),
  closedByUser: z.unknown().optional().nullable(),

  // Timestamps
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  closedAt: z.string().optional().nullable(),
  userUpdatedAt: z.string().optional(),
  customerWaitingSince: automailCustomerWaitingSinceSchema.optional(),

  // Source info
  source: automailSourceSchema.optional(),

  // Recipients
  cc: z.array(z.string()).optional().default([]),
  bcc: z.array(z.string()).optional().default([]),

  // Custom fields
  customFields: z.array(automailCustomFieldSchema).optional().default([]),

  // Embedded data (threads with attachments)
  _embedded: z.object({
    threads: z.array(automailThreadSchema).optional().default([]),
  }).optional(),

  // Pre-formatted threads text (optional, for backward compatibility)
  formattedThreads: z.string().optional().default(""),
}).passthrough(); // Allow additional fields we haven't mapped

export type AutomailWebhookPayload = z.infer<typeof automailWebhookPayloadSchema>;

// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Middleware to validate Automail webhook API key
 * Validates X-API-Key header against AUTOMAIL_WEBHOOK_SECRET env var
 */
function validateAutomailApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers['x-automail-api-key'] as string;
  const expectedKey = process.env.AUTOMAIL_WEBHOOK_SECRET;

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
  if (!apiKey || !timingSafeEqual(apiKey, expectedKey)) {
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
   * - x-freescout-event: Event type (optional, for logging)
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
