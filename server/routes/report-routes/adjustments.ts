/**
 * Adjustment Routes
 *
 * Handles post-workflow report adjustments.
 */

import type { Request, Response, Express } from "express";
import { storage } from "../../storage";
import type { PromptConfig, StageId } from "@shared/schema";
import { getLatestConceptText } from "@shared/constants";
import { adjustReportRequestSchema, acceptAdjustmentRequestSchema } from "@shared/types/api";
import { AIModelFactory } from "../../services/ai-models/ai-model-factory";
import { AIConfigResolver } from "../../services/ai-config-resolver";
import { asyncHandler, ServerError } from "../../middleware/errorHandler";
import { createApiSuccessResponse, ERROR_CODES } from "@shared/errors";
import { logger } from "../../services/logger";
import type { ReportRouteDependencies } from "./types";

export function registerAdjustmentRoutes(
  app: Express,
  dependencies: ReportRouteDependencies
): void {
  const { reportProcessor } = dependencies;

  // ============================================================
  // ADJUSTMENT GENERATION
  // ============================================================

  /**
   * Generate an adjustment proposal based on user instruction
   * POST /api/reports/:id/adjust
   */
  app.post("/api/reports/:id/adjust", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId } = req.params;

    logger.info(reportId, 'Adjustment requested');

    const validatedData = adjustReportRequestSchema.parse(req.body);
    const { instruction } = validatedData;

    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    const previousContent = getLatestConceptText(report.conceptReportVersions as Record<string, any>);

    if (!previousContent) {
      throw ServerError.business(
        ERROR_CODES.VALIDATION_FAILED,
        'Geen concept rapport gevonden om aan te passen. Voer eerst de generatie stap uit.'
      );
    }

    const conceptVersions = (report.conceptReportVersions as Record<string, any>) || {};
    const existingAdjustments = Object.keys(conceptVersions).filter(k => k.startsWith('adjustment_'));
    const adjustmentNumber = existingAdjustments.length + 1;
    const adjustmentId = `adjustment_${adjustmentNumber}`;

    const activeConfig = await storage.getActivePromptConfig();

    logger.debug(reportId, 'Active config loaded', {
      configId: activeConfig?.id,
      configKeys: activeConfig?.config ? Object.keys(activeConfig.config as object) : []
    });

    const adjustmentConfig = (activeConfig?.config as PromptConfig)?.adjustment;

    logger.debug(reportId, 'Adjustment config status', {
      exists: !!adjustmentConfig,
      promptLength: adjustmentConfig?.prompt?.length || 0
    });

    if (!adjustmentConfig?.prompt || adjustmentConfig.prompt.trim().length === 0) {
      throw ServerError.business(
        ERROR_CODES.VALIDATION_FAILED,
        'Adjustment prompt niet geconfigureerd. Ga naar Instellingen → Rapport Aanpassen en vul de prompt in.'
      );
    }

    const adjustmentPrompt = adjustmentConfig.prompt
      .replace(/{HUIDIGE_RAPPORT}/g, previousContent)
      .replace(/{INSTRUCTIE}/g, instruction);

    logger.info(reportId, 'Adjustment prompt loaded', { promptLength: adjustmentConfig.prompt.length });

    const configResolver = new AIConfigResolver();
    const aiConfig = configResolver.resolveForStage(
      'adjustment',
      adjustmentConfig ? { aiConfig: adjustmentConfig.aiConfig } : undefined,
      { aiConfig: (activeConfig?.config as PromptConfig)?.aiConfig },
      `adjust-${reportId}`
    );

    logger.info(reportId, 'Using AI config', { provider: aiConfig.provider, model: aiConfig.model });

    const aiFactory = AIModelFactory.getInstance();
    const response = await aiFactory.callModel(
      aiConfig,
      adjustmentPrompt,
      {
        timeout: 300000,
        jobId: `adjust-${reportId}-${adjustmentNumber}`,
        responseFormat: 'json'
      }
    );

    let adjustments: Array<{ context: string; oud: string; nieuw: string; reden: string }> = [];
    try {
      let jsonStr = response.content;
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);
      adjustments = parsed.aanpassingen || parsed.adjustments || [];

      adjustments = adjustments.map((adj, idx) => ({
        id: `adj-${reportId}-${adjustmentNumber}-${idx}`,
        ...adj
      }));
    } catch (parseError) {
      logger.error(reportId, 'Failed to parse AI response as JSON', {
        rawResponse: response.content.substring(0, 500)
      }, parseError instanceof Error ? parseError : undefined);
      res.json(createApiSuccessResponse({
        success: true,
        adjustmentId,
        adjustments: [],
        previousContent,
        metadata: {
          version: adjustmentNumber,
          instruction,
          createdAt: new Date().toISOString()
        },
        _debug: {
          promptUsed: adjustmentPrompt,
          promptLength: adjustmentPrompt.length,
          aiConfig,
          stage: "adjustment",
          parseError: String(parseError),
          rawResponse: response.content.substring(0, 2000)
        }
      }, 'AI response kon niet worden geparsed als JSON - bekijk Developer Tools voor details'));
      return;
    }

    logger.info(reportId, 'Adjustment analysis complete', { adjustmentCount: adjustments.length });

    res.json(createApiSuccessResponse({
      success: true,
      adjustmentId,
      adjustments,
      previousContent,
      metadata: {
        version: adjustmentNumber,
        instruction,
        createdAt: new Date().toISOString()
      },
      _debug: {
        promptUsed: adjustmentPrompt,
        promptLength: adjustmentPrompt.length,
        aiConfig,
        stage: "adjustment"
      }
    }, `${adjustments.length} aanpassingen gevonden - beoordeel en pas toe`));
  }));

  // ============================================================
  // ADJUSTMENT APPLICATION
  // ============================================================

  /**
   * Apply accepted adjustments
   * POST /api/reports/:id/adjust/apply
   */
  app.post("/api/reports/:id/adjust/apply", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId } = req.params;

    const { adjustments, instruction, adjustmentId, mode = "direct" } = req.body;

    logger.info(reportId, 'Applying adjustments', { mode, count: adjustments?.length });

    if (!adjustments || !Array.isArray(adjustments) || adjustments.length === 0) {
      throw ServerError.business(
        ERROR_CODES.VALIDATION_FAILED,
        'Geen aanpassingen om toe te passen. Selecteer minimaal één aanpassing.'
      );
    }

    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    const currentContent = getLatestConceptText(report.conceptReportVersions as Record<string, any>);
    if (!currentContent) {
      throw ServerError.business(
        ERROR_CODES.VALIDATION_FAILED,
        'Geen concept rapport gevonden om aan te passen.'
      );
    }

    let newContent: string;
    let appliedCount = 0;
    let debugInfo: Record<string, any> = {};

    if (mode === "direct") {
      // DIRECT MODE: Supports replace, insert, and delete
      logger.debug(reportId, 'Using direct mode', { adjustmentCount: adjustments.length });

      newContent = currentContent;
      const notFound: string[] = [];
      const applied: { type: string; context: string }[] = [];

      for (const adj of adjustments as {
        type?: "replace" | "insert" | "delete";
        oud?: string;
        nieuw?: string;
        anker?: string;
        context: string
      }[]) {
        const adjType = adj.type || "replace";

        if (adjType === "replace") {
          const oldText = adj.oud || "";
          const newText = adj.nieuw || "";

          if (oldText && newContent.includes(oldText)) {
            newContent = newContent.replace(oldText, newText);
            appliedCount++;
            applied.push({ type: "replace", context: adj.context });
            logger.debug(reportId, 'Replaced text', { preview: oldText.substring(0, 50) });
          } else {
            notFound.push(adj.context || (oldText ? oldText.substring(0, 50) : "unknown"));
            logger.debug(reportId, 'Replace failed - text not found', { context: adj.context });
          }
        }
        else if (adjType === "insert") {
          const ankerText = adj.anker || "";
          const newText = adj.nieuw || "";

          if (ankerText && newText && newContent.includes(ankerText)) {
            const ankerIndex = newContent.indexOf(ankerText);
            const insertPos = ankerIndex + ankerText.length;
            newContent = newContent.slice(0, insertPos) + "\n\n" + newText + newContent.slice(insertPos);
            appliedCount++;
            applied.push({ type: "insert", context: adj.context });
            logger.debug(reportId, 'Inserted text', { anchor: ankerText.substring(0, 50) });
          } else {
            notFound.push(adj.context || "insert failed");
            logger.debug(reportId, 'Insert failed - anchor not found', { context: adj.context });
          }
        }
        else if (adjType === "delete") {
          const oldText = adj.oud || "";

          if (oldText && newContent.includes(oldText)) {
            newContent = newContent.replace(oldText, "");
            appliedCount++;
            applied.push({ type: "delete", context: adj.context });
            logger.debug(reportId, 'Deleted text', { preview: oldText.substring(0, 50) });
          } else {
            notFound.push(adj.context || (oldText ? oldText.substring(0, 50) : "unknown"));
            logger.debug(reportId, 'Delete failed - text not found', { context: adj.context });
          }
        }
      }

      debugInfo = {
        mode: "direct",
        appliedCount,
        applied,
        notFound,
        totalRequested: adjustments.length
      };

      if (notFound.length > 0) {
        logger.warn(reportId, 'Some adjustments could not be applied', { notFoundCount: notFound.length });
      }
    } else {
      // AI MODE: Use Editor prompt
      const activeConfig = await storage.getActivePromptConfig();
      const editorConfig = (activeConfig?.config as PromptConfig)?.editor;

      if (!editorConfig?.prompt || editorConfig.prompt.trim().length === 0) {
        throw ServerError.business(
          ERROR_CODES.VALIDATION_FAILED,
          'Editor (Chirurgische Redacteur) prompt niet geconfigureerd. Ga naar Instellingen en vul de "Editor" prompt in.'
        );
      }

      const adjustmentsText = adjustments.map((adj: { context: string; oud: string; nieuw: string; reden: string }, idx: number) =>
        `${idx + 1}. [${adj.context}]\n   OUD: "${adj.oud}"\n   NIEUW: "${adj.nieuw}"\n   REDEN: ${adj.reden}`
      ).join('\n\n');

      const editorPrompt = editorConfig.prompt
        .replace(/{HUIDIGE_RAPPORT}/g, currentContent)
        .replace(/{CONCEPT_RAPPORT}/g, currentContent)
        .replace(/{AANPASSINGEN}/g, adjustmentsText)
        .replace(/{FEEDBACK}/g, adjustmentsText)
        .replace(/{AANTAL_AANPASSINGEN}/g, String(adjustments.length));

      const editorConfigResolver = new AIConfigResolver();
      const aiConfig = editorConfigResolver.resolveForStage(
        'editor',
        editorConfig ? { aiConfig: editorConfig.aiConfig } : undefined,
        { aiConfig: (activeConfig?.config as PromptConfig)?.aiConfig },
        `apply-${reportId}`
      );

      logger.info(reportId, 'Using AI for adjustments', { provider: aiConfig.provider, model: aiConfig.model, count: adjustments.length });

      const aiFactory = AIModelFactory.getInstance();
      const response = await aiFactory.callModel(
        aiConfig,
        editorPrompt,
        {
          timeout: 300000,
          jobId: `adjust-apply-${reportId}`
        }
      );

      newContent = response.content;
      appliedCount = adjustments.length;
      debugInfo = {
        mode: "ai",
        promptUsed: editorPrompt,
        promptLength: editorPrompt.length,
        aiConfig,
        stage: "editor"
      };
    }

    // Save the result
    const currentVersions = report.conceptReportVersions as Record<string, any> || {};
    const fromStage = currentVersions.latest?.pointer as StageId | undefined;

    const snapshot = await reportProcessor.createSnapshot(
      reportId,
      adjustmentId as StageId,
      newContent,
      fromStage
    );

    const updatedVersions = await reportProcessor.updateConceptVersions(
      reportId,
      adjustmentId as StageId,
      snapshot
    );

    await storage.updateReport(reportId, {
      conceptReportVersions: updatedVersions,
      generatedContent: newContent,
      updatedAt: new Date()
    });

    logger.info(reportId, 'Adjustments applied', { applied: appliedCount, total: adjustments.length, version: snapshot.v, mode });

    res.json(createApiSuccessResponse({
      success: true,
      newContent,
      appliedCount,
      newVersion: snapshot.v,
      stageId: adjustmentId,
      _debug: debugInfo
    }, `${appliedCount} aanpassingen toegepast - nieuwe versie ${snapshot.v}`));
  }));

  // ============================================================
  // LEGACY: ADJUSTMENT ACCEPT
  // ============================================================

  /**
   * Accept a previously generated adjustment proposal (legacy)
   * POST /api/reports/:id/adjust/accept
   */
  app.post("/api/reports/:id/adjust/accept", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId } = req.params;

    logger.info(reportId, 'Accepting adjustment (legacy)');

    const validatedData = acceptAdjustmentRequestSchema.parse(req.body);
    const { adjustmentId, proposedContent, instruction } = validatedData;

    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    const snapshot = await reportProcessor.createSnapshot(
      reportId,
      adjustmentId as StageId,
      proposedContent
    );

    const updatedVersions = await reportProcessor.updateConceptVersions(
      reportId,
      adjustmentId as StageId,
      snapshot
    );

    await storage.updateReport(reportId, {
      conceptReportVersions: updatedVersions,
      generatedContent: proposedContent,
      updatedAt: new Date()
    });

    logger.info(reportId, 'Adjustment accepted', { adjustmentId, version: snapshot.v });

    res.json(createApiSuccessResponse({
      success: true,
      newVersion: snapshot.v,
      stageId: adjustmentId,
      message: `Aanpassing succesvol toegepast - nieuwe versie ${snapshot.v}`
    }, 'Aanpassing geaccepteerd'));
  }));
}
