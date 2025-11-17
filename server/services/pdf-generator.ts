import { jsPDF } from 'jspdf';
import type { Report } from '@shared/schema';
import { PDFFontLoader } from './pdf-fonts.js';

export class PDFGenerator {
  private formatDate(date: Date | string | null): string {
    if (!date) return new Date().toLocaleDateString('nl-NL');
    
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('nl-NL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  private stripHtmlTags(html: string): string {
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace &nbsp; with spaces
      .replace(/&amp;/g, '&') // Replace &amp; with &
      .replace(/&lt;/g, '<') // Replace &lt; with <
      .replace(/&gt;/g, '>') // Replace &gt; with >
      .replace(/&quot;/g, '"') // Replace &quot; with "
      .replace(/&#39;/g, "'") // Replace &#39; with '
      .trim();
  }

  private splitTextToLines(text: string, maxWidth: number, fontSize: number): string[] {
    const pdf = new jsPDF();
    pdf.setFontSize(fontSize);
    
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const textWidth = pdf.getTextWidth(testLine);
      
      if (textWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines;
  }

  async generatePDF(report: Report): Promise<Buffer> {
    const pdf = new jsPDF();

    // Load custom fonts (Proxima Nova or fallback to Helvetica)
    PDFFontLoader.loadFonts(pdf);

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    let yPosition = margin;

    // Colors for Jan de Belastingman branding
    const primaryColor: [number, number, number] = [0, 51, 102]; // Dark blue
    const accentColor: [number, number, number] = [0, 123, 191]; // Light blue
    const textColor: [number, number, number] = [33, 33, 33]; // Dark gray

    // Header with Jan de Belastingman branding
    pdf.setFillColor(...primaryColor);
    pdf.rect(0, 0, pageWidth, 35, 'F');

    pdf.setTextColor(255, 255, 255);
    PDFFontLoader.setFont(pdf, 'bold');
    pdf.setFontSize(18);
    pdf.text('Jan de Belastingman', margin, 22);

    pdf.setFontSize(12);
    pdf.text('Fiscaal Adviesbureau', margin, 30);

    yPosition = 50;

    // Report Title
    pdf.setTextColor(...textColor);
    PDFFontLoader.setFont(pdf, 'bold');
    pdf.setFontSize(16);
    
    const titleLines = this.splitTextToLines(report.title, contentWidth, 16);
    for (const line of titleLines) {
      pdf.text(line, margin, yPosition);
      yPosition += 8;
    }
    
    yPosition += 10;

    // Client and Date info
    PDFFontLoader.setFont(pdf, 'normal');
    pdf.setFontSize(11);
    pdf.setTextColor(...accentColor);
    
    pdf.text(`Client: ${report.clientName}`, margin, yPosition);
    yPosition += 6;
    pdf.text(`Rapport datum: ${this.formatDate(report.createdAt)}`, margin, yPosition);
    yPosition += 6;
    pdf.text(`Status: ${this.getStatusLabel(report.status)}`, margin, yPosition);
    yPosition += 15;

    // Separator line
    pdf.setDrawColor(...accentColor);
    pdf.setLineWidth(0.5);
    pdf.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 15;

    // Report Content
    if (report.generatedContent) {
      const cleanContent = this.stripHtmlTags(report.generatedContent);
      
      pdf.setTextColor(...textColor);
      PDFFontLoader.setFont(pdf, 'normal');
      pdf.setFontSize(10);
      
      const contentLines = this.splitTextToLines(cleanContent, contentWidth, 10);
      
      for (const line of contentLines) {
        // Check if we need a new page
        if (yPosition > pageHeight - 30) {
          pdf.addPage();
          yPosition = margin;
          
          // Add header to new page
          pdf.setFillColor(...primaryColor);
          pdf.rect(0, 0, pageWidth, 25, 'F');
          pdf.setTextColor(255, 255, 255);
          PDFFontLoader.setFont(pdf, 'bold');
          pdf.setFontSize(12);
          pdf.text('Jan de Belastingman - Vervolg', margin, 16);
          
          yPosition = 40;
          pdf.setTextColor(...textColor);
          PDFFontLoader.setFont(pdf, 'normal');
          pdf.setFontSize(10);
        }
        
        pdf.text(line, margin, yPosition);
        yPosition += 5;
      }
    } else {
      pdf.setTextColor(150, 150, 150);
      PDFFontLoader.setFont(pdf, 'italic');
      pdf.text('Geen rapportinhoud beschikbaar', margin, yPosition);
    }

    // Footer on last page
    const totalPages = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      
      // Footer
      pdf.setFillColor(245, 245, 245);
      pdf.rect(0, pageHeight - 25, pageWidth, 25, 'F');
      
      pdf.setTextColor(...textColor);
      PDFFontLoader.setFont(pdf, 'normal');
      pdf.setFontSize(8);
      
      // Left footer - company info
      pdf.text('Jan de Belastingman | Fiscaal Adviesbureau', margin, pageHeight - 15);
      pdf.text('www.jandebelastingman.nl | info@jandebelastingman.nl', margin, pageHeight - 8);
      
      // Right footer - page number
      const pageText = `Pagina ${i} van ${totalPages}`;
      const pageTextWidth = pdf.getTextWidth(pageText);
      pdf.text(pageText, pageWidth - margin - pageTextWidth, pageHeight - 10);
    }

    // Disclaimer on last page
    pdf.setPage(totalPages);
    yPosition = pageHeight - 50;
    
    pdf.setTextColor(100, 100, 100);
    PDFFontLoader.setFont(pdf, 'italic');
    pdf.setFontSize(8);
    
    const disclaimer = "Dit rapport is gegenereerd door het AI-systeem van Jan de Belastingman. " +
                      "Alle adviezen zijn indicatief en dienen geverifieerd te worden door een " +
                      "gekwalificeerde fiscalist voordat definitieve beslissingen worden genomen.";
    
    const disclaimerLines = this.splitTextToLines(disclaimer, contentWidth, 8);
    for (const line of disclaimerLines) {
      pdf.text(line, margin, yPosition);
      yPosition += 4;
    }

    return Buffer.from(pdf.output('arraybuffer'));
  }

  private getStatusLabel(status: string): string {
    switch (status) {
      case "draft": return "Concept";
      case "processing": return "In behandeling";
      case "generated": return "Gegenereerd";
      case "exported": return "Geëxporteerd";
      case "archived": return "Gearchiveerd";
      default: return status;
    }
  }

  /**
   * Generate PDF from TipTap JSON content
   */
  async generateFromTipTap(params: {
    content: any;
    title: string;
    clientName: string;
  }): Promise<Buffer> {
    const { content, title, clientName } = params;

    const pdf = new jsPDF();

    // Load custom fonts (Proxima Nova or fallback to Helvetica)
    PDFFontLoader.loadFonts(pdf);

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 25; // 2.5cm margins
    const contentWidth = pageWidth - (margin * 2);

    // Colors for branding
    const primaryColor: [number, number, number] = [0, 51, 102]; // Dark blue
    const accentColor: [number, number, number] = [0, 123, 191]; // Light blue
    const textColor: [number, number, number] = [51, 51, 51]; // #333

    // ========== COVER PAGE ==========
    let yPosition = pageHeight / 3; // Start at 1/3 of page (vertical center-ish)

    // Main title: "Fiscale Analyse"
    pdf.setTextColor(...textColor);
    PDFFontLoader.setFont(pdf, 'bold');
    pdf.setFontSize(24);
    pdf.text('Fiscale Analyse', margin, yPosition);
    yPosition += 20;

    // Subtitle: Document title
    pdf.setFontSize(18);
    const titleLines = this.splitTextToLines(title, contentWidth, 18);
    for (const line of titleLines) {
      pdf.text(line, margin, yPosition);
      yPosition += 10;
    }
    yPosition += 15;

    // Client name
    PDFFontLoader.setFont(pdf, 'normal');
    pdf.setFontSize(12);
    pdf.text(clientName, margin, yPosition);
    yPosition += 8;

    // Date
    pdf.text(this.formatDate(new Date()), margin, yPosition);

    // Add new page for content (cover page should be alone)
    pdf.addPage();

    // ========== CONTENT PAGES ==========
    yPosition = margin;

    // Render TipTap content on content pages
    pdf.setTextColor(...textColor);
    PDFFontLoader.setFont(pdf, 'normal');
    pdf.setFontSize(11); // 11pt body text as per spec
    yPosition = this.renderTipTapNode(pdf, content, margin, yPosition, contentWidth, pageHeight, primaryColor, textColor);

    // Footer on all pages EXCEPT cover page (page 1)
    const totalPages = pdf.getNumberOfPages();
    const totalContentPages = totalPages - 1; // Exclude cover page from count

    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);

      // Skip footer on cover page
      if (i === 1) continue;

      // Footer with page number only
      pdf.setTextColor(...textColor);
      PDFFontLoader.setFont(pdf, 'normal');
      pdf.setFontSize(9);

      // Center footer - page number (content pages only, starting from 1)
      const pageNumber = i - 1; // Adjust for cover page
      const pageText = `Pagina ${pageNumber} van ${totalContentPages}`;
      const pageTextWidth = pdf.getTextWidth(pageText);
      const centerX = pageWidth / 2 - pageTextWidth / 2;
      pdf.text(pageText, centerX, pageHeight - 15);
    }

    // Disclaimer on last page
    pdf.setPage(totalPages);
    let disclaimerY = pageHeight - 50;

    pdf.setTextColor(100, 100, 100);
    PDFFontLoader.setFont(pdf, 'italic');
    pdf.setFontSize(8);

    const disclaimer = "Dit document is gegenereerd met behulp van AI-technologie. " +
                      "Alle informatie dient geverifieerd te worden voordat definitieve beslissingen worden genomen.";

    const disclaimerLines = this.splitTextToLines(disclaimer, contentWidth, 8);
    for (const line of disclaimerLines) {
      pdf.text(line, margin, disclaimerY);
      disclaimerY += 4;
    }

    return Buffer.from(pdf.output('arraybuffer'));
  }

