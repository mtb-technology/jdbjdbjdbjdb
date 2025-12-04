import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { promises as fs } from "fs";
import * as path from "path";
import multer from "multer";
import { storage } from "./storage";
import { ReportGenerator } from "./services/report-generator";
import { SourceValidator } from "./services/source-validator";
import { PDFGenerator } from "./services/pdf-generator";
import { TextStyler } from "./services/text-styler";
import { AIHealthService } from "./services/ai-models/health-service";
import { AIMonitoringService } from "./services/ai-models/monitoring";
import { AIModelFactory } from "./services/ai-models/ai-model-factory";
import { checkDatabaseConnection } from "./db";
import { dossierSchema, bouwplanSchema, insertPromptConfigSchema, insertFollowUpSessionSchema, insertFollowUpThreadSchema } from "@shared/schema";
import type { DossierData, BouwplanData, StageId, ConceptReportVersions, PromptConfig } from "@shared/schema";
import { createReportRequestSchema, processFeedbackRequestSchema, overrideConceptRequestSchema, promoteSnapshotRequestSchema } from "@shared/types/api";
import { ReportProcessor } from "./services/report-processor";
import { SSEHandler } from "./services/streaming/sse-handler";
import { StreamingSessionManager } from "./services/streaming/streaming-session-manager";
import { PromptBuilder } from "./services/prompt-builder";
import { registerStreamingRoutes } from "./routes/streaming-routes";
import { documentRouter } from "./routes/document-routes";
import { fileUploadRouter } from "./routes/file-upload-routes";
import { registerHealthRoutes } from "./routes/health-routes";
import { registerPromptRoutes } from "./routes/prompt-routes";
import { registerCaseRoutes } from "./routes/case-routes";
import { registerReportRoutes } from "./routes/report-routes";
import { box3ValidatorRouter } from "./routes/box3-validator-routes";
import { z } from "zod";
import { ServerError, asyncHandler, getErrorMessage, isErrorWithMessage } from "./middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { deduplicateRequests } from "./middleware/deduplicate";

