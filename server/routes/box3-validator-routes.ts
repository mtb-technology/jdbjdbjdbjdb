import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { storage } from "../storage";
import { AIModelFactory } from "../services/ai-models/ai-model-factory";
import { AIConfigResolver } from "../services/ai-config-resolver";
import { box3ValidationResultSchema, insertBox3ValidatorSessionSchema } from "@shared/schema";
import type { PromptConfig, Box3MultiYearData, Box3YearEntry, Box3ManualOverrides } from "@shared/schema";

// Shared config resolver
const configResolver = new AIConfigResolver();

export const box3ValidatorRouter = Router();

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

// NOTE: Box 3 intake prompt is now REQUIRED from frontend/settings
// No hardcoded fallback prompt - user must configure their own prompt

/**
 * Validate Box 3 documents
 * POST /api/box3-validator/validate
 */
box3ValidatorRouter.post(
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
    const { inputText, clientName, systemPrompt } = req.body;

    if (!inputText || inputText.trim().length === 0) {
      throw ServerError.validation("inputText is required", "Mail tekst is verplicht");
    }

    if (!clientName || clientName.trim().length === 0) {
      throw ServerError.validation("clientName is required", "Klantnaam is verplicht");
    }

    const files = req.files as Express.Multer.File[] || [];
    const attachmentNames: string[] = [];
    const attachmentTexts: string[] = [];
    const visionAttachments: { mimeType: string; data: string; filename: string }[] = [];
    const storedAttachments: { filename: string; mimeType: string; fileSize: number; fileData: string }[] = [];

    console.log(`📋 [Box3Validator] Validating for ${clientName}: ${files.length} files`);

    // Process uploaded files
    for (const file of files) {
      attachmentNames.push(file.originalname);

      // Store file data for later re-validation
      storedAttachments.push({
        filename: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileData: file.buffer.toString('base64')
      });

      const ext = file.originalname.toLowerCase().split('.').pop();
      const isPDF = file.mimetype === 'application/pdf' ||
                    (file.mimetype === 'application/octet-stream' && ext === 'pdf');
      const isTXT = file.mimetype === 'text/plain' ||
                    (file.mimetype === 'application/octet-stream' && ext === 'txt');
      const isImage = file.mimetype === 'image/jpeg' || file.mimetype === 'image/png' ||
                      (file.mimetype === 'application/octet-stream' && ['jpg', 'jpeg', 'png'].includes(ext || ''));

      let extractedText = "";
      let needsVision = false;

      // Images always go to vision
      if (isImage) {
        const mimeType = file.mimetype.startsWith('image/') ? file.mimetype :
                         (ext === 'png' ? 'image/png' : 'image/jpeg');
        visionAttachments.push({
          mimeType,
          data: file.buffer.toString('base64'),
          filename: file.originalname
        });
        console.log(`📋 [Box3Validator] Image added to vision: ${file.originalname}`);
      } else if (isPDF) {
        try {
          const PDFParseClass = await getPdfParse();
          const parser = new PDFParseClass({ data: file.buffer });
          const result = await parser.getText();
          const pages = Array.isArray(result.pages) ? result.pages.length :
                       (typeof result.pages === 'object' ? Object.keys(result.pages).length : 1);
          extractedText = result.text || "";

          // Detect scanned PDFs
          const charsPerPage = extractedText.length / Math.max(pages, 1);
          if (charsPerPage < 100 && pages > 0) {
            needsVision = true;
            console.log(`📋 [Box3Validator] Scanned PDF detected: ${file.originalname}`);
          }
        } catch (err: any) {
          console.warn(`📋 [Box3Validator] PDF parse failed: ${file.originalname}`, err.message);
          needsVision = true;
        }

        // If scanned or parse failed, use Vision
        if (needsVision || extractedText.length < 100) {
          visionAttachments.push({
            mimeType: 'application/pdf',
            data: file.buffer.toString('base64'),
            filename: file.originalname
          });
          console.log(`📋 [Box3Validator] Added to vision: ${file.originalname}`);
        }
      } else if (isTXT) {
        extractedText = file.buffer.toString('utf-8');
      }

      if (extractedText.trim().length > 0) {
        attachmentTexts.push(`\n=== DOCUMENT: ${file.originalname} ===\n${extractedText}`);
      }
    }

    // Build the user prompt
    const userPrompt = `## Mail van klant:
${inputText}

## Bijlages (${attachmentNames.length} documenten):
${attachmentTexts.length > 0 ? attachmentTexts.join('\n\n') : 'Geen tekst-extractie beschikbaar - documenten worden via vision geanalyseerd.'}

Analyseer alle bovenstaande input en geef je validatie als JSON.`;

    console.log(`📋 [Box3Validator] Calling AI with ${visionAttachments.length} vision attachments`);

    // Get AI config via AIConfigResolver
    // Box3 validator needs higher maxOutputTokens for bijlage_analyse with many files
    const activeConfig = await storage.getActivePromptConfig();
    const promptConfig = activeConfig?.config as PromptConfig;

    const baseAiConfig = configResolver.resolveForOperation(
      'box3_validator',
      promptConfig,
      `box3-validator-${Date.now()}`
    );

    // Ensure sufficient output tokens for detailed bijlage_analyse
    // Intake analysis requires high thinking for accurate document categorization
    const aiConfig = {
      ...baseAiConfig,
      maxOutputTokens: Math.max(baseAiConfig.maxOutputTokens || 8192, 16384),
      thinkingLevel: 'high' as const, // Intake requires thorough analysis
    };

    // Call AI with config from database
    // systemPrompt is REQUIRED - no fallback
    if (!systemPrompt || systemPrompt.trim().length === 0) {
      throw ServerError.validation("systemPrompt is required", "Configureer eerst een intake prompt in de instellingen");
    }

    const factory = AIModelFactory.getInstance();
    const result = await factory.callModel(
      aiConfig,
      `${systemPrompt}\n\n${userPrompt}`,
      {
        jobId: `box3-validator-${Date.now()}`,
        visionAttachments: visionAttachments.length > 0 ? visionAttachments : undefined
      }
    );

    console.log(`📋 [Box3Validator] AI response received: ${result.content.length} chars`);

    // Parse JSON from response
    let validationResult;
    try {
      // Try to extract JSON from response
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

      // Validate with Zod schema
      validationResult = box3ValidationResultSchema.parse(parsed);
      console.log(`📋 [Box3Validator] Validation result parsed successfully`);
    } catch (parseError: any) {
      console.error(`📋 [Box3Validator] JSON parse error:`, parseError.message);
      console.error(`📋 [Box3Validator] Raw response:`, result.content.substring(0, 500));
      throw ServerError.ai(
        'Kon AI response niet parsen. Probeer opnieuw.',
        { error: parseError.message }
      );
    }

    // Detect unique years from bijlage_analyse
    const yearsFromDocs = new Set<string>();
    if (validationResult.bijlage_analyse && Array.isArray(validationResult.bijlage_analyse)) {
      for (const analyse of validationResult.bijlage_analyse) {
        if (analyse.belastingjaar) {
          yearsFromDocs.add(String(analyse.belastingjaar));
        }
      }
    }
    // Also add the main detected year if not already included
    if (validationResult.belastingjaar) {
      yearsFromDocs.add(String(validationResult.belastingjaar));
    }

    const uniqueYears = Array.from(yearsFromDocs).sort();
    const isMultiYear = uniqueYears.length > 1;

    console.log(`📋 [Box3Validator] Detected years: ${uniqueYears.join(', ')} (multi-year: ${isMultiYear})`);

    let session;

    if (isMultiYear) {
      // Group attachments by year based on bijlage_analyse
      const attachmentsByYear: Record<string, typeof storedAttachments> = {};
      for (const year of uniqueYears) {
        attachmentsByYear[year] = [];
      }

      // Match each attachment to its year - try filename match first, then index-based
      for (let i = 0; i < storedAttachments.length; i++) {
        const attachment = storedAttachments[i];
        let matchedYear: string | null = null;

        // Find matching analyse entry by filename
        if (validationResult.bijlage_analyse) {
          const analyse = validationResult.bijlage_analyse.find(a =>
            a.bestandsnaam.toLowerCase() === attachment.filename.toLowerCase() ||
            a.bestandsnaam.toLowerCase().includes(attachment.filename.toLowerCase()) ||
            attachment.filename.toLowerCase().includes(a.bestandsnaam.toLowerCase())
          );
          if (analyse?.belastingjaar) {
            matchedYear = String(analyse.belastingjaar);
          }

          // If no filename match, try index-based (AI often names files image_1, image_2 etc)
          if (!matchedYear && validationResult.bijlage_analyse[i]?.belastingjaar) {
            matchedYear = String(validationResult.bijlage_analyse[i].belastingjaar);
          }
        }

        // Fallback to main belastingjaar if no match found
        if (!matchedYear && validationResult.belastingjaar) {
          matchedYear = String(validationResult.belastingjaar);
        }

        // Add to appropriate year bucket (or first year if no match)
        if (matchedYear && attachmentsByYear[matchedYear]) {
          attachmentsByYear[matchedYear].push(attachment);
        } else if (uniqueYears.length > 0) {
          attachmentsByYear[uniqueYears[0]].push(attachment);
        }
      }

      // Create multi-year data structure
      const multiYearData: Box3MultiYearData = {
        years: {}
      };

      for (const year of uniqueYears) {
        multiYearData.years[year] = {
          jaar: year,
          attachments: attachmentsByYear[year] || [],
          // For now, only the first/main year gets the validation result
          // Each year will need separate validation when docs are added
          validationResult: year === validationResult.belastingjaar ? validationResult : undefined,
          isComplete: false,
          updatedAt: new Date().toISOString(),
        };
      }

      // Create multi-year session
      session = await storage.createBox3ValidatorSession({
        clientName: clientName.trim(),
        belastingjaar: validationResult.belastingjaar || uniqueYears[0] || null,
        inputText: inputText.trim(),
        attachmentNames: attachmentNames as string[],
        attachments: storedAttachments, // Keep legacy field populated for backwards compat
        validationResult, // Keep legacy field for backwards compat
        conceptMail: validationResult.concept_mail,
        isMultiYear: true,
        multiYearData,
      });

      console.log(`📋 [Box3Validator] Multi-year session created: ${session.id} with years: ${uniqueYears.join(', ')}`);
    } else {
      // Single year - create legacy session
      session = await storage.createBox3ValidatorSession({
        clientName: clientName.trim(),
        belastingjaar: validationResult.belastingjaar || null,
        inputText: inputText.trim(),
        attachmentNames: attachmentNames as string[],
        attachments: storedAttachments,
        validationResult,
        conceptMail: validationResult.concept_mail,
        isMultiYear: false,
      });

      console.log(`📋 [Box3Validator] Single-year session created: ${session.id}`);
    }

    res.json(createApiSuccessResponse({
      session,
      validationResult
    }, "Documenten succesvol gevalideerd"));
  })
);

