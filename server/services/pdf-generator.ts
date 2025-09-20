import { jsPDF } from 'jspdf';
import type { Report } from '@shared/schema';

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
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.text('Jan de Belastingman', margin, 22);
    
    pdf.setFontSize(12);
    pdf.text('Fiscaal Adviesbureau', margin, 30);

    yPosition = 50;

    // Report Title
    pdf.setTextColor(...textColor);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    
    const titleLines = this.splitTextToLines(report.title, contentWidth, 16);
    for (const line of titleLines) {
      pdf.text(line, margin, yPosition);
      yPosition += 8;
    }
    
    yPosition += 10;

    // Client and Date info
    pdf.setFont('helvetica', 'normal');
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
      pdf.setFont('helvetica', 'normal');
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
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(12);
          pdf.text('Jan de Belastingman - Vervolg', margin, 16);
          
          yPosition = 40;
          pdf.setTextColor(...textColor);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(10);
        }
        
        pdf.text(line, margin, yPosition);
        yPosition += 5;
      }
    } else {
      pdf.setTextColor(150, 150, 150);
      pdf.setFont('helvetica', 'italic');
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
      pdf.setFont('helvetica', 'normal');
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
    pdf.setFont('helvetica', 'italic');
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
}