const generateReportSchema = z.object({
  dossier: dossierSchema,
  bouwplan: bouwplanSchema,
  clientName: z.string().min(1),
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize database with default prompts if needed
  try {
    await (storage as any).initializeDefaultPrompts?.();
  } catch (error) {
    console.warn("Could not initialize default prompts:", error);
  }
  const reportGenerator = new ReportGenerator();
  const sourceValidator = new SourceValidator();
  const pdfGenerator = new PDFGenerator();
  const textStyler = new TextStyler(reportGenerator);
  const healthService = new AIHealthService(AIMonitoringService.getInstance());
  const sseHandler = new SSEHandler();
  const sessionManager = StreamingSessionManager.getInstance();
  const promptBuilder = new PromptBuilder();
  
  // Create AI handler for ReportProcessor using same approach as ReportGenerator
  const aiHandler = {
    generateContent: async (params: { prompt: string; temperature: number; topP: number; maxOutputTokens: number }) => {
      // ✅ Pass AI config parameters to testAI (especially maxOutputTokens)
      const result = await reportGenerator.testAI(params.prompt, {
        temperature: params.temperature,
        topP: params.topP,
        maxOutputTokens: params.maxOutputTokens
      });
      return { content: result };
    }
  };
  const reportProcessor = new ReportProcessor(aiHandler);

  // ====== REGISTER EXTRACTED ROUTE MODULES ======
  // Phase 1: Health, Prompt, and Case routes moved to separate files
  // Phase 2: Report routes extracted for better maintainability

  // Simple routes - no auth needed for 2-3 internal users
  registerHealthRoutes(app); // Health checks
  registerPromptRoutes(app); // Prompt management
  registerCaseRoutes(app, pdfGenerator); // Case/Report CRUD
  registerReportRoutes(app, { // Report workflow (stages, feedback, generation)
    reportGenerator,
    reportProcessor,
    sourceValidator,
    sseHandler,
    sessionManager
  });

  // Box 3 Validator micro-module
  app.use("/api/box3-validator", box3ValidatorRouter);
  // ==============================================

  // Start periodic health checks and run immediate warm-up
  healthService.startPeriodicHealthChecks();

  // Warm up health cache immediately
  healthService.getSystemHealth().catch(error => {
    console.error('❌ Initial health check FAILED:', error);
  });

  // Test route voor AI - simpele test om te verifieren dat API werkt
  // 🔒 PROTECTED: Requires authentication (via global middleware)
  app.get("/api/test-ai", asyncHandler(async (req: Request, res: Response) => {
    const result = await reportGenerator.testAI("Say hello in Dutch in 5 words");
    res.json(createApiSuccessResponse({ response: result }, "AI test succesvol uitgevoerd"));
  }));

  // NOTE: Report workflow routes moved to server/routes/report-routes.ts
  // (extract-dossier, reports/create, stage execution, feedback processing, etc.)

  // === CASE MANAGEMENT ENDPOINTS ===

  // Get all cases/reports with pagination and filtering
  app.get("/api/cases", async (req, res) => {
    try {
      const { page = 1, limit = 10, status, search } = req.query;
      
      const cases = await storage.getAllReports({
        page: Number(page),
        limit: Number(limit),
        status: status as string,
        search: search as string
      });
      
      // Add caching headers for case list
      res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
      res.json(createApiSuccessResponse(cases));
    } catch (error: unknown) {
      console.error("Error fetching cases:", error);
      res.status(500).json({ message: "Fout bij ophalen cases" });
    }
  });

  // Get specific case by ID
  app.get("/api/cases/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const report = await storage.getReport(id);
      
      if (!report) {
        res.status(404).json({ message: "Case niet gevonden" });
        return;
      }
      
      res.json(createApiSuccessResponse(report));
    } catch (error: unknown) {
      console.error("Error fetching case:", error);
      res.status(500).json({ message: "Fout bij ophalen case" });
    }
  });

  // Update case metadata (title and clientName)
  app.patch("/api/cases/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { title, clientName } = req.body;

      // Validate input
      const updates: any = {};

      if (title !== undefined) {
        if (typeof title !== 'string' || title.trim().length === 0) {
          res.status(400).json({ message: "Titel mag niet leeg zijn" });
          return;
        }
        updates.title = title.trim();
      }

      if (clientName !== undefined) {
        if (typeof clientName !== 'string' || clientName.trim().length === 0) {
          res.status(400).json({ message: "Clientnaam mag niet leeg zijn" });
          return;
        }
        updates.clientName = clientName.trim();
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ message: "Geen velden om bij te werken" });
        return;
      }

      const updatedReport = await storage.updateReport(id, updates);

      if (!updatedReport) {
        res.status(404).json({ message: "Case niet gevonden" });
        return;
      }

      res.json(createApiSuccessResponse(updatedReport, "Case succesvol bijgewerkt"));
    } catch (error: unknown) {
      console.error("Error updating case:", error);
      res.status(500).json({ message: "Fout bij updaten case" });
    }
  });

  // Update case status
  app.patch("/api/cases/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!["draft", "processing", "generated", "exported", "archived"].includes(status)) {
        res.status(400).json({ message: "Ongeldige status" });
        return;
      }

      await storage.updateReportStatus(id, status);
      res.json(createApiSuccessResponse({ success: true }, "Status succesvol bijgewerkt"));
    } catch (error: unknown) {
      console.error("Error updating case status:", error);
      res.status(500).json({ message: "Fout bij updaten status" });
    }
  });

  // Delete case
  app.delete("/api/cases/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteReport(id);
      res.json(createApiSuccessResponse({ success: true }, "Case succesvol verwijderd"));
    } catch (error: unknown) {
      console.error("Error deleting case:", error);
      res.status(500).json({ message: "Fout bij verwijderen case" });
    }
  });

  // Export case as different formats
  app.get("/api/cases/:id/export/:format", async (req, res) => {
    try {
      const { id, format } = req.params;
      const report = await storage.getReport(id);

      if (!report) {
        res.status(404).json({ message: "Case niet gevonden" });
        return;
      }

      if (format === "html") {
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename="case-${id}.html"`);
        res.send(report.generatedContent || "Geen content beschikbaar");
      } else if (format === "json") {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="case-${id}.json"`);
        res.json(createApiSuccessResponse(report));
      } else if (format === "pdf") {
        const pdfBuffer = await pdfGenerator.generatePDF(report);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="rapport-${report.clientName.replace(/[^a-zA-Z0-9]/g, '-')}-${id.slice(0, 8)}.pdf"`);
        res.send(pdfBuffer);
      } else {
        res.status(400).json({ message: "Ongeldige export format" });
      }
    } catch (error: unknown) {
      console.error("Error exporting case:", error);
      res.status(500).json({ message: "Fout bij exporteren case" });
    }
  });

  // Follow-up Assistant - Generate AI response for customer follow-up questions
  app.post("/api/assistant/generate", asyncHandler(async (req: Request, res: Response) => {
    const { systemPrompt, userInput, model } = req.body;

    // Validate inputs
    if (!systemPrompt || !userInput || !model) {
      throw new ServerError(
        ERROR_CODES.VALIDATION_FAILED,
        "Ontbrekende verplichte velden: systemPrompt, userInput, en model zijn vereist",
        400
      );
    }

    // Validate input lengths
    if (userInput.length > 200000) {
      throw new ServerError(
        ERROR_CODES.VALIDATION_FAILED,
        "User input is te lang (max 200KB)",
        400
      );
    }

    // Call AI with the system prompt and user input
    const aiResult = await reportGenerator.generateWithCustomPrompt({
      systemPrompt,
      userPrompt: userInput,
      model,
    });

    // Parse the JSON response from AI
    let parsedResult;
    try {
      // The AI should return JSON - try multiple extraction strategies
      // Strategy 1: Look for JSON code block
      let jsonText = aiResult.match(/```json\s*([\s\S]*?)\s*```/)?.[1];

      // Strategy 2: Look for first complete JSON object
      if (!jsonText) {
        jsonText = aiResult.match(/\{[\s\S]*\}/)?.[0];
      }

      // Strategy 3: Try the whole response if it looks like JSON
      if (!jsonText && aiResult.trim().startsWith('{')) {
        jsonText = aiResult.trim();
      }

      if (!jsonText) {
        console.error("AI response does not contain JSON. Raw response:", aiResult);
        throw new Error("AI response does not contain valid JSON");
      }

      parsedResult = JSON.parse(jsonText);
    } catch (parseError: unknown) {
      console.error("Failed to parse AI response:", parseError);
      console.error("Raw AI response:", aiResult.substring(0, 500));
      throw new ServerError(
        ERROR_CODES.AI_PROCESSING_FAILED,
        `AI antwoord kon niet worden geparseerd als JSON: ${getErrorMessage(parseError)}`,
        500
      );
    }

    // Validate the structure
    if (!parsedResult.analyse || !parsedResult.concept_email) {
      throw new ServerError(
        ERROR_CODES.AI_RESPONSE_INVALID,
        "AI antwoord heeft niet de verwachte structuur (ontbrekende 'analyse' of 'concept_email')",
        500
      );
    }

    res.json(createApiSuccessResponse(parsedResult, "Concept antwoord succesvol gegenereerd"));
  }));

  // Dynamic PDF parser import for simple email endpoint
  let pdfParseFunc: any = null;
  async function getPdfParse() {
    if (!pdfParseFunc) {
      const module = await import('pdf-parse');
      pdfParseFunc = (module as any).PDFParse || (module as any).default || module;
    }
    return pdfParseFunc;
  }

  // Configure multer for simple email file uploads
  const simpleEmailUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
    fileFilter: (req, file, cb) => {
      const ext = file.originalname.toLowerCase().split('.').pop();
      const allowedExtensions = ['pdf', 'txt', 'jpg', 'jpeg', 'png'];
      if (allowedExtensions.includes(ext || '')) {
        cb(null, true);
      } else {
        cb(new Error(`Bestandstype niet ondersteund: ${file.mimetype}`));
      }
    }
  });

  // Simple Email Assistant - Generate AI response with attachments (no dossier/rapport needed)
  app.post("/api/assistant/simple-email",
    simpleEmailUpload.array('files', 10),
    asyncHandler(async (req: Request, res: Response) => {
      const { emailThread, systemPrompt, model } = req.body;

      // Validate inputs
      if (!emailThread || emailThread.trim().length === 0) {
        throw new ServerError(
          ERROR_CODES.VALIDATION_FAILED,
          "Email thread is verplicht",
          400
        );
      }

      const files = req.files as Express.Multer.File[] || [];
      const attachmentNames: string[] = [];
      const attachmentTexts: string[] = [];
      const visionAttachments: { mimeType: string; data: string; filename: string }[] = [];

      console.log(`📧 [SimpleEmail] Processing ${files.length} attachments`);

      // Process uploaded files
      for (const file of files) {
        attachmentNames.push(file.originalname);

        const ext = file.originalname.toLowerCase().split('.').pop();
        const isPDF = file.mimetype === 'application/pdf' ||
                      (file.mimetype === 'application/octet-stream' && ext === 'pdf');
        const isTXT = file.mimetype === 'text/plain' ||
                      (file.mimetype === 'application/octet-stream' && ext === 'txt');
        const isImage = file.mimetype.startsWith('image/') ||
                        ['jpg', 'jpeg', 'png'].includes(ext || '');

        let extractedText = "";
        let needsVision = false;

        if (isImage) {
          // Images always go to vision
          const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
          visionAttachments.push({
            mimeType,
            data: file.buffer.toString('base64'),
            filename: file.originalname
          });
          console.log(`📧 [SimpleEmail] Image added to vision: ${file.originalname}`);
        } else if (isPDF) {
          try {
            const PDFParseClass = await getPdfParse();
            const parser = new PDFParseClass({ data: file.buffer });
            const result = await parser.getText();
            const pages = Array.isArray(result.pages) ? result.pages.length :
                         (typeof result.pages === 'object' ? Object.keys(result.pages).length : 1);
            extractedText = result.text || "";

            // Detect scanned PDFs (low text content)
            const charsPerPage = extractedText.length / Math.max(pages, 1);
            if (charsPerPage < 100 && pages > 0) {
              needsVision = true;
              console.log(`📧 [SimpleEmail] Scanned PDF detected: ${file.originalname}`);
            }
          } catch (err: any) {
            console.warn(`📧 [SimpleEmail] PDF parse failed: ${file.originalname}`, err.message);
            needsVision = true;
          }

          // If scanned or parse failed, use Vision
          if (needsVision || extractedText.length < 100) {
            visionAttachments.push({
              mimeType: 'application/pdf',
              data: file.buffer.toString('base64'),
              filename: file.originalname
            });
            console.log(`📧 [SimpleEmail] Added to vision: ${file.originalname}`);
          }
        } else if (isTXT) {
          extractedText = file.buffer.toString('utf-8');
        }

        if (extractedText.trim().length > 0) {
          attachmentTexts.push(`\n=== BIJLAGE: ${file.originalname} ===\n${extractedText}`);
        }
      }

      // Build the user prompt
      const userPrompt = `## Email Thread:
${emailThread}

${attachmentNames.length > 0 ? `## Bijlages (${attachmentNames.length} documenten):
${attachmentTexts.length > 0 ? attachmentTexts.join('\n\n') : 'Documenten worden via vision geanalyseerd.'}` : '## Bijlages: Geen bijlages meegestuurd'}

Analyseer de email thread${attachmentNames.length > 0 ? ' en bijlages' : ''} en genereer een professioneel concept-antwoord als JSON.`;

      // Build full prompt for debug
      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

      console.log(`📧 [SimpleEmail] Calling AI model: ${model} with ${visionAttachments.length} vision attachments`);

      // Call AI model
      const factory = AIModelFactory.getInstance();
      const result = await factory.callModel(
        {
          provider: 'google',
          model: model || 'gemini-3-pro-preview',
          temperature: 0.3,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192,
          thinkingLevel: 'medium'
        },
        `${systemPrompt}\n\n${userPrompt}`,
        {
          jobId: `simple-email-${Date.now()}`,
          visionAttachments: visionAttachments.length > 0 ? visionAttachments : undefined
        }
      );

      console.log(`📧 [SimpleEmail] AI response received: ${result.content.length} chars`);

      // Parse JSON from response
      let parsedResult;
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

        parsedResult = JSON.parse(jsonText);
      } catch (parseError: any) {
        console.error(`📧 [SimpleEmail] JSON parse error:`, parseError.message);
        console.error(`📧 [SimpleEmail] Raw response:`, result.content.substring(0, 500));
        throw new ServerError(
          ERROR_CODES.AI_PROCESSING_FAILED,
          'Kon AI response niet parsen. Probeer opnieuw.',
          500
        );
      }

      // Validate structure
      if (!parsedResult.analyse || !parsedResult.concept_email) {
        throw new ServerError(
          ERROR_CODES.AI_RESPONSE_INVALID,
          "AI antwoord heeft niet de verwachte structuur",
          500
        );
      }

      // Add debug info to response
      parsedResult._debug = {
        promptSent: fullPrompt,
        attachmentNames,
        visionAttachmentCount: visionAttachments.length
      };

      console.log(`📧 [SimpleEmail] Sending response with _debug: ${!!parsedResult._debug}, promptLength: ${fullPrompt.length}`);

      res.json(createApiSuccessResponse(parsedResult, "Concept antwoord succesvol gegenereerd"));
    })
  );

  // Follow-up session management endpoints

  // Get all sessions
  app.get("/api/follow-up/sessions", asyncHandler(async (req: Request, res: Response) => {
    const sessions = await storage.getAllFollowUpSessions();
    res.json(createApiSuccessResponse(sessions, "Sessies succesvol opgehaald"));
  }));

  // Get single session with all threads
  app.get("/api/follow-up/sessions/:id", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const sessionWithThreads = await storage.getFollowUpSessionWithThreads(id);

    if (!sessionWithThreads) {
      throw ServerError.notFound("Follow-up session");
    }

    res.json(createApiSuccessResponse(sessionWithThreads, "Sessie succesvol opgehaald"));
  }));

  // Create new session
  app.post("/api/follow-up/sessions", asyncHandler(async (req: Request, res: Response) => {
    const validatedData = insertFollowUpSessionSchema.parse(req.body);
    const session = await storage.createFollowUpSession({
      ...validatedData,
      dossierData: validatedData.dossierData! // Zod ensures this is present
    });
    res.json(createApiSuccessResponse(session, "Sessie succesvol aangemaakt"));
  }));

  // Delete session (cascade deletes threads)
  app.delete("/api/follow-up/sessions/:id", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Check if session exists
    const session = await storage.getFollowUpSession(id);
    if (!session) {
      throw ServerError.notFound("Follow-up session");
    }

    await storage.deleteFollowUpSession(id);
    res.json(createApiSuccessResponse(null, "Sessie succesvol verwijderd"));
  }));

  // Add thread to existing session
  app.post("/api/follow-up/sessions/:id/threads", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Check if session exists
    const session = await storage.getFollowUpSession(id);
    if (!session) {
      throw ServerError.notFound("Follow-up session");
    }

    const validatedData = insertFollowUpThreadSchema.parse({
      ...req.body,
      sessionId: id,
    });

    const thread = await storage.createFollowUpThread({
      ...validatedData,
      aiAnalysis: validatedData.aiAnalysis!, // Zod ensures this is present
      conceptEmail: validatedData.conceptEmail! // Zod ensures this is present
    });
    res.json(createApiSuccessResponse(thread, "Thread succesvol toegevoegd"));
  }));

  // Text Styler - Style text using LLM and export to PDF
  app.post("/api/text-styler/process", asyncHandler(async (req: Request, res: Response) => {
    const { rawText, stylePrompt, model } = req.body;

    // Validate inputs
    if (!rawText || !stylePrompt || !model) {
      throw new ServerError(
        ERROR_CODES.VALIDATION_FAILED,
        "Ontbrekende verplichte velden: rawText, stylePrompt, en model zijn vereist",
        400
      );
    }

    // Validate input lengths
    if (rawText.length > 200000) {
      throw new ServerError(
        ERROR_CODES.VALIDATION_FAILED,
        "Ruwe tekst is te lang (max 200KB)",
        400
      );
    }

    // Call AI to style the text
    const styledText = await textStyler.styleText({
      rawText,
      stylePrompt,
      model
    });

    // Convert markdown to TipTap JSON
    const tipTapContent = textStyler.markdownToTipTap(styledText);

    res.json(createApiSuccessResponse({
      styledText,
      tipTapContent
    }, "Tekst succesvol gestyled"));
  }));

  app.post("/api/text-styler/export-pdf", asyncHandler(async (req: Request, res: Response) => {
    const { tipTapContent, title } = req.body;

    if (!tipTapContent) {
      throw new ServerError(
        ERROR_CODES.VALIDATION_FAILED,
        "Ontbrekend verplicht veld: tipTapContent",
        400
      );
    }

    // Generate PDF from TipTap content
    const pdfBuffer = await pdfGenerator.generateFromTipTap({
      content: tipTapContent,
      title: title || "Gestyled Document",
      clientName: "Document"
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${title || 'document'}.pdf"`);
    res.send(pdfBuffer);
  }));

  // Register streaming routes
  registerStreamingRoutes(app, sseHandler, sessionManager);

  // Register document management routes
  app.use("/api/documents", documentRouter);

  // Register file upload routes
  app.use("/api/upload", fileUploadRouter);

  const httpServer = createServer(app);
  return httpServer;
}
