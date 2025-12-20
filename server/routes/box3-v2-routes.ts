/**
 * Box 3 V2 Routes
 *
 * New canonical data model for Box 3 bezwaar dossiers.
 * Uses Blueprint JSON format for all AI outputs.
 *
 * Endpoints:
 * - POST /api/box3-v2/intake - Create new dossier with initial validation
 * - GET /api/box3-v2/dossiers - List all dossiers
 * - GET /api/box3-v2/dossiers/:id - Get dossier with latest blueprint
 * - PATCH /api/box3-v2/dossiers/:id - Update dossier metadata
 * - DELETE /api/box3-v2/dossiers/:id - Delete dossier
 * - POST /api/box3-v2/dossiers/:id/documents - Add documents
 * - POST /api/box3-v2/dossiers/:id/revalidate - Revalidate with all documents
 * - GET /api/box3-v2/dossiers/:id/blueprints - Get blueprint history
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { Box3ExtractionPipeline, type PipelineDocument } from "../services/box3-extraction-pipeline";
import { Box3PipelineV2, type PipelineV2Document } from "../services/box3-pipeline-v2";
import { Box3MergeEngine } from "../services/box3-merge-engine";
import { extractPdfText, hasUsableText } from "../services/pdf-text-extractor";
import type { Box3Blueprint, Box3DocumentClassification } from "@shared/schema";
import { BOX3_CONSTANTS } from "@shared/constants";

export const box3V2Router = Router();

// Dynamic PDF parser import
let pdfParseFunc: any = null;

async function getPdfParse() {
  if (!pdfParseFunc) {
    const module = await import('pdf-parse');
    pdfParseFunc = (module as any).PDFParse || (module as any).default || module;
  }
  return pdfParseFunc;
}

// Configure multer for memory storage using shared constants
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: BOX3_CONSTANTS.MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.toLowerCase().split('.').pop();
    const allowedTypes = BOX3_CONSTANTS.ALLOWED_MIME_TYPES as readonly string[];
    const allowedExtensions = BOX3_CONSTANTS.ALLOWED_EXTENSIONS as readonly string[];

    if (allowedTypes.includes(file.mimetype) || (ext && allowedExtensions.includes(ext))) {
      cb(null, true);
    } else {
      cb(new Error(`Bestandstype niet ondersteund: ${file.mimetype}`));
    }
  }
});

/**
 * Extract tax years from blueprint
 */
function extractTaxYearsFromBlueprint(blueprint: Box3Blueprint): string[] {
  const years = new Set<string>();

  // From source_documents_registry
  if (blueprint.source_documents_registry) {
    for (const doc of blueprint.source_documents_registry) {
      if (doc.detected_tax_year) {
        years.add(String(doc.detected_tax_year));
      }
    }
  }

  // From year_summaries
  if (blueprint.year_summaries) {
    for (const year of Object.keys(blueprint.year_summaries)) {
      years.add(year);
    }
  }

  // From tax_authority_data
  if (blueprint.tax_authority_data) {
    for (const year of Object.keys(blueprint.tax_authority_data)) {
      years.add(year);
    }
  }

  // From assets yearly_data
  const assetCategories = ['bank_savings', 'investments', 'real_estate', 'other_assets'] as const;
  for (const category of assetCategories) {
    const assets = blueprint.assets?.[category] || [];
    for (const asset of assets) {
      if (asset.yearly_data) {
        for (const year of Object.keys(asset.yearly_data)) {
          years.add(year);
        }
      }
    }
  }

  // From debts yearly_data
  if (blueprint.debts) {
    for (const debt of blueprint.debts) {
      if (debt.yearly_data) {
        for (const year of Object.keys(debt.yearly_data)) {
          years.add(year);
        }
      }
    }
  }

  return Array.from(years).sort();
}

/**
 * Create new dossier with intake validation
 * POST /api/box3-validator/validate (compatible with frontend)
 */
box3V2Router.post(
  "/validate",
  (req: Request, res: Response, next: NextFunction) => {
    upload.array('files', 10)(req, res, (err: any) => {
      if (err) {
        return res.status(400).json(createApiErrorResponse(
          'VALIDATION_ERROR',
          ERROR_CODES.VALIDATION_FAILED,
          err.message || 'Bestand upload mislukt',
          err.message
        ));
      }
      next();
    });
  },
  asyncHandler(async (req: Request, res: Response) => {
    const { inputText, clientName, clientEmail } = req.body;
    // Note: systemPrompt is no longer required - pipeline has built-in prompts

    if (!clientName || clientName.trim().length === 0) {
      throw ServerError.validation("clientName is required", "Klantnaam is verplicht");
    }

    const files = req.files as Express.Multer.File[] || [];

    if (files.length === 0) {
      throw ServerError.validation("No files", "Upload minimaal één document");
    }

    logger.info('box3-v2', `Pipeline intake for ${clientName}`, { fileCount: files.length });

    // Create dossier first
    const dossier = await storage.createBox3Dossier({
      clientName: clientName.trim(),
      clientEmail: clientEmail?.trim() || null,
      intakeText: inputText?.trim() || null,
      status: 'intake',
    });

    logger.info('box3-v2', 'Dossier created', { dossierId: dossier.id });

    // Store documents and prepare for pipeline
    const pipelineDocs: PipelineDocument[] = [];

    for (const file of files) {
      // Extract text from PDFs for pipeline AND storage
      let extractedText: string | undefined;
      let extractionStatus: 'success' | 'low_yield' | 'failed' | 'password_protected' = 'failed';
      let extractionCharCount = 0;

      const ext = file.originalname.toLowerCase().split('.').pop();
      const isPDF = file.mimetype === 'application/pdf' ||
                    (file.mimetype === 'application/octet-stream' && ext === 'pdf');
      const isTXT = file.mimetype === 'text/plain' ||
                    (file.mimetype === 'application/octet-stream' && ext === 'txt');

      if (isPDF) {
        try {
          const result = await extractPdfText(file.buffer, file.originalname);
          extractionCharCount = result.charCount;

          if (hasUsableText(result, 200)) {
            extractedText = result.text;
            extractionStatus = 'success';
            logger.info('box3-v2', `✅ Text extracted from ${file.originalname}`, {
              charCount: result.charCount,
              avgCharsPerPage: result.avgCharsPerPage,
            });
          } else if (result.charCount > 0) {
            extractedText = result.text;
            extractionStatus = 'low_yield';
            logger.warn('box3-v2', `⚠️ Low text yield from ${file.originalname}, will use vision`, {
              charCount: result.charCount,
              avgCharsPerPage: result.avgCharsPerPage,
            });
          } else {
            // No text at all - likely scanned or password protected
            extractionStatus = 'failed';
            logger.warn('box3-v2', `⚠️ No text from ${file.originalname}, will use vision`, {
              error: result.error || 'No text content',
            });
          }
        } catch (err: any) {
          // Check for password-protected PDF error
          const errorMsg = err.message?.toLowerCase() || '';
          if (errorMsg.includes('password') || errorMsg.includes('encrypted')) {
            extractionStatus = 'password_protected';
            logger.error('box3-v2', `🔒 Password-protected PDF: ${file.originalname}`, { error: err.message });
          } else {
            extractionStatus = 'failed';
            logger.error('box3-v2', `❌ PDF extraction failed for ${file.originalname}`, { error: err.message });
          }
        }
      } else if (isTXT) {
        extractedText = file.buffer.toString('utf-8');
        extractionCharCount = extractedText.length;
        extractionStatus = 'success';
      }

      // Store document WITH extraction results
      const doc = await storage.createBox3Document({
        dossierId: dossier.id,
        filename: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileData: file.buffer.toString('base64'),
        uploadedVia: 'intake',
        extractedText: extractedText || null,
        extractionStatus,
        extractionCharCount,
      });

      pipelineDocs.push({
        id: doc.id,
        filename: doc.filename,
        mimeType: doc.mimeType,
        fileData: doc.fileData,
        extractedText,
      });
    }

    logger.info('box3-v2', 'Documents prepared for pipeline', { count: pipelineDocs.length });

    // Run extraction pipeline
    const pipeline = new Box3ExtractionPipeline((progress) => {
      logger.debug('box3-v2', `Pipeline step ${progress.stepNumber}/${progress.totalSteps}`, { message: progress.message });
    });

    let pipelineResult;
    try {
      pipelineResult = await pipeline.run(pipelineDocs, inputText || null);
    } catch (pipelineError: any) {
      logger.error('box3-v2', 'Pipeline failed, cleaning up dossier', { dossierId: dossier.id, error: pipelineError.message });
      await storage.deleteBox3Dossier(dossier.id).catch(() => {});
      throw ServerError.ai(`Pipeline extractie mislukt: ${pipelineError.message}`, { originalError: pipelineError.message });
    }

    const blueprint = pipelineResult.blueprint;
    logger.info('box3-v2', 'Pipeline completed successfully');

    // Log any pipeline errors
    if (pipelineResult.errors.length > 0) {
      logger.warn('box3-v2', 'Pipeline had non-fatal errors', { errorCount: pipelineResult.errors.length, errors: pipelineResult.errors });
    }

    // Extract tax years from blueprint
    const taxYears = extractTaxYearsFromBlueprint(blueprint);
    const hasFiscalPartner = blueprint.fiscal_entity?.fiscal_partner?.has_partner || false;

    // Update dossier with extracted info
    await storage.updateBox3Dossier(dossier.id, {
      taxYears: taxYears.length > 0 ? taxYears : null,
      hasFiscalPartner,
      status: taxYears.length > 0 ? 'in_behandeling' : 'intake',
    });

    // Store blueprint version 1
    await storage.createBox3Blueprint({
      dossierId: dossier.id,
      version: 1,
      blueprint,
      createdBy: 'pipeline',
    });

    logger.info('box3-v2', 'Blueprint v1 created', { dossierId: dossier.id });

    // Update document classifications from source_documents_registry (batched)
    if (blueprint.source_documents_registry) {
      const updates: Array<{ id: string; data: { classification: Box3DocumentClassification; extractionSummary: string | null } }> = [];

      for (const regEntry of blueprint.source_documents_registry) {
        const matchingDoc = pipelineDocs.find(d =>
          d.filename.toLowerCase() === regEntry.filename.toLowerCase() ||
          d.filename.toLowerCase().includes(regEntry.filename.toLowerCase()) ||
          regEntry.filename.toLowerCase().includes(d.filename.toLowerCase())
        );

        if (matchingDoc) {
          updates.push({
            id: matchingDoc.id,
            data: {
              classification: {
                document_type: mapDetectedTypeToClassification(regEntry.detected_type),
                tax_years: regEntry.detected_tax_year ? [String(regEntry.detected_tax_year)] : [],
                for_person: null,
                confidence: regEntry.is_readable ? 'high' : 'low',
              },
              extractionSummary: regEntry.notes || null,
            },
          });
        }
      }

      if (updates.length > 0) {
        await storage.updateBox3DocumentsBatch(updates);
      }
    }

    // Fetch updated dossier with documents (they now have classification)
    const fullDossier = await storage.getBox3DossierWithLatestBlueprint(dossier.id);
    const updatedDossier = fullDossier?.dossier || dossier;

    // Return documents with classification (without file data)
    const documentsLight = (fullDossier?.documents || []).map(d => ({
      id: d.id,
      filename: d.filename,
      mimeType: d.mimeType,
      fileSize: d.fileSize,
      uploadedAt: d.uploadedAt,
      uploadedVia: d.uploadedVia,
      classification: d.classification,
      extractionSummary: d.extractionSummary,
    }));

    res.json(createApiSuccessResponse({
      dossier: updatedDossier,
      blueprint,
      blueprintVersion: 1,
      taxYears,
      documents: documentsLight,
      _debug: {
        pipelineSteps: pipelineResult.stepResults,
        pipelineErrors: pipelineResult.errors,
        fullPrompt: pipelineResult.fullPrompt,
        rawAiResponse: pipelineResult.rawAiResponse,
        model: 'gemini-3-flash-preview',
        timestamp: new Date().toISOString(),
      }
    }, "Dossier aangemaakt en gevalideerd"));
  })
);

