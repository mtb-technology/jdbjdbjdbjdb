import { jsPDF } from 'jspdf';
import * as fs from 'fs';
import * as path from 'path';

interface FontConfig {
  name: string;
  normal: string;
  bold: string;
  italic?: string;
  boldItalic?: string;
}

export class PDFFontLoader {
  private static fontsLoaded = false;
  private static customFontAvailable = false;
  private static warningShown = false;

  /**
   * Load custom fonts into jsPDF
   * Falls back to Helvetica if custom fonts are not available
   */
  static loadFonts(pdf: jsPDF): boolean {
    // Only load once per process
    if (this.fontsLoaded) {
      return this.customFontAvailable;
    }

    try {
      // In production (bundled), fonts are in server/assets/fonts relative to project root
      const fontsDir = path.join(process.cwd(), 'server', 'assets', 'fonts');

      // Check if fonts directory exists
      if (!fs.existsSync(fontsDir)) {
        if (!this.warningShown) {
          console.warn('📝 PDF Fonts: Directory not found, using Helvetica fallback');
          console.warn(`   Expected location: ${fontsDir}`);
          this.warningShown = true;
        }
        this.fontsLoaded = true;
        this.customFontAvailable = false;
        return false;
      }

      // Try to load Proxima Nova fonts
      const regularPath = path.join(fontsDir, 'ProximaNova-Regular.ttf');
      const boldPath = path.join(fontsDir, 'ProximaNova-Bold.ttf');

      if (fs.existsSync(regularPath) && fs.existsSync(boldPath)) {
        // Read font files
        const regularFont = fs.readFileSync(regularPath).toString('base64');
        const boldFont = fs.readFileSync(boldPath).toString('base64');

        // Add fonts to jsPDF
        pdf.addFileToVFS('ProximaNova-Regular.ttf', regularFont);
        pdf.addFont('ProximaNova-Regular.ttf', 'ProximaNova', 'normal');

        pdf.addFileToVFS('ProximaNova-Bold.ttf', boldFont);
        pdf.addFont('ProximaNova-Bold.ttf', 'ProximaNova', 'bold');

        // Try to load italic variants (optional)
        const italicPath = path.join(fontsDir, 'ProximaNova-Italic.ttf');
        if (fs.existsSync(italicPath)) {
          const italicFont = fs.readFileSync(italicPath).toString('base64');
          pdf.addFileToVFS('ProximaNova-Italic.ttf', italicFont);
          pdf.addFont('ProximaNova-Italic.ttf', 'ProximaNova', 'italic');
        }

        const boldItalicPath = path.join(fontsDir, 'ProximaNova-BoldItalic.ttf');
        if (fs.existsSync(boldItalicPath)) {
          const boldItalicFont = fs.readFileSync(boldItalicPath).toString('base64');
          pdf.addFileToVFS('ProximaNova-BoldItalic.ttf', boldItalicFont);
          pdf.addFont('ProximaNova-BoldItalic.ttf', 'ProximaNova', 'bolditalic');
        }

        console.log('✅ PDF Fonts: Proxima Nova loaded successfully');
        this.customFontAvailable = true;
      } else {
        if (!this.warningShown) {
          console.warn('📝 PDF Fonts: Proxima Nova not found, using Helvetica fallback');
          console.warn(`   Place .ttf files in: ${fontsDir}`);
          console.warn(`   See ${path.join(fontsDir, 'README.md')} for instructions`);
          this.warningShown = true;
        }
        this.customFontAvailable = false;
      }
    } catch (error) {
      if (!this.warningShown) {
        console.error('❌ PDF Fonts: Error loading custom fonts:', error instanceof Error ? error.message : error);
        console.warn('   Falling back to Helvetica');
        this.warningShown = true;
      }
      this.customFontAvailable = false;
    }

    this.fontsLoaded = true;
    return this.customFontAvailable;
  }

  /**
   * Get the font name to use (custom or fallback)
   */
  static getFontName(): string {
    return this.customFontAvailable ? 'ProximaNova' : 'helvetica';
  }

  /**
   * Set font on PDF document with proper fallback
   */
  static setFont(pdf: jsPDF, style: 'normal' | 'bold' | 'italic' | 'bolditalic' = 'normal'): void {
    const fontName = this.getFontName();
    pdf.setFont(fontName, style);
  }

  /**
   * Reset the loader (useful for testing)
   */
  static reset(): void {
    this.fontsLoaded = false;
    this.customFontAvailable = false;
    this.warningShown = false;
  }
}
