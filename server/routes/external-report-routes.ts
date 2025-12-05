/**
 * External Report Routes
 *
 * API endpoints for managing external report sessions - allowing users
 * to paste existing reports and get AI-assisted adjustments with diff preview.
 */

import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { AIModelFactory } from "../services/ai-models/ai-model-factory";
import {
  createExternalReportSessionSchema,
  externalReportAdjustRequestSchema,
  externalReportAcceptSchema
} from "@shared/types/api";
import type { PromptConfig } from "@shared/schema";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse, ERROR_CODES } from "@shared/errors";

export const externalReportRouter = Router();

/**
 * GET /api/external-reports
 * List all external report sessions
 */
externalReportRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const sessions = await storage.getAllExternalReportSessions();
  res.json(createApiSuccessResponse(sessions));
}));

/**
 * GET /api/external-reports/:id
 * Get a single external report session with its adjustments
 */
externalReportRouter.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const session = await storage.getExternalReportSession(id);
  if (!session) {
    throw ServerError.notFound("External report session");
  }

  const adjustments = await storage.getAdjustmentsForSession(id);

  res.json(createApiSuccessResponse({
    ...session,
    adjustments
  }));
}));

/**
 * POST /api/external-reports
 * Create a new external report session
 */
externalReportRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const validatedData = createExternalReportSessionSchema.parse(req.body);

  const session = await storage.createExternalReportSession({
    title: validatedData.title,
    originalContent: validatedData.originalContent,
    currentContent: validatedData.originalContent, // Initially same as original
    adjustmentCount: 0
  });

  console.log(`📄 Created external report session: ${session.id}`);

  res.json(createApiSuccessResponse(session, "Externe rapport sessie aangemaakt"));
}));

/**
 * POST /api/external-reports/:id/adjust
 * Generate an adjustment proposal (not committed yet)
 */
externalReportRouter.post("/:id/adjust", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const validatedData = externalReportAdjustRequestSchema.parse(req.body);

  const session = await storage.getExternalReportSession(id);
  if (!session) {
    throw ServerError.notFound("External report session");
  }

  const previousContent = session.currentContent || session.originalContent;
  const newVersion = (session.adjustmentCount || 0) + 1;

  // Get adjustment prompt from config - uses the same "adjustment" stage
  const activeConfig = await storage.getActivePromptConfig();
  const adjustmentConfig = (activeConfig?.config as PromptConfig)?.adjustment;

  if (!adjustmentConfig?.prompt || adjustmentConfig.prompt.trim().length === 0) {
    throw ServerError.business(
      ERROR_CODES.VALIDATION_FAILED,
      'Adjustment prompt niet geconfigureerd. Ga naar Instellingen → Rapport Aanpassen en vul de prompt in.'
    );
  }

  // Replace placeholders
  const adjustmentPrompt = adjustmentConfig.prompt
    .replace(/{HUIDIGE_RAPPORT}/g, previousContent)
    .replace(/{INSTRUCTIE}/g, validatedData.instruction);

  // Get AI config
  const stageAiConfig = adjustmentConfig.aiConfig;
  const globalAiConfig = (activeConfig?.config as PromptConfig)?.aiConfig;

  if (!stageAiConfig?.provider && !globalAiConfig?.provider) {
    throw ServerError.business(
      ERROR_CODES.VALIDATION_FAILED,
      'AI configuratie niet gevonden. Configureer de AI instellingen in Instellingen.'
    );
  }

  const aiConfig = {
    provider: (stageAiConfig?.provider || globalAiConfig?.provider) as 'google' | 'openai',
    model: stageAiConfig?.model || globalAiConfig?.model || 'gemini-2.5-pro',
    temperature: stageAiConfig?.temperature ?? globalAiConfig?.temperature ?? 0.3,
    topP: stageAiConfig?.topP ?? globalAiConfig?.topP ?? 0.95,
    topK: stageAiConfig?.topK ?? globalAiConfig?.topK ?? 40,
    maxOutputTokens: stageAiConfig?.maxOutputTokens ?? globalAiConfig?.maxOutputTokens ?? 65536
  };

  console.log(`📝 [${id}] Generating adjustment v${newVersion} with ${aiConfig.provider}/${aiConfig.model}`);

  // Call AI
  const aiFactory = AIModelFactory.getInstance();
  const response = await aiFactory.callModel(
    aiConfig,
    adjustmentPrompt,
    {
      timeout: 300000,
      jobId: `external-adjust-${id}-${newVersion}`
    }
  );

  const proposedContent = response.content;

  console.log(`✅ [${id}] Adjustment proposal generated (${proposedContent.length} chars)`);

  res.json(createApiSuccessResponse({
    success: true,
    proposedContent,
    previousContent,
    version: newVersion
  }, 'Aanpassing voorstel gegenereerd'));
}));

/**
 * POST /api/external-reports/:id/accept
 * Accept and commit an adjustment
 */
externalReportRouter.post("/:id/accept", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const validatedData = externalReportAcceptSchema.parse(req.body);

  const session = await storage.getExternalReportSession(id);
  if (!session) {
    throw ServerError.notFound("External report session");
  }

  const previousContent = session.currentContent || session.originalContent;
  const newVersion = (session.adjustmentCount || 0) + 1;

  // Save adjustment to history
  await storage.createExternalReportAdjustment({
    sessionId: id,
    version: newVersion,
    instruction: validatedData.instruction,
    previousContent,
    newContent: validatedData.proposedContent
  });

  // Update session with new current content
  await storage.updateExternalReportSession(id, {
    currentContent: validatedData.proposedContent,
    adjustmentCount: newVersion,
    lastInstruction: validatedData.instruction
  });

  console.log(`✅ [${id}] Adjustment v${newVersion} accepted`);

  res.json(createApiSuccessResponse({
    success: true,
    version: newVersion,
    message: `Aanpassing v${newVersion} geaccepteerd`
  }));
}));

/**
 * DELETE /api/external-reports/:id
 * Delete an external report session
 */
externalReportRouter.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const session = await storage.getExternalReportSession(id);
  if (!session) {
    throw ServerError.notFound("External report session");
  }

  await storage.deleteExternalReportSession(id);

  console.log(`🗑️ Deleted external report session: ${id}`);

  res.json(createApiSuccessResponse({ success: true }, "Sessie verwijderd"));
}));
