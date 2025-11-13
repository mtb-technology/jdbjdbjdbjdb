/**
 * Case Management Routes
 *
 * CRUD operations for cases/reports with pagination, filtering,
 * status management, and export functionality.
 */

import type { Express } from "express";
import { storage } from "../storage";
import { PDFGenerator } from "../services/pdf-generator";
import { createApiSuccessResponse } from "@shared/errors";
import { CACHE } from "../config/constants";

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
  app.get("/api/cases", async (req, res) => {
    try {
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
    } catch (error: any) {
      console.error("Error fetching cases:", error);
      res.status(500).json({ message: "Fout bij ophalen cases" });
    }
  });

  /**
   * GET /api/cases/:id
   *
   * Get specific case by ID.
   *
   * Response: Case/report object
   */
  app.get("/api/cases/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const report = await storage.getReport(id);

      if (!report) {
        res.status(404).json({ message: "Case niet gevonden" });
        return;
      }

      res.json(createApiSuccessResponse(report));
    } catch (error: any) {
      console.error("Error fetching case:", error);
      res.status(500).json({ message: "Fout bij ophalen case" });
    }
  });

  /**
   * PATCH /api/cases/:id
   *
   * Update case metadata (title and clientName).
   *
   * Request body: { title?, clientName? }
   * Response: Updated case object
   */
  app.patch("/api/cases/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { title, clientName } = req.body;

      // Validate input
      const updates: any = {};

      if (title !== undefined) {
        if (typeof title !== 'string' || title.trim().length === 0) {
          res.status(400).json({ message: "Titel mag niet leeg zijn" });
          return;
        }
        updates.title = title.trim();
      }

      if (clientName !== undefined) {
        if (typeof clientName !== 'string' || clientName.trim().length === 0) {
          res.status(400).json({ message: "Clientnaam mag niet leeg zijn" });
          return;
        }
        updates.clientName = clientName.trim();
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ message: "Geen velden om bij te werken" });
        return;
      }

      const updatedReport = await storage.updateReport(id, updates);

      if (!updatedReport) {
        res.status(404).json({ message: "Case niet gevonden" });
        return;
      }

      res.json(createApiSuccessResponse(updatedReport, "Case succesvol bijgewerkt"));
    } catch (error: any) {
      console.error("Error updating case:", error);
      res.status(500).json({ message: "Fout bij updaten case" });
    }
  });

  /**
   * PATCH /api/cases/:id/status
   *
   * Update case status.
   *
   * Request body: { status: 'draft' | 'processing' | 'generated' | 'exported' | 'archived' }
   * Response: Success confirmation
   */
  app.patch("/api/cases/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!["draft", "processing", "generated", "exported", "archived"].includes(status)) {
        res.status(400).json({ message: "Ongeldige status" });
        return;
      }

      await storage.updateReportStatus(id, status);
      res.json(createApiSuccessResponse({ success: true }, "Status succesvol bijgewerkt"));
    } catch (error: any) {
      console.error("Error updating case status:", error);
      res.status(500).json({ message: "Fout bij updaten status" });
    }
  });

  /**
   * DELETE /api/cases/:id
   *
   * Delete a case.
   *
   * Response: Success confirmation
   */
  app.delete("/api/cases/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteReport(id);
      res.json(createApiSuccessResponse({ success: true }, "Case succesvol verwijderd"));
    } catch (error: any) {
      console.error("Error deleting case:", error);
      res.status(500).json({ message: "Fout bij verwijderen case" });
    }
  });

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
  app.get("/api/cases/:id/export/:format", async (req, res) => {
    try {
      const { id, format } = req.params;
      const report = await storage.getReport(id);

      if (!report) {
        res.status(404).json({ message: "Case niet gevonden" });
        return;
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
        res.status(400).json({ message: "Ongeldige export format" });
      }
    } catch (error: any) {
      console.error("Error exporting case:", error);
      res.status(500).json({ message: "Fout bij exporteren case" });
    }
  });
}