  /**
   * Recursively render TipTap JSON nodes to PDF
   */
  private renderTipTapNode(
    pdf: jsPDF,
    node: any,
    margin: number,
    yPosition: number,
    contentWidth: number,
    pageHeight: number,
    primaryColor: [number, number, number],
    textColor: [number, number, number]
  ): number {
    const pageWidth = pdf.internal.pageSize.getWidth();

    if (!node || !node.type) {
      return yPosition;
    }

    // Helper to check for page break
    const checkPageBreak = (requiredSpace: number = 20): number => {
      if (yPosition > pageHeight - 30 - requiredSpace) {
        pdf.addPage();
        yPosition = margin;

        // Add header to new page
        pdf.setFillColor(...primaryColor);
        pdf.rect(0, 0, pageWidth, 25, 'F');
        pdf.setTextColor(255, 255, 255);
        PDFFontLoader.setFont(pdf, 'bold');
        pdf.setFontSize(12);
        pdf.text('Jan de Belastingman - Vervolg', margin, 16);

        yPosition = 40;
        pdf.setTextColor(...textColor);
      }
      return yPosition;
    };

    // Process based on node type
    switch (node.type) {
      case 'doc':
        // Render all child nodes
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            yPosition = this.renderTipTapNode(pdf, child, margin, yPosition, contentWidth, pageHeight, primaryColor, textColor);
          }
        }
        break;

