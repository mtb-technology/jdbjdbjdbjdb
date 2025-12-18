/**
 * Report CRUD Operations
 *
 * Basic Create, Read, Update, Delete operations for reports.
 * Also includes source validation and list endpoints.
 */

import type { Request, Response } from "express";
import type { Express } from "express";
import { storage } from "../../storage";
import { dossierSchema, bouwplanSchema } from "@shared/schema";
import type { DossierData, BouwplanData } from "@shared/schema";
import { createReportRequestSchema } from "@shared/types/api";
import { asyncHandler, ServerError } from "../../middleware/errorHandler";
import { createApiSuccessResponse, ERROR_CODES } from "@shared/errors";
import { HTTP_STATUS } from "../../config/constants";
import { logger } from "../../services/logger";
import type { ReportRouteDependencies } from "./types";

export function registerCrudRoutes(
  app: Express,
  dependencies: ReportRouteDependencies
): void {
  const { reportGenerator, sourceValidator } = dependencies;

  // ============================================================
  // DOSSIER EXTRACTION
  // ============================================================

  /**
   * Extract dossier data from raw text using AI
   * POST /api/extract-dossier
   */
  app.post("/api/extract-dossier", asyncHandler(async (req: Request, res: Response) => {
    const { rawText } = req.body;

    if (!rawText || typeof rawText !== 'string') {
      throw ServerError.validation(
        'Missing or invalid rawText parameter',
        'Tekst is verplicht voor het extraheren van dossiergegevens'
      );
    }

    const parsedData = await reportGenerator.extractDossierData(rawText);

    // Validate extracted data against schemas
    const validatedDossier = dossierSchema.parse(parsedData.dossier);
    const validatedBouwplan = bouwplanSchema.parse(parsedData.bouwplan);

    res.json(createApiSuccessResponse({
      dossier: validatedDossier,
      bouwplan: validatedBouwplan,
    }, "Dossiergegevens succesvol geëxtraheerd"));
  }));

  // ============================================================
  // REPORT CRUD
  // ============================================================

  /**
   * Create new report (start workflow)
   * POST /api/reports/create
   */
  app.post("/api/reports/create", asyncHandler(async (req: Request, res: Response) => {
    const validatedData = createReportRequestSchema.parse(req.body);
    const { clientName, rawText } = validatedData;

    logger.info('reports', 'Creating new report', {
      clientName,
      rawTextLength: rawText.length
    });

    const report = await storage.createReport({
      title: clientName,
      clientName: clientName,
      dossierData: { rawText, klant: { naam: clientName } },
      bouwplanData: {},
      generatedContent: null,
      stageResults: {},
      conceptReportVersions: {},
      currentStage: "1a_informatiecheck",
      status: "processing",
    });

    logger.info('reports', 'Report created successfully', { reportId: report.id });
    res.json(createApiSuccessResponse(report, "Rapport succesvol aangemaakt"));
  }));

  /**
   * Get all reports
   * GET /api/reports
   */
  app.get("/api/reports", asyncHandler(async (req: Request, res: Response) => {
    const reports = await storage.getAllReports();
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(createApiSuccessResponse(reports));
  }));

  /**
   * Restore client names from dossier_context_summary
   * POST /api/reports/restore-client-names
   * Must be defined BEFORE /api/reports/:id to avoid route conflict
   */
  app.post("/api/reports/restore-client-names", asyncHandler(async (req: Request, res: Response) => {
    logger.info('reports', 'Starting client name restoration');
    const result = await storage.restoreClientNamesFromContext();
    logger.info('reports', 'Restoration complete', result);
    res.json(createApiSuccessResponse(result, `Client names restored: ${result.updated} updated, ${result.failed} failed/skipped`));
  }));

  /**
   * Get specific report
   * GET /api/reports/:id
   */
  app.get("/api/reports/:id", asyncHandler(async (req: Request, res: Response) => {
    const report = await storage.getReport(req.params.id);
    if (!report) {
      throw ServerError.notFound("Rapport");
    }

    // ETag caching for conditional requests
    const lastModified = report.updatedAt || report.createdAt || new Date();
    const etag = `"report-${report.id}-${lastModified.getTime()}"`;

    const clientETag = req.headers['if-none-match'];
    if (clientETag === etag) {
      res.status(HTTP_STATUS.NOT_MODIFIED).end();
      return;
    }

    res.set('Cache-Control', 'public, max-age=5, stale-while-revalidate=15');
    res.set('ETag', etag);
    res.set('Last-Modified', lastModified.toUTCString());

    res.json(createApiSuccessResponse(report));
  }));

  /**
   * Duplicate a report (full copy)
   * POST /api/reports/:id/duplicate
   * Creates a complete copy of the report with all data preserved
   */
  app.post("/api/reports/:id/duplicate", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const sourceReport = await storage.getReport(id);
    if (!sourceReport) {
      throw ServerError.notFound("Report");
    }

    // Create full duplicate with all data
    const duplicate = await storage.createReport({
      title: `${sourceReport.title} (kopie)`,
      clientName: sourceReport.clientName,
      dossierData: sourceReport.dossierData as DossierData,
      bouwplanData: sourceReport.bouwplanData as BouwplanData,
      generatedContent: sourceReport.generatedContent,
      stageResults: sourceReport.stageResults as Record<string, unknown>,
      conceptReportVersions: sourceReport.conceptReportVersions as Record<string, string>,
      currentStage: sourceReport.currentStage,
      status: sourceReport.status,
    });

    logger.info(id, 'Report duplicated', { newId: duplicate.id });
    res.json(createApiSuccessResponse(duplicate, "Rapport gedupliceerd"));
  }));

  // ============================================================
  // SOURCES
  // ============================================================

  /**
   * Validate a source URL
   * POST /api/sources/validate
   */
  app.post("/api/sources/validate", asyncHandler(async (req: Request, res: Response) => {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      throw ServerError.validation("URL is required", "URL is verplicht");
    }

    const isValid = await sourceValidator.validateSource(url);
    res.json(createApiSuccessResponse({ valid: isValid }));
  }));

  /**
   * Get all verified sources
   * GET /api/sources
   */
  app.get("/api/sources", asyncHandler(async (req: Request, res: Response) => {
    const sources = await storage.getAllSources();
    res.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=1200');
    res.json(createApiSuccessResponse(sources));
  }));

  // ============================================================
  // PROMPT TEMPLATES
  // ============================================================

  /**
   * Get prompt template for a stage (for new cases without existing report)
   * GET /api/prompt-templates/:stageKey
   */
  app.get("/api/prompt-templates/:stageKey", asyncHandler(async (req: Request, res: Response) => {
    const { stageKey } = req.params;

    const promptConfig = await storage.getActivePromptConfig();
    if (!promptConfig?.config?.[stageKey as keyof typeof promptConfig.config]) {
      throw ServerError.notFound("Prompt template niet gevonden voor deze stap");
    }

    const stageConfig = promptConfig.config[stageKey as keyof typeof promptConfig.config] as any;
    const prompt = stageConfig?.prompt || "";

    const currentDate = new Date().toLocaleDateString('nl-NL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const templatePrompt = `${prompt}\n\n### Datum: ${currentDate}`;

    res.json(createApiSuccessResponse({ prompt: templatePrompt }));
  }));

  /**
   * Finalize report (mark as complete)
   * POST /api/reports/:id/finalize
   */
  app.post("/api/reports/:id/finalize", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    const conceptVersions = report.conceptReportVersions as Record<string, string> || {};
    const latestConceptKeys = Object.keys(conceptVersions).filter(key => key !== 'latest' && key !== 'history');

    if (latestConceptKeys.length === 0) {
      throw ServerError.business(
        ERROR_CODES.REPORT_NOT_FOUND,
        'Geen concept rapport versies gevonden - voer minimaal stap 3 (Generatie) uit'
      );
    }

    const finalContent = conceptVersions[latestConceptKeys[latestConceptKeys.length - 1]];

    const finalizedReport = await storage.updateReport(id, {
      generatedContent: finalContent,
      status: "generated",
    });

    res.json(createApiSuccessResponse(finalizedReport, "Rapport succesvol gefinaliseerd"));
  }));
}