/**
 * Map detected_type from prompt to Box3DocumentClassification document_type
 */
function mapDetectedTypeToClassification(detectedType: string): Box3DocumentClassification['document_type'] {
  const mapping: Record<string, Box3DocumentClassification['document_type']> = {
    'aangifte_ib': 'aangifte_ib',
    'aanslag_definitief': 'definitieve_aanslag',
    'aanslag_voorlopig': 'voorlopige_aanslag',
    'jaaropgave_bank': 'jaaroverzicht_bank',
    'woz_beschikking': 'woz_beschikking',
    'email_body': 'overig',
    'overig': 'overig',
  };
  return mapping[detectedType] || 'overig';
}

/**
 * Get all dossiers
 * GET /api/box3-v2/dossiers
 */
box3V2Router.get(
  "/dossiers",
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    // Use light query - excludes intakeText for faster loading
    const dossiers = await storage.getAllBox3DossiersLight();
    logger.info('box3-v2', `GET /dossiers query took ${Date.now() - start}ms`, { count: dossiers.length });
    res.json(createApiSuccessResponse(dossiers));
  })
);

/**
 * Get single dossier with latest blueprint
 * GET /api/box3-v2/dossiers/:id
 */
box3V2Router.get(
  "/dossiers/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const data = await storage.getBox3DossierWithLatestBlueprint(id);
    if (!data) {
      throw ServerError.notFound("Dossier");
    }

    // Return documents without file data for list view
    const documentsLight = data.documents.map(d => ({
      id: d.id,
      filename: d.filename,
      mimeType: d.mimeType,
      fileSize: d.fileSize,
      uploadedAt: d.uploadedAt,
      uploadedVia: d.uploadedVia,
      classification: d.classification,
      extractionSummary: d.extractionSummary,
      // New: extraction status fields
      extractedText: d.extractedText,
      extractionStatus: d.extractionStatus,
      extractionCharCount: d.extractionCharCount,
    }));

    res.json(createApiSuccessResponse({
      dossier: data.dossier,
      blueprint: data.blueprint?.blueprint || null,
      blueprintVersion: data.blueprint?.version || 0,
      generatedEmail: data.blueprint?.generatedEmail || null,
      documents: documentsLight,
    }));
  })
);

/**
 * Update dossier metadata
 * PATCH /api/box3-v2/dossiers/:id
 */
box3V2Router.patch(
  "/dossiers/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { clientName, clientEmail, status } = req.body;

    const dossier = await storage.getBox3Dossier(id);
    if (!dossier) {
      throw ServerError.notFound("Dossier");
    }

    const updateData: Record<string, any> = {};
    if (clientName !== undefined) updateData.clientName = clientName;
    if (clientEmail !== undefined) updateData.clientEmail = clientEmail;
    if (status !== undefined) updateData.status = status;

    const updated = await storage.updateBox3Dossier(id, updateData);

    res.json(createApiSuccessResponse(updated, "Dossier bijgewerkt"));
  })
);

/**
 * Delete dossier
 * DELETE /api/box3-v2/dossiers/:id
 */
box3V2Router.delete(
  "/dossiers/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const dossier = await storage.getBox3Dossier(id);
    if (!dossier) {
      throw ServerError.notFound("Dossier");
    }

    await storage.deleteBox3Dossier(id);
    res.json(createApiSuccessResponse({ deleted: true }, "Dossier verwijderd"));
  })
);

/**
 * Add documents to existing dossier with INCREMENTAL MERGE
 * POST /api/box3-v2/dossiers/:id/documents
 *
 * This endpoint now performs:
 * 1. Store the new documents
 * 2. Extract claims from each new document (parallel)
 * 3. Merge claims into existing blueprint (preserving existing data)
 * 4. Create new blueprint version
 */
