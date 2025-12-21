/**
 * PDF to Images Converter
 *
 * Converts PDF pages to images for multimodal AI processing.
 * Uses pdf-poppler which requires poppler-utils to be installed on the system.
 *
 * On macOS: brew install poppler
 * On Ubuntu: apt-get install poppler-utils
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from './logger';

const execAsync = promisify(exec);

export interface PageImage {
  pageNumber: number;
  mimeType: 'image/png' | 'image/jpeg';
  data: string; // base64 encoded
  width?: number;
  height?: number;
}

export interface PdfToImagesResult {
  success: boolean;
  images: PageImage[];
  pageCount: number;
  error?: string;
  processingTimeMs: number;
}

export interface PdfToImagesOptions {
  /** Output format: 'png' or 'jpeg'. Default: 'jpeg' (smaller file size) */
  format?: 'png' | 'jpeg';
  /** DPI for rendering. Default: 150 (good balance of quality vs size) */
  dpi?: number;
  /** Max pages to convert. Default: 50 */
  maxPages?: number;
  /** Only convert specific pages (1-indexed). If empty, convert all. */
  pages?: number[];
}

const DEFAULT_OPTIONS: Required<PdfToImagesOptions> = {
  format: 'jpeg',
  dpi: 150,
  maxPages: 50,
  pages: [],
};

/**
 * Convert PDF buffer to array of page images using pdftoppm (poppler)
 */
export async function convertPdfToImages(
  pdfBuffer: Buffer,
  filename?: string,
  options?: PdfToImagesOptions
): Promise<PdfToImagesResult> {
  const startTime = Date.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const logContext = filename || 'unknown.pdf';

  // Create temp directory for this conversion
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-images-'));
  const pdfPath = path.join(tempDir, 'input.pdf');
  const outputPrefix = path.join(tempDir, 'page');

  try {
    // Write PDF to temp file
    await fs.promises.writeFile(pdfPath, pdfBuffer);

    // Build pdftoppm command
    const formatFlag = opts.format === 'png' ? '-png' : '-jpeg';
    const extension = opts.format === 'png' ? 'png' : 'jpg';

    // First, get page count using pdfinfo
    let pageCount: number;
    try {
      const { stdout } = await execAsync(`pdfinfo "${pdfPath}" | grep Pages | awk '{print $2}'`);
      pageCount = parseInt(stdout.trim(), 10) || 0;
    } catch {
      // Fallback: try to convert and count results
      pageCount = 0;
    }

    if (pageCount === 0) {
      throw new Error('Could not determine PDF page count');
    }

    logger.info('pdf-to-images', `Converting ${logContext}`, {
      pageCount,
      format: opts.format,
      dpi: opts.dpi
    });

    // Determine which pages to convert
    let pagesToConvert: number[];
    if (opts.pages && opts.pages.length > 0) {
      pagesToConvert = opts.pages.filter(p => p >= 1 && p <= pageCount);
    } else {
      const maxPages = Math.min(pageCount, opts.maxPages);
      pagesToConvert = Array.from({ length: maxPages }, (_, i) => i + 1);
    }

    // Convert pages using pdftoppm
    // pdftoppm -jpeg -r 150 input.pdf output-prefix
    // This creates output-prefix-01.jpg, output-prefix-02.jpg, etc.
    const cmd = `pdftoppm ${formatFlag} -r ${opts.dpi} "${pdfPath}" "${outputPrefix}"`;

    await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 }); // 50MB buffer for large PDFs

    // Read generated images
    const images: PageImage[] = [];

    for (const pageNum of pagesToConvert) {
      // pdftoppm names files as prefix-01.jpg, prefix-02.jpg, etc.
      const paddedNum = pageNum.toString().padStart(String(pageCount).length, '0');
      const imagePath = `${outputPrefix}-${paddedNum}.${extension}`;

      try {
        const imageData = await fs.promises.readFile(imagePath);
        const base64Data = imageData.toString('base64');

        images.push({
          pageNumber: pageNum,
          mimeType: opts.format === 'png' ? 'image/png' : 'image/jpeg',
          data: base64Data,
        });
      } catch (err) {
        logger.warn('pdf-to-images', `Failed to read page ${pageNum} image`, {
          imagePath,
          error: (err as Error).message
        });
      }
    }

    const processingTimeMs = Date.now() - startTime;

    logger.info('pdf-to-images', `Converted ${logContext}`, {
      pageCount,
      imagesGenerated: images.length,
      processingTimeMs,
      totalSizeKB: Math.round(images.reduce((sum, img) => sum + img.data.length, 0) / 1024),
    });

    return {
      success: true,
      images,
      pageCount,
      processingTimeMs,
    };

  } catch (err) {
    const errorMessage = (err as Error).message;

    // Check for common errors
    if (errorMessage.includes('command not found') || errorMessage.includes('pdftoppm')) {
      logger.error('pdf-to-images', 'pdftoppm not found. Install poppler-utils.', {
        hint: 'macOS: brew install poppler | Ubuntu: apt-get install poppler-utils'
      });
    }

    logger.error('pdf-to-images', `Failed to convert ${logContext}`, { error: errorMessage });

    return {
      success: false,
      images: [],
      pageCount: 0,
      error: errorMessage,
      processingTimeMs: Date.now() - startTime,
    };

  } finally {
    // Cleanup temp directory
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Convert base64-encoded PDF to images
 */
export async function convertPdfToImagesFromBase64(
  base64Data: string,
  filename?: string,
  options?: PdfToImagesOptions
): Promise<PdfToImagesResult> {
  const buffer = Buffer.from(base64Data, 'base64');
  return convertPdfToImages(buffer, filename, options);
}

/**
 * Check if poppler is installed
 */
export async function isPopperInstalled(): Promise<boolean> {
  try {
    await execAsync('which pdftoppm');
    return true;
  } catch {
    return false;
  }
}