      case 'heading':
        yPosition = checkPageBreak(20);
        const level = node.attrs?.level || 1;

        // Font sizes according to spec: h1=18pt, h2=14pt, h3=12pt
        const headingFontSize = level === 1 ? 18 : level === 2 ? 14 : 12;
        if (level === 1) {
          yPosition += 6; // Extra margin-top for h1
        } else if (level === 2) {
          yPosition += 4; // Extra margin-top for h2
        } else {
          yPosition += 2;
        }

        yPosition = this.renderTextWithMarks(pdf, node.content, margin, yPosition, contentWidth, headingFontSize, 'bold');
        yPosition += level === 1 ? 6 : 4; // Extra space after heading
        break;

      case 'paragraph':
        yPosition = checkPageBreak();

        if (node.content && node.content.length > 0 &&
            node.content.some((n: any) => n.text?.trim())) {
          yPosition = this.renderTextWithMarks(pdf, node.content, margin, yPosition, contentWidth, 11, 'normal');
        }
        yPosition += 4; // Space between paragraphs
        break;

      case 'bulletList':
        if (node.content && Array.isArray(node.content)) {
          for (const listItem of node.content) {
            yPosition = checkPageBreak();

            // Render bullet point
            PDFFontLoader.setFont(pdf, 'normal');
            pdf.setFontSize(11);
            pdf.text('•', margin, yPosition);

            // Render list item content (indented)
            if (listItem.content && Array.isArray(listItem.content)) {
              for (const itemChild of listItem.content) {
                if (itemChild.type === 'paragraph' && itemChild.content) {
                  yPosition = this.renderTextWithMarks(pdf, itemChild.content, margin + 8, yPosition, contentWidth - 10, 11, 'normal');
                  yPosition -= 5.5; // Compensate for extra spacing added by renderTextWithMarks
                }
              }
            }
            yPosition += 6;
          }
          yPosition += 2;
        }
        break;