/**
 * Get all sessions
 * GET /api/box3-validator/sessions
 */
box3ValidatorRouter.get(
  "/sessions",
  asyncHandler(async (req: Request, res: Response) => {
    const sessions = await storage.getAllBox3ValidatorSessions();

    // Return without full validation result to reduce response size
    const sessionsLight = sessions.map(s => ({
      id: s.id,
      clientName: s.clientName,
      belastingjaar: s.belastingjaar,
      attachmentCount: (s.attachmentNames as string[] || []).length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    }));

    res.json(createApiSuccessResponse(sessionsLight));
  })
);

/**
 * Get single session
 * GET /api/box3-validator/sessions/:id
 */
box3ValidatorRouter.get(
  "/sessions/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      throw ServerError.notFound("Sessie");
    }

    res.json(createApiSuccessResponse(session));
  })
);

/**
 * Create new session (manual save)
 * POST /api/box3-validator/sessions
 */
box3ValidatorRouter.post(
  "/sessions",
  asyncHandler(async (req: Request, res: Response) => {
    const validated = insertBox3ValidatorSessionSchema.parse(req.body);
    const session = await storage.createBox3ValidatorSession({
      ...validated,
      attachmentNames: validated.attachmentNames as string[] | null | undefined
    });
    res.json(createApiSuccessResponse(session, "Sessie opgeslagen"));
  })
);

/**
 * Update session (e.g., after editing concept mail)
 * PATCH /api/box3-validator/sessions/:id
 */
box3ValidatorRouter.patch(
  "/sessions/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { conceptMail } = req.body;

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      throw ServerError.notFound("Sessie");
    }

    const updated = await storage.updateBox3ValidatorSession(id, { conceptMail });
    res.json(createApiSuccessResponse(updated, "Sessie bijgewerkt"));
  })
);

/**
 * Update manual overrides for a session
 * PATCH /api/box3-validator/sessions/:id/overrides
 */
box3ValidatorRouter.patch(
  "/sessions/:id/overrides",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { overrides } = req.body;

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      throw ServerError.notFound("Sessie");
    }

    // Merge existing overrides with new ones
    const existingOverrides = (session.manualOverrides || {}) as Record<string, unknown>;
    const mergedOverrides = { ...existingOverrides, ...overrides };

    const updated = await storage.updateBox3ValidatorSession(id, {
      manualOverrides: mergedOverrides
    });

    console.log(`📋 [Box3Validator] Updated overrides for session ${id}`);
    res.json(createApiSuccessResponse(updated, "Overrides bijgewerkt"));
  })
);

/**
 * Update dossier status and notes
 * PATCH /api/box3-validator/sessions/:id/status
 */
box3ValidatorRouter.patch(
  "/sessions/:id/status",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { dossierStatus, notes } = req.body;

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      throw ServerError.notFound("Sessie");
    }

    const updateData: Record<string, unknown> = {};
    if (dossierStatus !== undefined) updateData.dossierStatus = dossierStatus;
    if (notes !== undefined) updateData.notes = notes;

    const updated = await storage.updateBox3ValidatorSession(id, updateData);

    console.log(`📋 [Box3Validator] Updated status for session ${id}: ${dossierStatus}`);
    res.json(createApiSuccessResponse(updated, "Status bijgewerkt"));
  })
);

