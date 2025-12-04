import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { storage } from "../storage";
import { AIModelFactory } from "../services/ai-models/ai-model-factory";

export const fileUploadRouter = Router();

// ✅ FIX: Import pdf-parse which exports PDFParse as a named export
// Version 2.4.5+ uses named exports instead of default export
let pdfParseFunc: any = null;

async function getPdfParse() {
  if (!pdfParseFunc) {
    // Dynamic import - pdf-parse exports PDFParse as named export
    const module = await import('pdf-parse');
    // Try multiple possible export names
    pdfParseFunc = (module as any).PDFParse || (module as any).default || module;
    console.log('📦 PDF parser loaded:', typeof pdfParseFunc);
  }
  return pdfParseFunc;
}

// Configure multer for memory storage (we'll process files in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max file size (increased for larger PDFs)
  },
  fileFilter: (req, file, cb) => {
    // Accept PDF, TXT, images, and common document formats
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/octet-stream', // Browsers sometimes send this for PDFs
      'image/jpeg',
      'image/png',
      'image/jpg'
    ];

    // Check file extension as fallback for octet-stream
    const ext = file.originalname.toLowerCase().split('.').pop();
    const allowedExtensions = ['pdf', 'txt', 'doc', 'docx', 'jpg', 'jpeg', 'png'];

    // ✅ FIX: Be more lenient with file type checking
    // Accept if EITHER mime type is in allowed list OR extension is allowed
    const mimeTypeAllowed = allowedTypes.includes(file.mimetype);
    const extensionAllowed = ext && allowedExtensions.includes(ext);

    if (mimeTypeAllowed || extensionAllowed) {
      console.log(`✅ File upload accepted: ${file.originalname} (${file.mimetype}, ext: ${ext})`);
      cb(null, true);
    } else {
      console.error(`❌ File upload rejected: ${file.originalname} (${file.mimetype}, ext: ${ext})`);
      cb(new Error(`Bestandstype niet ondersteund: ${file.mimetype} (${file.originalname})`));
    }
  }
});

/**
 * Extract text from uploaded files
 * POST /api/upload/extract-text
 */
