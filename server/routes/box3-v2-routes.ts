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
import { AIModelFactory } from "../services/ai-models/ai-model-factory";
import { AIConfigResolver } from "../services/ai-config-resolver";
import { box3BlueprintPartialSchema, createEmptyBox3Blueprint } from "@shared/schema";
import type { PromptConfig, Box3Blueprint, Box3DocumentClassification } from "@shared/schema";

const configResolver = new AIConfigResolver();

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
 * Process files for AI analysis
 * Returns extracted text and vision attachments
 */
async function processFilesForAI(files: Array<{ filename: string; mimeType: string; fileData: string }>) {
  const attachmentTexts: string[] = [];
  const visionAttachments: { mimeType: string; data: string; filename: string }[] = [];

  for (const file of files) {
    const ext = file.filename.toLowerCase().split('.').pop();
    const isPDF = file.mimeType === 'application/pdf' ||
                  (file.mimeType === 'application/octet-stream' && ext === 'pdf');
    const isTXT = file.mimeType === 'text/plain' ||
                  (file.mimeType === 'application/octet-stream' && ext === 'txt');
    const isImage = file.mimeType === 'image/jpeg' || file.mimeType === 'image/png' ||
                    (file.mimeType === 'application/octet-stream' && ['jpg', 'jpeg', 'png'].includes(ext || ''));

    let extractedText = "";
    let needsVision = false;

    if (isImage) {
      const mimeType = file.mimeType.startsWith('image/') ? file.mimeType :
                       (ext === 'png' ? 'image/png' : 'image/jpeg');
      visionAttachments.push({
        mimeType,
        data: file.fileData,
        filename: file.filename
      });
      console.log(`📋 [Box3V2] Image added to vision: ${file.filename}`);
    } else if (isPDF) {
      try {
        const PDFParseClass = await getPdfParse();
        const buffer = Buffer.from(file.fileData, 'base64');
        const parser = new PDFParseClass({ data: buffer });
        const result = await parser.getText();
        const pages = Array.isArray(result.pages) ? result.pages.length :
                     (typeof result.pages === 'object' ? Object.keys(result.pages).length : 1);
        extractedText = result.text || "";

        // Detect scanned PDFs
        const charsPerPage = extractedText.length / Math.max(pages, 1);
        if (charsPerPage < 100 && pages > 0) {
          needsVision = true;
          console.log(`📋 [Box3V2] Scanned PDF detected: ${file.filename}`);
        }
      } catch (err: any) {
        console.warn(`📋 [Box3V2] PDF parse failed: ${file.filename}`, err.message);
        needsVision = true;
      }

      if (needsVision || extractedText.length < 100) {
        visionAttachments.push({
          mimeType: 'application/pdf',
          data: file.fileData,
          filename: file.filename
        });
        console.log(`📋 [Box3V2] Added to vision: ${file.filename}`);
      }
    } else if (isTXT) {
      const buffer = Buffer.from(file.fileData, 'base64');
      extractedText = buffer.toString('utf-8');
    }

    if (extractedText.trim().length > 0) {
      attachmentTexts.push(`\n=== DOCUMENT: ${file.filename} ===\n${extractedText}`);
    }
  }

  return { attachmentTexts, visionAttachments };
}

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
    const { inputText, clientName, clientEmail, systemPrompt } = req.body;

    if (!clientName || clientName.trim().length === 0) {
      throw ServerError.validation("clientName is required", "Klantnaam is verplicht");
    }

    if (!systemPrompt || systemPrompt.trim().length === 0) {
      throw ServerError.validation("systemPrompt is required", "Configureer eerst een intake prompt in de instellingen");
    }

    const files = req.files as Express.Multer.File[] || [];

    console.log(`📋 [Box3V2] Intake for ${clientName}: ${files.length} files`);

    // Create dossier first
    const dossier = await storage.createBox3Dossier({
      clientName: clientName.trim(),
      clientEmail: clientEmail?.trim() || null,
      intakeText: inputText?.trim() || null,
      status: 'intake',
    });

    console.log(`📋 [Box3V2] Dossier created: ${dossier.id}`);

    // Store documents
    const storedDocs: Array<{ id: string; filename: string; mimeType: string; fileData: string }> = [];

    for (const file of files) {
      const doc = await storage.createBox3Document({
        dossierId: dossier.id,
        filename: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileData: file.buffer.toString('base64'),
        uploadedVia: 'intake',
      });
      storedDocs.push({
        id: doc.id,
        filename: doc.filename,
        mimeType: doc.mimeType,
        fileData: doc.fileData,
      });
    }

    console.log(`📋 [Box3V2] ${storedDocs.length} documents stored`);

    // Process files for AI
    const { attachmentTexts, visionAttachments } = await processFilesForAI(storedDocs);

    // Build user prompt
    const userPrompt = `## Mail van klant:
${inputText || "(geen mail tekst)"}

## Bijlages (${storedDocs.length} documenten):
${attachmentTexts.length > 0 ? attachmentTexts.join('\n\n') : 'Geen tekst-extractie beschikbaar - documenten worden via vision geanalyseerd.'}

Analyseer alle bovenstaande input en geef je validatie als JSON.`;

    console.log(`📋 [Box3V2] Calling AI with ${visionAttachments.length} vision attachments`);

    // Generate consistent jobId for this request
    const jobId = `box3-v2-intake-${dossier.id.substring(0, 8)}-${Date.now()}`;

    // Get AI config
    const activeConfig = await storage.getActivePromptConfig();
    if (!activeConfig?.config) {
      // Cleanup: delete dossier if config is missing
      await storage.deleteBox3Dossier(dossier.id).catch(() => {});
      throw ServerError.validation(
        "No active prompt config",
        "Geen actieve AI configuratie gevonden. Configureer dit in Instellingen."
      );
    }
    const promptConfig = activeConfig.config as PromptConfig;

    let baseAiConfig;
    try {
      baseAiConfig = configResolver.resolveForOperation(
        'box3_validator',
        promptConfig,
        jobId
      );
    } catch (configError: any) {
      // Cleanup on config resolution failure
      await storage.deleteBox3Dossier(dossier.id).catch(() => {});
      throw ServerError.validation(
        "Config resolution failed",
        `AI configuratie kon niet worden geladen: ${configError.message}`
      );
    }

    const aiConfig = {
      ...baseAiConfig,
      maxOutputTokens: Math.max(baseAiConfig.maxOutputTokens || 8192, 16384),
      thinkingLevel: 'high' as const,
    };

    // Call AI with cleanup on failure
    const factory = AIModelFactory.getInstance();
    let result;
    try {
      result = await factory.callModel(
        aiConfig,
        `${systemPrompt}\n\n${userPrompt}`,
        {
          jobId,
          visionAttachments: visionAttachments.length > 0 ? visionAttachments : undefined
        }
      );
    } catch (aiError: any) {
      console.error(`📋 [Box3V2] AI call failed, cleaning up dossier ${dossier.id}:`, aiError.message);
      // Cleanup: delete dossier and documents on AI failure
      await storage.deleteBox3Dossier(dossier.id).catch(() => {});
      throw ServerError.ai(`AI analyse mislukt: ${aiError.message}`, { originalError: aiError.message });
    }

    console.log(`📋 [Box3V2] AI response received: ${result.content.length} chars`);

    // Parse JSON from response
    let blueprint: Box3Blueprint;
    try {
      let jsonText = result.content.match(/```json\s*([\s\S]*?)\s*```/)?.[1];
      if (!jsonText) {
        jsonText = result.content.match(/\{[\s\S]*\}/)?.[0];
      }
      if (!jsonText && result.content.trim().startsWith('{')) {
        jsonText = result.content.trim();
      }

      if (!jsonText) {
        throw new Error('No JSON found in AI response');
      }

      const parsed = JSON.parse(jsonText);

      // Validate with partial schema (lenient)
      blueprint = box3BlueprintPartialSchema.parse(parsed) as Box3Blueprint;
      console.log(`📋 [Box3V2] Blueprint parsed successfully`);
    } catch (parseError: any) {
      console.error(`📋 [Box3V2] JSON parse error:`, parseError.message);
      console.error(`📋 [Box3V2] Raw response:`, result.content.substring(0, 500));

      // Create empty blueprint on parse failure
      blueprint = createEmptyBox3Blueprint();
      blueprint.validation_flags = [{
        id: 'parse_error',
        field_path: 'root',
        type: 'requires_validation',
        message: `AI response kon niet geparsed worden: ${parseError.message}`,
        severity: 'high',
        created_at: new Date().toISOString(),
      }];
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
    const blueprintRecord = await storage.createBox3Blueprint({
      dossierId: dossier.id,
      version: 1,
      blueprint,
      createdBy: 'intake',
    });

    console.log(`📋 [Box3V2] Blueprint v1 created for dossier ${dossier.id}`);

    // Update document classifications from source_documents_registry
    if (blueprint.source_documents_registry) {
      for (const regEntry of blueprint.source_documents_registry) {
        const matchingDoc = storedDocs.find(d =>
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

    // Include debug info
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    res.json(createApiSuccessResponse({
      dossier: updatedDossier,
      blueprint,
      blueprintVersion: 1,
      taxYears,
      documents: documentsLight,
      _debug: {
        fullPrompt,
        rawAiResponse: result.content,
        modelUsed: aiConfig.model,
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
    const { systemPrompt } = req.body;

    if (!systemPrompt || systemPrompt.trim().length === 0) {
      throw ServerError.validation("systemPrompt is required", "Configureer eerst een intake prompt in de instellingen");
    }

    const dossier = await storage.getBox3Dossier(id);
    if (!dossier) {
      throw ServerError.notFound("Dossier");
    }

    // Get all documents
    const documents = await storage.getBox3DocumentsForDossier(id);
    if (documents.length === 0) {
      throw ServerError.validation("No documents", "Geen documenten om te valideren");
    }

    console.log(`📋 [Box3V2] Revalidating dossier ${id} with ${documents.length} documents`);

    // Process files for AI
    const filesForAI = documents.map(d => ({
      filename: d.filename,
      mimeType: d.mimeType,
      fileData: d.fileData,
    }));
    const { attachmentTexts, visionAttachments } = await processFilesForAI(filesForAI);

    // Build user prompt
    const userPrompt = `## Mail van klant:
${dossier.intakeText || "(geen mail tekst)"}

## Bijlages (${documents.length} documenten):
${attachmentTexts.length > 0 ? attachmentTexts.join('\n\n') : 'Geen tekst-extractie beschikbaar - documenten worden via vision geanalyseerd.'}

Analyseer alle bovenstaande input en geef je validatie als JSON.`;

    // Get AI config
    const activeConfig = await storage.getActivePromptConfig();
    if (!activeConfig?.config) {
      throw ServerError.validation(
        "No active prompt config",
        "Geen actieve AI configuratie gevonden. Configureer dit in Instellingen."
      );
    }
    const promptConfig = activeConfig.config as PromptConfig;

    const baseAiConfig = configResolver.resolveForOperation(
      'box3_validator',
      promptConfig,
      `box3-v2-revalidate-${Date.now()}`
    );

    const aiConfig = {
      ...baseAiConfig,
      maxOutputTokens: Math.max(baseAiConfig.maxOutputTokens || 8192, 16384),
      thinkingLevel: 'high' as const,
    };

    // Call AI
    const factory = AIModelFactory.getInstance();
    const result = await factory.callModel(
      aiConfig,
      `${systemPrompt}\n\n${userPrompt}`,
      {
        jobId: `box3-v2-revalidate-${Date.now()}`,
        visionAttachments: visionAttachments.length > 0 ? visionAttachments : undefined
      }
    );

    console.log(`📋 [Box3V2] Revalidation AI response: ${result.content.length} chars`);

    // Parse JSON
    let blueprint: Box3Blueprint;
    try {
      let jsonText = result.content.match(/```json\s*([\s\S]*?)\s*```/)?.[1];
      if (!jsonText) jsonText = result.content.match(/\{[\s\S]*\}/)?.[0];
      if (!jsonText && result.content.trim().startsWith('{')) jsonText = result.content.trim();
      if (!jsonText) throw new Error('No JSON found');

      blueprint = box3BlueprintPartialSchema.parse(JSON.parse(jsonText)) as Box3Blueprint;
    } catch (parseError: any) {
      console.error(`📋 [Box3V2] Parse error:`, parseError.message);
      throw ServerError.ai('Kon AI response niet parsen', { error: parseError.message });
    }

    // Get current version and increment
    const currentBlueprint = await storage.getLatestBox3Blueprint(id);
    const newVersion = (currentBlueprint?.version || 0) + 1;

    // Store new blueprint
    await storage.createBox3Blueprint({
      dossierId: id,
      version: newVersion,
      blueprint,
      createdBy: 'hervalidatie',
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

    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    res.json(createApiSuccessResponse({
      blueprint,
      blueprintVersion: newVersion,
      taxYears,
      _debug: {
        fullPrompt,
        rawAiResponse: result.content,
        modelUsed: aiConfig.model,
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