/**
 * Add documents to existing session and re-validate
 * POST /api/box3-validator/sessions/:id/add-documents
 */
box3ValidatorRouter.post(
  "/sessions/:id/add-documents",
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
    const { additionalText, systemPrompt } = req.body;

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      throw ServerError.notFound("Sessie");
    }

    const newFiles = req.files as Express.Multer.File[] || [];
    if (newFiles.length === 0 && !additionalText) {
      throw ServerError.validation("No new data", "Geen nieuwe documenten of tekst toegevoegd");
    }

    // Get existing attachments
    const existingAttachments = (session.attachments || []) as { filename: string; mimeType: string; fileSize: number; fileData: string }[];
    const existingNames = (session.attachmentNames || []) as string[];

    // Process new files and add to existing
    const newAttachments: { filename: string; mimeType: string; fileSize: number; fileData: string }[] = [];
    const newNames: string[] = [];

    for (const file of newFiles) {
      newAttachments.push({
        filename: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileData: file.buffer.toString('base64')
      });
      newNames.push(file.originalname);
    }

    // Combine all attachments
    const allAttachments = [...existingAttachments, ...newAttachments];
    const allNames = [...existingNames, ...newNames];

    // Combine input text if additional text provided
    const combinedInputText = additionalText
      ? `${session.inputText}\n\n--- Aanvullende informatie ---\n${additionalText}`
      : session.inputText;

    console.log(`📋 [Box3Validator] Adding ${newFiles.length} documents to session ${id}. Total: ${allAttachments.length}`);

    // Now re-validate with all documents
    const attachmentTexts: string[] = [];
    const visionAttachments: { mimeType: string; data: string; filename: string }[] = [];

    for (const attachment of allAttachments) {
      const ext = attachment.filename.toLowerCase().split('.').pop();
      const isPDF = attachment.mimeType === 'application/pdf' ||
                    (attachment.mimeType === 'application/octet-stream' && ext === 'pdf');
      const isTXT = attachment.mimeType === 'text/plain' ||
                    (attachment.mimeType === 'application/octet-stream' && ext === 'txt');
      const isImage = attachment.mimeType === 'image/jpeg' || attachment.mimeType === 'image/png' ||
                      (attachment.mimeType === 'application/octet-stream' && ['jpg', 'jpeg', 'png'].includes(ext || ''));

      let extractedText = "";
      let needsVision = false;

      if (isImage) {
        const mimeType = attachment.mimeType.startsWith('image/') ? attachment.mimeType :
                         (ext === 'png' ? 'image/png' : 'image/jpeg');
        visionAttachments.push({
          mimeType,
          data: attachment.fileData,
          filename: attachment.filename
        });
      } else if (isPDF) {
        try {
          const PDFParseClass = await getPdfParse();
          const buffer = Buffer.from(attachment.fileData, 'base64');
          const parser = new PDFParseClass({ data: buffer });
          const result = await parser.getText();
          const pages = Array.isArray(result.pages) ? result.pages.length :
                       (typeof result.pages === 'object' ? Object.keys(result.pages).length : 1);
          extractedText = result.text || "";

          const charsPerPage = extractedText.length / Math.max(pages, 1);
          if (charsPerPage < 100 && pages > 0) {
            needsVision = true;
          }
        } catch (err: any) {
          needsVision = true;
        }

        if (needsVision || extractedText.length < 100) {
          visionAttachments.push({
            mimeType: 'application/pdf',
            data: attachment.fileData,
            filename: attachment.filename
          });
        }
      } else if (isTXT) {
        const buffer = Buffer.from(attachment.fileData, 'base64');
        extractedText = buffer.toString('utf-8');
      }

      if (extractedText.trim().length > 0) {
        attachmentTexts.push(`\n=== DOCUMENT: ${attachment.filename} ===\n${extractedText}`);
      }
    }

    // Build prompt and call AI
    const userPrompt = `## Mail van klant:
${combinedInputText}

## Bijlages (${allNames.length} documenten):
${attachmentTexts.length > 0 ? attachmentTexts.join('\n\n') : 'Geen tekst-extractie beschikbaar - documenten worden via vision geanalyseerd.'}

Analyseer alle bovenstaande input en geef je validatie als JSON.`;

    const activeConfig = await storage.getActivePromptConfig();
    const promptConfig = activeConfig?.config as PromptConfig;

    const baseAiConfig = configResolver.resolveForOperation(
      'box3_validator',
      promptConfig,
      `box3-add-docs-${Date.now()}`
    );

    // Ensure sufficient output tokens for detailed bijlage_analyse
    // Adding docs requires high thinking for accurate document analysis
    const aiConfig = {
      ...baseAiConfig,
      maxOutputTokens: Math.max(baseAiConfig.maxOutputTokens || 8192, 16384),
      thinkingLevel: 'high' as const, // Document analysis requires thorough thinking
    };

    // systemPrompt is REQUIRED - no fallback
    if (!systemPrompt || systemPrompt.trim().length === 0) {
      throw ServerError.validation("systemPrompt is required", "Configureer eerst een intake prompt in de instellingen");
    }

    const factory = AIModelFactory.getInstance();
    const result = await factory.callModel(
      aiConfig,
      `${systemPrompt}\n\n${userPrompt}`,
      {
        jobId: `box3-add-docs-${Date.now()}`,
        visionAttachments: visionAttachments.length > 0 ? visionAttachments : undefined
      }
    );

    // Parse JSON response
    let validationResult;
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
      validationResult = box3ValidationResultSchema.parse(parsed);
    } catch (parseError: any) {
      throw ServerError.ai(
        'Kon AI response niet parsen. Probeer opnieuw.',
        { error: parseError.message }
      );
    }

    // Update session with combined data
    const updatedSession = await storage.updateBox3ValidatorSession(id, {
      inputText: combinedInputText,
      attachmentNames: allNames,
      attachments: allAttachments,
      belastingjaar: validationResult.belastingjaar || session.belastingjaar,
      validationResult,
      conceptMail: validationResult.concept_mail || validationResult.draft_mail
    });

    console.log(`📋 [Box3Validator] Session ${id} updated with ${newFiles.length} new documents`);

    res.json(createApiSuccessResponse({
      session: updatedSession,
      validationResult,
      addedDocuments: newNames
    }, `${newFiles.length} document(en) toegevoegd en opnieuw gevalideerd`));
  })
);

/**
 * Delete session
 * DELETE /api/box3-validator/sessions/:id
 */
box3ValidatorRouter.delete(
  "/sessions/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      throw ServerError.notFound("Sessie");
    }

    await storage.deleteBox3ValidatorSession(id);
    res.json(createApiSuccessResponse({ deleted: true }, "Sessie verwijderd"));
  })
);

/**
 * Re-validate session with stored attachments
 * POST /api/box3-validator/sessions/:id/revalidate
 */
