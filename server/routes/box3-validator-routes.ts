import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { storage } from "../storage";
import { AIModelFactory } from "../services/ai-models/ai-model-factory";
import { AIConfigResolver } from "../services/ai-config-resolver";
import { box3ValidationResultSchema, insertBox3ValidatorSessionSchema } from "@shared/schema";
import type { PromptConfig } from "@shared/schema";

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

// Box 3 Validation System Prompt
const BOX3_SYSTEM_PROMPT = `Je bent een fiscaal specialist die documenten voor Box 3 bezwaar zaken valideert.

## Context
Een klant heeft een informatieverzoek ontvangen waarin de volgende 5 documentcategorieën worden gevraagd:

1. **Aangifte inkomstenbelasting** - De volledige aangifte van het betreffende belastingjaar
2. **Bankrekeningen** - Een overzicht van de daadwerkelijk ontvangen rente en eventuele valutaresultaten
3. **Beleggingen** - Een overzicht met:
   - Beginstand (1 januari)
   - Eindstand (31 december)
   - Eventuele stortingen/onttrekkingen
   - Ontvangen dividenden
4. **Vastgoed & overige bezittingen** - De WOZ-waarde op 1 januari van het jaar erna (T+1). Indien verhuurd: een overzicht van de huurinkomsten.
5. **Schulden** - Een overzicht van de schulden en de betaalde rente

## Jouw taak
Analyseer ALLE input (mail tekst + bijlages) en bepaal per categorie:
- **status**: "compleet" (alle benodigde info aanwezig), "onvolledig" (deels aanwezig), of "ontbreekt" (niet gevonden)
- **feedback**: Gedetailleerde uitleg wat je hebt gevonden of wat er mist
- **gevonden_in**: In welke document(en) je de informatie hebt gevonden

Detecteer ook het **belastingjaar** uit de documenten.

Genereer tot slot een **concept reactie-mail** waarin je:
- De klant bedankt voor de aangeleverde documenten
- Duidelijk aangeeft wat compleet is
- Specifiek benoemt wat er nog ontbreekt of onvolledig is
- Professioneel en vriendelijk communiceert

## Output formaat (STRIKT JSON)
Geef je antwoord als valide JSON in exact dit formaat:

\`\`\`json
{
  "belastingjaar": "2023",
  "validatie": {
    "aangifte_ib": {
      "status": "compleet|onvolledig|ontbreekt",
      "feedback": "Gedetailleerde uitleg...",
      "gevonden_in": ["document1.pdf", "mail tekst"]
    },
    "bankrekeningen": {
      "status": "compleet|onvolledig|ontbreekt",
      "feedback": "Gedetailleerde uitleg...",
      "gevonden_in": []
    },
    "beleggingen": {
      "status": "compleet|onvolledig|ontbreekt",
      "feedback": "Gedetailleerde uitleg...",
      "gevonden_in": []
    },
    "vastgoed": {
      "status": "compleet|onvolledig|ontbreekt",
      "feedback": "Gedetailleerde uitleg...",
      "gevonden_in": []
    },
    "schulden": {
      "status": "compleet|onvolledig|ontbreekt",
      "feedback": "Gedetailleerde uitleg...",
      "gevonden_in": []
    }
  },
  "concept_mail": {
    "onderwerp": "Re: Informatieverzoek Box 3 bezwaar [jaar]",
    "body": "Geachte heer/mevrouw,\\n\\nHartelijk dank voor..."
  }
}
\`\`\``;

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
    const aiConfig = {
      ...baseAiConfig,
      maxOutputTokens: Math.max(baseAiConfig.maxOutputTokens || 8192, 16384)
    };

    // Call AI with config from database
    const factory = AIModelFactory.getInstance();
    const result = await factory.callModel(
      aiConfig,
      `${systemPrompt || BOX3_SYSTEM_PROMPT}\n\n${userPrompt}`,
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

    // Create session with stored attachments
    const session = await storage.createBox3ValidatorSession({
      clientName: clientName.trim(),
      belastingjaar: validationResult.belastingjaar || null,
      inputText: inputText.trim(),
      attachmentNames: attachmentNames as string[],
      attachments: storedAttachments,
      validationResult,
      conceptMail: validationResult.concept_mail
    });

    console.log(`📋 [Box3Validator] Session created: ${session.id}`);

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
    const aiConfig = {
      ...baseAiConfig,
      maxOutputTokens: Math.max(baseAiConfig.maxOutputTokens || 8192, 16384)
    };

    const factory = AIModelFactory.getInstance();
    const result = await factory.callModel(
      aiConfig,
      `${systemPrompt || BOX3_SYSTEM_PROMPT}\n\n${userPrompt}`,
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
    const aiConfig = {
      ...baseAiConfig,
      maxOutputTokens: Math.max(baseAiConfig.maxOutputTokens || 8192, 16384)
    };

    // Call AI with config from database
    const factory = AIModelFactory.getInstance();
    const result = await factory.callModel(
      aiConfig,
      `${systemPrompt || BOX3_SYSTEM_PROMPT}\n\n${userPrompt}`,
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