      case 'orderedList':
        if (node.content && Array.isArray(node.content)) {
          const start = node.attrs?.start || 1;

          for (let i = 0; i < node.content.length; i++) {
            const listItem = node.content[i];
            yPosition = checkPageBreak();

            // Render number
            PDFFontLoader.setFont(pdf, 'normal');
            pdf.setFontSize(11);
            const number = `${start + i}.`;
            pdf.text(number, margin, yPosition);

            // Render list item content (indented)
            if (listItem.content && Array.isArray(listItem.content)) {
              for (const itemChild of listItem.content) {
                if (itemChild.type === 'paragraph' && itemChild.content) {
                  yPosition = this.renderTextWithMarks(pdf, itemChild.content, margin + 10, yPosition, contentWidth - 12, 11, 'normal');
                  yPosition -= 5.5; // Compensate for extra spacing added by renderTextWithMarks
                }
              }
            }
            yPosition += 6;
          }
          yPosition += 2;
        }
        break;
    }

    return yPosition;
  }

  /**
   * Extract plain text from TipTap content nodes (handling marks like bold/italic)
   */
  private extractTextFromContent(content: any[]): string {
    if (!content || !Array.isArray(content)) {
      return '';
    }

    return content
      .map((node: any) => {
        if (node.type === 'text') {
          return node.text || '';
        }
        if (node.type === 'hardBreak') {
          return '\n';
        }
        return '';
      })
      .join('');
  }

  /**
   * Render text with proper mark handling (bold, italic, code)
   * Returns the new yPosition after rendering
   */
  private renderTextWithMarks(
    pdf: jsPDF,
    content: any[],
    xPosition: number,
    yPosition: number,
    maxWidth: number,
    fontSize: number,
    baseFont: 'normal' | 'bold' | 'italic' = 'normal'
  ): number {
    if (!content || !Array.isArray(content)) {
      return yPosition;
    }

    const pageHeight = pdf.internal.pageSize.getHeight();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 25;

    // Helper to check for page break
    const checkPageBreak = (): number => {
      if (yPosition > pageHeight - 30 - 10) {
        pdf.addPage();
        yPosition = margin;

        // Add header to new page
        const primaryColor: [number, number, number] = [0, 51, 102];
        const textColor: [number, number, number] = [51, 51, 51];
        pdf.setFillColor(...primaryColor);
        pdf.rect(0, 0, pageWidth, 25, 'F');
        pdf.setTextColor(255, 255, 255);
        PDFFontLoader.setFont(pdf, 'bold');
        pdf.setFontSize(12);
        pdf.text('Jan de Belastingman - Vervolg', margin, 16);

        yPosition = 40;
        pdf.setTextColor(...textColor);
      }
      return yPosition;
    };

    // Build segments with their respective marks
    interface TextSegment {
      text: string;
      marks: string[];
    }

    const segments: TextSegment[] = [];

    for (const node of content) {
      if (node.type === 'text') {
        const marks = node.marks ? node.marks.map((m: any) => m.type) : [];
        segments.push({ text: node.text || '', marks });
      } else if (node.type === 'hardBreak') {
        // Add a newline as a segment
        segments.push({ text: '\n', marks: [] });
      }
    }

    // Now render segments line by line, respecting maxWidth
    let currentLine = '';
    let currentLineSegments: { text: string; marks: string[] }[] = [];
    let currentX = xPosition;

    pdf.setFontSize(fontSize);

    for (const segment of segments) {
      // Handle hard breaks
      if (segment.text === '\n') {
        // Render current line first
        if (currentLineSegments.length > 0) {
          yPosition = checkPageBreak();
          this.renderLineSegments(pdf, currentLineSegments, xPosition, yPosition, fontSize, baseFont);
          yPosition += 5.5;
          currentLineSegments = [];
          currentLine = '';
        }
        // Move to next line for the hard break
        yPosition = checkPageBreak();
        yPosition += 5.5;
        continue;
      }

      const words = segment.text.split(' ');

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const testText = currentLine ? `${currentLine} ${word}` : word;

        // Determine font for width calculation
        const effectiveFont = this.determineFont(baseFont, segment.marks);
        PDFFontLoader.setFont(pdf, effectiveFont);
        const testWidth = pdf.getTextWidth(testText);

        if (testWidth > maxWidth && currentLine) {
          // Line is full, render it
          yPosition = checkPageBreak();
          this.renderLineSegments(pdf, currentLineSegments, xPosition, yPosition, fontSize, baseFont);
          yPosition += 5.5;

          // Start new line with current word
          currentLine = word;
          currentLineSegments = [{ text: word + (i < words.length - 1 ? ' ' : ''), marks: segment.marks }];
        } else {
          // Add word to current line
          const addText = word + (i < words.length - 1 ? ' ' : '');
          currentLine = testText;
          currentLineSegments.push({ text: addText, marks: segment.marks });
        }
      }
    }

    // Render any remaining line
    if (currentLineSegments.length > 0) {
      yPosition = checkPageBreak();
      this.renderLineSegments(pdf, currentLineSegments, xPosition, yPosition, fontSize, baseFont);
      yPosition += 5.5;
    }

    return yPosition;
  }

  /**
   * Render a line of text segments with their respective marks
   */
  private renderLineSegments(
    pdf: jsPDF,
    segments: { text: string; marks: string[] }[],
    xPosition: number,
    yPosition: number,
    fontSize: number,
    baseFont: 'normal' | 'bold' | 'italic'
  ): void {
    let currentX = xPosition;
    pdf.setFontSize(fontSize);

    for (const segment of segments) {
      const effectiveFont = this.determineFont(baseFont, segment.marks);
      PDFFontLoader.setFont(pdf, effectiveFont);

      pdf.text(segment.text, currentX, yPosition);
      currentX += pdf.getTextWidth(segment.text);
    }
  }

  /**
   * Determine the effective font based on base font and marks
   */
  private determineFont(baseFont: 'normal' | 'bold' | 'italic', marks: string[]): 'normal' | 'bold' | 'italic' {
    const hasBold = marks.includes('bold');
    const hasItalic = marks.includes('italic');

    // If baseFont is already bold, keep it bold unless italic is also present
    if (baseFont === 'bold') {
      return hasItalic ? 'italic' : 'bold';
    }

    // For normal base font
    if (hasBold && hasItalic) {
      // jsPDF doesn't have bold-italic, prefer bold
      return 'bold';
    } else if (hasBold) {
      return 'bold';
    } else if (hasItalic) {
      return 'italic';
    }

    return baseFont;
  }
}