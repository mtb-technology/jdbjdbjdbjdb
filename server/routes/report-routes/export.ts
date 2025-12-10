/**
 * Export Routes
 *
 * Handles PDF, DOCX, and JSON export/import functionality.
 */

import type { Request, Response, Express } from "express";
import { storage } from "../../storage";
import { asyncHandler, ServerError } from "../../middleware/errorHandler";
import { createApiSuccessResponse } from "@shared/errors";
import type { ReportRouteDependencies } from "./types";

export function registerExportRoutes(
  app: Express,
  _dependencies: ReportRouteDependencies
): void {

  // ============================================================
  // PDF EXPORT
  // ============================================================

  /**
   * Preview report as HTML (for debugging/previewing before PDF export)
   * GET /api/reports/:id/preview-pdf
   */
  app.get("/api/reports/:id/preview-pdf", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    const report = await storage.getReport(reportId);

    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    const { getHtmlPdfGenerator } = await import('../../services/html-pdf-generator.js');
    const pdfGenerator = getHtmlPdfGenerator();

    try {
      const html = await pdfGenerator.generateHTMLPreview(report);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);

      console.log(`PDF preview generated for report ${reportId}`);

    } catch (error: any) {
      console.error(`PDF preview failed for report ${reportId}:`, error);
      throw ServerError.internal(
        'PDF preview failed',
        error.message || 'Er is een fout opgetreden bij het genereren van de preview'
      );
    }
  }));

  /**
   * Export report as PDF
   * GET /api/reports/:id/export-pdf
   */
  app.get("/api/reports/:id/export-pdf", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    const report = await storage.getReport(reportId);

    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    const { getHtmlPdfGenerator } = await import('../../services/html-pdf-generator.js');
    const pdfGenerator = getHtmlPdfGenerator();

    try {
      const pdfBuffer = await pdfGenerator.generatePDF(report);

      const safeClientName = (report.clientName || 'rapport')
        .replace(/[^a-zA-Z0-9\-_\s]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50);

      const filename = `JDB-${report.dossierNumber || '00000'}-${safeClientName}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);

      res.send(pdfBuffer);

      console.log(`PDF exported for report ${reportId}:`, {
        filename,
        size: pdfBuffer.length,
        clientName: report.clientName
      });

    } catch (error: any) {
      console.error(`PDF generation failed for report ${reportId}:`, error);
      throw ServerError.internal(
        'PDF generation failed',
        error.message || 'Er is een fout opgetreden bij het genereren van de PDF'
      );
    }
  }));

  // ============================================================
  // DOCX EXPORT
  // ============================================================

  /**
   * Export report as Word document (.docx)
   * GET /api/reports/:id/export-docx
   */
  app.get("/api/reports/:id/export-docx", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    const report = await storage.getReport(reportId);

    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    const { getDocxGenerator } = await import('../../services/docx-generator.js');
    const docxGenerator = getDocxGenerator();

    try {
      const docxBuffer = await docxGenerator.generateDocx(report);
      const filename = docxGenerator.generateFilename(report);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', docxBuffer.length);

      res.send(docxBuffer);

      console.log(`DOCX exported for report ${reportId}:`, {
        filename,
        size: docxBuffer.length,
        clientName: report.clientName
      });

    } catch (error: any) {
      console.error(`DOCX generation failed for report ${reportId}:`, error);
      throw ServerError.internal(
        'DOCX generation failed',
        error.message || 'Er is een fout opgetreden bij het genereren van het Word document'
      );
    }
  }));

  // ============================================================
  // JSON EXPORT/IMPORT (Dev/Prod Sync)
  // ============================================================

  /**
   * Export complete dossier as JSON
   * GET /api/reports/:id/export-json
   */
  app.get("/api/reports/:id/export-json", asyncHandler(async (req: Request, res: Response) => {
    const reportId = req.params.id;
    const includeAttachments = req.query.includeAttachments !== 'false';

    if (!reportId) {
      throw ServerError.validation('Report ID is required', 'Rapport ID is verplicht');
    }

    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound('Report not found');
    }

    let reportAttachments: any[] = [];
    if (includeAttachments) {
      reportAttachments = await storage.getAttachmentsForReport(reportId);
    }

    const { id, dossierNumber, createdAt, updatedAt, ...reportData } = report;

    const exportData = {
      _exportMeta: {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        originalId: id,
        originalDossierNumber: dossierNumber,
        source: process.env.NODE_ENV || 'development'
      },
      report: reportData,
      attachments: reportAttachments.map(att => {
        const { id: attId, reportId: attReportId, uploadedAt, ...attData } = att;
        return attData;
      })
    };

    const safeClientName = report.clientName.replace(/[^a-zA-Z0-9]/g, '-');
    const filename = `dossier-D${String(dossierNumber).padStart(4, '0')}-${safeClientName}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    console.log(`Dossier exported: ${filename} (${includeAttachments ? 'with' : 'without'} attachments)`);

    res.json(exportData);
  }));

  /**
   * Import dossier from JSON
   * POST /api/reports/import-json
   */
  app.post("/api/reports/import-json", asyncHandler(async (req: Request, res: Response) => {
    const importData = req.body;

    if (!importData?._exportMeta || !importData?.report) {
      throw ServerError.validation(
        'Invalid import format',
        'Ongeldig import formaat. Gebruik een JSON bestand geëxporteerd via /export-json'
      );
    }

    const { _exportMeta, report: reportData, attachments = [] } = importData;

    console.log(`Importing dossier from ${_exportMeta.source || 'unknown'} (original: D-${String(_exportMeta.originalDossierNumber || 0).padStart(4, '0')})`);

    const newReport = await storage.createReport({
      title: reportData.title?.replace(/^D-\d{4}\s*-\s*/, '') || reportData.clientName,
      clientName: reportData.clientName,
      dossierData: reportData.dossierData,
      bouwplanData: reportData.bouwplanData,
      generatedContent: reportData.generatedContent,
      stageResults: reportData.stageResults,
      conceptReportVersions: reportData.conceptReportVersions,
      substepResults: reportData.substepResults,
      stagePrompts: reportData.stagePrompts,
      documentState: reportData.documentState,
      pendingChanges: reportData.pendingChanges,
      documentSnapshots: reportData.documentSnapshots,
      dossierContextSummary: reportData.dossierContextSummary,
      currentStage: reportData.currentStage,
      status: reportData.status
    });

    console.log(`Report imported: ${newReport.id} (D-${String(newReport.dossierNumber).padStart(4, '0')})`);

    let importedAttachments = 0;
    for (const att of attachments) {
      try {
        await storage.createAttachment({
          reportId: newReport.id,
          filename: att.filename,
          mimeType: att.mimeType,
          fileSize: att.fileSize,
          pageCount: att.pageCount,
          fileData: att.fileData,
          extractedText: att.extractedText,
          needsVisionOCR: att.needsVisionOCR,
          usedInStages: att.usedInStages || []
        });
        importedAttachments++;
      } catch (attError) {
        console.warn(`Failed to import attachment ${att.filename}:`, attError);
      }
    }

    if (importedAttachments > 0) {
      console.log(`Imported ${importedAttachments} attachment(s)`);
    }

    res.json(createApiSuccessResponse({
      id: newReport.id,
      dossierNumber: newReport.dossierNumber,
      title: newReport.title,
      importedFrom: {
        originalId: _exportMeta.originalId,
        originalDossierNumber: _exportMeta.originalDossierNumber,
        source: _exportMeta.source,
        exportedAt: _exportMeta.exportedAt
      },
      attachmentsImported: importedAttachments
    }, `Dossier geïmporteerd als D-${String(newReport.dossierNumber).padStart(4, '0')}`));
  }));
}
