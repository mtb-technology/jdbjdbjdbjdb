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
import { Box3MergeEngine } from "../services/box3-merge-engine";
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
      const doc = await storage.createBox3Document({
        dossierId: dossier.id,
        filename: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileData: file.buffer.toString('base64'),
        uploadedVia: 'intake',
      });

      // Extract text from PDFs for pipeline
      let extractedText: string | undefined;
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
          extractedText = result.text || "";
        } catch {
          // Vision will handle it
        }
      } else if (isTXT) {
        extractedText = file.buffer.toString('utf-8');
      }

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
    }));

    res.json(createApiSuccessResponse({
      dossier: data.dossier,
      blueprint: data.blueprint?.blueprint || null,
      blueprintVersion: data.blueprint?.version || 0,
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
      const doc = await storage.createBox3Document({
        dossierId: id,
        filename: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileData: file.buffer.toString('base64'),
        uploadedVia: 'aanvulling',
      });
      newDocs.push({ id: doc.id, filename: doc.filename });

      // Prepare for extraction
      let extractedText: string | undefined;
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
          extractedText = result.text || "";
        } catch {
          // Vision will handle it
        }
      } else if (isTXT) {
        extractedText = file.buffer.toString('utf-8');
      }

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
 * Revalidate dossier with all documents
 * POST /api/box3-v2/dossiers/:id/revalidate
 */
box3V2Router.post(
  "/dossiers/:id/revalidate",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    // Note: systemPrompt is no longer required - pipeline has built-in prompts

    const dossier = await storage.getBox3Dossier(id);
    if (!dossier) {
      throw ServerError.notFound("Dossier");
    }

    // Get all documents
    const documents = await storage.getBox3DocumentsForDossier(id);
    if (documents.length === 0) {
      throw ServerError.validation("No documents", "Geen documenten om te valideren");
    }

    logger.info('box3-v2', 'Revalidating dossier', { dossierId: id, documentCount: documents.length });

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

    // Run extraction pipeline
    const pipeline = new Box3ExtractionPipeline((progress) => {
      logger.debug('box3-v2', `Pipeline step ${progress.stepNumber}/${progress.totalSteps}`, { message: progress.message });
    });

    const pipelineResult = await pipeline.run(pipelineDocs, dossier.intakeText || null);
    const blueprint = pipelineResult.blueprint;

    logger.info('box3-v2', 'Pipeline revalidation completed');

    // Log any pipeline errors
    if (pipelineResult.errors.length > 0) {
      logger.warn('box3-v2', 'Pipeline had non-fatal errors', { errorCount: pipelineResult.errors.length, errors: pipelineResult.errors });
    }

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

    res.json(createApiSuccessResponse({
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
      }
    }, `Dossier opnieuw gevalideerd (v${newVersion})`));
  })
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
    let hasCompleteData = true;

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

      totalIndicativeRefund += summary?.calculated_totals?.indicative_refund || 0;
      totalDeemedReturn += summary?.calculated_totals?.deemed_return_from_tax_authority || 0;
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
      subject = `Box 3 bezwaar ${yearRange} - aanvullende documenten nodig`;

      // Group missing items by year
      const missingByYear: Record<string, string[]> = {};
      allMissingItems.forEach(item => {
        if (!missingByYear[item.year]) missingByYear[item.year] = [];
        missingByYear[item.year].push(item.description);
      });

      const missingListHtml = Object.entries(missingByYear)
        .map(([year, items]) => `<p><strong>${year}:</strong></p><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`)
        .join('');

      body = `<p>Beste ${firstName},</p>

<p>Bedankt voor uw aanmelding voor het Box 3 bezwaar over ${yearRange}.</p>

<p>Om te kunnen beoordelen of bezwaar maken voor u voordelig is, hebben wij nog de volgende documenten nodig:</p>

${missingListHtml}

<p>Met deze documenten kunnen wij berekenen wat uw werkelijke rendement was en of dit lager ligt dan het forfaitaire rendement dat de Belastingdienst heeft gehanteerd.</p>

<p>U kunt de documenten eenvoudig uploaden via uw persoonlijke dossier of als bijlage bij een reply op deze email sturen.</p>

<p>Heeft u vragen? Neem gerust contact met ons op.</p>

<p>Met vriendelijke groet,</p>`;

    } else if (determinedType === 'not_profitable') {
      subject = `Box 3 bezwaar ${yearRange} - onze beoordeling`;

      const refundText = totalIndicativeRefund > 0
        ? `De indicatieve teruggave bedraagt €${totalIndicativeRefund.toFixed(2)}.`
        : 'Op basis van de gegevens is er geen teruggave te verwachten.';

      body = `<p>Beste ${firstName},</p>

<p>Wij hebben uw Box 3 gegevens over ${yearRange} beoordeeld.</p>

<p><strong>Conclusie:</strong> Bezwaar maken is in uw situatie helaas niet rendabel.</p>

<p>${refundText} De kosten voor het indienen van een bezwaarschrift bedragen €${BOX3_CONSTANTS.MINIMUM_PROFITABLE_AMOUNT},-. Omdat de mogelijke teruggave lager is dan deze kosten, raden wij af om bezwaar te maken.</p>

<p><strong>Waarom geen voordeel?</strong></p>
<p>Het Box 3 bezwaar is gebaseerd op het verschil tussen uw werkelijke rendement en het forfaitaire rendement dat de Belastingdienst hanteert. In uw geval ligt uw werkelijke rendement niet significant lager dan het forfaitaire rendement.</p>

<p>Mocht uw situatie in de toekomst veranderen (bijvoorbeeld door lagere rendementen op spaargeld), dan kunt u altijd opnieuw contact met ons opnemen.</p>

<p>Heeft u vragen over deze beoordeling? Wij lichten het graag toe.</p>

<p>Met vriendelijke groet,</p>`;

    } else { // profitable
      subject = `Box 3 bezwaar ${yearRange} - goed nieuws!`;

      body = `<p>Beste ${firstName},</p>

<p>Goed nieuws! Wij hebben uw Box 3 gegevens over ${yearRange} beoordeeld en bezwaar maken is in uw situatie <strong>wél voordelig</strong>.</p>

<p><strong>Indicatieve teruggave: €${totalIndicativeRefund.toFixed(2)}</strong></p>

<p>Dit bedrag is gebaseerd op het verschil tussen uw werkelijke rendement en het forfaitaire rendement dat de Belastingdienst heeft gehanteerd. De daadwerkelijke teruggave kan afwijken afhankelijk van de definitieve beoordeling door de Belastingdienst.</p>

<p><strong>Hoe nu verder?</strong></p>
<p>Als u wilt dat wij het bezwaarschrift voor u opstellen en indienen, dan kunt u dat via deze link bevestigen. De kosten hiervoor bedragen €${BOX3_CONSTANTS.MINIMUM_PROFITABLE_AMOUNT},-.</p>

<p>Na uw bevestiging stellen wij het bezwaarschrift op en dienen dit namens u in bij de Belastingdienst.</p>

<p>Heeft u vragen? Neem gerust contact met ons op.</p>

<p>Met vriendelijke groet,</p>`;
    }

    logger.info('box3-v2', 'Generated follow-up email', {
      dossierId: id,
      emailType: determinedType,
      indicativeRefund: totalIndicativeRefund,
      missingItemsCount: allMissingItems.length,
    });

    res.json(createApiSuccessResponse({
      emailType: determinedType,
      subject,
      body,
      metadata: {
        clientName,
        yearRange,
        totalIndicativeRefund,
        totalDeemedReturn,
        missingItemsCount: allMissingItems.length,
        hasCompleteData,
        minimumProfitableAmount: BOX3_CONSTANTS.MINIMUM_PROFITABLE_AMOUNT,
      }
    }, "Email gegenereerd"));
  })
);
