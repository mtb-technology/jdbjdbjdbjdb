// @ts-ignore - html-to-docx has no type declarations
import HTMLtoDOCX from 'html-to-docx';
import type { Report } from '@shared/schema';
import { getHtmlPdfGenerator } from './html-pdf-generator';

/**
 * Generates Word documents (.docx) from reports
 * Uses html-to-docx to convert the HTML template (with CSS) to Word format
 */
export class DocxGenerator {
  /**
   * Generate a DOCX buffer from a report
   * Uses the same HTML template as PDF generation for consistent styling
   */
  async generateDocx(report: Report): Promise<Buffer> {
    // Get the HTML preview (same as PDF uses) - includes all CSS styling
    const htmlPdfGenerator = getHtmlPdfGenerator();
    const html = await htmlPdfGenerator.generateHTMLPreview(report);

    // Convert HTML to DOCX with styling options
    const docxBuffer = await HTMLtoDOCX(html, null, {
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true,
      font: 'Calibri',
      fontSize: 22, // 11pt in half-points
      margins: {
        top: 1440,    // 1 inch in twips
        bottom: 1440,
        left: 1440,
        right: 1440,
      },
    });

    return Buffer.from(docxBuffer);
  }

  /**
   * Generate filename for the DOCX export
   */
  generateFilename(report: Report): string {
    const year = report.createdAt
      ? new Date(report.createdAt).getFullYear()
      : new Date().getFullYear();
    const num = report.dossierNumber || 1;
    const reference = `JDB-${year}-${String(num).padStart(5, '0')}`;

    // Sanitize client name for filename
    const clientName = (report.clientName || 'Onbekend')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim();

    return `${reference} - ${clientName} - Fiscaal Memorandum.docx`;
  }
}

// Singleton instance
let instance: DocxGenerator | null = null;

export function getDocxGenerator(): DocxGenerator {
  if (!instance) {
    instance = new DocxGenerator();
  }
  return instance;
}