box3ValidatorRouter.post(
  "/sessions/:id/revalidate",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { systemPrompt } = req.body;

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      throw ServerError.notFound("Sessie");
    }

    const storedAttachments = (session.attachments || []) as { filename: string; mimeType: string; fileSize: number; fileData: string }[];
    if (storedAttachments.length === 0 && !session.inputText) {
      throw ServerError.validation("No data", "Geen opgeslagen bijlages of tekst om opnieuw te valideren");
    }

    const attachmentNames: string[] = [];
    const attachmentTexts: string[] = [];
    const visionAttachments: { mimeType: string; data: string; filename: string }[] = [];

    console.log(`📋 [Box3Validator] Re-validating session ${id}: ${storedAttachments.length} stored files`);

    // Process stored attachments
    for (const attachment of storedAttachments) {
      attachmentNames.push(attachment.filename);

      const ext = attachment.filename.toLowerCase().split('.').pop();
      const isPDF = attachment.mimeType === 'application/pdf' ||
                    (attachment.mimeType === 'application/octet-stream' && ext === 'pdf');
      const isTXT = attachment.mimeType === 'text/plain' ||
                    (attachment.mimeType === 'application/octet-stream' && ext === 'txt');
      const isImage = attachment.mimeType === 'image/jpeg' || attachment.mimeType === 'image/png' ||
                      (attachment.mimeType === 'application/octet-stream' && ['jpg', 'jpeg', 'png'].includes(ext || ''));

      let extractedText = "";
      let needsVision = false;

      // Images always go to vision
      if (isImage) {
        const mimeType = attachment.mimeType.startsWith('image/') ? attachment.mimeType :
                         (ext === 'png' ? 'image/png' : 'image/jpeg');
        visionAttachments.push({
          mimeType,
          data: attachment.fileData,
          filename: attachment.filename
        });
        console.log(`📋 [Box3Validator] Image added to vision: ${attachment.filename}`);
      } else if (isPDF) {
        try {
          const PDFParseClass = await getPdfParse();
          const buffer = Buffer.from(attachment.fileData, 'base64');
          const parser = new PDFParseClass({ data: buffer });
          const result = await parser.getText();
          const pages = Array.isArray(result.pages) ? result.pages.length :
                       (typeof result.pages === 'object' ? Object.keys(result.pages).length : 1);
          extractedText = result.text || "";

          // Detect scanned PDFs
          const charsPerPage = extractedText.length / Math.max(pages, 1);
          if (charsPerPage < 100 && pages > 0) {
            needsVision = true;
            console.log(`📋 [Box3Validator] Scanned PDF detected: ${attachment.filename}`);
          }
        } catch (err: any) {
          console.warn(`📋 [Box3Validator] PDF parse failed: ${attachment.filename}`, err.message);
          needsVision = true;
        }

        // If scanned or parse failed, use Vision
        if (needsVision || extractedText.length < 100) {
          visionAttachments.push({
            mimeType: 'application/pdf',
            data: attachment.fileData,
            filename: attachment.filename
          });
          console.log(`📋 [Box3Validator] Added to vision: ${attachment.filename}`);
        }
      } else if (isTXT) {
        const buffer = Buffer.from(attachment.fileData, 'base64');
        extractedText = buffer.toString('utf-8');
      }

      if (extractedText.trim().length > 0) {
        attachmentTexts.push(`\n=== DOCUMENT: ${attachment.filename} ===\n${extractedText}`);
      }
    }

    // Build the user prompt
    const userPrompt = `## Mail van klant:
${session.inputText}

## Bijlages (${attachmentNames.length} documenten):
${attachmentTexts.length > 0 ? attachmentTexts.join('\n\n') : 'Geen tekst-extractie beschikbaar - documenten worden via vision geanalyseerd.'}

Analyseer alle bovenstaande input en geef je validatie als JSON.`;

    console.log(`📋 [Box3Validator] Re-validating with ${visionAttachments.length} vision attachments`);

    // Get AI config via AIConfigResolver
    // Box3 validator needs higher maxOutputTokens for bijlage_analyse with many files
    const activeConfig = await storage.getActivePromptConfig();
    const promptConfig = activeConfig?.config as PromptConfig;

    const baseAiConfig = configResolver.resolveForOperation(
      'box3_validator',
      promptConfig,
      `box3-revalidate-${Date.now()}`
    );

    // Ensure sufficient output tokens for detailed bijlage_analyse
    // Legacy revalidation requires high thinking for thorough analysis
    const aiConfig = {
      ...baseAiConfig,
      maxOutputTokens: Math.max(baseAiConfig.maxOutputTokens || 8192, 16384),
      thinkingLevel: 'high' as const, // Revalidation requires thorough thinking
    };

    // Call AI with config from database
    // systemPrompt is REQUIRED - no fallback
    if (!systemPrompt || systemPrompt.trim().length === 0) {
      throw ServerError.validation("systemPrompt is required", "Configureer eerst een intake prompt in de instellingen");
    }

    const factory = AIModelFactory.getInstance();
    const result = await factory.callModel(
      aiConfig,
      `${systemPrompt}\n\n${userPrompt}`,
      {
        jobId: `box3-revalidate-${Date.now()}`,
        visionAttachments: visionAttachments.length > 0 ? visionAttachments : undefined
      }
    );

    console.log(`📋 [Box3Validator] Re-validation AI response: ${result.content.length} chars`);

    // Parse JSON from response
    let validationResult;
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
      validationResult = box3ValidationResultSchema.parse(parsed);
      console.log(`📋 [Box3Validator] Re-validation result parsed successfully`);
    } catch (parseError: any) {
      console.error(`📋 [Box3Validator] JSON parse error:`, parseError.message);
      throw ServerError.ai(
        'Kon AI response niet parsen. Probeer opnieuw.',
        { error: parseError.message }
      );
    }

    // Update session with new validation result
    const updatedSession = await storage.updateBox3ValidatorSession(id, {
      belastingjaar: validationResult.belastingjaar || session.belastingjaar,
      validationResult,
      conceptMail: validationResult.concept_mail
    });

    console.log(`📋 [Box3Validator] Session ${id} re-validated`);

    res.json(createApiSuccessResponse({
      session: updatedSession,
      validationResult
    }, "Documenten opnieuw gevalideerd"));
  })
);

// ============ MULTI-YEAR ENDPOINTS ============

/**
 * Convert session to multi-year format
 * POST /api/box3-validator/sessions/:id/convert-to-multi-year
 *
 * Automatically groups documents by year based on bijlage_analyse
 */