fileUploadRouter.post(
  "/extract-text",
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    console.log(`📥 Single file upload request received:`, {
      hasFile: !!req.file,
      fieldName: req.file?.fieldname,
      originalName: req.file?.originalname,
      mimetype: req.file?.mimetype,
      size: req.file?.size
    });

    if (!req.file) {
      console.error('❌ No file in request');
      throw ServerError.validation(
        "No file uploaded",
        "Geen bestand ontvangen"
      );
    }

    const file = req.file;
    let extractedText = "";

    try {
      // Detect file type by extension if MIME type is octet-stream
      const ext = file.originalname.toLowerCase().split('.').pop();
      const isPDF = file.mimetype === 'application/pdf' ||
                    (file.mimetype === 'application/octet-stream' && ext === 'pdf');
      const isTXT = file.mimetype === 'text/plain' ||
                    (file.mimetype === 'application/octet-stream' && ext === 'txt');

      // Handle different file types
      if (isPDF) {
        // Parse PDF using pdf-parse v2
        console.log(`📄 Parsing PDF: ${file.originalname} (${file.size} bytes)`);
        try {
          const PDFParseClass = await getPdfParse();
          // Create PDFParse instance with buffer
          const parser = new PDFParseClass({ data: file.buffer });
          // Use getText() method to extract text
          const result = await parser.getText();
          const pageCount = Array.isArray(result.pages) ? result.pages.length : (typeof result.pages === 'object' ? Object.keys(result.pages).length : 1);
          console.log(`✅ PDF parsed successfully: ${pageCount} pages, ${result.text?.length || 0} characters`);
          extractedText = result.text;

          // Add metadata comment
          extractedText = `=== DOCUMENT: ${file.originalname} ===\n` +
                         `Type: PDF (${pageCount} pagina's)\n` +
                         `Geëxtraheerd: ${new Date().toLocaleString('nl-NL')}\n\n` +
                         extractedText;
        } catch (pdfError: any) {
          console.error(`❌ PDF parsing failed for ${file.originalname}:`, pdfError.message);
          throw new Error(`PDF parsing mislukt: ${pdfError.message}. Controleer of het een geldig PDF bestand is.`);
        }
      } else if (isTXT) {
        // Plain text - just decode buffer
        extractedText = file.buffer.toString('utf-8');
        extractedText = `=== DOCUMENT: ${file.originalname} ===\n` +
                       `Type: Tekst bestand\n` +
                       `Geëxtraheerd: ${new Date().toLocaleString('nl-NL')}\n\n` +
                       extractedText;
      } else if (file.mimetype.startsWith('image/') || ['jpg', 'jpeg', 'png'].includes(ext || '')) {
        // Image files - use Gemini Vision to extract text/analyze content
        console.log(`🖼️ Processing image: ${file.originalname} (${file.size} bytes)`);
        try {
          const factory = AIModelFactory.getInstance();
          const handler = factory.getHandler('gemini-2.5-flash');
          if (!handler) {
            throw new Error('Gemini handler not available for image OCR');
          }

          const base64Data = file.buffer.toString('base64');
          const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

          const ocrResult = await handler.call(
            `Analyseer deze afbeelding en extraheer ALLE relevante informatie. Als het een document of scan is, extraheer dan alle tekst. Als het een screenshot of foto is, beschrijf dan de relevante inhoud. Return de geëxtraheerde tekst/informatie zonder extra commentaar.`,
            {
              model: 'gemini-2.5-flash',
              temperature: 0.1,
              maxOutputTokens: 32768,
              topP: 0.95,
              topK: 40,
              provider: 'google'
            },
            {
              jobId: `image-extract-${Date.now()}`,
              visionAttachments: [{
                mimeType,
                data: base64Data,
                filename: file.originalname
              }]
            }
          );

          if (ocrResult.content && ocrResult.content.trim().length > 10) {
            extractedText = `=== DOCUMENT: ${file.originalname} ===\n` +
                           `Type: Afbeelding (${mimeType})\n` +
                           `Geëxtraheerd: ${new Date().toLocaleString('nl-NL')}\n\n` +
                           ocrResult.content;
            console.log(`✅ Image OCR successful: ${extractedText.length} chars extracted`);
          } else {
            throw new Error('Geen tekst gevonden in afbeelding');
          }
        } catch (ocrError: any) {
          console.error(`❌ Image OCR failed for ${file.originalname}:`, ocrError.message);
          throw ServerError.validation(
            `Image OCR failed: ${ocrError.message}`,
            `Kon geen tekst uit afbeelding halen: ${ocrError.message}`
          );
        }
      } else if (file.mimetype === 'application/msword' ||
                 file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // For DOCX, we'd need mammoth.js or similar
        // For now, return a message
        throw ServerError.validation(
          "DOCX parsing not yet implemented",
          "DOCX bestanden worden binnenkort ondersteund. Gebruik voor nu PDF of TXT."
        );
      } else {
        throw ServerError.validation(
          `Unsupported file type: ${file.mimetype}`,
          `Bestandstype niet ondersteund: ${file.mimetype}`
        );
      }

      if (!extractedText.trim()) {
        throw ServerError.validation(
          "No text could be extracted from file",
          "Geen tekst gevonden in het bestand"
        );
      }

      res.json(createApiSuccessResponse({
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        extractedText: extractedText,
        characterCount: extractedText.length
      }, "Tekst succesvol geëxtraheerd"));

    } catch (error: any) {
      console.error("File extraction error:", error);

      if (error instanceof ServerError) {
        throw error;
      }

      throw ServerError.validation(
        `Failed to extract text: ${error.message}`,
        `Kon tekst niet extraheren uit ${file.originalname}: ${error.message}`
      );
    }
  })
);

/**
 * Handle multiple file uploads
 * POST /api/upload/extract-text-batch
 */