box3V2Router.post(
  "/dossiers/:id/documents",
  (req: Request, res: Response, next: NextFunction) => {
    upload.array('files', 10)(req, res, (err: any) => {
      if (err) {
        return res.status(400).json(createApiErrorResponse(
          'VALIDATION_ERROR',
          ERROR_CODES.VALIDATION_FAILED,
          err.message || 'Bestand upload mislukt',
          err.message
        ));
      }
      next();
    });
  },
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { skipExtraction } = req.body; // Optional: skip AI extraction

    const dossier = await storage.getBox3Dossier(id);
    if (!dossier) {
      throw ServerError.notFound("Dossier");
    }

    const files = req.files as Express.Multer.File[] || [];
    if (files.length === 0) {
      throw ServerError.validation("No files", "Geen bestanden geselecteerd");
    }

    logger.info('box3-v2', 'Adding documents with incremental merge', {
      dossierId: id,
      fileCount: files.length,
      skipExtraction: !!skipExtraction
    });

    // Step 1: Store new documents and prepare for extraction
    const newDocs: Array<{ id: string; filename: string }> = [];
    const pipelineDocs: PipelineDocument[] = [];

    for (const file of files) {
      // Extract text from PDFs for pipeline AND storage
      let extractedText: string | undefined;
      let extractionStatus: 'success' | 'low_yield' | 'failed' | 'password_protected' = 'failed';
      let extractionCharCount = 0;

      const ext = file.originalname.toLowerCase().split('.').pop();
      const isPDF = file.mimetype === 'application/pdf' ||
                    (file.mimetype === 'application/octet-stream' && ext === 'pdf');
      const isTXT = file.mimetype === 'text/plain' ||
                    (file.mimetype === 'application/octet-stream' && ext === 'txt');

      if (isPDF) {
        try {
          const result = await extractPdfText(file.buffer, file.originalname);
          extractionCharCount = result.charCount;

          if (hasUsableText(result, 200)) {
            extractedText = result.text;
            extractionStatus = 'success';
          } else if (result.charCount > 0) {
            extractedText = result.text;
            extractionStatus = 'low_yield';
          } else {
            extractionStatus = 'failed';
          }
        } catch (err: any) {
          const errorMsg = err.message?.toLowerCase() || '';
          if (errorMsg.includes('password') || errorMsg.includes('encrypted')) {
            extractionStatus = 'password_protected';
          } else {
            extractionStatus = 'failed';
          }
        }
      } else if (isTXT) {
        extractedText = file.buffer.toString('utf-8');
        extractionCharCount = extractedText.length;
        extractionStatus = 'success';
      }

      // Store document WITH extraction results
      const doc = await storage.createBox3Document({
        dossierId: id,
        filename: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileData: file.buffer.toString('base64'),
        uploadedVia: 'aanvulling',
        extractedText: extractedText || null,
        extractionStatus,
        extractionCharCount,
      });
      newDocs.push({ id: doc.id, filename: doc.filename });

      pipelineDocs.push({
        id: doc.id,
        filename: doc.filename,
        mimeType: doc.mimeType,
        fileData: file.buffer.toString('base64'),
        extractedText,
      });
    }

    // If skipExtraction is true, just return the stored docs
    if (skipExtraction) {
      await storage.updateBox3Dossier(id, { status: 'in_behandeling' });
      return res.json(createApiSuccessResponse({
        addedDocuments: newDocs,
        message: `${newDocs.length} document(en) toegevoegd (zonder extractie)`,
        extracted: false,
      }, `${newDocs.length} document(en) toegevoegd`));
    }

    // Step 2: Get existing blueprint
    const existingBlueprintRecord = await storage.getLatestBox3Blueprint(id);
    if (!existingBlueprintRecord) {
      throw ServerError.validation("No blueprint", "Geen bestaande blueprint gevonden. Voer eerst een intake validatie uit.");
    }
    const existingBlueprint = existingBlueprintRecord.blueprint as Box3Blueprint;

    // Step 3: Extract claims from new documents (parallel)
    const pipeline = new Box3ExtractionPipeline();
    const extractionResults = await pipeline.extractMultipleDocuments(pipelineDocs);

    logger.info('box3-v2', 'Extractions completed', {
      totalDocs: pipelineDocs.length,
      successfulExtractions: extractionResults.filter(r => !r.error).length,
      totalClaims: extractionResults.reduce((sum, r) => sum + r.extraction.claims.length, 0)
    });

    // Step 4: Merge all extractions into blueprint
    let mergedBlueprint = existingBlueprint;
    const allConflicts: any[] = [];
    const mergeStats = {
      valuesAdded: 0,
      valuesUpdated: 0,
      valuesSkipped: 0,
      conflictsDetected: 0,
    };

    // Collect document classification updates for batch processing
    const docUpdates: Array<{ id: string; data: { classification: Box3DocumentClassification; extractionSummary: string } }> = [];

    for (const result of extractionResults) {
      if (result.error) {
        logger.warn('box3-v2', 'Skipping failed extraction', {
          docId: result.extraction.document_id,
          error: result.error
        });
        continue;
      }

      const mergeEngine = new Box3MergeEngine(mergedBlueprint);
      const mergeResult = mergeEngine.mergeDocumentExtraction(result.extraction);

      mergedBlueprint = mergeResult.blueprint;
      allConflicts.push(...mergeResult.conflicts);

      // Aggregate stats
      mergeStats.valuesAdded += mergeResult.stats.valuesAdded;
      mergeStats.valuesUpdated += mergeResult.stats.valuesUpdated;
      mergeStats.valuesSkipped += mergeResult.stats.valuesSkipped;
      mergeStats.conflictsDetected += mergeResult.stats.conflictsDetected;

      // Collect document classification update
      docUpdates.push({
        id: result.extraction.document_id,
        data: {
          classification: {
            document_type: mapDetectedTypeToClassification(result.extraction.detected_type),
            tax_years: result.extraction.detected_tax_years,
            for_person: result.extraction.detected_person,
            confidence: result.extraction.claims.length > 0 ? 'high' : 'low',
          },
          extractionSummary: `${result.extraction.claims.length} claims geëxtraheerd`,
        },
      });
    }

    // Batch update all document classifications
    if (docUpdates.length > 0) {
      await storage.updateBox3DocumentsBatch(docUpdates);
    }

    // Step 5: Save new blueprint version
    const newVersion = existingBlueprintRecord.version + 1;

    await storage.createBox3Blueprint({
      dossierId: id,
      version: newVersion,
      blueprint: mergedBlueprint,
      createdBy: 'aanvulling',
    });

    // Step 6: Update dossier metadata
    const taxYears = extractTaxYearsFromBlueprint(mergedBlueprint);
    const hasFiscalPartner = mergedBlueprint.fiscal_entity?.fiscal_partner?.has_partner || false;

    await storage.updateBox3Dossier(id, {
      taxYears: taxYears.length > 0 ? taxYears : null,
      hasFiscalPartner,
      status: 'in_behandeling',
    });

    logger.info('box3-v2', 'Incremental merge completed', {
      dossierId: id,
      newVersion,
      ...mergeStats,
      conflictsNeedingReview: allConflicts.filter(c => c.needs_review).length
    });

    res.json(createApiSuccessResponse({
      addedDocuments: newDocs,
      blueprint: mergedBlueprint,
      blueprintVersion: newVersion,
      taxYears,
      mergeStats,
      conflicts: allConflicts,
      conflictsNeedingReview: allConflicts.filter(c => c.needs_review).length,
      message: `${newDocs.length} document(en) toegevoegd en gemerged`,
      _debug: {
        extractions: extractionResults.map(r => ({
          docId: r.extraction.document_id,
          type: r.extraction.detected_type,
          claimCount: r.extraction.claims.length,
          error: r.error,
        })),
      }
    }, `${newDocs.length} document(en) toegevoegd en gemerged (v${newVersion})`));
  })
);

/**
 * Start validation job for new dossier (background processing)
 * POST /api/box3-v2/validate-job
 *
 * Creates a new dossier, stores documents, and starts a background job.
 * Returns dossier ID and job ID immediately - client navigates to dossier
 * and can poll for progress.
 */