box3ValidatorRouter.post(
  "/sessions/:id/convert-to-multi-year",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      throw ServerError.notFound("Sessie");
    }

    if (session.isMultiYear) {
      throw ServerError.validation("Already multi-year", "Sessie is al multi-year");
    }

    const existingValidation = session.validationResult as any;
    const existingAttachments = (session.attachments as any[]) || [];
    const primaryYear = session.belastingjaar || "2023";

    // Detect all unique years from bijlage_analyse
    const yearsFromDocs = new Set<string>();
    yearsFromDocs.add(primaryYear); // Always include primary year

    if (existingValidation?.bijlage_analyse && Array.isArray(existingValidation.bijlage_analyse)) {
      for (const analyse of existingValidation.bijlage_analyse) {
        if (analyse.belastingjaar) {
          yearsFromDocs.add(String(analyse.belastingjaar));
        }
      }
    }

    const uniqueYears = Array.from(yearsFromDocs).sort();
    console.log(`📋 [Box3Validator] Converting to multi-year with years: ${uniqueYears.join(', ')}`);

    // Group attachments by year based on bijlage_analyse
    const attachmentsByYear: Record<string, any[]> = {};
    for (const year of uniqueYears) {
      attachmentsByYear[year] = [];
    }

    // Match each attachment to its year - try filename match first, then index-based
    for (let i = 0; i < existingAttachments.length; i++) {
      const attachment = existingAttachments[i];
      let matchedYear: string | null = null;

      if (existingValidation?.bijlage_analyse) {
        // First try filename match
        const analyse = existingValidation.bijlage_analyse.find((a: any) =>
          a.bestandsnaam?.toLowerCase() === attachment.filename?.toLowerCase() ||
          a.bestandsnaam?.toLowerCase().includes(attachment.filename?.toLowerCase()) ||
          attachment.filename?.toLowerCase().includes(a.bestandsnaam?.toLowerCase())
        );
        if (analyse?.belastingjaar) {
          matchedYear = String(analyse.belastingjaar);
        }

        // If no filename match, try index-based (AI often names files image_1, image_2 etc)
        if (!matchedYear && existingValidation.bijlage_analyse[i]?.belastingjaar) {
          matchedYear = String(existingValidation.bijlage_analyse[i].belastingjaar);
        }
      }

      // Fallback to primary year if no match found
      if (!matchedYear) {
        matchedYear = primaryYear;
      }

      // Add to appropriate year bucket
      if (attachmentsByYear[matchedYear]) {
        attachmentsByYear[matchedYear].push(attachment);
      } else {
        // Year not in list, add to primary year
        attachmentsByYear[primaryYear].push(attachment);
      }
    }

    // Create multi-year data structure
    const multiYearData: Box3MultiYearData = {
      years: {}
    };

    for (const year of uniqueYears) {
      multiYearData.years[year] = {
        jaar: year,
        attachments: attachmentsByYear[year] || [],
        // Only primary year gets the existing validation result
        validationResult: year === primaryYear ? existingValidation : undefined,
        manualOverrides: year === primaryYear ? (session.manualOverrides as any) : undefined,
        isComplete: false,
        updatedAt: new Date().toISOString(),
      };
    }

    const updated = await storage.updateBox3ValidatorSession(id, {
      isMultiYear: true,
      multiYearData,
    });

    const yearCounts = uniqueYears.map(y => `${y}: ${attachmentsByYear[y]?.length || 0} docs`).join(', ');
    console.log(`📋 [Box3Validator] Session ${id} converted to multi-year: ${yearCounts}`);

    res.json(createApiSuccessResponse(updated, `Sessie omgezet naar multi-year met ${uniqueYears.length} jaren`));
  })
);

/**
 * Re-organize multi-year session - redistribute documents by year
 * POST /api/box3-validator/sessions/:id/reorganize
 *
 * Use this when documents were not properly grouped by year
 */
box3ValidatorRouter.post(
  "/sessions/:id/reorganize",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      throw ServerError.notFound("Sessie");
    }

    if (!session.isMultiYear) {
      throw ServerError.validation("Not multi-year", "Sessie is geen multi-year dossier");
    }

    const existingValidation = session.validationResult as any;
    const multiYearData = (session.multiYearData || { years: {} }) as Box3MultiYearData;

    // Collect all attachments from all years
    const allAttachments: any[] = [];
    for (const yearEntry of Object.values(multiYearData.years)) {
      if (yearEntry.attachments) {
        allAttachments.push(...yearEntry.attachments);
      }
    }

    // Also add legacy attachments if not already included
    const legacyAttachments = (session.attachments as any[]) || [];
    for (const att of legacyAttachments) {
      const exists = allAttachments.some(a => a.filename === att.filename);
      if (!exists) {
        allAttachments.push(att);
      }
    }

    // Detect all unique years from bijlage_analyse
    const yearsFromDocs = new Set<string>();
    const primaryYear = session.belastingjaar || "2023";
    yearsFromDocs.add(primaryYear);

    if (existingValidation?.bijlage_analyse && Array.isArray(existingValidation.bijlage_analyse)) {
      for (const analyse of existingValidation.bijlage_analyse) {
        if (analyse.belastingjaar) {
          yearsFromDocs.add(String(analyse.belastingjaar));
        }
      }
    }

    const uniqueYears = Array.from(yearsFromDocs).sort();
    console.log(`📋 [Box3Validator] Reorganizing with years: ${uniqueYears.join(', ')}, ${allAttachments.length} total docs`);

    // Group attachments by year based on bijlage_analyse
    const attachmentsByYear: Record<string, any[]> = {};
    for (const year of uniqueYears) {
      attachmentsByYear[year] = [];
    }

    // Match attachments to years - try filename match first, then index-based
    for (let i = 0; i < allAttachments.length; i++) {
      const attachment = allAttachments[i];
      let matchedYear: string | null = null;

      if (existingValidation?.bijlage_analyse) {
        // First try filename match
        const analyse = existingValidation.bijlage_analyse.find((a: any) =>
          a.bestandsnaam?.toLowerCase() === attachment.filename?.toLowerCase() ||
          a.bestandsnaam?.toLowerCase().includes(attachment.filename?.toLowerCase()) ||
          attachment.filename?.toLowerCase().includes(a.bestandsnaam?.toLowerCase())
        );
        if (analyse?.belastingjaar) {
          matchedYear = String(analyse.belastingjaar);
        }

        // If no filename match, try index-based (AI often names files image_1, image_2 etc)
        if (!matchedYear && existingValidation.bijlage_analyse[i]?.belastingjaar) {
          matchedYear = String(existingValidation.bijlage_analyse[i].belastingjaar);
        }
      }

      if (!matchedYear) {
        matchedYear = primaryYear;
      }

      if (attachmentsByYear[matchedYear]) {
        attachmentsByYear[matchedYear].push(attachment);
      } else {
        attachmentsByYear[primaryYear].push(attachment);
      }
    }

    // Rebuild multi-year structure
    const newMultiYearData: Box3MultiYearData = {
      years: {}
    };

    for (const year of uniqueYears) {
      const existingYearEntry = multiYearData.years[year];
      newMultiYearData.years[year] = {
        jaar: year,
        attachments: attachmentsByYear[year] || [],
        validationResult: existingYearEntry?.validationResult || (year === primaryYear ? existingValidation : undefined),
        manualOverrides: existingYearEntry?.manualOverrides,
        isComplete: false,
        updatedAt: new Date().toISOString(),
      };
    }

    const updated = await storage.updateBox3ValidatorSession(id, {
      multiYearData: newMultiYearData,
    });

    const yearCounts = uniqueYears.map(y => `${y}: ${attachmentsByYear[y]?.length || 0} docs`).join(', ');
    console.log(`📋 [Box3Validator] Session ${id} reorganized: ${yearCounts}`);

    res.json(createApiSuccessResponse(updated, `Documenten herverdeeld: ${yearCounts}`));
  })
);