fileUploadRouter.post(
  "/extract-text-batch",
  upload.array('files', 5), // Max 5 files
  asyncHandler(async (req: Request, res: Response) => {
    console.log(`📥 Batch file upload request received:`, {
      hasFiles: !!req.files,
      isArray: Array.isArray(req.files),
      count: Array.isArray(req.files) ? req.files.length : 0,
      files: Array.isArray(req.files) ? req.files.map(f => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size
      })) : []
    });

    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      console.error('❌ No files in batch request');
      throw ServerError.validation(
        "No files uploaded",
        "Geen bestanden ontvangen"
      );
    }

    const results = [];
    const errors = [];

    for (const file of req.files) {
      try {
        let extractedText = "";

        // Detect file type by extension if MIME type is octet-stream
        const ext = file.originalname.toLowerCase().split('.').pop();
        const isPDF = file.mimetype === 'application/pdf' ||
                      (file.mimetype === 'application/octet-stream' && ext === 'pdf');
        const isTXT = file.mimetype === 'text/plain' ||
                      (file.mimetype === 'application/octet-stream' && ext === 'txt');

        if (isPDF) {
          console.log(`📄 [Batch] Parsing PDF: ${file.originalname} (${file.size} bytes)`);
          try {
            const PDFParseClass = await getPdfParse();
            const parser = new PDFParseClass({ data: file.buffer });
            const result = await parser.getText();
            const pageCount = Array.isArray(result.pages) ? result.pages.length : (typeof result.pages === 'object' ? Object.keys(result.pages).length : 1);
            console.log(`✅ [Batch] PDF parsed: ${pageCount} pages, ${result.text?.length || 0} chars`);

            extractedText = `=== DOCUMENT: ${file.originalname} ===\n` +
                           `Type: PDF (${pageCount} pagina's)\n` +
                           `Geëxtraheerd: ${new Date().toLocaleString('nl-NL')}\n\n` +
                           result.text;
          } catch (pdfError: any) {
            console.error(`❌ [Batch] PDF parsing failed for ${file.originalname}:`, pdfError.message);
            throw new Error(`PDF parsing mislukt: ${pdfError.message}`);
          }
        } else if (isTXT) {
          extractedText = `=== DOCUMENT: ${file.originalname} ===\n` +
                         `Type: Tekst bestand\n` +
                         `Geëxtraheerd: ${new Date().toLocaleString('nl-NL')}\n\n` +
                         file.buffer.toString('utf-8');
        } else {
          throw new Error(`Niet ondersteund bestandstype: ${file.mimetype}`);
        }

        results.push({
          filename: file.originalname,
          success: true,
          extractedText: extractedText,
          characterCount: extractedText.length
        });

      } catch (error: any) {
        console.error(`Error processing file ${file.originalname}:`, error);
        errors.push({
          filename: file.originalname,
          success: false,
          error: error.message
        });
      }
    }

    // If all files failed, throw an error
    if (results.length === 0 && errors.length > 0) {
      throw ServerError.validation(
        "All files failed to process",
        `Kon geen enkel bestand verwerken: ${errors.map(e => `${e.filename}: ${e.error}`).join(', ')}`
      );
    }

    res.json(createApiSuccessResponse({
      totalFiles: req.files.length,
      successful: results.length,
      failed: errors.length,
      results: results,
      errors: errors
    }, `${results.length} van ${req.files.length} bestanden succesvol verwerkt`));
  })
);

// ===== ATTACHMENT PERSISTENCE ENDPOINTS =====

/**
 * Upload and persist attachment for a report
 * POST /api/upload/attachments/:reportId
 *
 * Stores the file as base64 in database along with extracted text
 */