box3V2Router.post(
  "/validate-job",
  (req: Request, res: Response, next: NextFunction) => {
    upload.array('files', 10)(req, res, (err: any) => {
      if (err) {
        return res.status(400).json(createApiErrorResponse(
          'VALIDATION_ERROR',
          ERROR_CODES.VALIDATION_FAILED,
          err.message || 'Bestand upload mislukt',
          err.message
        ));
      }
      next();
    });
  },
  asyncHandler(async (req: Request, res: Response) => {
    const { inputText, clientName, clientEmail } = req.body;

    if (!clientName || clientName.trim().length === 0) {
      throw ServerError.validation("clientName is required", "Klantnaam is verplicht");
    }

    const files = req.files as Express.Multer.File[] || [];

    if (files.length === 0) {
      throw ServerError.validation("No files", "Upload minimaal één document");
    }

    logger.info('box3-v2', `Creating dossier with job for ${clientName}`, { fileCount: files.length });

    // Create dossier first (status: intake, will be updated when job completes)
    const dossier = await storage.createBox3Dossier({
      clientName: clientName.trim(),
      clientEmail: clientEmail?.trim() || null,
      intakeText: inputText?.trim() || null,
      status: 'intake',
    });

    logger.info('box3-v2', 'Dossier created', { dossierId: dossier.id });

    // Store documents
    for (const file of files) {
      await storage.createBox3Document({
        dossierId: dossier.id,
        filename: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileData: file.buffer.toString('base64'),
        uploadedVia: 'intake',
      });
    }

    logger.info('box3-v2', 'Documents stored', { dossierId: dossier.id, count: files.length });

    // Create validation job
    const job = await storage.createJob({
      type: 'box3_validation',
      status: 'queued',
      box3DossierId: dossier.id, // Use dedicated field for box3 dossiers
      result: {}, // No additional config needed
    });

    logger.info('box3-v2', 'Validation job created', {
      jobId: job.id,
      dossierId: dossier.id,
      documentCount: files.length
    });

    res.json(createApiSuccessResponse({
      dossier: {
        id: dossier.id,
        clientName: dossier.clientName,
        status: dossier.status,
        createdAt: dossier.createdAt,
      },
      jobId: job.id,
      status: 'queued',
      message: 'Dossier aangemaakt, validatie gestart'
    }));
  })
);

/**
 * Start revalidation job (background processing) - V1 Pipeline
 * POST /api/box3-v2/dossiers/:id/revalidate-job
 *
 * Creates a background job to revalidate the dossier using Pipeline V1.
 * Returns job ID immediately - client can poll for progress.
 */
box3V2Router.post(
  "/dossiers/:id/revalidate-job",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Validate dossier exists
    const dossier = await storage.getBox3Dossier(id);
    if (!dossier) {
      return res.status(404).json(createApiErrorResponse(
        'NOT_FOUND',
        ERROR_CODES.REPORT_NOT_FOUND,
        'Dossier niet gevonden',
        'Dossier niet gevonden'
      ));
    }

    // Check for documents
    const documents = await storage.getBox3DocumentsForDossier(id);
    if (documents.length === 0) {
      return res.status(400).json(createApiErrorResponse(
        'VALIDATION_ERROR',
        ERROR_CODES.VALIDATION_FAILED,
        'Geen documenten om te valideren',
        'Geen documenten om te valideren'
      ));
    }

    // Check if there's already an active job for this dossier
    const activeJobs = await storage.getJobsForBox3Dossier(id, ['queued', 'processing']);
    const existingBox3Job = activeJobs.find(j => j.type === 'box3_revalidation');
    if (existingBox3Job) {
      // Return existing job ID instead of creating duplicate
      res.json(createApiSuccessResponse({
        jobId: existingBox3Job.id,
        status: existingBox3Job.status,
        existing: true,
        message: 'Revalidatie job is al actief'
      }));
      return;
    }

    // Create job for box3 revalidation
    const job = await storage.createJob({
      type: 'box3_revalidation',
      status: 'queued',
      box3DossierId: id, // Use dedicated field for box3 dossiers
      result: {}, // No additional config needed
    });

    logger.info('box3-v2', 'Revalidation job created', {
      jobId: job.id,
      dossierId: id,
      documentCount: documents.length
    });

    res.json(createApiSuccessResponse({
      jobId: job.id,
      status: 'queued',
      message: 'Revalidatie job gestart'
    }));
  })
);

/**
 * Start revalidation job (background processing) - V2 Pipeline (Aangifte-First)
 * POST /api/box3-v2/dossiers/:id/revalidate-v2-job
 *
 * Creates a background job to revalidate the dossier using Pipeline V2.
 * Returns job ID immediately - client can poll for progress.
 */
box3V2Router.post(
  "/dossiers/:id/revalidate-v2-job",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Validate dossier exists
    const dossier = await storage.getBox3Dossier(id);
    if (!dossier) {
      return res.status(404).json(createApiErrorResponse(
        'NOT_FOUND',
        ERROR_CODES.REPORT_NOT_FOUND,
        'Dossier niet gevonden',
        'Dossier niet gevonden'
      ));
    }

    // Check for documents
    const documents = await storage.getBox3DocumentsForDossier(id);
    if (documents.length === 0) {
      return res.status(400).json(createApiErrorResponse(
        'VALIDATION_ERROR',
        ERROR_CODES.VALIDATION_FAILED,
        'Geen documenten om te valideren',
        'Geen documenten om te valideren'
      ));
    }

    // Check if there's already an active job for this dossier (V1 or V2)
    const activeJobs = await storage.getJobsForBox3Dossier(id, ['queued', 'processing']);
    const existingBox3Job = activeJobs.find(j =>
      j.type === 'box3_revalidation' || j.type === 'box3_revalidation_v2'
    );
    if (existingBox3Job) {
      // Return existing job ID instead of creating duplicate
      res.json(createApiSuccessResponse({
        jobId: existingBox3Job.id,
        status: existingBox3Job.status,
        existing: true,
        pipelineVersion: existingBox3Job.type === 'box3_revalidation_v2' ? 'v2' : 'v1',
        message: 'Revalidatie job is al actief'
      }));
      return;
    }

    // Create job for box3 revalidation V2
    const job = await storage.createJob({
      type: 'box3_revalidation_v2',
      status: 'queued',
      box3DossierId: id,
      result: {}, // No additional config needed
    });

    logger.info('box3-v2', 'Revalidation V2 job created', {
      jobId: job.id,
      dossierId: id,
      documentCount: documents.length,
      pipelineVersion: 'v2'
    });

    res.json(createApiSuccessResponse({
      jobId: job.id,
      status: 'queued',
      pipelineVersion: 'v2',
      message: 'Revalidatie V2 job gestart'
    }));
  })
);

/**
 * Get active job for dossier
 * GET /api/box3-v2/dossiers/:id/job
 *
 * Returns the active revalidation job for this dossier, if any.
 * Supports both V1 and V2 pipeline jobs.
 */
box3V2Router.get(
  "/dossiers/:id/job",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Get active jobs for this dossier (validation, revalidation V1 and V2)
    const activeJobs = await storage.getJobsForBox3Dossier(id, ['queued', 'processing']);
    const box3Job = activeJobs.find(j =>
      j.type === 'box3_revalidation' ||
      j.type === 'box3_revalidation_v2' ||
      j.type === 'box3_validation'
    );

    if (!box3Job) {
      res.json(createApiSuccessResponse({
        hasActiveJob: false,
        job: null
      }));
      return;
    }

    // Parse progress JSON
    let progress = null;
    if (box3Job.progress) {
      try {
        progress = JSON.parse(box3Job.progress);
      } catch {
        progress = null;
      }
    }

    // Determine pipeline version from job type
    const pipelineVersion = box3Job.type === 'box3_revalidation_v2' ? 'v2' : 'v1';

    res.json(createApiSuccessResponse({
      hasActiveJob: true,
      job: {
        id: box3Job.id,
        type: box3Job.type,
        status: box3Job.status,
        progress,
        pipelineVersion,
        createdAt: box3Job.createdAt,
        startedAt: box3Job.startedAt,
      }
    }));
  })
);

/**
 * Revalidate dossier with all documents (SSE streaming)
 * POST /api/box3-v2/dossiers/:id/revalidate
 *
 * DEPRECATED: Use /revalidate-job instead for background processing.
 * Returns Server-Sent Events with progress updates during extraction,
 * then a final result event with the complete blueprint.
 */
