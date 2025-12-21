/**
 * Box 3 Routes
 *
 * Canonical data model for Box 3 bezwaar dossiers.
 * Uses Blueprint JSON format for all AI outputs.
 *
 * Endpoints:
 * - POST /api/box3-validator/validate - Create new dossier with initial validation
 * - POST /api/box3-validator/validate-job - Create new dossier with background job
 * - GET /api/box3-validator/dossiers - List all dossiers
 * - GET /api/box3-validator/dossiers/:id - Get dossier with latest blueprint
 * - PATCH /api/box3-validator/dossiers/:id - Update dossier metadata
 * - DELETE /api/box3-validator/dossiers/:id - Delete dossier
 * - POST /api/box3-validator/dossiers/:id/documents - Add documents
 * - POST /api/box3-validator/dossiers/:id/revalidate - Revalidate with all documents
 * - POST /api/box3-validator/dossiers/:id/revalidate-job - Revalidate with background job
 * - GET /api/box3-validator/dossiers/:id/blueprints - Get blueprint history
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { Box3PipelineV2, type PipelineV2Document } from "../services/box3-pipeline-v2";
import { extractPdfText, hasUsableText } from "../services/pdf-text-extractor";
import type { Box3Blueprint } from "@shared/schema";
import { BOX3_CONSTANTS } from "@shared/constants";
import { AIModelFactory } from "../services/ai-models/ai-model-factory";
import { buildEmailGenerationPrompt, EMAIL_GENERATION_PROMPT } from "../services/box3-prompts-v2";

export const box3V2Router = Router();

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
 * Add documents to existing dossier
 * POST /api/box3-v2/dossiers/:id/documents
 *
 * Stores new documents and triggers a revalidation job to process them.
 * Uses V2 pipeline for all processing (no incremental merge).
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

    logger.info('box3-v2', 'Adding documents to dossier', {
      dossierId: id,
      fileCount: files.length,
    });

    // Store new documents with text extraction
    const newDocs: Array<{ id: string; filename: string }> = [];

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

      // Store document with extraction results
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
    }

    // Update dossier status
    await storage.updateBox3Dossier(id, { status: 'in_behandeling' });

    logger.info('box3-v2', 'Documents added successfully', {
      dossierId: id,
      addedCount: newDocs.length,
    });

    res.json(createApiSuccessResponse({
      addedDocuments: newDocs,
      message: `${newDocs.length} document(en) toegevoegd`,
    }, `${newDocs.length} document(en) toegevoegd`));
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

    logger.info('box3-v2', `Creating dossier with V2 job for ${clientName}`, { fileCount: files.length });

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

    // Create validation job with V2 pipeline type
    const job = await storage.createJob({
      type: 'box3_validation_v2',
      status: 'queued',
      box3DossierId: dossier.id,
      result: {},
    });

    logger.info('box3-v2', 'V2 Validation job created', {
      jobId: job.id,
      dossierId: dossier.id,
      documentCount: files.length,
      pipelineVersion: 'v2'
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
      pipelineVersion: 'v2',
      message: 'Dossier aangemaakt, V2 validatie gestart'
    }));
  })
);

/**
 * Start revalidation job (background processing)
 * POST /api/box3-v2/dossiers/:id/revalidate-job
 *
 * Creates a background job to revalidate the dossier.
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
    const existingBox3Job = activeJobs.find(j =>
      j.type === 'box3_revalidation_v2' || j.type === 'box3_validation_v2'
    );
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
      type: 'box3_revalidation_v2',
      status: 'queued',
      box3DossierId: id,
      result: {},
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
 * Get active job for dossier
 * GET /api/box3-v2/dossiers/:id/job
 *
 * Returns the active validation/revalidation job for this dossier, if any.
 */
