/**
 * External Report Routes
 *
 * API endpoints for managing external report sessions - allowing users
 * to paste existing reports and get AI-assisted adjustments with diff preview.
 *
 * Two-step flow:
 * 1. POST /:id/analyze - Generates JSON with proposed adjustments
 * 2. POST /:id/apply - Applies accepted adjustments using Editor prompt
 */

import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { AIModelFactory } from "../services/ai-models/ai-model-factory";
import { AIConfigResolver } from "../services/ai-config-resolver";
import {
  createExternalReportSessionSchema,
  externalReportAdjustRequestSchema,
  externalReportAcceptSchema,
  externalReportAnalyzeRequestSchema,
  externalReportApplyRequestSchema
} from "@shared/types/api";
import type { PromptConfig } from "@shared/schema";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse, ERROR_CODES } from "@shared/errors";

// Shared AIConfigResolver instance
const configResolver = new AIConfigResolver();

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

  // Get AI config via AIConfigResolver - GEEN hardcoded defaults
  const aiConfig = configResolver.resolveForStage(
    'adjustment',
    adjustmentConfig ? { aiConfig: adjustmentConfig.aiConfig } : undefined,
    { aiConfig: (activeConfig?.config as PromptConfig)?.aiConfig },
    `external-adjust-${id}`
  );

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
 * POST /api/external-reports/:id/analyze
 * Step 1: Generate JSON with proposed adjustments using "adjustment" prompt (same as reviewers)
 */
externalReportRouter.post("/:id/analyze", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const validatedData = externalReportAnalyzeRequestSchema.parse(req.body);

  const session = await storage.getExternalReportSession(id);
  if (!session) {
    throw ServerError.notFound("External report session");
  }

  const currentContent = session.currentContent || session.originalContent;
  const newVersion = (session.adjustmentCount || 0) + 1;

  // Get adjustment prompt from config (reuse existing "adjustment" stage)
  const activeConfig = await storage.getActivePromptConfig();
  const adjustmentConfig = (activeConfig?.config as PromptConfig)?.adjustment;

  if (!adjustmentConfig?.prompt || adjustmentConfig.prompt.trim().length === 0) {
    throw ServerError.business(
      ERROR_CODES.VALIDATION_FAILED,
      'Rapport Aanpassen prompt niet geconfigureerd. Ga naar Instellingen en vul de "Rapport Aanpassen" prompt in.'
    );
  }

  // Replace placeholders
  const analyzerPrompt = adjustmentConfig.prompt
    .replace(/{HUIDIGE_RAPPORT}/g, currentContent)
    .replace(/{INSTRUCTIE}/g, validatedData.instruction);

  // Get AI config via AIConfigResolver - GEEN hardcoded defaults
  const aiConfig = configResolver.resolveForStage(
    'adjustment',
    adjustmentConfig ? { aiConfig: adjustmentConfig.aiConfig } : undefined,
    { aiConfig: (activeConfig?.config as PromptConfig)?.aiConfig },
    `external-analyze-${id}`
  );

  console.log(`🔍 [${id}] Analyzing report v${newVersion} with ${aiConfig.provider}/${aiConfig.model}`);

  // Call AI - use responseFormat: 'json' to force valid JSON output
  const aiFactory = AIModelFactory.getInstance();
  const response = await aiFactory.callModel(
    aiConfig,
    analyzerPrompt,
    {
      timeout: 300000,
      jobId: `external-analyze-${id}-${newVersion}`,
      responseFormat: 'json' // Force structured JSON output to prevent Markdown responses
    }
  );

  // Parse JSON response from AI
  let adjustments: Array<{ context: string; oud: string; nieuw: string; reden: string }> = [];
  try {
    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonStr = response.content;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    adjustments = parsed.aanpassingen || parsed.adjustments || [];

    // Add IDs to each adjustment
    adjustments = adjustments.map((adj, idx) => ({
      id: `adj-${id}-${newVersion}-${idx}`,
      ...adj
    }));
  } catch (parseError) {
    console.error(`❌ [${id}] Failed to parse AI response as JSON:`, parseError);
    console.error(`❌ [${id}] Raw AI response:`, response.content.substring(0, 500));
    // Return empty adjustments with debug info so user can see what went wrong
    res.json(createApiSuccessResponse({
      success: true,
      adjustments: [],
      instruction: validatedData.instruction,
      version: newVersion,
      _debug: {
        promptUsed: analyzerPrompt,
        promptLength: analyzerPrompt.length,
        aiConfig,
        stage: "adjustment",
        parseError: String(parseError),
        rawResponse: response.content.substring(0, 2000)
      }
    }, 'AI response kon niet worden geparsed als JSON - bekijk Developer Tools voor details'));
    return;
  }

  console.log(`✅ [${id}] Analysis complete: ${adjustments.length} adjustments proposed`);

  res.json(createApiSuccessResponse({
    success: true,
    adjustments,
    instruction: validatedData.instruction,
    version: newVersion,
    // Debug info: include prompt details
    _debug: {
      promptUsed: analyzerPrompt,
      promptLength: analyzerPrompt.length,
      aiConfig,
      stage: "adjustment"
    }
  }, `${adjustments.length} aanpassingen gevonden`));
}));