/**
 * Add a year to multi-year session
 * POST /api/box3-validator/sessions/:id/years
 */
box3ValidatorRouter.post(
  "/sessions/:id/years",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { jaar } = req.body;

    if (!jaar || typeof jaar !== "string") {
      throw ServerError.validation("jaar required", "Belastingjaar is verplicht");
    }

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      throw ServerError.notFound("Sessie");
    }

    if (!session.isMultiYear) {
      throw ServerError.validation("Not multi-year", "Sessie is geen multi-year dossier");
    }

    const multiYearData = (session.multiYearData || { years: {} }) as Box3MultiYearData;

    if (multiYearData.years[jaar]) {
      throw ServerError.validation("Year exists", `Jaar ${jaar} bestaat al`);
    }

    // Add empty year entry
    multiYearData.years[jaar] = {
      jaar,
      attachments: [],
      isComplete: false,
      updatedAt: new Date().toISOString(),
    };

    const updated = await storage.updateBox3ValidatorSession(id, {
      multiYearData,
    });

    console.log(`📋 [Box3Validator] Added year ${jaar} to session ${id}`);

    res.json(createApiSuccessResponse(updated, `Jaar ${jaar} toegevoegd`));
  })
);

/**
 * Add documents to a specific year
 * POST /api/box3-validator/sessions/:id/years/:jaar/add-documents
 */
box3ValidatorRouter.post(
  "/sessions/:id/years/:jaar/add-documents",
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
    const { id, jaar } = req.params;
    const { systemPrompt } = req.body;

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      throw ServerError.notFound("Sessie");
    }

    if (!session.isMultiYear) {
      throw ServerError.validation("Not multi-year", "Sessie is geen multi-year dossier");
    }

    const multiYearData = (session.multiYearData || { years: {} }) as Box3MultiYearData;

    if (!multiYearData.years[jaar]) {
      throw ServerError.notFound(`Jaar ${jaar}`);
    }

    const newFiles = req.files as Express.Multer.File[] || [];
    if (newFiles.length === 0) {
      throw ServerError.validation("No files", "Geen bestanden geselecteerd");
    }

    // Process new files
    const newAttachments: { filename: string; mimeType: string; fileSize: number; fileData: string }[] = [];
    for (const file of newFiles) {
      newAttachments.push({
        filename: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileData: file.buffer.toString('base64')
      });
    }

    // Add to existing year attachments
    const yearEntry = multiYearData.years[jaar];
    const existingAttachments = yearEntry.attachments || [];
    const allAttachments = [...existingAttachments, ...newAttachments];
    yearEntry.attachments = allAttachments;
    yearEntry.updatedAt = new Date().toISOString();

    console.log(`📋 [Box3Validator] Adding ${newFiles.length} documents to year ${jaar}`);

    // Re-validate this year's documents
    const attachmentTexts: string[] = [];
    const visionAttachments: { mimeType: string; data: string; filename: string }[] = [];

    for (const attachment of allAttachments) {
      const ext = attachment.filename.toLowerCase().split('.').pop();
      const isPDF = attachment.mimeType === 'application/pdf' ||
                    (attachment.mimeType === 'application/octet-stream' && ext === 'pdf');
      const isTXT = attachment.mimeType === 'text/plain';
      const isImage = attachment.mimeType.startsWith('image/');

      let extractedText = "";
      let needsVision = false;

      if (isImage) {
        visionAttachments.push({
          mimeType: attachment.mimeType,
          data: attachment.fileData,
          filename: attachment.filename
        });
      } else if (isPDF) {
        try {
          const PDFParseClass = await getPdfParse();
          const buffer = Buffer.from(attachment.fileData, 'base64');
          const parser = new PDFParseClass({ data: buffer });
          const result = await parser.getText();
          extractedText = result.text || "";

          if (extractedText.length < 100) {
            needsVision = true;
          }
        } catch {
          needsVision = true;
        }

        if (needsVision) {
          visionAttachments.push({
            mimeType: 'application/pdf',
            data: attachment.fileData,
            filename: attachment.filename
          });
        }
      } else if (isTXT) {
        const buffer = Buffer.from(attachment.fileData, 'base64');
        extractedText = buffer.toString('utf-8');
      }

      if (extractedText.trim().length > 0) {
        attachmentTexts.push(`\n=== DOCUMENT: ${attachment.filename} ===\n${extractedText}`);
      }
    }

    // Build year-specific prompt
    const userPrompt = `## Belastingjaar: ${jaar}

## Bijlages (${allAttachments.length} documenten):
${attachmentTexts.length > 0 ? attachmentTexts.join('\n\n') : 'Geen tekst-extractie beschikbaar.'}

Analyseer alle bovenstaande input voor belastingjaar ${jaar} en geef je validatie als JSON.`;

    const activeConfig = await storage.getActivePromptConfig();
    const promptConfig = activeConfig?.config as PromptConfig;

    const baseAiConfig = configResolver.resolveForOperation(
      'box3_validator',
      promptConfig,
      `box3-year-${jaar}-${Date.now()}`
    );

    // Year validation requires high thinking for accurate kansrijkheid calculation
    const aiConfig = {
      ...baseAiConfig,
      maxOutputTokens: Math.max(baseAiConfig.maxOutputTokens || 8192, 16384),
      thinkingLevel: 'high' as const, // Year validation requires thorough analysis
    };

    // systemPrompt is REQUIRED - no fallback
    if (!systemPrompt || systemPrompt.trim().length === 0) {
      throw ServerError.validation("systemPrompt is required", "Configureer eerst een intake prompt in de instellingen");
    }

    const factory = AIModelFactory.getInstance();
    const result = await factory.callModel(
      aiConfig,
      `${systemPrompt}\n\n${userPrompt}`,
      {
        jobId: `box3-year-${jaar}-${Date.now()}`,
        visionAttachments: visionAttachments.length > 0 ? visionAttachments : undefined
      }
    );

    // Parse validation result
    let validationResult;
    try {
      let jsonText = result.content.match(/```json\s*([\s\S]*?)\s*```/)?.[1];
      if (!jsonText) jsonText = result.content.match(/\{[\s\S]*\}/)?.[0];
      if (!jsonText && result.content.trim().startsWith('{')) jsonText = result.content.trim();

      if (!jsonText) throw new Error('No JSON found');

      validationResult = box3ValidationResultSchema.parse(JSON.parse(jsonText));
    } catch (parseError: any) {
      throw ServerError.ai('Kon AI response niet parsen', { error: parseError.message });
    }

    yearEntry.validationResult = validationResult;

    // Update session
    const updated = await storage.updateBox3ValidatorSession(id, { multiYearData });

    console.log(`📋 [Box3Validator] Year ${jaar} validated with ${newFiles.length} new docs`);

    res.json(createApiSuccessResponse({
      session: updated,
      yearEntry,
      validationResult,
    }, `Documenten toegevoegd aan ${jaar}`));
  })
);

