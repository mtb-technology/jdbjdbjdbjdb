/**
 * Case Management Routes
 *
 * CRUD operations for cases/reports with pagination, filtering,
 * status management, and export functionality.
 */

import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { PDFGenerator } from "../services/pdf-generator";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse } from "@shared/errors";
import { CACHE, HTTP_STATUS } from "../config/constants";

export function registerCaseRoutes(app: Express, pdfGenerator: PDFGenerator): void {
  /**
   * GET /api/cases
   *
   * Get all cases/reports with pagination and filtering.
   *
   * Query params:
   * - page: number (default: 1)
   * - limit: number (default: 10, max: 100)
   * - status: string (optional filter)
   * - search: string (optional search)
   *
   * Response: Paginated list of cases
   */
  app.get("/api/cases", asyncHandler(async (req: Request, res: Response) => {
    const { page = 1, limit = 10, status, search } = req.query;

    const cases = await storage.getAllReports({
      page: Number(page),
      limit: Number(limit),
      status: status as string,
      search: search as string
    });

    // Add caching headers for case list
    res.set('Cache-Control', `public, max-age=${CACHE.REPORT_LIST_TTL / 1000}, stale-while-revalidate=60`);
    res.json(createApiSuccessResponse(cases));
  }));

  /**
   * GET /api/cases/:id
   *
   * Get specific case by ID.
   *
   * Response: Case/report object
   */
  app.get("/api/cases/:id", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const report = await storage.getReport(id);

    if (!report) {
      throw ServerError.notFound("Case");
    }

    res.json(createApiSuccessResponse(report));
  }));

  /**
   * PATCH /api/cases/:id
   *
   * Update case metadata. Only clientName is user-editable.
   * Title is auto-generated from dossierNumber + clientName.
   *
   * Request body: { clientName }
   * Response: Updated case object with new title
   */
  app.patch("/api/cases/:id", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { clientName } = req.body;

    // Only clientName is editable - title is auto-generated
    if (clientName === undefined) {
      throw ServerError.validation("No fields to update", "Geen velden om bij te werken");
    }

    if (typeof clientName !== 'string' || clientName.trim().length === 0) {
      throw ServerError.validation("Client name cannot be empty", "Clientnaam mag niet leeg zijn");
    }

    // Get current report to access dossierNumber
    const currentReport = await storage.getReport(id);
    if (!currentReport) {
      throw ServerError.notFound("Case");
    }

    // Auto-generate title from dossierNumber + clientName
    const formattedNumber = String(currentReport.dossierNumber).padStart(4, '0');
    const newTitle = `D-${formattedNumber} - ${clientName.trim()}`;

    const updates = {
      clientName: clientName.trim(),
      title: newTitle,
    };

    const updatedReport = await storage.updateReport(id, updates);

    if (!updatedReport) {
      throw ServerError.notFound("Case");
    }

    res.json(createApiSuccessResponse(updatedReport, "Case succesvol bijgewerkt"));
  }));

  /**
   * PATCH /api/cases/:id/status
   *
   * Update case status.
   *
   * Request body: { status: 'draft' | 'processing' | 'generated' | 'exported' | 'archived' }
   * Response: Success confirmation
   */
  app.patch("/api/cases/:id/status", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!["draft", "processing", "generated", "exported", "archived"].includes(status)) {
      throw ServerError.validation("Invalid status value", "Ongeldige status");
    }

    await storage.updateReportStatus(id, status);
    res.json(createApiSuccessResponse({ success: true }, "Status succesvol bijgewerkt"));
  }));

  /**
   * DELETE /api/cases/:id
   *
   * Delete a case.
   *
   * Response: Success confirmation
   */
  app.delete("/api/cases/:id", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    await storage.deleteReport(id);
    res.json(createApiSuccessResponse({ success: true }, "Case succesvol verwijderd"));
  }));

  /**
   * GET /api/cases/:id/export/:format
   *
   * Export case in different formats (html, json, pdf).
   *
   * Params:
   * - id: string (case ID)
   * - format: 'html' | 'json' | 'pdf'
   *
   * Response: File download
   */
  app.get("/api/cases/:id/export/:format", asyncHandler(async (req: Request, res: Response) => {
    const { id, format } = req.params;
    const report = await storage.getReport(id);

    if (!report) {
      throw ServerError.notFound("Case");
    }

    if (format === "html") {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="case-${id}.html"`);
      res.send(report.generatedContent || "Geen content beschikbaar");
    } else if (format === "json") {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="case-${id}.json"`);
      res.json(createApiSuccessResponse(report));
    } else if (format === "pdf") {
      const pdfBuffer = await pdfGenerator.generatePDF(report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="rapport-${report.clientName.replace(/[^a-zA-Z0-9]/g, '-')}-${id.slice(0, 8)}.pdf"`);
      res.send(pdfBuffer);
    } else {
      throw ServerError.validation("Invalid export format", "Ongeldige export format");
    }
  }));
}