/**
 * POST /api/external-reports/:id/apply
 * Step 2: Apply accepted adjustments using existing "editor" prompt (Chirurgische Redacteur)
 */
externalReportRouter.post("/:id/apply", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const validatedData = externalReportApplyRequestSchema.parse(req.body);

  if (validatedData.adjustments.length === 0) {
    throw ServerError.business(
      ERROR_CODES.VALIDATION_FAILED,
      'Geen aanpassingen om toe te passen. Selecteer minimaal één aanpassing.'
    );
  }

  const session = await storage.getExternalReportSession(id);
  if (!session) {
    throw ServerError.notFound("External report session");
  }

  const currentContent = session.currentContent || session.originalContent;
  const newVersion = (session.adjustmentCount || 0) + 1;

  // Get editor prompt from config (reuse existing "editor" stage - Chirurgische Redacteur)
  const activeConfig = await storage.getActivePromptConfig();
  const editorConfig = (activeConfig?.config as PromptConfig)?.editor;

  if (!editorConfig?.prompt || editorConfig.prompt.trim().length === 0) {
    throw ServerError.business(
      ERROR_CODES.VALIDATION_FAILED,
      'Editor (Chirurgische Redacteur) prompt niet geconfigureerd. Ga naar Instellingen en vul de "Editor" prompt in.'
    );
  }

  // Format adjustments for the editor prompt (same format as reviewer feedback)
  const adjustmentsText = validatedData.adjustments.map((adj, idx) =>
    `${idx + 1}. [${adj.context}]\n   OUD: "${adj.oud}"\n   NIEUW: "${adj.nieuw}"\n   REDEN: ${adj.reden}`
  ).join('\n\n');

  // Replace placeholders (editor prompt uses these placeholders)
  const editorPrompt = editorConfig.prompt
    .replace(/{HUIDIGE_RAPPORT}/g, currentContent)
    .replace(/{CONCEPT_RAPPORT}/g, currentContent)
    .replace(/{AANPASSINGEN}/g, adjustmentsText)
    .replace(/{FEEDBACK}/g, adjustmentsText)
    .replace(/{AANTAL_AANPASSINGEN}/g, String(validatedData.adjustments.length));

  // Get AI config via AIConfigResolver - GEEN hardcoded defaults
  const aiConfig = configResolver.resolveForStage(
    'editor',
    editorConfig ? { aiConfig: editorConfig.aiConfig } : undefined,
    { aiConfig: (activeConfig?.config as PromptConfig)?.aiConfig },
    `external-apply-${id}`
  );

  console.log(`✏️ [${id}] Applying ${validatedData.adjustments.length} adjustments v${newVersion} with ${aiConfig.provider}/${aiConfig.model}`);

  // Call AI
  const aiFactory = AIModelFactory.getInstance();
  const response = await aiFactory.callModel(
    aiConfig,
    editorPrompt,
    {
      timeout: 300000,
      jobId: `external-apply-${id}-${newVersion}`
    }
  );

  const newContent = response.content;

  // Save adjustment to history
  await storage.createExternalReportAdjustment({
    sessionId: id,
    version: newVersion,
    instruction: validatedData.instruction,
    previousContent: currentContent,
    newContent
  });

  // Update session with new current content
  await storage.updateExternalReportSession(id, {
    currentContent: newContent,
    adjustmentCount: newVersion,
    lastInstruction: validatedData.instruction
  });

  console.log(`✅ [${id}] Applied ${validatedData.adjustments.length} adjustments, saved as v${newVersion}`);

  res.json(createApiSuccessResponse({
    success: true,
    newContent,
    appliedCount: validatedData.adjustments.length,
    version: newVersion,
    // Debug info: include prompt details
    _debug: {
      promptUsed: editorPrompt,
      promptLength: editorPrompt.length,
      aiConfig,
      stage: "editor"
    }
  }, `${validatedData.adjustments.length} aanpassingen toegepast`));
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