/**
 * Update overrides for a specific year
 * PATCH /api/box3-validator/sessions/:id/years/:jaar/overrides
 */
box3ValidatorRouter.patch(
  "/sessions/:id/years/:jaar/overrides",
  asyncHandler(async (req: Request, res: Response) => {
    const { id, jaar } = req.params;
    const { overrides } = req.body;

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      throw ServerError.notFound("Sessie");
    }

    if (!session.isMultiYear) {
      throw ServerError.validation("Not multi-year", "Sessie is geen multi-year dossier");
    }

    const multiYearData = (session.multiYearData || { years: {} }) as Box3MultiYearData;

    if (!multiYearData.years[jaar]) {
      throw ServerError.notFound(`Jaar ${jaar}`);
    }

    // Merge overrides for this year
    const yearEntry = multiYearData.years[jaar];
    const existingOverrides = yearEntry.manualOverrides || {};
    yearEntry.manualOverrides = { ...existingOverrides, ...overrides } as Box3ManualOverrides;
    yearEntry.updatedAt = new Date().toISOString();

    const updated = await storage.updateBox3ValidatorSession(id, { multiYearData });

    console.log(`📋 [Box3Validator] Updated overrides for year ${jaar}`);

    res.json(createApiSuccessResponse(updated, "Overrides bijgewerkt"));
  })
);

/**
 * Re-validate a specific year
 * POST /api/box3-validator/sessions/:id/years/:jaar/revalidate
 */
box3ValidatorRouter.post(
  "/sessions/:id/years/:jaar/revalidate",
  asyncHandler(async (req: Request, res: Response) => {
    const { id, jaar } = req.params;
    const { systemPrompt } = req.body;

    console.log(`📋 [Box3Validator] Revalidate year request: session=${id}, jaar=${jaar}`);

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      console.log(`📋 [Box3Validator] Session not found: ${id}`);
      throw ServerError.notFound("Sessie");
    }

    console.log(`📋 [Box3Validator] Session found: isMultiYear=${session.isMultiYear}`);

    if (!session.isMultiYear) {
      throw ServerError.validation("Not multi-year", "Sessie is geen multi-year dossier");
    }

    const multiYearData = (session.multiYearData || { years: {} }) as Box3MultiYearData;
    console.log(`📋 [Box3Validator] Available years: ${Object.keys(multiYearData.years).join(', ')}`);

    if (!multiYearData.years[jaar]) {
      console.log(`📋 [Box3Validator] Year not found: ${jaar}`);
      throw ServerError.notFound(`Jaar ${jaar}`);
    }

    const yearEntry = multiYearData.years[jaar];
    let attachments = yearEntry.attachments || [];
    console.log(`📋 [Box3Validator] Year ${jaar} has ${attachments.length} attachments in yearEntry`);

    // If no attachments in year entry, try to find them from session-level bijlage_analyse
    // This handles cases where documents were assigned to years but not physically moved
    if (attachments.length === 0) {
      const sessionAttachments = (session.attachments || []) as { filename: string; mimeType: string; fileSize: number; fileData: string }[];
      const sessionValidation = session.validationResult as any;

      if (sessionAttachments.length > 0 && sessionValidation?.bijlage_analyse) {
        // Find attachments that belong to this year based on bijlage_analyse
        for (let i = 0; i < sessionAttachments.length; i++) {
          const attachment = sessionAttachments[i];

          // Try filename match first
          const analyse = sessionValidation.bijlage_analyse.find((a: any) =>
            a.bestandsnaam?.toLowerCase() === attachment.filename?.toLowerCase() ||
            a.bestandsnaam?.toLowerCase().includes(attachment.filename?.toLowerCase()) ||
            attachment.filename?.toLowerCase().includes(a.bestandsnaam?.toLowerCase())
          );

          if (analyse?.belastingjaar && String(analyse.belastingjaar) === jaar) {
            attachments.push(attachment);
            continue;
          }

          // Try index-based match (AI often names files image_1, image_2 etc)
          if (sessionValidation.bijlage_analyse[i]?.belastingjaar &&
              String(sessionValidation.bijlage_analyse[i].belastingjaar) === jaar) {
            attachments.push(attachment);
          }
        }

        // Update the year entry with found attachments
        if (attachments.length > 0) {
          yearEntry.attachments = attachments;
          await storage.updateBox3ValidatorSession(id, { multiYearData });
          console.log(`📋 [Box3Validator] Migrated ${attachments.length} attachments to year ${jaar}`);
        }
      }
    }

    if (attachments.length === 0) {
      throw ServerError.validation("No data", "Geen documenten voor dit jaar");
    }

    // Process attachments for revalidation
    const attachmentTexts: string[] = [];
    const visionAttachments: { mimeType: string; data: string; filename: string }[] = [];

    for (const attachment of attachments) {
      const ext = attachment.filename.toLowerCase().split('.').pop();
      const isPDF = attachment.mimeType === 'application/pdf';
      const isTXT = attachment.mimeType === 'text/plain';
      const isImage = attachment.mimeType.startsWith('image/');

      let extractedText = "";
      let needsVision = false;

      if (isImage) {
        visionAttachments.push({
          mimeType: attachment.mimeType,
          data: attachment.fileData,
          filename: attachment.filename
        });
      } else if (isPDF) {
        try {
          const PDFParseClass = await getPdfParse();
          const buffer = Buffer.from(attachment.fileData, 'base64');
          const parser = new PDFParseClass({ data: buffer });
          const result = await parser.getText();
          extractedText = result.text || "";
          if (extractedText.length < 100) needsVision = true;
        } catch {
          needsVision = true;
        }

        if (needsVision) {
          visionAttachments.push({
            mimeType: 'application/pdf',
            data: attachment.fileData,
            filename: attachment.filename
          });
        }
      } else if (isTXT) {
        extractedText = Buffer.from(attachment.fileData, 'base64').toString('utf-8');
      }

      if (extractedText.trim().length > 0) {
        attachmentTexts.push(`\n=== DOCUMENT: ${attachment.filename} ===\n${extractedText}`);
      }
    }

    const userPrompt = `## Belastingjaar: ${jaar}

## Bijlages (${attachments.length} documenten):
${attachmentTexts.length > 0 ? attachmentTexts.join('\n\n') : 'Documenten via vision.'}

Analyseer voor belastingjaar ${jaar} en geef validatie als JSON.`;

    const activeConfig = await storage.getActivePromptConfig();
    const promptConfig = activeConfig?.config as PromptConfig;

    const baseAiConfig = configResolver.resolveForOperation(
      'box3_validator',
      promptConfig,
      `box3-reval-${jaar}-${Date.now()}`
    );

    // Year revalidation requires high thinking for accurate analysis
    const aiConfig = {
      ...baseAiConfig,
      maxOutputTokens: Math.max(baseAiConfig.maxOutputTokens || 8192, 16384),
      thinkingLevel: 'high' as const, // Year revalidation requires thorough analysis
    };

    // systemPrompt is REQUIRED - no fallback
    if (!systemPrompt || systemPrompt.trim().length === 0) {
      throw ServerError.validation("systemPrompt is required", "Configureer eerst een intake prompt in de instellingen");
    }

    const factory = AIModelFactory.getInstance();
    const result = await factory.callModel(
      aiConfig,
      `${systemPrompt}\n\n${userPrompt}`,
      {
        jobId: `box3-reval-${jaar}-${Date.now()}`,
        visionAttachments: visionAttachments.length > 0 ? visionAttachments : undefined
      }
    );

    let validationResult;
    try {
      let jsonText = result.content.match(/```json\s*([\s\S]*?)\s*```/)?.[1];
      if (!jsonText) jsonText = result.content.match(/\{[\s\S]*\}/)?.[0];
      if (!jsonText && result.content.trim().startsWith('{')) jsonText = result.content.trim();
      if (!jsonText) throw new Error('No JSON found');

      validationResult = box3ValidationResultSchema.parse(JSON.parse(jsonText));
    } catch (parseError: any) {
      throw ServerError.ai('Kon AI response niet parsen', { error: parseError.message });
    }

    yearEntry.validationResult = validationResult;
    yearEntry.updatedAt = new Date().toISOString();

    const updated = await storage.updateBox3ValidatorSession(id, { multiYearData });

    console.log(`📋 [Box3Validator] Year ${jaar} revalidated`);

    res.json(createApiSuccessResponse({
      session: updated,
      validationResult,
    }, `Jaar ${jaar} opnieuw gevalideerd`));
  })
);

