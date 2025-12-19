/**
 * PDF Text Extractor using pdfjs-dist
 *
 * Robust text extraction for "locked" PDFs like Belastingdienst documents.
 * These PDFs have machine-readable text but standard pdf-parse often fails to extract it.
 *
 * pdfjs-dist (Mozilla's PDF.js) handles these edge cases better.
 */

import { logger } from './logger';

// Dynamic import for pdfjs-dist (ESM compatibility)
let pdfjsLib: any = null;

// Dynamic import for pdf-parse (legacy parser)
let pdfParseFunc: any = null;

/**
 * Get the pdf-parse function (dynamically imported for ESM compatibility)
 * This is the legacy parser - use extractPdfText for better results with locked PDFs
 */
export async function getPdfParse() {
  if (!pdfParseFunc) {
    const module = await import('pdf-parse');
    pdfParseFunc = (module as any).PDFParse || (module as any).default || module;
  }
  return pdfParseFunc;
}

async function getPdfjs() {
  if (!pdfjsLib) {
    // pdfjs-dist needs to be imported dynamically
    const pdfjs = await import('pdfjs-dist');
    pdfjsLib = pdfjs;

    // Disable worker for server-side use (no DOM/Worker available)
    // @ts-ignore - GlobalWorkerOptions exists but types may vary
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    }
  }
  return pdfjsLib;
}

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  charCount: number;
  success: boolean;
  error?: string;
  /** Average characters per page - low values suggest scanned/image PDF */
  avgCharsPerPage: number;
}

/**
 * Extract text from a PDF buffer using pdfjs-dist
 *
 * @param buffer - PDF file as Buffer
 * @param filename - Optional filename for logging
 * @returns Extraction result with text and metadata
 */
export async function extractPdfText(
  buffer: Buffer,
  filename?: string
): Promise<PdfExtractionResult> {
  const logContext = filename || 'unknown.pdf';

  try {
    const pdfjs = await getPdfjs();

    // Convert Buffer to Uint8Array for pdfjs
    const data = new Uint8Array(buffer);

    // Load the PDF document
    const loadingTask = pdfjs.getDocument({
      data,
      // Disable features we don't need for text extraction
      useSystemFonts: true,
      disableFontFace: true,
      // Important: don't fail on missing fonts
      standardFontDataUrl: undefined,
    });

    const pdf = await loadingTask.promise;
    const pageCount = pdf.numPages;

    logger.debug('pdf-extractor', `Processing ${logContext}`, { pageCount });

    // Extract text from all pages
    const pageTexts: string[] = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Concatenate all text items with proper spacing
        const pageText = textContent.items
          .map((item: any) => {
            // item.str contains the text, item.hasEOL indicates end of line
            const str = item.str || '';
            return item.hasEOL ? str + '\n' : str;
          })
          .join(' ')
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim();

        pageTexts.push(pageText);
      } catch (pageErr: any) {
        logger.warn('pdf-extractor', `Failed to extract page ${pageNum}`, {
          filename: logContext,
          error: pageErr.message
        });
        pageTexts.push(''); // Add empty string for failed page
      }
    }

    // Join all pages with double newline
    const fullText = pageTexts.join('\n\n').trim();
    const charCount = fullText.length;
    const avgCharsPerPage = pageCount > 0 ? Math.round(charCount / pageCount) : 0;

    logger.info('pdf-extractor', `Extracted text from ${logContext}`, {
      pageCount,
      charCount,
      avgCharsPerPage,
      // Warn if very low char count (likely scanned PDF)
      likelyScanned: avgCharsPerPage < 100
    });

    return {
      text: fullText,
      pageCount,
      charCount,
      avgCharsPerPage,
      success: charCount > 0,
      error: charCount === 0 ? 'No text extracted - PDF may be scanned/image-based' : undefined
    };

  } catch (err: any) {
    logger.error('pdf-extractor', `Failed to extract text from ${logContext}`, {
      error: err.message
    });

    return {
      text: '',
      pageCount: 0,
      charCount: 0,
      avgCharsPerPage: 0,
      success: false,
      error: err.message
    };
  }
}

/**
 * Extract text from a base64-encoded PDF
 *
 * @param base64Data - Base64 encoded PDF data
 * @param filename - Optional filename for logging
 */
export async function extractPdfTextFromBase64(
  base64Data: string,
  filename?: string
): Promise<PdfExtractionResult> {
  const buffer = Buffer.from(base64Data, 'base64');
  return extractPdfText(buffer, filename);
}

/**
 * Check if extracted text is sufficient for text-based processing
 * (vs. needing vision/OCR fallback)
 *
 * @param result - Extraction result
 * @param minCharsPerPage - Minimum average chars per page to consider "sufficient"
 */
export function hasUsableText(result: PdfExtractionResult, minCharsPerPage = 200): boolean {
  return result.success && result.avgCharsPerPage >= minCharsPerPage;
}
