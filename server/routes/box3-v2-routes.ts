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
import { Box3ExtractionPipeline, type PipelineDocument } from "../services/box3-extraction-pipeline";
import type { Box3Blueprint, Box3DocumentClassification } from "@shared/schema";

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

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'text/plain', 'application/octet-stream', 'image/jpeg', 'image/png'];
    const ext = file.originalname.toLowerCase().split('.').pop();
    const allowedExtensions = ['pdf', 'txt', 'jpg', 'jpeg', 'png'];

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

    console.log(`📋 [Box3V2] Pipeline intake for ${clientName}: ${files.length} files`);

    // Create dossier first
    const dossier = await storage.createBox3Dossier({
      clientName: clientName.trim(),
      clientEmail: clientEmail?.trim() || null,
      intakeText: inputText?.trim() || null,
      status: 'intake',
    });

    console.log(`📋 [Box3V2] Dossier created: ${dossier.id}`);

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

    console.log(`📋 [Box3V2] ${pipelineDocs.length} documents prepared for pipeline`);

    // Run extraction pipeline
    const pipeline = new Box3ExtractionPipeline((progress) => {
      console.log(`📋 [Pipeline] Step ${progress.stepNumber}/${progress.totalSteps}: ${progress.message}`);
    });

    let pipelineResult;
    try {
      pipelineResult = await pipeline.run(pipelineDocs, inputText || null);
    } catch (pipelineError: any) {
      console.error(`📋 [Box3V2] Pipeline failed, cleaning up dossier ${dossier.id}:`, pipelineError.message);
      await storage.deleteBox3Dossier(dossier.id).catch(() => {});
      throw ServerError.ai(`Pipeline extractie mislukt: ${pipelineError.message}`, { originalError: pipelineError.message });
    }

    const blueprint = pipelineResult.blueprint;
    console.log(`📋 [Box3V2] Pipeline completed successfully`);

    // Log any pipeline errors
    if (pipelineResult.errors.length > 0) {
      console.warn(`📋 [Box3V2] Pipeline had ${pipelineResult.errors.length} non-fatal errors:`, pipelineResult.errors);
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

    console.log(`📋 [Box3V2] Blueprint v1 created for dossier ${dossier.id}`);

    // Update document classifications from source_documents_registry
    if (blueprint.source_documents_registry) {
      for (const regEntry of blueprint.source_documents_registry) {
        const matchingDoc = pipelineDocs.find(d =>
          d.filename.toLowerCase() === regEntry.filename.toLowerCase() ||
          d.filename.toLowerCase().includes(regEntry.filename.toLowerCase()) ||
          regEntry.filename.toLowerCase().includes(d.filename.toLowerCase())
        );

        if (matchingDoc) {
          const classification: Box3DocumentClassification = {
            document_type: mapDetectedTypeToClassification(regEntry.detected_type),
            tax_years: regEntry.detected_tax_year ? [String(regEntry.detected_tax_year)] : [],
            for_person: null,
            confidence: regEntry.is_readable ? 'high' : 'low',
          };

          await storage.updateBox3Document(matchingDoc.id, {
            classification,
            extractionSummary: regEntry.notes || null,
          });
        }
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
        model: 'gemini-3-pro-preview',
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
    const dossiers = await storage.getAllBox3Dossiers();

    // Return light version (no file data)
    const dossiersLight = dossiers.map(d => ({
      id: d.id,
      dossierNummer: d.dossierNummer,
      clientName: d.clientName,
      clientEmail: d.clientEmail,
      status: d.status,
      taxYears: d.taxYears,
      hasFiscalPartner: d.hasFiscalPartner,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    res.json(createApiSuccessResponse(dossiersLight));
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
 * Add documents to existing dossier
 * POST /api/box3-v2/dossiers/:id/documents
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

    const dossier = await storage.getBox3Dossier(id);
    if (!dossier) {
      throw ServerError.notFound("Dossier");
    }

    const files = req.files as Express.Multer.File[] || [];
    if (files.length === 0) {
      throw ServerError.validation("No files", "Geen bestanden geselecteerd");
    }

    // Store new documents
    const newDocs: Array<{ id: string; filename: string }> = [];
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
    }

    console.log(`📋 [Box3V2] Added ${newDocs.length} documents to dossier ${id}`);

    // Update dossier status
    await storage.updateBox3Dossier(id, { status: 'in_behandeling' });

    res.json(createApiSuccessResponse({
      addedDocuments: newDocs,
      message: `${newDocs.length} document(en) toegevoegd`,
    }, `${newDocs.length} document(en) toegevoegd`));
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

    console.log(`📋 [Box3V2] Revalidating dossier ${id} with ${documents.length} documents using pipeline`);

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
      console.log(`📋 [Pipeline] Step ${progress.stepNumber}/${progress.totalSteps}: ${progress.message}`);
    });

    const pipelineResult = await pipeline.run(pipelineDocs, dossier.intakeText || null);
    const blueprint = pipelineResult.blueprint;

    console.log(`📋 [Box3V2] Pipeline revalidation completed`);

    // Log any pipeline errors
    if (pipelineResult.errors.length > 0) {
      console.warn(`📋 [Box3V2] Pipeline had ${pipelineResult.errors.length} non-fatal errors:`, pipelineResult.errors);
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

    // Update document classifications from source_documents_registry
    if (blueprint.source_documents_registry) {
      for (let i = 0; i < blueprint.source_documents_registry.length; i++) {
        const regEntry = blueprint.source_documents_registry[i];
        // Match by index since AI generates its own filenames
        const matchingDoc = documents[i];

        if (matchingDoc) {
          const classification: Box3DocumentClassification = {
            document_type: mapDetectedTypeToClassification(regEntry.detected_type),
            tax_years: regEntry.detected_tax_year ? [String(regEntry.detected_tax_year)] : [],
            for_person: null,
            confidence: regEntry.is_readable ? 'high' : 'low',
          };

          await storage.updateBox3Document(matchingDoc.id, {
            classification,
            extractionSummary: regEntry.notes || null,
          });
        }
      }
    }

    console.log(`📋 [Box3V2] Blueprint v${newVersion} created for dossier ${id}`);

    res.json(createApiSuccessResponse({
      blueprint,
      blueprintVersion: newVersion,
      taxYears,
      _debug: {
        pipelineSteps: pipelineResult.stepResults,
        pipelineErrors: pipelineResult.errors,
        model: 'gemini-3-pro-preview',
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

    const blueprints = await storage.getAllBox3Blueprints(id);
    const blueprint = blueprints.find(b => b.version === parseInt(version, 10));

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