box3V2Router.post(
  "/dossiers/:id/revalidate",
  async (req: Request, res: Response) => {
    const { id } = req.params;

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Helper to send SSE events
    const sendEvent = (event: string, data: object) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const dossier = await storage.getBox3Dossier(id);
      if (!dossier) {
        sendEvent('error', { message: 'Dossier niet gevonden' });
        res.end();
        return;
      }

      // Get all documents
      const documents = await storage.getBox3DocumentsForDossier(id);
      if (documents.length === 0) {
        sendEvent('error', { message: 'Geen documenten om te valideren' });
        res.end();
        return;
      }

      logger.info('box3-v2', 'Revalidating dossier', { dossierId: id, documentCount: documents.length });

      // Send initial progress
      sendEvent('progress', {
        step: 0,
        totalSteps: 5,
        message: 'Documenten voorbereiden...',
        phase: 'preparation',
      });

      // Prepare documents for pipeline
      const pipelineDocs: PipelineDocument[] = [];
      for (const doc of documents) {
        // Extract text from PDFs
        let extractedText: string | undefined;
        const ext = doc.filename.toLowerCase().split('.').pop();
        const isPDF = doc.mimeType === 'application/pdf' ||
                      (doc.mimeType === 'application/octet-stream' && ext === 'pdf');
        const isTXT = doc.mimeType === 'text/plain' ||
                      (doc.mimeType === 'application/octet-stream' && ext === 'txt');

        if (isPDF) {
          try {
            const PDFParseClass = await getPdfParse();
            const buffer = Buffer.from(doc.fileData, 'base64');
            const parser = new PDFParseClass({ data: buffer });
            const result = await parser.getText();
            extractedText = result.text || "";
          } catch {
            // Vision will handle it
          }
        } else if (isTXT) {
          extractedText = Buffer.from(doc.fileData, 'base64').toString('utf-8');
        }

        pipelineDocs.push({
          id: doc.id,
          filename: doc.filename,
          mimeType: doc.mimeType,
          fileData: doc.fileData,
          extractedText,
        });
      }

      // Run extraction pipeline with SSE progress callback
      const pipeline = new Box3ExtractionPipeline((progress) => {
        logger.debug('box3-v2', `Pipeline step ${progress.stepNumber}/${progress.totalSteps}`, { message: progress.message });
        sendEvent('progress', {
          step: progress.stepNumber,
          totalSteps: progress.totalSteps,
          message: progress.message,
          phase: progress.step,
        });
      });

      const pipelineResult = await pipeline.run(pipelineDocs, dossier.intakeText || null);
      const blueprint = pipelineResult.blueprint;

      logger.info('box3-v2', 'Pipeline revalidation completed');

      // Log any pipeline errors
      if (pipelineResult.errors.length > 0) {
        logger.warn('box3-v2', 'Pipeline had non-fatal errors', { errorCount: pipelineResult.errors.length, errors: pipelineResult.errors });
      }

      // Send saving progress
      sendEvent('progress', {
        step: 5,
        totalSteps: 5,
        message: 'Blueprint opslaan...',
        phase: 'saving',
      });

      // Get current version and increment
      const currentBlueprint = await storage.getLatestBox3Blueprint(id);
      const newVersion = (currentBlueprint?.version || 0) + 1;

      // Store new blueprint
      await storage.createBox3Blueprint({
        dossierId: id,
        version: newVersion,
        blueprint,
        createdBy: 'pipeline',
      });

      // Update dossier
      const taxYears = extractTaxYearsFromBlueprint(blueprint);
      const hasFiscalPartner = blueprint.fiscal_entity?.fiscal_partner?.has_partner || false;

      await storage.updateBox3Dossier(id, {
        taxYears: taxYears.length > 0 ? taxYears : null,
        hasFiscalPartner,
      });

      // Update document classifications from source_documents_registry (batched)
      if (blueprint.source_documents_registry) {
        const updates: Array<{ id: string; data: { classification: Box3DocumentClassification; extractionSummary: string | null } }> = [];

        for (let i = 0; i < blueprint.source_documents_registry.length; i++) {
          const regEntry = blueprint.source_documents_registry[i];
          // Match by index since AI generates its own filenames
          const matchingDoc = documents[i];

          if (matchingDoc) {
            updates.push({
              id: matchingDoc.id,
              data: {
                classification: {
                  document_type: mapDetectedTypeToClassification(regEntry.detected_type),
                  tax_years: regEntry.detected_tax_year ? [String(regEntry.detected_tax_year)] : [],
                  for_person: null,
                  confidence: regEntry.is_readable ? 'high' : 'low',
                },
                extractionSummary: regEntry.notes || null,
              },
            });
          }
        }

        if (updates.length > 0) {
          await storage.updateBox3DocumentsBatch(updates);
        }
      }

      logger.info('box3-v2', `Blueprint v${newVersion} created`, { dossierId: id });

      // Send final result event
      sendEvent('result', {
        success: true,
        blueprint,
        blueprintVersion: newVersion,
        taxYears,
        _debug: {
          pipelineSteps: pipelineResult.stepResults,
          pipelineErrors: pipelineResult.errors,
          fullPrompt: pipelineResult.fullPrompt,
          rawAiResponse: pipelineResult.rawAiResponse,
          model: 'gemini-3-flash-preview',
          timestamp: new Date().toISOString(),
        },
        message: `Dossier opnieuw gevalideerd (v${newVersion})`,
      });

      res.end();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Onbekende fout';
      logger.error('box3-v2', 'Revalidation failed', { dossierId: id, error: message });
      sendEvent('error', { message });
      res.end();
    }
  }
);

/**
 * Get blueprint history for dossier
 * GET /api/box3-v2/dossiers/:id/blueprints
 */
box3V2Router.get(
  "/dossiers/:id/blueprints",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const dossier = await storage.getBox3Dossier(id);
    if (!dossier) {
      throw ServerError.notFound("Dossier");
    }

    const blueprints = await storage.getAllBox3Blueprints(id);

    // Return light version (without full blueprint JSON for list)
    const blueprintsLight = blueprints.map(b => ({
      id: b.id,
      version: b.version,
      createdAt: b.createdAt,
      createdBy: b.createdBy,
    }));

    res.json(createApiSuccessResponse(blueprintsLight));
  })
);

/**
 * Get specific blueprint version
 * GET /api/box3-v2/dossiers/:id/blueprints/:version
 */
box3V2Router.get(
  "/dossiers/:id/blueprints/:version",
  asyncHandler(async (req: Request, res: Response) => {
    const { id, version } = req.params;

    const dossier = await storage.getBox3Dossier(id);
    if (!dossier) {
      throw ServerError.notFound("Dossier");
    }

    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum)) {
      throw ServerError.validation("Invalid version parameter", "Ongeldige versie nummer");
    }

    const blueprints = await storage.getAllBox3Blueprints(id);
    const blueprint = blueprints.find(b => b.version === versionNum);

    if (!blueprint) {
      throw ServerError.notFound(`Blueprint versie ${version}`);
    }

    res.json(createApiSuccessResponse(blueprint));
  })
);

/**
 * Get document file data (for download)
 * GET /api/box3-v2/documents/:id/download
 */
box3V2Router.get(
  "/documents/:id/download",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const doc = await storage.getBox3Document(id);
    if (!doc) {
      throw ServerError.notFound("Document");
    }

    const buffer = Buffer.from(doc.fileData, 'base64');

    res.set({
      'Content-Type': doc.mimeType,
      'Content-Disposition': `attachment; filename="${doc.filename}"`,
      'Content-Length': buffer.length,
    });

    res.send(buffer);
  })
);

/**
 * Generate follow-up email based on dossier status
 * POST /api/box3-v2/dossiers/:id/generate-email
 *
 * Generates a contextual email based on the current state of the dossier:
 * - Missing documents: Request for additional documents
 * - Not profitable: Explain that costs outweigh potential refund
 * - Profitable: Congratulate and offer to file objection
 */