fileUploadRouter.post(
  "/attachments/:reportId",
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    const { reportId } = req.params;

    if (!req.file) {
      throw ServerError.validation("No file uploaded", "Geen bestand ontvangen");
    }

    // Verify report exists
    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Rapport");
    }

    const file = req.file;
    let extractedText = "";
    let pageCount: string | null = null;

    // Extract text for indexing/searching
    const ext = file.originalname.toLowerCase().split('.').pop();
    const isPDF = file.mimetype === 'application/pdf' ||
                  (file.mimetype === 'application/octet-stream' && ext === 'pdf');
    const isTXT = file.mimetype === 'text/plain' ||
                  (file.mimetype === 'application/octet-stream' && ext === 'txt');

    if (isPDF) {
      try {
        const PDFParseClass = await getPdfParse();
        const parser = new PDFParseClass({ data: file.buffer });
        const result = await parser.getText();
        pageCount = String(Array.isArray(result.pages) ? result.pages.length :
                          (typeof result.pages === 'object' ? Object.keys(result.pages).length : 1));
        extractedText = result.text || "";
      } catch (pdfError: any) {
        console.warn(`PDF text extraction failed for ${file.originalname}:`, pdfError.message);
        // Continue without extracted text - file is still usable
      }
    } else if (isTXT) {
      extractedText = file.buffer.toString('utf-8');
    }

    // Convert file to base64
    const fileData = file.buffer.toString('base64');

    // Create attachment record
    const attachment = await storage.createAttachment({
      reportId,
      filename: file.originalname,
      mimeType: file.mimetype,
      fileSize: String(file.size),
      pageCount,
      fileData,
      extractedText: extractedText || null,
      usedInStages: [],
    });

    // Return without fileData to reduce response size
    const { fileData: _, ...attachmentWithoutData } = attachment;

    res.json(createApiSuccessResponse({
      ...attachmentWithoutData,
      hasExtractedText: !!extractedText,
      characterCount: extractedText.length,
    }, "Bijlage succesvol opgeslagen"));
  })
);

/**
 * Upload multiple attachments for a report (batch)
 * POST /api/upload/attachments/:reportId/batch
 */
