import { chromium, Browser } from 'playwright';
import Handlebars from 'handlebars';
import { marked } from 'marked';
import * as fs from 'fs';
import * as path from 'path';
import type { Report } from '@shared/schema';

// Get project root - works in both dev and production
const PROJECT_ROOT = process.cwd();

interface PDFTemplateContext {
  // Meta information
  clientName: string;
  date: string;
  subject: string;
  reference: string;

  // Content (HTML rendered from markdown)
  contentHtml: string;

  // Optional logo (base64 or URL)
  logoSrc?: string;
}

export class HtmlPdfGenerator {
  private browser: Browser | null = null;
  private template: Handlebars.TemplateDelegate | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
      });
    }
    return this.browser;
  }

  private getTemplate(): Handlebars.TemplateDelegate {
    if (!this.template) {
      const templatePath = path.join(PROJECT_ROOT, 'server/templates/pdf/fiscaal-memo.html');

      if (!fs.existsSync(templatePath)) {
        throw new Error(`PDF template not found at: ${templatePath}`);
      }

      const templateSource = fs.readFileSync(templatePath, 'utf-8');
      this.template = Handlebars.compile(templateSource);
    }
    return this.template;
  }

  private formatDate(date: Date | string | null): string {
    if (!date) return new Date().toLocaleDateString('nl-NL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('nl-NL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  private formatReference(dossierNumber: number | null, createdAt: Date | string | null): string {
    const year = createdAt
      ? new Date(createdAt).getFullYear()
      : new Date().getFullYear();
    const num = dossierNumber || 1;
    return `JDB-${year}-${String(num).padStart(5, '0')}`;
  }

  private async markdownToHtml(markdown: string): Promise<string> {
    // Configure marked for safe HTML output
    marked.setOptions({
      gfm: true,
      breaks: true,
    });

    let html = await marked(markdown);

    // Post-process HTML to add inline styles for Google Docs copy-paste compatibility
    // This ensures formatting is preserved when copying from browser to Google Docs
    //
    // Document structure from AI:
    // - H1 = Document title (ADVISORY REPORT: ...) → Title styling
    // - H2 = Main sections (1. Introduction, 2. etc.) → Should be Heading 1 in Google Docs
    // - H3 = Subsections → Should be Heading 2 in Google Docs

    // H1 headers - Document title, keep as Title (larger)
    html = html.replace(/<h1>/g, '<h1 style="font-size: 20pt; font-weight: 700; color: #ff0000; margin-top: 0; margin-bottom: 20px; line-height: 1.3;">');

    // H2 headers - Main sections (1. Introduction, etc.) → Transform to H1 for Google Docs Heading 1
    html = html.replace(/<h2>/g, '<h1 style="font-size: 14pt; font-weight: 700; color: #ff0000; margin-top: 30px; margin-bottom: 12px; line-height: 1.5;">');
    html = html.replace(/<\/h2>/g, '</h1>');

    // H3 headers - Subsections → Transform to H2 for Google Docs Heading 2
    html = html.replace(/<h3>/g, '<h2 style="font-size: 12pt; font-weight: 600; color: #ff0000; margin-top: 20px; margin-bottom: 10px; line-height: 1.5;">');
    html = html.replace(/<\/h3>/g, '</h2>');

    // H4 headers → Transform to H3 for Google Docs Heading 3
    html = html.replace(/<h4>/g, '<h3 style="font-size: 11pt; font-weight: 600; color: #ff0000; margin-top: 15px; margin-bottom: 8px; line-height: 1.5;">');
    html = html.replace(/<\/h4>/g, '</h3>');

    // Paragraphs with line-height 1.5
    html = html.replace(/<p>/g, '<p style="margin-bottom: 12px; line-height: 1.5;">');

    // Bold text with explicit font-weight
    html = html.replace(/<strong>/g, '<strong style="font-weight: 700;">');

    // List items with line-height
    html = html.replace(/<li>/g, '<li style="margin-bottom: 6px; line-height: 1.5;">');

    // Unordered lists with line-height
    html = html.replace(/<ul>/g, '<ul style="margin-bottom: 15px; padding-left: 25px; line-height: 1.5;">');

    // Ordered lists with line-height
    html = html.replace(/<ol>/g, '<ol style="margin-bottom: 15px; padding-left: 25px; line-height: 1.5;">');

    // Table headers with blue background (#204bc6)
    html = html.replace(/<th>/g, '<th style="background-color: #204bc6; color: white; font-weight: 600; text-align: left; padding: 10px 12px;">');
    html = html.replace(/<th /g, '<th style="background-color: #204bc6; color: white; font-weight: 600; text-align: left; padding: 10px 12px;" ');

    // Table cells with padding
    html = html.replace(/<td>/g, '<td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb;">');

    // Tables with proper styling
    html = html.replace(/<table>/g, '<table style="width: 100%; border-collapse: collapse; margin: 20px 0;">');

    return html;
  }

  private extractLatestContent(report: Report): string {
    // Get content from conceptReportVersions if available
    const versions = report.conceptReportVersions as any;

    if (versions?.latest?.pointer) {
      const latestSnapshot = versions[versions.latest.pointer];
      if (latestSnapshot?.content) {
        return latestSnapshot.content;
      }
    }

    // Fallback to generatedContent
    if (report.generatedContent) {
      return report.generatedContent;
    }

    return '';
  }

  private extractSubject(report: Report): string {
    // Try to get subject from bouwplanData
    const bouwplan = report.bouwplanData as any;
    if (bouwplan?.fiscale_kernthemas?.length > 0) {
      return bouwplan.fiscale_kernthemas.slice(0, 2).join(' & ');
    }

    // Fallback to title
    return report.title || 'Fiscaal Advies';
  }

  /**
   * Generate HTML preview (without converting to PDF)
   * Useful for debugging and previewing the template
   */
  async generateHTMLPreview(report: Report): Promise<string> {
    // Extract content and convert to HTML
    const markdownContent = this.extractLatestContent(report);

    // Check if we have content
    if (!markdownContent || markdownContent.trim().length === 0) {
      throw new Error('Geen rapport content gevonden. Zorg dat het rapport eerst is gegenereerd.');
    }

    const contentHtml = await this.markdownToHtml(markdownContent);

    // Build template context
    const context: PDFTemplateContext = {
      clientName: report.clientName || 'Onbekend',
      date: this.formatDate(report.createdAt),
      subject: this.extractSubject(report),
      reference: this.formatReference(report.dossierNumber, report.createdAt),
      contentHtml,
    };

    // Render HTML from template
    const template = this.getTemplate();
    return template(context);
  }

  async generatePDF(report: Report): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // Generate HTML first
      const html = await this.generateHTMLPreview(report);

      // Load HTML in page
      await page.setContent(html, { waitUntil: 'networkidle' });

      // Generate PDF with print settings
      const pdfBuffer = await page.pdf({
        format: 'A4',
        margin: {
          top: '25mm',
          bottom: '30mm',
          left: '25mm',
          right: '25mm',
        },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `
          <div style="width: 100%; font-size: 9px; font-family: 'Proxima Nova', Arial, sans-serif; color: #003366; padding: 0 25mm; display: flex; justify-content: space-between; align-items: center;">
            <div style="font-weight: bold;">JAN DE BELASTINGMAN</div>
            <div style="color: #666;">Fiscaal Adviesbureau</div>
          </div>
        `,
        footerTemplate: `
          <div style="width: 100%; font-size: 9px; font-family: 'Proxima Nova', Arial, sans-serif; color: #666; padding: 0 25mm; display: flex; justify-content: space-between; align-items: center;">
            <div>Vertrouwelijk</div>
            <div>Pagina <span class="pageNumber"></span> van <span class="totalPages"></span></div>
          </div>
        `,
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

// Singleton instance
let instance: HtmlPdfGenerator | null = null;

export function getHtmlPdfGenerator(): HtmlPdfGenerator {
  if (!instance) {
    instance = new HtmlPdfGenerator();
  }
  return instance;
}