box3V2Router.post(
  "/dossiers/:id/generate-email",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { emailType } = req.body; // Optional: 'request_docs' | 'not_profitable' | 'profitable' | 'auto'

    const data = await storage.getBox3DossierWithLatestBlueprint(id);
    if (!data) {
      throw ServerError.notFound("Dossier");
    }

    const { dossier } = data;
    const blueprint = data.blueprint?.blueprint as Box3Blueprint | null;
    if (!blueprint) {
      throw ServerError.validation("No blueprint", "Dossier heeft nog geen gevalideerde data");
    }

    // Analyze the dossier status
    const years = Object.keys(blueprint.year_summaries || {});
    const allMissingItems: Array<{ year: string; description: string }> = [];
    let totalIndicativeRefund = 0;
    let totalDeemedReturn = 0;
    let totalEstimatedRefund = 0;
    let totalTaxPaid = 0;
    let hasCompleteData = true;
    let hasUnknownInterest = false;
    const bankSavings = blueprint.assets?.bank_savings || [];

    years.forEach(year => {
      const summary = blueprint.year_summaries?.[year];
      const missingItems = summary?.missing_items || [];
      missingItems.forEach(item => {
        // Handle both string items and object items with description field
        const description = typeof item === 'string' ? item : item.description;
        allMissingItems.push({ year, description });
      });

      if (summary?.status === 'incomplete') {
        hasCompleteData = false;
      }

      const yearRefund = summary?.calculated_totals?.indicative_refund || 0;
      totalIndicativeRefund += yearRefund;
      totalDeemedReturn += summary?.calculated_totals?.deemed_return_from_tax_authority || 0;

      // Get tax paid from tax_authority_data
      const taxAuthorityYear = blueprint.tax_authority_data?.[year];
      if (taxAuthorityYear?.household_totals?.total_tax_assessed) {
        totalTaxPaid += taxAuthorityYear.household_totals.total_tax_assessed;
      }

      // Calculate estimated refund (same logic as frontend)
      const savingsRate = BOX3_CONSTANTS.AVERAGE_SAVINGS_RATES[year] || 0.001;
      const taxRate = BOX3_CONSTANTS.TAX_RATES[year] || 0.31;
      const deemedReturn = summary?.calculated_totals?.deemed_return_from_tax_authority || 0;
      const actualReturn = summary?.calculated_totals?.actual_return?.total || 0;

      let yearEstimatedInterest = 0;
      let yearHasUnknown = false;

      bankSavings.forEach(asset => {
        const yearData = asset.yearly_data?.[year];
        if (!yearData) return;

        const interestField = yearData.interest_received;
        const hasInterest = interestField != null &&
          (typeof interestField === 'number' ? (interestField as number) > 0 :
           typeof interestField === 'object' && (interestField as any).amount != null);

        if (!hasInterest) {
          yearHasUnknown = true;
          hasUnknownInterest = true;
          const balance = typeof yearData.value_jan_1 === 'number' ? yearData.value_jan_1 :
            typeof yearData.value_jan_1 === 'object' ? (yearData.value_jan_1 as any)?.amount :
            typeof (yearData as any).balance_jan1 === 'number' ? (yearData as any).balance_jan1 : 0;

          if (balance && balance > 0) {
            yearEstimatedInterest += balance * savingsRate;
          }
        }
      });

      // Calculate this year's estimated refund
      if (yearHasUnknown) {
        const estimatedActualReturn = actualReturn + yearEstimatedInterest;
        const estimatedDifference = deemedReturn - estimatedActualReturn;
        const yearEstimatedRefund = Math.max(0, estimatedDifference * taxRate);
        totalEstimatedRefund += yearEstimatedRefund;
      } else {
        totalEstimatedRefund += yearRefund;
      }
    });

    // Determine email type automatically if not specified
    let determinedType = emailType || 'auto';

    if (determinedType === 'auto') {
      if (allMissingItems.length > 0) {
        determinedType = 'request_docs';
      } else if (totalIndicativeRefund > BOX3_CONSTANTS.MINIMUM_PROFITABLE_AMOUNT) {
        determinedType = 'profitable';
      } else {
        determinedType = 'not_profitable';
      }
    }

    // Get client info
    const clientName = dossier.clientName || 'heer/mevrouw';
    const firstName = clientName.split(' ')[0];
    const yearRange = years.length > 1 ? `${Math.min(...years.map(Number))}-${Math.max(...years.map(Number))}` : years[0];

    // Generate email based on type
    let subject = '';
    let body = '';

    if (determinedType === 'request_docs') {
      subject = `Box 3 ${yearRange} - goed nieuws over mogelijke teruggave`;

      // Group missing items by year for bullet list
      const missingByYear: Record<string, string[]> = {};
      allMissingItems.forEach(item => {
        if (!missingByYear[item.year]) missingByYear[item.year] = [];
        missingByYear[item.year].push(item.description);
      });

      // Build bullet list of missing docs (cleaner format)
      const missingListHtml = Object.entries(missingByYear)
        .map(([year, items]) => {
          const bullets = items.map(i => `<li>${i}</li>`).join('');
          return years.length > 1 ? `<p><strong>${year}:</strong></p><ul>${bullets}</ul>` : `<ul>${bullets}</ul>`;
        })
        .join('');

      // Calculate costs - use constant from BOX3_CONSTANTS
      const costPerYear = BOX3_CONSTANTS.COST_PER_YEAR;
      const totalCost = years.length * costPerYear;
      const displayRefund = hasUnknownInterest ? totalEstimatedRefund : totalIndicativeRefund;
      const displayRefundRounded = Math.round(displayRefund);
      const netRefund = displayRefundRounded - totalCost;
      const totalTaxPaidRounded = Math.round(totalTaxPaid);

      // Get the appropriate tax rate label for display
      const primaryYear = years[0];
      const taxRatePercent = Math.round((BOX3_CONSTANTS.TAX_RATES[primaryYear] || 0.31) * 100);

      // Build the email with new structure
      body = `<p>Beste ${firstName},</p>

<p>Goed nieuws! Wij hebben uw aangifte inkomstenbelasting ${yearRange} gecontroleerd en zien een mogelijkheid voor teruggave van Box 3 belasting.</p>

<p>${totalTaxPaidRounded > 0 ? `U heeft <strong>€${totalTaxPaidRounded},-</strong> Box 3 belasting betaald. ` : ''}De <strong>Hoge Raad</strong> heeft bepaald dat u niet meer belasting hoeft te betalen dan uw <strong>werkelijk behaalde rendement</strong>. Dit betekent dat als uw daadwerkelijke rente en dividend lager was dan wat de Belastingdienst veronderstelde, u recht heeft op teruggave.</p>

${displayRefundRounded > 0 ? `<p>Op basis van onze eerste analyse schatten wij uw teruggave op <strong>€${displayRefundRounded},-</strong>. Let op: de definitieve teruggaaf hangt af van uw daadwerkelijk rendement.</p>` : ''}

<refund_visual></refund_visual>

<p>Om de exacte teruggave te berekenen hebben wij nog de volgende jaaropgaven nodig:</p>

${missingListHtml}

<ul>
<li><strong>Service:</strong> Opstellen en indienen van het officiële verzoek tot toepassing werkelijk rendement</li>
<li><strong>Kosten:</strong> €${costPerYear},- per belastingjaar${years.length > 1 ? ` (totaal €${totalCost},- voor ${years.length} jaren)` : ''}</li>
${netRefund > 0 ? `<li><strong>Geschat netto voordeel:</strong> €${netRefund},- (teruggave minus kosten)</li>` : ''}
</ul>

<p><em>Het netto voordeel kan variëren op basis van het vastgestelde werkelijk rendement.</em></p>

<ol>
<li>Na akkoord en aanlevering van de jaaropgaven maken wij het dossier definitief</li>
<li>U ontvangt een factuur van €${costPerYear},-${years.length > 1 ? ` per jaar` : ''}</li>
<li>Na betaling dienen wij het formele verzoek in bij de Belastingdienst</li>
</ol>

<p>U kunt de documenten eenvoudig als bijlage bij een reply op deze email sturen of uploaden via uw persoonlijke dossier.</p>

<p><strong>Wilt u doorgaan?</strong> Stuur ons de gevraagde jaaropgaven en wij zetten de factuur voor u klaar.</p>

<p>Met vriendelijke groet,</p>`;

    } else if (determinedType === 'not_profitable') {
      subject = `Box 3 ${yearRange} - onze beoordeling`;

      const costPerYearNotProfitable = BOX3_CONSTANTS.COST_PER_YEAR;
      const totalTaxPaidRoundedNotProfitable = Math.round(totalTaxPaid);
      const indicativeRefundRounded = Math.round(totalIndicativeRefund);

      body = `<p>Beste ${firstName},</p>

<p>Wij hebben uw aangifte inkomstenbelasting ${yearRange} gecontroleerd op mogelijkheden voor teruggave van Box 3 belasting.</p>

${totalTaxPaidRoundedNotProfitable > 0 ? `<p>U heeft <strong>€${totalTaxPaidRoundedNotProfitable},-</strong> Box 3 belasting betaald.</p>` : ''}

<p>Helaas is een verzoek tot toepassing werkelijk rendement in uw situatie <strong>niet rendabel</strong>.</p>

${indicativeRefundRounded > 0
  ? `<p>De mogelijke teruggave bedraagt circa <strong>€${indicativeRefundRounded},-</strong>. De kosten voor het indienen van een verzoek bedragen €${costPerYearNotProfitable},- per jaar. Omdat de teruggave lager is dan de kosten, raden wij af om door te gaan.</p>`
  : `<p>Op basis van de gegevens is er geen teruggave te verwachten. Uw werkelijke rendement ligt niet lager dan het forfaitaire rendement dat de Belastingdienst heeft gehanteerd.</p>`}

<p>Het verzoek werkelijk rendement is gebaseerd op het verschil tussen uw <strong>daadwerkelijke rente en dividend</strong> en het <strong>forfaitaire rendement</strong> dat de Belastingdienst hanteert. In uw geval ligt uw werkelijke rendement niet significant lager dan het forfaitaire rendement.</p>

<p>Mocht uw situatie in de toekomst veranderen (bijvoorbeeld door lagere rendementen op spaargeld), dan kunt u altijd opnieuw contact met ons opnemen.</p>

<p>Heeft u vragen over deze beoordeling? Wij lichten het graag toe.</p>

<p>Met vriendelijke groet,</p>`;

    } else { // profitable
      subject = `Box 3 ${yearRange} - uw teruggave is berekend`;

      // Calculate values for profitable email
      const costPerYear = BOX3_CONSTANTS.COST_PER_YEAR;
      const totalCost = years.length * costPerYear;
      const netRefundProfitable = Math.round(totalIndicativeRefund) - totalCost;
      const totalTaxPaidRoundedProfitable = Math.round(totalTaxPaid);

      body = `<p>Beste ${firstName},</p>

<p>Goed nieuws! Wij hebben uw aangifte inkomstenbelasting ${yearRange} gecontroleerd en de berekening is compleet.</p>

<p>${totalTaxPaidRoundedProfitable > 0 ? `U heeft <strong>€${totalTaxPaidRoundedProfitable},-</strong> Box 3 belasting betaald. ` : ''}De <strong>Hoge Raad</strong> heeft bepaald dat u niet meer belasting hoeft te betalen dan uw <strong>werkelijk behaalde rendement</strong>. Uw werkelijke rendement was lager dan wat de Belastingdienst veronderstelde.</p>

<refund_visual></refund_visual>

<p><strong>Berekende teruggave: €${Math.round(totalIndicativeRefund)},-</strong></p>

<p>Dit bedrag is gebaseerd op het verschil tussen uw werkelijke rendement en het forfaitaire rendement dat de Belastingdienst heeft gehanteerd.</p>

<ul>
<li><strong>Service:</strong> Opstellen en indienen van het officiële verzoek tot toepassing werkelijk rendement</li>
<li><strong>Kosten:</strong> €${costPerYear},- per belastingjaar${years.length > 1 ? ` (totaal €${totalCost},- voor ${years.length} jaren)` : ''}</li>
<li><strong>Netto voordeel:</strong> €${netRefundProfitable},- (teruggave minus kosten)</li>
</ul>

<ol>
<li>U geeft akkoord om door te gaan</li>
<li>U ontvangt een factuur van €${costPerYear},-${years.length > 1 ? ` per jaar` : ''}</li>
<li>Na betaling dienen wij het formele verzoek in bij de Belastingdienst</li>
</ol>

<p><strong>Wilt u doorgaan?</strong> Reageer op deze email met uw akkoord en wij zetten de factuur voor u klaar.</p>

<p>Met vriendelijke groet,</p>`;
    }

    const emailData = {
      emailType: determinedType,
      subject,
      body,
      metadata: {
        yearRange,
        totalIndicativeRefund,
        missingItemsCount: allMissingItems.length,
        minimumProfitableAmount: BOX3_CONSTANTS.MINIMUM_PROFITABLE_AMOUNT,
      },
      generatedAt: new Date().toISOString(),
    };

    // Save the generated email to the blueprint record
    if (data.blueprint) {
      await storage.updateBox3BlueprintGeneratedEmail(data.blueprint.id, emailData);
    }

    logger.info('box3-v2', 'Generated and saved follow-up email', {
      dossierId: id,
      blueprintId: data.blueprint?.id,
      emailType: determinedType,
      indicativeRefund: totalIndicativeRefund,
      missingItemsCount: allMissingItems.length,
    });

    res.json(createApiSuccessResponse(emailData, "Email gegenereerd"));
  })
);