fileUploadRouter.post(
  "/attachments/:reportId/batch",
  (req: Request, res: Response, next: NextFunction) => {
    console.log(`📎 [${req.params.reportId}] Batch upload request received`);
    // Wrap multer to catch file filter errors
    upload.array('files', 10)(req, res, (err: any) => {
      if (err) {
        console.error('📎 Multer error:', err.message, err.stack);
        return res.status(400).json(createApiErrorResponse(
          'VALIDATION_ERROR',
          ERROR_CODES.VALIDATION_FAILED,
          err.message || 'Bestand upload mislukt',
          err.message
        ));
      }
      console.log(`📎 [${req.params.reportId}] Multer processing complete, files:`, req.files?.length || 0);
      next();
    });
  },
  asyncHandler(async (req: Request, res: Response) => {
    const { reportId } = req.params;

    console.log(`📎 [${reportId}] Processing batch attachment upload:`, {
      hasFiles: !!req.files,
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
      files: Array.isArray(req.files) ? req.files.map(f => ({
        name: f.originalname,
        type: f.mimetype,
        size: f.size
      })) : []
    });

    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      throw ServerError.validation("No files uploaded", "Geen bestanden ontvangen");
    }

    // Verify report exists
    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Rapport");
    }

    const results = [];
    const errors = [];

    for (const file of req.files) {
      console.log(`📎 [${reportId}] Processing file: ${file.originalname} (${file.size} bytes)`);
      try {
        let extractedText = "";
        let pageCount: string | null = null;
        let needsVisionOCR = false;

        const ext = file.originalname.toLowerCase().split('.').pop();
        const isPDF = file.mimetype === 'application/pdf' ||
                      (file.mimetype === 'application/octet-stream' && ext === 'pdf');
        const isTXT = file.mimetype === 'text/plain' ||
                      (file.mimetype === 'application/octet-stream' && ext === 'txt');

        if (isPDF) {
          try {
            console.log(`📎 [${reportId}] Parsing PDF: ${file.originalname}`);
            const PDFParseClass = await getPdfParse();
            const parser = new PDFParseClass({ data: file.buffer });
            const result = await parser.getText();
            const pages = Array.isArray(result.pages) ? result.pages.length :
                         (typeof result.pages === 'object' ? Object.keys(result.pages).length : 1);
            pageCount = String(pages);
            extractedText = result.text || "";

            // Detect scanned PDFs: if text per page is very low, it's likely a scan
            const charsPerPage = extractedText.length / Math.max(pages, 1);
            const MIN_CHARS_PER_PAGE = 100; // Less than 100 chars/page = probably scanned

            if (charsPerPage < MIN_CHARS_PER_PAGE && pages > 0) {
              needsVisionOCR = true;
              console.log(`📎 [${reportId}] 🔍 PDF detected as SCANNED: ${file.originalname} (${Math.round(charsPerPage)} chars/page) - running Gemini Vision OCR...`);

              // Immediately run Gemini Vision OCR to extract text
              try {
                const factory = AIModelFactory.getInstance();
                const handler = factory.getHandler('gemini-2.5-flash');
                if (!handler) {
                  throw new Error('Gemini handler not available');
                }
                const base64Data = file.buffer.toString('base64');

                const ocrResult = await handler.call(
                  `Extract ALL text from this scanned PDF document. Return ONLY the extracted text, no commentary or formatting instructions. Preserve the original structure and formatting as much as possible.`,
                  {
                    model: 'gemini-2.5-flash',
                    temperature: 0.1,
                    maxOutputTokens: 32768,
                    topP: 0.95,
                    topK: 40,
                    provider: 'google'
                  },
                  {
                    jobId: `ocr-${reportId}-${file.originalname}`,
                    visionAttachments: [{
                      mimeType: 'application/pdf',
                      data: base64Data,
                      filename: file.originalname
                    }]
                  }
                );

                if (ocrResult.content && ocrResult.content.trim().length > 50) {
                  extractedText = ocrResult.content;
                  console.log(`📎 [${reportId}] ✅ Gemini Vision OCR successful: ${extractedText.length} chars extracted from ${file.originalname}`);
                } else {
                  console.warn(`📎 [${reportId}] ⚠️ Gemini Vision OCR returned minimal text for ${file.originalname}`);
                }
              } catch (ocrError: any) {
                console.error(`📎 [${reportId}] ❌ Gemini Vision OCR failed for ${file.originalname}:`, ocrError.message);
                // Keep needsVisionOCR = true so user knows OCR is needed
              }
            } else {
              console.log(`📎 [${reportId}] PDF parsed: ${pageCount} pages, ${extractedText.length} chars (${Math.round(charsPerPage)} chars/page)`);
            }
          } catch (pdfError: any) {
            console.warn(`📎 [${reportId}] PDF text extraction failed for ${file.originalname}:`, pdfError.message);
            // If we can't extract text at all, assume it needs vision OCR
            needsVisionOCR = true;

            // Try Gemini Vision OCR as fallback
            try {
              const factory = AIModelFactory.getInstance();
              const handler = factory.getHandler('gemini-2.5-flash');
              if (!handler) {
                throw new Error('Gemini handler not available for fallback OCR');
              }
              const base64Data = file.buffer.toString('base64');

              console.log(`📎 [${reportId}] 🔍 Trying Gemini Vision OCR for ${file.originalname}...`);
              const ocrResult = await handler.call(
                `Extract ALL text from this PDF document. Return ONLY the extracted text, no commentary.`,
                {
                  model: 'gemini-2.5-flash',
                  temperature: 0.1,
                  maxOutputTokens: 32768,
                  topP: 0.95,
                  topK: 40,
                  provider: 'google'
                },
                {
                  jobId: `ocr-fallback-${reportId}-${file.originalname}`,
                  visionAttachments: [{
                    mimeType: 'application/pdf',
                    data: base64Data,
                    filename: file.originalname
                  }]
                }
              );

              if (ocrResult.content && ocrResult.content.trim().length > 50) {
                extractedText = ocrResult.content;
                console.log(`📎 [${reportId}] ✅ Gemini Vision OCR fallback successful: ${extractedText.length} chars`);
              }
            } catch (ocrError: any) {
              console.error(`📎 [${reportId}] ❌ Gemini Vision OCR fallback failed:`, ocrError.message);
            }
          }
        } else if (isTXT) {
          extractedText = file.buffer.toString('utf-8');
          console.log(`📎 [${reportId}] TXT file read: ${extractedText.length} chars`);
        } else if (file.mimetype.startsWith('image/') || ['jpg', 'jpeg', 'png'].includes(ext || '')) {
          // Image files - use Gemini Vision to extract text/analyze content
          console.log(`📎 [${reportId}] 🖼️ Processing image: ${file.originalname}`);
          needsVisionOCR = true;

          try {
            const factory = AIModelFactory.getInstance();
            const handler = factory.getHandler('gemini-2.5-flash');
            if (!handler) {
              throw new Error('Gemini handler not available for image OCR');
            }

            const base64Data = file.buffer.toString('base64');
            const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

            const ocrResult = await handler.call(
              `Analyseer deze afbeelding en extraheer ALLE relevante informatie. Als het een document of scan is, extraheer dan alle tekst. Als het een screenshot of foto is, beschrijf dan de relevante inhoud. Return de geëxtraheerde tekst/informatie zonder extra commentaar.`,
              {
                model: 'gemini-2.5-flash',
                temperature: 0.1,
                maxOutputTokens: 32768,
                topP: 0.95,
                topK: 40,
                provider: 'google'
              },
              {
                jobId: `image-ocr-${reportId}-${file.originalname}`,
                visionAttachments: [{
                  mimeType,
                  data: base64Data,
                  filename: file.originalname
                }]
              }
            );

            if (ocrResult.content && ocrResult.content.trim().length > 10) {
              extractedText = ocrResult.content;
              console.log(`📎 [${reportId}] ✅ Image OCR successful: ${extractedText.length} chars extracted from ${file.originalname}`);
            } else {
              console.warn(`📎 [${reportId}] ⚠️ Image OCR returned minimal text for ${file.originalname}`);
              extractedText = `[Afbeelding: ${file.originalname}]`;
            }
          } catch (ocrError: any) {
            console.error(`📎 [${reportId}] ❌ Image OCR failed for ${file.originalname}:`, ocrError.message);
            extractedText = `[Afbeelding: ${file.originalname} - OCR niet beschikbaar]`;
          }
        }

        console.log(`📎 [${reportId}] Converting to base64...`);
        const fileData = file.buffer.toString('base64');
        console.log(`📎 [${reportId}] Base64 size: ${fileData.length} chars`);

        console.log(`📎 [${reportId}] Saving to database...`);
        const attachment = await storage.createAttachment({
          reportId,
          filename: file.originalname,
          mimeType: file.mimetype,
          fileSize: String(file.size),
          pageCount,
          fileData,
          extractedText: extractedText || null,
          needsVisionOCR,
          usedInStages: [],
        });
        console.log(`📎 [${reportId}] Saved attachment: ${attachment.id}${needsVisionOCR ? ' (needs Vision OCR)' : ''}`);

        const { fileData: _, ...attachmentWithoutData } = attachment;
        results.push({
          ...attachmentWithoutData,
          hasExtractedText: !!extractedText,
          characterCount: extractedText.length,
        });
      } catch (error: any) {
        console.error(`📎 [${reportId}] Error processing ${file.originalname}:`, error.message, error.stack);
        errors.push({
          filename: file.originalname,
          error: error.message,
        });
      }
    }

    const responseData = {
      totalFiles: req.files.length,
      successful: results.length,
      failed: errors.length,
      attachments: results,
      errors,
    };

    console.log(`📎 [${reportId}] Sending batch response:`, {
      totalFiles: responseData.totalFiles,
      successful: responseData.successful,
      failed: responseData.failed,
      attachmentIds: results.map(r => r.id),
    });

    res.json(createApiSuccessResponse(responseData, `${results.length} van ${req.files.length} bijlages opgeslagen`));
  })
);

