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
import { z } from "zod";

// ============================================================
// ZOD SCHEMAS FOR AUTOMAIL WEBHOOK PAYLOAD
// ============================================================

const automailCustomerSchema = z.object({
  id: z.number(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
});

const automailCustomFieldSchema = z.object({
  id: z.number(),
  name: z.string(),
  value: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
});

const automailThreadSchema = z.object({
  id: z.number(),
  type: z.enum(["note", "message", "customer", "lineitem"]),
  body: z.string(),
  createdAt: z.string(),
});

const automailWebhookPayloadSchema = z.object({
  id: z.number(),
  number: z.number(),
  subject: z.string(),
  customer: automailCustomerSchema,
  customFields: z.array(automailCustomFieldSchema).optional().default([]),
  _embedded: z.object({
    threads: z.array(automailThreadSchema).optional().default([]),
  }).optional(),
  formattedThreads: z.string().optional().default(""),
});

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
    console.error('[Automail Webhook] AUTOMAIL_WEBHOOK_SECRET not configured');
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
    console.warn('[Automail Webhook] Invalid API key attempt from:', req.ip);
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
    validateAutomailApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      // Log incoming webhook event
      const eventType = req.headers['x-freescout-event'] as string || 'unknown';
      console.log(`[Automail Webhook] Received event: ${eventType}`);

      // Validate payload structure
      const validationResult = automailWebhookPayloadSchema.safeParse(req.body);
      if (!validationResult.success) {
        console.error('[Automail Webhook] Validation failed:', validationResult.error.errors);
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

      // Use formattedThreads as the raw text (pre-formatted plain text)
      const rawText = payload.formattedThreads || '';

      if (!rawText || rawText.trim().length < 10) {
        throw ServerError.validation(
          'Insufficient content in webhook payload',
          'Onvoldoende inhoud in de conversatie'
        );
      }

      console.log('[Automail Webhook] Creating report:', {
        clientName,
        conversationId: payload.id,
        conversationNumber: payload.number,
        leadId,
        rawTextLength: rawText.length,
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

      console.log('[Automail Webhook] Report created:', {
        reportId: report.id,
        dossierNumber: report.dossierNumber,
      });

      // Return minimal response with report identifiers
      res.status(HTTP_STATUS.CREATED).json(
        createApiSuccessResponse(
          {
            reportId: report.id,
            dossierNumber: report.dossierNumber,
            clientName: report.clientName,
            title: report.title,
          },
          'Rapport succesvol aangemaakt vanuit Automail'
        )
      );
    })
  );
}