// =============================================================================
// PIPELINE V2: AANGIFTE-FIRST ARCHITECTURE
// =============================================================================

/**
 * Feature flag for Pipeline V2
 * Set USE_PIPELINE_V2=true in environment to enable
 */
const USE_PIPELINE_V2 = process.env.USE_PIPELINE_V2 === 'true';

/**
 * Validate using Pipeline V2 (Aangifte-First)
 * POST /api/box3-validator/validate-v2
 *
 * Uses the new 3-stage pipeline:
 * 1. Manifest extraction from aangifte (1 LLM call)
 * 2. Enrichment from source documents (1 LLM call)
 * 3. Validation & calculation (deterministic)
 */
box3V2Router.post(
  "/validate-v2",
  (req: Request, res: Response, next: NextFunction) => {
    upload.array('files', 10)(req, res, (err: any) => {
      if (err) {
        return res.status(400).json(createApiErrorResponse(
          'VALIDATION_ERROR',
          ERROR_CODES.VALIDATION_FAILED,
          err.message || 'Bestand upload mislukt',
          err.message
        ));
      }
      next();
    });
  },
  asyncHandler(async (req: Request, res: Response) => {
    const { inputText, clientName, clientEmail } = req.body;

    if (!clientName || clientName.trim().length === 0) {
      throw ServerError.validation("clientName is required", "Klantnaam is verplicht");
    }

    const files = req.files as Express.Multer.File[] || [];

    if (files.length === 0) {
      throw ServerError.validation("No files", "Upload minimaal één document (aangifte IB vereist)");
    }

    logger.info('box3-v2', `Pipeline V2 intake for ${clientName}`, { fileCount: files.length });

    // Create dossier first
    const dossier = await storage.createBox3Dossier({
      clientName: clientName.trim(),
      clientEmail: clientEmail?.trim() || null,
      intakeText: inputText?.trim() || null,
      status: 'intake',
    });

    logger.info('box3-v2', 'Dossier created (V2)', { dossierId: dossier.id });

    // Store documents and prepare for pipeline
    const pipelineDocs: PipelineV2Document[] = [];

    for (const file of files) {
      let extractedText: string | undefined;
      let extractionStatus: 'success' | 'low_yield' | 'failed' | 'password_protected' = 'failed';
      let extractionCharCount = 0;

      const ext = file.originalname.toLowerCase().split('.').pop();
      const isPDF = file.mimetype === 'application/pdf' ||
                    (file.mimetype === 'application/octet-stream' && ext === 'pdf');
      const isTXT = file.mimetype === 'text/plain' ||
                    (file.mimetype === 'application/octet-stream' && ext === 'txt');

      if (isPDF) {
        try {
          const result = await extractPdfText(file.buffer, file.originalname);
          extractionCharCount = result.charCount;

          if (hasUsableText(result, 200)) {
            extractedText = result.text;
            extractionStatus = 'success';
          } else if (result.charCount > 0) {
            extractedText = result.text;
            extractionStatus = 'low_yield';
          } else {
            extractionStatus = 'failed';
          }
        } catch (err: any) {
          const errorMsg = err.message?.toLowerCase() || '';
          extractionStatus = errorMsg.includes('password') || errorMsg.includes('encrypted')
            ? 'password_protected'
            : 'failed';
        }
      } else if (isTXT) {
        extractedText = file.buffer.toString('utf-8');
        extractionCharCount = extractedText.length;
        extractionStatus = 'success';
      }

      // Store document
      const doc = await storage.createBox3Document({
        dossierId: dossier.id,
        filename: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileData: file.buffer.toString('base64'),
        uploadedVia: 'intake',
        extractedText: extractedText || null,
        extractionStatus,
        extractionCharCount,
      });

      pipelineDocs.push({
        id: doc.id,
        filename: doc.filename,
        mimeType: doc.mimeType,
        fileData: doc.fileData,
        extractedText,
      });
    }

    logger.info('box3-v2', 'Documents prepared for Pipeline V2', { count: pipelineDocs.length });

    // Run Pipeline V2
    const pipeline = new Box3PipelineV2((progress) => {
      logger.debug('box3-v2', `Pipeline V2: ${progress.message}`, {
        stage: progress.stage,
        percentage: progress.percentage,
      });
    });

    let pipelineResult;
    try {
      pipelineResult = await pipeline.run(pipelineDocs, inputText || null);
    } catch (pipelineError: any) {
      logger.error('box3-v2', 'Pipeline V2 failed, cleaning up dossier', {
        dossierId: dossier.id,
        error: pipelineError.message,
      });
      await storage.deleteBox3Dossier(dossier.id).catch(() => {});
      throw ServerError.ai(`Pipeline V2 extractie mislukt: ${pipelineError.message}`, {
        originalError: pipelineError.message,
      });
    }

    if (!pipelineResult.success) {
      logger.error('box3-v2', 'Pipeline V2 returned failure', {
        dossierId: dossier.id,
        errors: pipelineResult.errors,
      });
      await storage.deleteBox3Dossier(dossier.id).catch(() => {});
      throw ServerError.ai(`Pipeline V2 mislukt: ${pipelineResult.errors.join(', ')}`, {});
    }

    const blueprint = pipelineResult.blueprint;
    logger.info('box3-v2', 'Pipeline V2 completed successfully', {
      timing: pipelineResult.timing,
      validation: pipelineResult.validation.is_valid,
    });

    // Log warnings
    if (pipelineResult.warnings.length > 0) {
      logger.warn('box3-v2', 'Pipeline V2 warnings', { warnings: pipelineResult.warnings });
    }

    // Extract tax years from manifest
    const taxYears = pipelineResult.manifest.tax_years || [];
    const hasFiscalPartner = !!pipelineResult.manifest.fiscal_entity?.fiscal_partner;

    // Update dossier with extracted info
    await storage.updateBox3Dossier(dossier.id, {
      taxYears: taxYears.length > 0 ? taxYears : null,
      hasFiscalPartner,
      status: taxYears.length > 0 ? 'in_behandeling' : 'intake',
    });

    // Store blueprint version 1
    await storage.createBox3Blueprint({
      dossierId: dossier.id,
      version: 1,
      blueprint,
      createdBy: 'pipeline-v2',
    });

    logger.info('box3-v2', 'Blueprint v1 created (Pipeline V2)', { dossierId: dossier.id });

    // Return result
    res.json(createApiSuccessResponse({
      dossier: {
        id: dossier.id,
        clientName: dossier.clientName,
        taxYears,
        hasFiscalPartner,
        status: dossier.status,
      },
      blueprint,
      manifest: pipelineResult.manifest,
      actualReturns: pipelineResult.actualReturns,
      validation: pipelineResult.validation,
      timing: pipelineResult.timing,
      warnings: pipelineResult.warnings,
      pipelineVersion: 'v2',
    }, "Box 3 validatie succesvol (Pipeline V2)"));
  })
);