/**
 * Get all attachments for a report (metadata only, no file content)
 * GET /api/upload/attachments/:reportId
 */
fileUploadRouter.get(
  "/attachments/:reportId",
  asyncHandler(async (req: Request, res: Response) => {
    const { reportId } = req.params;

    const attachments = await storage.getAttachmentsForReport(reportId);

    // Return without fileData to reduce response size
    const attachmentsWithoutData = attachments.map(({ fileData, ...rest }) => ({
      ...rest,
      hasFileData: !!fileData,
    }));

    res.json(createApiSuccessResponse(attachmentsWithoutData));
  })
);

/**
 * Get single attachment with full file data (for download/AI usage)
 * GET /api/upload/attachment/:id
 */
fileUploadRouter.get(
  "/attachment/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const attachment = await storage.getAttachment(id);
    if (!attachment) {
      throw ServerError.notFound("Bijlage");
    }

    res.json(createApiSuccessResponse(attachment));
  })
);

/**
 * Get attachment file as binary download
 * GET /api/upload/attachment/:id/download
 */
fileUploadRouter.get(
  "/attachment/:id/download",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const attachment = await storage.getAttachment(id);
    if (!attachment) {
      throw ServerError.notFound("Bijlage");
    }

    // Convert base64 back to buffer
    const fileBuffer = Buffer.from(attachment.fileData, 'base64');

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    res.send(fileBuffer);
  })
);

