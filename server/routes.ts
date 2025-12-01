import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { promises as fs } from "fs";
import * as path from "path";
import { storage } from "./storage";
import { ReportGenerator } from "./services/report-generator";
import { SourceValidator } from "./services/source-validator";
import { PDFGenerator } from "./services/pdf-generator";
import { TextStyler } from "./services/text-styler";
import { AIHealthService } from "./services/ai-models/health-service";
import { AIMonitoringService } from "./services/ai-models/monitoring";
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
    promptBuilder,
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
    // Log to monitoring system for visibility
    AIMonitoringService.getInstance().recordError('initial_health_check', error);
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