/**
 * Revalidate using Pipeline V2 (Aangifte-First)
 * POST /api/box3-validator/dossiers/:id/revalidate-v2
 *
 * Synchronous revalidation using the V2 pipeline.
 * Returns immediately with result (no background job).
 */
box3V2Router.post(
  "/dossiers/:id/revalidate-v2",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Validate dossier exists
    const dossier = await storage.getBox3Dossier(id);
    if (!dossier) {
      return res.status(404).json(createApiErrorResponse(
        'NOT_FOUND',
        ERROR_CODES.REPORT_NOT_FOUND,
        'Dossier niet gevonden',
        'Dossier niet gevonden'
      ));
    }

    // Get all documents
    const documents = await storage.getBox3DocumentsForDossier(id);
    if (documents.length === 0) {
      return res.status(400).json(createApiErrorResponse(
        'VALIDATION_ERROR',
        ERROR_CODES.VALIDATION_FAILED,
        'Geen documenten om te valideren',
        'Geen documenten om te valideren'
      ));
    }

    logger.info('box3-v2', `Revalidate V2 for dossier ${id}`, { docCount: documents.length });

    // Prepare documents for Pipeline V2
    const pipelineDocs: PipelineV2Document[] = documents.map(doc => ({
      id: doc.id,
      filename: doc.filename,
      mimeType: doc.mimeType,
      fileData: doc.fileData,
      extractedText: doc.extractedText || undefined,
      docType: doc.classification?.document_type,
    }));

    // Run Pipeline V2
    const pipeline = new Box3PipelineV2((progress) => {
      logger.debug('box3-v2', `Revalidate V2: ${progress.message}`, {
        stage: progress.stage,
        percentage: progress.percentage,
      });
    });

    let pipelineResult;
    try {
      pipelineResult = await pipeline.run(pipelineDocs, dossier.intakeText || null);
    } catch (pipelineError: any) {
      logger.error('box3-v2', 'Revalidate V2 pipeline failed', {
        dossierId: id,
        error: pipelineError.message,
      });
      throw ServerError.ai(`Pipeline V2 hervalidatie mislukt: ${pipelineError.message}`, {
        originalError: pipelineError.message,
      });
    }

    if (!pipelineResult.success) {
      logger.error('box3-v2', 'Revalidate V2 returned failure', {
        dossierId: id,
        errors: pipelineResult.errors,
      });
      throw ServerError.ai(`Pipeline V2 mislukt: ${pipelineResult.errors.join(', ')}`, {});
    }

    const blueprint = pipelineResult.blueprint;
    logger.info('box3-v2', 'Revalidate V2 completed successfully', {
      timing: pipelineResult.timing,
      validation: pipelineResult.validation.is_valid,
    });

    // Get current version and increment
    const currentBlueprint = await storage.getLatestBox3Blueprint(id);
    const newVersion = (currentBlueprint?.version || 0) + 1;

    // Extract tax years from manifest
    const taxYears = pipelineResult.manifest.tax_years || [];
    const hasFiscalPartner = !!pipelineResult.manifest.fiscal_entity?.fiscal_partner;

    // Update dossier
    await storage.updateBox3Dossier(id, {
      taxYears: taxYears.length > 0 ? taxYears : null,
      hasFiscalPartner,
      status: taxYears.length > 0 ? 'in_behandeling' : 'intake',
    });

    // Store new blueprint version
    await storage.createBox3Blueprint({
      dossierId: id,
      version: newVersion,
      blueprint,
      createdBy: 'pipeline-v2-revalidate',
    });

    logger.info('box3-v2', `Blueprint v${newVersion} created (Revalidate V2)`, { dossierId: id });

    // Return result
    res.json(createApiSuccessResponse({
      dossier: {
        id: dossier.id,
        clientName: dossier.clientName,
        taxYears,
        hasFiscalPartner,
        status: dossier.status,
      },
      blueprint,
      blueprintVersion: newVersion,
      manifest: pipelineResult.manifest,
      actualReturns: pipelineResult.actualReturns,
      validation: pipelineResult.validation,
      timing: pipelineResult.timing,
      warnings: pipelineResult.warnings,
      pipelineVersion: 'v2',
    }, `Box 3 hervalidatie succesvol (Pipeline V2, v${newVersion})`));
  })
);
