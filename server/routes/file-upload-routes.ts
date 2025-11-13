import { Router, type Request, type Response } from "express";
import multer from "multer";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";

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
    // Accept PDF, TXT, and common document formats
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/octet-stream' // Browsers sometimes send this for PDFs
    ];

    // Check file extension as fallback for octet-stream
    const ext = file.originalname.toLowerCase().split('.').pop();
    const allowedExtensions = ['pdf', 'txt', 'doc', 'docx'];

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