/**
 * Mark attachment as used in a specific stage
 * PATCH /api/upload/attachment/:id/usage
 */
fileUploadRouter.patch(
  "/attachment/:id/usage",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { stageId } = req.body;

    if (!stageId) {
      throw ServerError.validation("stageId is required", "stageId is verplicht");
    }

    const updated = await storage.updateAttachmentUsage(id, stageId);
    if (!updated) {
      throw ServerError.notFound("Bijlage");
    }

    const { fileData: _, ...attachmentWithoutData } = updated;
    res.json(createApiSuccessResponse(attachmentWithoutData, "Usage bijgewerkt"));
  })
);

/**
 * Delete attachment
 * DELETE /api/upload/attachment/:id
 */
fileUploadRouter.delete(
  "/attachment/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const attachment = await storage.getAttachment(id);
    if (!attachment) {
      throw ServerError.notFound("Bijlage");
    }

    await storage.deleteAttachment(id);
    res.json(createApiSuccessResponse({ deleted: true }, "Bijlage verwijderd"));
  })
);

/**
 * Recalculate needsVisionOCR flag for all attachments of a report
 * Useful for attachments uploaded before the scanned PDF detection was implemented
 * POST /api/upload/attachments/:reportId/recalculate-ocr
 */
fileUploadRouter.post(
  "/attachments/:reportId/recalculate-ocr",
  asyncHandler(async (req: Request, res: Response) => {
    const { reportId } = req.params;
    const MIN_CHARS_PER_PAGE = 100;

    const attachments = await storage.getAttachmentsForReport(reportId);
    if (attachments.length === 0) {
      res.json(createApiSuccessResponse({ updated: 0 }, "Geen bijlages gevonden"));
      return;
    }

    const results: { filename: string; needsVisionOCR: boolean; reason: string }[] = [];

    for (const att of attachments) {
      // Only process PDFs
      if (!att.mimeType.includes('pdf')) {
        continue;
      }

      const pages = parseInt(att.pageCount || '1', 10);
      const textLength = att.extractedText?.length || 0;
      const charsPerPage = textLength / Math.max(pages, 1);

      // Determine if it needs vision OCR
      const needsVisionOCR = charsPerPage < MIN_CHARS_PER_PAGE && pages > 0;

      // Update if different from current value
      if (needsVisionOCR !== att.needsVisionOCR) {
        await storage.updateAttachment(att.id, { needsVisionOCR });
        console.log(`📎 [${reportId}] Updated ${att.filename}: needsVisionOCR = ${needsVisionOCR} (${Math.round(charsPerPage)} chars/page)`);
      }

      results.push({
        filename: att.filename,
        needsVisionOCR,
        reason: needsVisionOCR
          ? `Scanned PDF: ${Math.round(charsPerPage)} chars/page < ${MIN_CHARS_PER_PAGE}`
          : `Text PDF: ${Math.round(charsPerPage)} chars/page >= ${MIN_CHARS_PER_PAGE}`
      });
    }

    const needsOcrCount = results.filter(r => r.needsVisionOCR).length;
    res.json(createApiSuccessResponse(
      { results, summary: { total: results.length, needsVisionOCR: needsOcrCount } },
      `${needsOcrCount} van ${results.length} PDFs gemarkeerd voor Vision OCR`
    ));
  })
);