box3V2Router.get(
  "/dossiers/:id/job",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Get active jobs for this dossier
    const activeJobs = await storage.getJobsForBox3Dossier(id, ['queued', 'processing']);
    const box3Job = activeJobs.find(j =>
      j.type === 'box3_revalidation_v2' ||
      j.type === 'box3_validation_v2'
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

    res.json(createApiSuccessResponse({
      hasActiveJob: true,
      job: {
        id: box3Job.id,
        type: box3Job.type,
        status: box3Job.status,
        progress,
        createdAt: box3Job.createdAt,
        startedAt: box3Job.startedAt,
      }
    }));
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

    // Use 'inline' for preview in iframe, 'attachment' forces download
    res.set({
      'Content-Type': doc.mimeType,
      'Content-Disposition': `inline; filename="${doc.filename}"`,
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

    // Calculate costs
    const costPerYear = BOX3_CONSTANTS.COST_PER_YEAR;
    const totalCost = years.length * costPerYear;
    // Always use totalIndicativeRefund if available (from blueprint calculation)
    // Only fall back to estimated if indicative is 0 and we have unknown interest
    const displayRefund = totalIndicativeRefund > 0 ? totalIndicativeRefund :
                          (hasUnknownInterest ? totalEstimatedRefund : totalIndicativeRefund);
    const displayRefundRounded = Math.round(displayRefund);
    const netRefund = displayRefundRounded - totalCost;
    const totalTaxPaidRounded = Math.round(totalTaxPaid);

    // Build missing docs list for request_docs type
    let missingDocsList: string | undefined;
    if (determinedType === 'request_docs' && allMissingItems.length > 0) {
      const missingByYear: Record<string, string[]> = {};
      allMissingItems.forEach(item => {
        if (!missingByYear[item.year]) missingByYear[item.year] = [];
        missingByYear[item.year].push(item.description);
      });
      missingDocsList = Object.entries(missingByYear)
        .map(([year, items]) => {
          const bullets = items.map(i => `- ${i}`).join('\n');
          return years.length > 1 ? `**${year}:**\n${bullets}` : bullets;
        })
        .join('\n\n');
    }

    // Get custom prompt from request body (optional - for cog functionality)
    const customPrompt = req.body.customPrompt as string | undefined;

    // Generate email using AI (Gemini 2.5 Flash with thinking)
    const factory = AIModelFactory.getInstance();
    const emailContext = {
      clientName,
      firstName,
      yearRange,
      totalTaxPaid: totalTaxPaidRounded,
      indicativeRefund: displayRefundRounded,
      costPerYear,
      totalCost,
      netRefund,
      missingDocsList,
      numYears: years.length,
    };

    // Use custom prompt if provided, otherwise use default
    const prompt = customPrompt
      ? `${customPrompt}\n\n## HUIDIGE SITUATIE\n\n**Email type:** ${determinedType}\n**Klant:** ${clientName} (voornaam: ${firstName})\n**Belastingjaar(en):** ${yearRange} (${years.length} jaar)\n\n### Financiële gegevens:\n- Totaal betaalde Box 3 belasting: €${totalTaxPaidRounded},-\n- ${determinedType === 'request_docs' ? 'Geschatte' : 'Berekende'} teruggave: €${displayRefundRounded},-\n- Kosten per jaar: €${costPerYear},-\n- Totale kosten: €${totalCost},-\n- Netto voordeel: €${netRefund},-\n\n${missingDocsList ? `### Ontbrekende documenten:\n${missingDocsList}` : ''}\n\nGenereer nu de email voor status "${determinedType}".`
      : buildEmailGenerationPrompt(determinedType as 'profitable' | 'request_docs' | 'not_profitable', emailContext);

    logger.info('box3-v2', 'Generating email with AI', {
      dossierId: id,
      emailType: determinedType,
      usingCustomPrompt: !!customPrompt,
      emailContext: {
        totalTaxPaid: totalTaxPaidRounded,
        indicativeRefund: displayRefundRounded,
        displayRefund,
        totalCost,
        netRefund,
        hasUnknownInterest,
        totalIndicativeRefund,
        totalEstimatedRefund,
      },
      // Debug: show raw year data
      yearData: years.map(year => ({
        year,
        indicativeRefund: blueprint.year_summaries?.[year]?.calculated_totals?.indicative_refund,
        status: blueprint.year_summaries?.[year]?.status,
      })),
    });

    let subject = '';
    let body = '';

    try {
      const aiResult = await factory.callModel(
        {
          provider: 'google',
          model: 'gemini-3-flash-preview',
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 8192,
          thinkingLevel: 'low', // Keep thinking minimal for simple email generation
        } as any, // thinkingLevel is not in base AiConfig type
        prompt
      );

      // Parse JSON response from AI
      const responseText = aiResult.content;
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                        responseText.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);

      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        subject = parsed.subject || `Box 3 ${yearRange}`;
        body = parsed.body || '';

        logger.info('box3-v2', 'AI email generated successfully', {
          dossierId: id,
          subjectLength: subject.length,
          bodyLength: body.length,
        });
      } else {
        throw new Error('Could not parse AI response as JSON');
      }
    } catch (aiError) {
      logger.error('box3-v2', 'AI email generation failed, using fallback', {
        dossierId: id,
        error: aiError instanceof Error ? aiError.message : String(aiError),
      });

      // Fallback to simple template
      subject = `Box 3 ${yearRange} - ${determinedType === 'profitable' ? 'uw teruggave is berekend' : determinedType === 'request_docs' ? 'documenten nodig' : 'onze beoordeling'}`;
      body = `<p>Beste ${firstName},</p><p>Er is een probleem opgetreden bij het genereren van deze email. Neem contact op met ons kantoor.</p><p>Met vriendelijke groet,</p>`;
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

/**
 * Get email generation prompt template
 * GET /api/box3-v2/email-prompt
 *
 * Returns the default prompt for email generation, which can be customized
 * in the frontend via the cog button.
 */
box3V2Router.get(
  "/email-prompt",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(createApiSuccessResponse({
      prompt: EMAIL_GENERATION_PROMPT,
      placeholders: [
        { key: '{client_name}', description: 'Volledige naam van de klant' },
        { key: '{first_name}', description: 'Voornaam van de klant' },
        { key: '{year_range}', description: 'Belastingjaar(en), bijv. "2022" of "2021-2023"' },
        { key: '{total_tax_paid}', description: 'Totaal betaalde Box 3 belasting (afgerond)' },
        { key: '{indicative_refund}', description: 'Berekende/geschatte teruggave (afgerond)' },
        { key: '{cost_per_year}', description: 'Kosten per belastingjaar' },
        { key: '{total_cost}', description: 'Totale kosten (jaren × kosten per jaar)' },
        { key: '{net_refund}', description: 'Netto voordeel (teruggave minus kosten)' },
        { key: '{missing_docs_list}', description: 'HTML lijst met ontbrekende documenten' },
        { key: '{num_years}', description: 'Aantal belastingjaren' },
      ],
      emailTypes: [
        { key: 'profitable', description: 'Kansrijk - berekening compleet, teruggave hoger dan kosten' },
        { key: 'request_docs', description: 'Documenten nodig - er ontbreken jaaropgaven' },
        { key: 'not_profitable', description: 'Niet rendabel - teruggave lager dan kosten' },
      ],
    }, "Email prompt template"));
  })
);

// =============================================================================
// VALIDATION ENDPOINTS
// =============================================================================

/**
 * Create new dossier with intake validation
 * POST /api/box3-validator/validate
 *
 * Uses the 3-stage pipeline:
 * 1. Manifest extraction from aangifte (1 LLM call)
 * 2. Enrichment from source documents (1 LLM call)
 * 3. Validation & calculation (deterministic)
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
 * Revalidate dossier with all documents
 * POST /api/box3-validator/dossiers/:id/revalidate
 *
 * Synchronous revalidation.
 * Returns immediately with result (no background job).
 */
box3V2Router.post(
  "/dossiers/:id/revalidate",
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

// =============================================================================
// FAST INIT + SEPARATE UPLOAD FLOW (for better UX with progress)
// =============================================================================

/**
 * Initialize a new dossier WITHOUT files (fast response)
 * POST /api/box3-v2/init-dossier
 *
 * Creates an empty dossier with status 'uploading'.
 * Client then uploads files separately and can show progress.
 * Returns dossier ID immediately for navigation.
 */
box3V2Router.post(
  "/init-dossier",
  asyncHandler(async (req: Request, res: Response) => {
    const { clientName, clientEmail, inputText } = req.body;

    if (!clientName || clientName.trim().length === 0) {
      throw ServerError.validation("clientName is required", "Klantnaam is verplicht");
    }

    logger.info('box3-v2', `Creating empty dossier for ${clientName}`);

    // Create dossier with 'uploading' status
    const dossier = await storage.createBox3Dossier({
      clientName: clientName.trim(),
      clientEmail: clientEmail?.trim() || null,
      intakeText: inputText?.trim() || null,
      status: 'uploading' as any, // New status for upload-in-progress
    });

    logger.info('box3-v2', 'Empty dossier created', { dossierId: dossier.id });

    res.json(createApiSuccessResponse({
      dossier: {
        id: dossier.id,
        clientName: dossier.clientName,
        status: 'uploading',
        createdAt: dossier.createdAt,
      },
      message: 'Dossier aangemaakt, wacht op documenten'
    }));
  })
);

/**
 * Upload files to an existing dossier and start validation job
 * POST /api/box3-v2/dossiers/:id/upload-and-start
 *
 * Stores documents and starts V2 validation job.
 * Called after init-dossier, allows client to show upload progress.
 */
box3V2Router.post(
  "/dossiers/:id/upload-and-start",
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
    const { id: dossierId } = req.params;

    // Verify dossier exists and is in correct state
    const dossier = await storage.getBox3Dossier(dossierId);
    if (!dossier) {
      throw ServerError.notFound("Dossier niet gevonden");
    }

    // Allow upload if status is 'uploading' or 'intake' (for re-uploads)
    if (dossier.status !== 'uploading' && dossier.status !== 'intake') {
      throw ServerError.validation(
        "Invalid dossier status",
        `Dossier heeft status '${dossier.status}', kan geen nieuwe documenten uploaden`
      );
    }

    const files = req.files as Express.Multer.File[] || [];

    if (files.length === 0) {
      throw ServerError.validation("No files", "Upload minimaal één document");
    }

    logger.info('box3-v2', `Uploading ${files.length} files to dossier`, { dossierId });

    // Store documents with text extraction (same as original intake flow)
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
            logger.info('box3-v2', `✅ Text extracted from ${file.originalname}`, {
              charCount: result.charCount,
              avgCharsPerPage: result.avgCharsPerPage,
            });
          } else if (result.charCount > 0) {
            extractedText = result.text;
            extractionStatus = 'low_yield';
            logger.warn('box3-v2', `⚠️ Low text yield from ${file.originalname}`, {
              charCount: result.charCount,
              avgCharsPerPage: result.avgCharsPerPage,
            });
          } else {
            extractionStatus = 'failed';
            logger.warn('box3-v2', `⚠️ No text from ${file.originalname}`, {
              error: result.error || 'No text content',
            });
          }
        } catch (err: any) {
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

      await storage.createBox3Document({
        dossierId,
        filename: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileData: file.buffer.toString('base64'),
        uploadedVia: 'intake',
        extractedText: extractedText || null,
        extractionStatus,
        extractionCharCount,
      });
    }

    logger.info('box3-v2', 'Documents stored with extraction', { dossierId, count: files.length });

    // Update dossier status to intake
    await storage.updateBox3Dossier(dossierId, { status: 'intake' });

    // Create validation job with V2 pipeline type
    const job = await storage.createJob({
      type: 'box3_validation_v2',
      status: 'queued',
      box3DossierId: dossierId,
      result: {},
    });

    logger.info('box3-v2', 'V2 Validation job created after upload', {
      jobId: job.id,
      dossierId,
      documentCount: files.length,
    });

    res.json(createApiSuccessResponse({
      dossierId,
      jobId: job.id,
      documentCount: files.length,
      status: 'queued',
      pipelineVersion: 'v2',
      message: 'Documenten geüpload, validatie gestart'
    }));
  })
);