/**
 * Generate email for entire dossier (all years)
 * Uses low thinking level for fast email generation
 *
 * POST /api/box3-validator/sessions/:id/generate-email
 */
box3ValidatorRouter.post(
  "/sessions/:id/generate-email",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { emailPrompt } = req.body;

    console.log(`📋 [Box3Validator] Generate email request: session=${id}`);

    const session = await storage.getBox3ValidatorSession(id);
    if (!session) {
      throw ServerError.notFound("Sessie");
    }

    // Build context from session data
    const clientName = session.clientName || "de klant";
    let dossierContext = "";

    if (session.isMultiYear) {
      // Multi-year dossier: gather status from all years
      const multiYearData = (session.multiYearData || { years: {} }) as Box3MultiYearData;
      const years = Object.keys(multiYearData.years).sort();

      dossierContext = `## Dossier Overzicht (Multi-year)\nKlant: ${clientName}\nJaren: ${years.join(", ")}\n\n`;

      for (const jaar of years) {
        const yearEntry = multiYearData.years[jaar];
        const validation = yearEntry.validationResult as any;

        dossierContext += `### Belastingjaar ${jaar}\n`;

        if (validation?.document_validatie) {
          dossierContext += `Document status:\n`;
          for (const [cat, status] of Object.entries(validation.document_validatie)) {
            dossierContext += `- ${cat}: ${status}\n`;
          }
        }

        if (validation?.validatie) {
          for (const [cat, data] of Object.entries(validation.validatie)) {
            const v = data as any;
            if (v?.feedback) {
              dossierContext += `${cat}: ${v.feedback}\n`;
            }
          }
        }

        dossierContext += "\n";
      }
    } else {
      // Legacy single-year dossier
      const validation = session.validationResult as any;
      const jaar = validation?.belastingjaar || validation?.gevonden_data?.algemeen?.belastingjaar || "onbekend";

      dossierContext = `## Dossier Overzicht\nKlant: ${clientName}\nBelastingjaar: ${jaar}\n\n`;

      if (validation?.document_validatie) {
        dossierContext += `Document status:\n`;
        for (const [cat, status] of Object.entries(validation.document_validatie)) {
          dossierContext += `- ${cat}: ${status}\n`;
        }
        dossierContext += "\n";
      }

      if (validation?.validatie) {
        dossierContext += `Details:\n`;
        for (const [cat, data] of Object.entries(validation.validatie)) {
          const v = data as any;
          if (v?.status) {
            dossierContext += `- ${cat}: ${v.status}`;
            if (v.feedback) dossierContext += ` - ${v.feedback}`;
            dossierContext += "\n";
          }
        }
      }
    }

    const userPrompt = `${dossierContext}\n\nGenereer een professionele e-mail voor deze klant met een overzicht van de status en wat er nog nodig is.`;

    // Default email prompt if none provided
    const DEFAULT_EMAIL_PROMPT = `Je bent een ervaren fiscalist die professionele e-mails schrijft voor Box 3 bezwaarprocedures.

## E-mail richtlijnen:
- **Toon**: Professioneel maar vriendelijk
- **Structuur**: Duidelijke alinea's met logische opbouw
- **Compleetheid**: Benoem specifiek wat ontvangen is en wat ontbreekt
- **Actie**: Geef duidelijk aan welke actie de klant moet ondernemen

## Output formaat (STRIKT JSON)
\`\`\`json
{
  "onderwerp": "Box 3 bezwaar - Status en verzoek aanvullende documenten",
  "body": "Geachte heer/mevrouw,\\n\\n..."
}
\`\`\``;

    const activeConfig = await storage.getActivePromptConfig();
    const promptConfig = activeConfig?.config as PromptConfig;

    const baseAiConfig = configResolver.resolveForOperation(
      'box3_validator',
      promptConfig,
      `box3-email-${Date.now()}`
    );

    // Email generation uses LOW thinking - it's just text formatting
    const aiConfig = {
      ...baseAiConfig,
      maxOutputTokens: Math.max(baseAiConfig.maxOutputTokens || 4096, 8192),
      thinkingLevel: 'low' as const, // Email generation is straightforward
    };

    const factory = AIModelFactory.getInstance();
    const result = await factory.callModel(
      aiConfig,
      `${emailPrompt || DEFAULT_EMAIL_PROMPT}\n\n${userPrompt}`,
      {
        jobId: `box3-email-${Date.now()}`,
      }
    );

    // Parse email response
    let emailData: { onderwerp: string; body: string };
    try {
      let jsonText = result.content.match(/```json\s*([\s\S]*?)\s*```/)?.[1];
      if (!jsonText) jsonText = result.content.match(/\{[\s\S]*\}/)?.[0];
      if (!jsonText && result.content.trim().startsWith('{')) jsonText = result.content.trim();
      if (!jsonText) throw new Error('No JSON found');

      emailData = JSON.parse(jsonText);

      if (!emailData.onderwerp || !emailData.body) {
        throw new Error('Missing onderwerp or body in response');
      }
    } catch (parseError: any) {
      console.error(`📋 [Box3Validator] Email parse error:`, parseError.message);
      throw ServerError.ai('Kon e-mail response niet parsen', { error: parseError.message });
    }

    console.log(`📋 [Box3Validator] Email generated for session ${id}`);

    res.json(createApiSuccessResponse({
      email: emailData,
    }, 'E-mail gegenereerd'));
  })
);
