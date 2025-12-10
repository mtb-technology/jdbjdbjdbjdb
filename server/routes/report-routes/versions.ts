/**
 * Version Management Routes
 *
 * Handles concept versions, snapshots, restore, and document state.
 */

import type { Request, Response, Express } from "express";
import { storage } from "../../storage";
import { ReportGenerator } from "../../services/report-generator";
import type { StageId } from "@shared/schema";
import { overrideConceptRequestSchema, promoteSnapshotRequestSchema } from "@shared/types/api";
import { asyncHandler, ServerError } from "../../middleware/errorHandler";
import { createApiSuccessResponse, ERROR_CODES } from "@shared/errors";
import type { ReportRouteDependencies } from "./types";

export function registerVersionRoutes(
  app: Express,
  dependencies: ReportRouteDependencies
): void {
  const { reportProcessor } = dependencies;

  // ============================================================
  // VERSION RESTORE
  // ============================================================

  /**
   * Restore to a previous version by making it the "latest"
   * POST /api/reports/:id/restore-version
   */
  app.post("/api/reports/:id/restore-version", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { stageKey } = req.body;

    if (!stageKey) {
      throw ServerError.validation("stageKey is required", "stageKey is verplicht");
    }

    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    const currentConceptVersions = (report.conceptReportVersions as Record<string, any>) || {};

    const history = currentConceptVersions.history || [];
    const versionEntry = history.find((entry: any) => entry.stageId === stageKey);

    if (!versionEntry) {
      throw ServerError.validation(`Stage ${stageKey} not found in version history`, `Versie ${stageKey} niet gevonden in de geschiedenis`);
    }

    currentConceptVersions.latest = {
      pointer: stageKey as StageId,
      v: versionEntry.v || 1
    };

    const updatedReport = await storage.updateReport(id, {
      conceptReportVersions: currentConceptVersions,
    });

    if (!updatedReport) {
      throw ServerError.notFound("Updated report not found");
    }

    console.log(`Restored report ${id} to version ${stageKey}`);

    res.json(createApiSuccessResponse({
      report: updatedReport,
      restoredStage: stageKey
    }, `Versie ${stageKey} is nu de actieve versie`));
  }));

  // ============================================================
  // CONCEPT OVERRIDE
  // ============================================================

  /**
   * Override concept content for a specific stage
   * POST /api/reports/:id/stage/:stageId/override-concept
   */
  app.post("/api/reports/:id/stage/:stageId/override-concept", asyncHandler(async (req: Request, res: Response) => {
    const { id, stageId } = req.params;
    const payload = overrideConceptRequestSchema.parse(req.body);

    console.log(`[${id}] Overriding concept for stage ${stageId}:`, {
      contentLength: payload.content.length,
      fromStage: payload.fromStage,
      reason: payload.reason
    });

    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    const snapshot = await reportProcessor.createSnapshot(
      id,
      stageId as StageId,
      payload.content
    );

    const updatedVersions = await reportProcessor.updateConceptVersions(
      id,
      stageId as StageId,
      snapshot
    );

    await storage.updateReport(id, {
      currentStage: stageId as StageId,
      conceptReportVersions: updatedVersions,
      generatedContent: payload.content,
      updatedAt: new Date()
    });

    console.log(`[${id}] Concept overridden for ${stageId} - new version ${snapshot.v}`);

    res.json(createApiSuccessResponse({
      success: true,
      newLatestStage: stageId,
      newLatestVersion: snapshot.v,
      message: `Concept voor ${stageId} succesvol overschreven`
    }, "Concept rapport overschreven"));
  }));

  // ============================================================
  // SNAPSHOT PROMOTION
  // ============================================================

  /**
   * Promote a previous stage snapshot to be the latest
   * POST /api/reports/:id/snapshots/promote
   */
  app.post("/api/reports/:id/snapshots/promote", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { stageId, reason } = promoteSnapshotRequestSchema.parse(req.body);

    console.log(`[${id}] Promoting stage ${stageId} to latest:`, { reason });

    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    const conceptVersions = (report.conceptReportVersions as any) || {};
    const targetStageSnapshot = conceptVersions[stageId as StageId];

    if (!targetStageSnapshot) {
      throw ServerError.business(ERROR_CODES.REPORT_NOT_FOUND, `Geen snapshot gevonden voor stage ${stageId}`);
    }

    const updatedVersions = {
      ...conceptVersions,
      latest: {
        pointer: stageId as StageId,
        v: targetStageSnapshot.v
      },
      history: [
        ...(conceptVersions.history || []),
        {
          stageId: stageId as StageId,
          v: targetStageSnapshot.v,
          timestamp: new Date().toISOString(),
          action: 'promote',
          reason: reason || 'Promoted to latest'
        }
      ]
    };

    await storage.updateReport(id, {
      currentStage: stageId as StageId,
      conceptReportVersions: updatedVersions,
      generatedContent: targetStageSnapshot.content || targetStageSnapshot,
      updatedAt: new Date()
    });

    console.log(`[${id}] Stage ${stageId} promoted to latest - version ${targetStageSnapshot.v}`);

    res.json(createApiSuccessResponse({
      success: true,
      newLatestStage: stageId,
      newLatestVersion: targetStageSnapshot.v,
      message: `Stage ${stageId} is nu de actieve versie`
    }, "Stage gepromoveerd naar latest"));
  }));

  // ============================================================
  // DOCUMENT STATE (TIPTAP)
  // ============================================================

  /**
   * Get TipTap-formatted content for editor
   * GET /api/reports/:id/tiptap-content
   */
  app.get("/api/reports/:id/tiptap-content", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    const report = await storage.getReport(reportId);

    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    // If documentState already exists, return it
    if (report.documentState && Object.keys(report.documentState).length > 0) {
      return res.json(report.documentState);
    }

    // Get markdown content from conceptReportVersions
    const versions = report.conceptReportVersions as any;
    let markdownContent = '';

    if (versions?.latest?.pointer) {
      const latestSnapshot = versions[versions.latest.pointer];
      if (latestSnapshot?.content) {
        markdownContent = latestSnapshot.content;
      }
    }

    // Fallback to generatedContent
    if (!markdownContent && report.generatedContent) {
      markdownContent = report.generatedContent;
    }

    if (!markdownContent) {
      return res.json({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Geen content beschikbaar' }] }]
      });
    }

    // Import TextStyler and convert markdown to TipTap
    const { TextStyler } = await import('../../services/text-styler.js');
    const reportGenerator = new ReportGenerator();
    const textStyler = new TextStyler(reportGenerator);

    const tipTapContent = textStyler.markdownToTipTap(markdownContent);

    res.json(tipTapContent);
  }));

  /**
   * Save document state (TipTap content)
   * PATCH /api/reports/:id/document-state
   */
  app.patch("/api/reports/:id/document-state", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;
    const { documentState } = req.body;

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    if (!documentState) {
      throw ServerError.validation('Document state is required', 'Document state is verplicht');
    }

    const report = await storage.getReport(reportId);

    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    await storage.updateReport(reportId, {
      documentState: documentState
    });

    console.log(`Document state saved for report ${reportId}`);

    res.json(createApiSuccessResponse({ success: true }));
  }));

  /**
   * Save manual edits to the concept report content
   * PATCH /api/reports/:id/concept-content
   */
  app.patch("/api/reports/:id/concept-content", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;
    const { content } = req.body;

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    if (!content || typeof content !== 'string') {
      throw ServerError.validation('Content is required', 'Content is verplicht');
    }

    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    const existingVersions = (report.conceptReportVersions as Record<string, any>) || {};
    const currentLatest = existingVersions.latest;
    const nextVersion = (currentLatest?.v || 0) + 1;
    const timestamp = new Date().toISOString();

    const stageId = `manual_edit_${nextVersion}`;
    const updatedVersions = {
      ...existingVersions,
      [stageId]: {
        content,
        v: nextVersion,
        timestamp,
        source: 'manual_edit'
      },
      latest: {
        pointer: stageId,
        v: nextVersion
      },
      history: [
        ...(existingVersions.history || []),
        { stageId, v: nextVersion, timestamp }
      ]
    };

    await storage.updateReport(reportId, {
      conceptReportVersions: updatedVersions,
      generatedContent: content
    });

    console.log(`Manual concept edit saved for report ${reportId} (v${nextVersion})`);

    res.json(createApiSuccessResponse({
      success: true,
      version: nextVersion,
      stageId
    }));
  }));

  // ============================================================
  // ROLLBACK
  // ============================================================

  /**
   * Roll back a single change made by a reviewer stage
   * POST /api/reports/:id/rollback-change
   */
  app.post("/api/reports/:id/rollback-change", asyncHandler(async (req: Request, res: Response) => {
    const { id: reportId } = req.params;
    const { stageId, changeIndex } = req.body;

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    if (!stageId || typeof stageId !== 'string') {
      throw ServerError.validation('Stage ID is required', 'Stage ID is verplicht');
    }

    if (typeof changeIndex !== 'number' || changeIndex < 0) {
      throw ServerError.validation('Valid change index is required', 'Geldige change index is verplicht');
    }

    const { rollbackChange } = await import('../../services/rollback-service');

    const result = await rollbackChange({
      reportId,
      stageId,
      changeIndex,
    });

    if (!result.success) {
      throw ServerError.business(ERROR_CODES.VALIDATION_FAILED, result.error || 'Rollback mislukt');
    }

    console.log(`Change rolled back: ${stageId} #${changeIndex} -> v${result.newVersion}`);

    res.json(createApiSuccessResponse({
      success: true,
      newContent: result.newContent,
      newVersion: result.newVersion,
      warning: result.warning,
    }));
  }));
}