/**
 * Run Gemini Vision OCR on all scanned PDFs for a report
 * POST /api/upload/attachments/:reportId/run-ocr
 */
fileUploadRouter.post(
  "/attachments/:reportId/run-ocr",
  asyncHandler(async (req: Request, res: Response) => {
    const { reportId } = req.params;

    const attachments = await storage.getAttachmentsForReport(reportId);
    const scannedPdfs = attachments.filter(att =>
      att.mimeType.includes('pdf') && att.needsVisionOCR
    );

    if (scannedPdfs.length === 0) {
      res.json(createApiSuccessResponse({ processed: 0 }, "Geen gescande PDFs gevonden om te OCR'en"));
      return;
    }

    console.log(`📎 [${reportId}] Running Gemini Vision OCR on ${scannedPdfs.length} scanned PDF(s)...`);

    const results: { filename: string; success: boolean; extractedChars?: number; error?: string }[] = [];

    for (const att of scannedPdfs) {
      try {
        const factory = AIModelFactory.getInstance();
        const handler = factory.getHandler('gemini-2.5-flash');
        if (!handler) {
          throw new Error('Gemini handler not available');
        }

        console.log(`📎 [${reportId}] OCR'ing ${att.filename}...`);

        const ocrResult = await handler.call(
          `Extract ALL text from this scanned PDF document. Return ONLY the extracted text, no commentary or formatting instructions. Preserve the original structure and formatting as much as possible.`,
          {
            model: 'gemini-2.5-flash',
            temperature: 0.1,
            maxOutputTokens: 32768,
            topP: 0.95,
            topK: 40,
            provider: 'google'
          },
          {
            jobId: `ocr-batch-${reportId}-${att.id}`,
            visionAttachments: [{
              mimeType: 'application/pdf',
              data: att.fileData,
              filename: att.filename
            }]
          }
        );

        if (ocrResult.content && ocrResult.content.trim().length > 50) {
          // Update attachment with extracted text
          await storage.updateAttachment(att.id, {
            extractedText: ocrResult.content,
            needsVisionOCR: false // Mark as processed
          });

          console.log(`📎 [${reportId}] ✅ OCR successful for ${att.filename}: ${ocrResult.content.length} chars`);
          results.push({
            filename: att.filename,
            success: true,
            extractedChars: ocrResult.content.length
          });
        } else {
          console.warn(`📎 [${reportId}] ⚠️ OCR returned minimal text for ${att.filename}`);
          results.push({
            filename: att.filename,
            success: false,
            error: 'Minimal text extracted'
          });
        }
      } catch (ocrError: any) {
        console.error(`📎 [${reportId}] ❌ OCR failed for ${att.filename}:`, ocrError.message);
        results.push({
          filename: att.filename,
          success: false,
          error: ocrError.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    res.json(createApiSuccessResponse(
      { results, summary: { total: scannedPdfs.length, successful: successCount } },
      `${successCount} van ${scannedPdfs.length} PDFs succesvol ge-OCR'd`
    ));
  })
);
