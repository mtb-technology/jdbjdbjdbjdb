/**
 * Stage Execution Routes
 *
 * Handles AI stage execution, manual mode, and stage deletion.
 */

import type { Request, Response, Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import type { DossierData, BouwplanData, StageId } from "@shared/schema";
import { STAGE_ORDER } from "@shared/constants";
import { asyncHandler, ServerError, getErrorMessage } from "../../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { deduplicateRequests } from "../../middleware/deduplicate";
import { parseJsonWithMarkdown } from "./utils";
import type { ReportRouteDependencies } from "./types";

export function registerStageRoutes(
  app: Express,
  dependencies: ReportRouteDependencies
): void {
  const { reportGenerator } = dependencies;

  // ============================================================
  // PROMPT PREVIEW/GENERATION
  // ============================================================

  /**
   * Get prompt preview for a stage without executing it
   * GET /api/reports/:id/stage/:stage/preview
   */
  app.get("/api/reports/:id/stage/:stage/preview", async (req, res) => {
    try {
      const { id, stage } = req.params;
      const report = await storage.getReport(id);

      if (!report) {
        throw ServerError.notFound("Report");
      }

      const prompt = await reportGenerator.generatePromptForStage(
        stage,
        report.dossierData as DossierData,
        report.bouwplanData as BouwplanData,
        report.stageResults as Record<string, string> || {},
        report.conceptReportVersions as Record<string, string> || {},
        undefined
      );

      res.json(createApiSuccessResponse({ prompt }, "Prompt preview succesvol opgehaald"));
    } catch (error: unknown) {
      console.error("Error generating prompt preview:", error);
      res.status(500).json(createApiErrorResponse(
        'PREVIEW_GENERATION_FAILED',
        ERROR_CODES.INTERNAL_SERVER_ERROR,
        'Fout bij het genereren van prompt preview',
        getErrorMessage(error)
      ));
    }
  });

  /**
   * Generate prompt for a stage (without executing AI)
   * GET /api/reports/:id/stage/:stage/prompt
   */
  app.get("/api/reports/:id/stage/:stage/prompt", asyncHandler(async (req: Request, res: Response) => {
    const { id, stage } = req.params;

    const report = await storage.getReport(id);
    if (!report) {
      throw new Error("Rapport niet gevonden");
    }

    const prompt = await reportGenerator.generatePromptOnly(
      stage,
      report.dossierData as DossierData,
      report.bouwplanData as BouwplanData,
      report.stageResults as Record<string, string> || {},
      report.conceptReportVersions as Record<string, string> || {}
    );

    const updatedStagePrompts = {
      ...(report.stagePrompts as Record<string, string> || {}),
      [stage]: prompt
    };

    await storage.updateReport(id, {
      stagePrompts: updatedStagePrompts
    });

    res.json(createApiSuccessResponse({ prompt }, "Prompt gegenereerd"));
  }));

  // ============================================================
  // STAGE EXECUTION
  // ============================================================

  /**
   * Execute specific stage of report generation
   * POST /api/reports/:id/stage/:stage
   */
  app.post("/api/reports/:id/stage/:stage",
    deduplicateRequests({
      keyFn: (req) => `${req.params.id}-${req.params.stage}`,
      timeout: 300000
    }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id, stage } = req.params;
      const { customInput, reportDepth } = req.body;

      const report = await storage.getReport(id);
      if (!report) {
        throw new Error("Rapport niet gevonden");
      }

      // SERVER-SIDE BLOCKING: Block Stage 1a if OCR is still pending
      // This prevents race conditions where client-side blocking is bypassed
      if (stage === '1a_informatiecheck') {
        const attachments = await storage.getAttachmentsForReport(id);
        // OCR is pending if: needsVisionOCR=true AND no substantial text yet
        // This handles legacy data where OCR completed but flag wasn't updated
        const pendingOcrCount = attachments.filter(att => {
          if (att.needsVisionOCR !== true) return false;
          // Check if we have substantial text (OCR must have completed)
          const hasSubstantialText = att.extractedText &&
            att.extractedText.length > 100 &&
            !att.extractedText.startsWith('[OCR') &&
            !att.extractedText.startsWith('[Afbeelding') &&
            !att.extractedText.startsWith('[PDF');
          return !hasSubstantialText;
        }).length;
        if (pendingOcrCount > 0) {
          console.log(`[${id}] ⛔ Stage 1a blocked: ${pendingOcrCount} attachment(s) still awaiting OCR`);
          return res.status(400).json({
            success: false,
            error: {
              code: 'OCR_PENDING',
              message: `Stage 1a kan niet starten: ${pendingOcrCount} bijlage(n) wacht(en) nog op OCR verwerking. Wacht tot de OCR klaar is.`
            }
          });
        }
      }

      // For Stage 1a: Include attachment extracted text AND vision attachments
      let dossierWithAttachments = report.dossierData as DossierData;
      let visionAttachments: Array<{ mimeType: string; data: string; filename: string }> = [];

      if (stage === '1a_informatiecheck') {
        const attachments = await storage.getAttachmentsForReport(id);
        if (attachments.length > 0) {
          const textAttachments = attachments.filter(att => att.extractedText && !att.needsVisionOCR);
          const visionNeededAttachments = attachments.filter(att => att.needsVisionOCR);

          if (textAttachments.length > 0) {
            const attachmentTexts = textAttachments
              .map(att => `\n\n=== BIJLAGE: ${att.filename} ===\n${att.extractedText}`)
              .join('');

            const existingRawText = (dossierWithAttachments as any).rawText || '';
            dossierWithAttachments = {
              ...dossierWithAttachments,
              rawText: existingRawText + attachmentTexts
            };
            console.log(`[${id}] Stage 1a: Added ${textAttachments.length} text attachment(s) to dossier`);
          }

          if (visionNeededAttachments.length > 0) {
            visionAttachments = visionNeededAttachments.map(att => ({
              mimeType: att.mimeType,
              data: att.fileData,
              filename: att.filename
            }));
            console.log(`[${id}] Stage 1a: Sending ${visionNeededAttachments.length} scanned PDF(s) to Gemini Vision for OCR`);
          }

          for (const att of attachments) {
            await storage.updateAttachmentUsage(att.id, stage);
          }
        }
      }

      // Execute the stage
      let stageExecution;
      try {
        stageExecution = await reportGenerator.executeStage(
          stage,
          dossierWithAttachments,
          report.bouwplanData as BouwplanData,
          report.stageResults as Record<string, string> || {},
          report.conceptReportVersions as Record<string, string> || {},
          customInput,
          id,
          undefined,
          visionAttachments.length > 0 ? visionAttachments : undefined,
          reportDepth
        );
      } catch (stageError: unknown) {
        console.error(`Stage execution failed but recovering gracefully:`, getErrorMessage(stageError));
        res.status(500).json(createApiErrorResponse(
          'ServerError',
          ERROR_CODES.AI_PROCESSING_FAILED,
          `Stage ${stage} kon niet volledig worden uitgevoerd`,
          getErrorMessage(stageError),
          { stage, reportId: id, originalError: getErrorMessage(stageError) }
        ));
        return;
      }

      // Update report with stage output
      const currentStageResults = report.stageResults as Record<string, string> || {};
      const updatedStageResults = {
        ...currentStageResults,
        [stage]: stageExecution.stageOutput
      };

      const updatedConceptVersions = stageExecution.conceptReport
        ? {
            ...(report.conceptReportVersions as Record<string, string> || {}),
            [stage]: stageExecution.conceptReport
          }
        : report.conceptReportVersions;

      const updatedStagePrompts = {
        ...(report.stagePrompts as Record<string, string> || {}),
        [stage]: stageExecution.prompt
      };

      let updateData: any = {
        stageResults: updatedStageResults,
        conceptReportVersions: updatedConceptVersions,
        stagePrompts: updatedStagePrompts,
        currentStage: stage,
      };

      // Stage 3: make first report version visible
      if (stage === '3_generatie' && stageExecution.conceptReport) {
        updateData.generatedContent = stageExecution.conceptReport;
        updateData.status = 'generated';
      }

      // Stage 1a: Update dossierData with extracted info
      if (stage === '1a_informatiecheck' && stageExecution.stageOutput) {
        try {
          const parsed = parseJsonWithMarkdown(stageExecution.stageOutput);
          if (parsed.dossier) {
            const currentDossier = (report.dossierData as Record<string, any>) || {};

            if (parsed.status === 'COMPLEET') {
              console.log(`[${id}] Stage 1a COMPLEET - updating dossierData with complete structured data`);
              updateData.dossierData = {
                klant: {
                  naam: report.clientName,
                  situatie: parsed.dossier.samenvatting_onderwerp || ''
                },
                gestructureerde_data: parsed.dossier.gestructureerde_data,
                samenvatting_onderwerp: parsed.dossier.samenvatting_onderwerp
              };
            } else if (parsed.status === 'INCOMPLEET') {
              console.log(`[${id}] Stage 1a INCOMPLEET - accumulating partial dossierData for next re-run`);
              updateData.dossierData = {
                ...currentDossier,
                klant: {
                  naam: report.clientName,
                  situatie: parsed.dossier.samenvatting_onderwerp || currentDossier.klant?.situatie || ''
                },
                gestructureerde_data: {
                  ...(currentDossier.gestructureerde_data || {}),
                  ...(parsed.dossier.gestructureerde_data || {})
                },
                samenvatting_onderwerp: parsed.dossier.samenvatting_onderwerp || currentDossier.samenvatting_onderwerp,
                ontbrekende_informatie: parsed.ontbrekende_informatie || parsed.dossier.ontbrekende_informatie
              };
            }
          }
        } catch (parseError) {
          console.warn(`[${id}] Could not parse Stage 1a output for dossierData update:`, parseError);
        }
      }

      // Stage 2: Update dossierData with corrected data
      if (stage === '2_complexiteitscheck' && stageExecution.stageOutput) {
        try {
          const parsed = parseJsonWithMarkdown(stageExecution.stageOutput);
          if (parsed.next_action === 'PROCEED_TO_GENERATION' && parsed.origineel_dossier) {
            console.log(`[${id}] Stage 2 COMPLEET - updating dossierData with corrected data from origineel_dossier`);
            const currentDossier = (report.dossierData as Record<string, any>) || {};
            updateData.dossierData = {
              ...currentDossier,
              klant: {
                naam: report.clientName,
                situatie: parsed.origineel_dossier.samenvatting_onderwerp || parsed.samenvatting_onderwerp || ''
              },
              gestructureerde_data: parsed.origineel_dossier.gestructureerde_data || parsed.origineel_dossier.relevante_data,
              samenvatting_onderwerp: parsed.origineel_dossier.samenvatting_onderwerp || parsed.samenvatting_onderwerp
            };
          }
        } catch (parseError) {
          console.warn(`[${id}] Could not parse Stage 2 output for dossierData update:`, parseError);
        }
      }

      // Review stages (4a-4g): Just store raw feedback
      if (stage.startsWith('4')) {
        console.log(`[${id}-${stage}] Review stage completed - storing raw feedback for user review (NO auto-processing)`);
      }

      const updatedReport = await storage.updateReport(id, updateData);

      const result = {
        report: updatedReport,
        stageResult: stageExecution.stageOutput,
        conceptReport: stageExecution.conceptReport,
        prompt: stageExecution.prompt,
      };

      res.json(createApiSuccessResponse(result, "Stage succesvol uitgevoerd"));
    })
  );

  // ============================================================
  // MANUAL MODE
  // ============================================================

  /**
   * Process manual stage content for any stage
   * POST /api/reports/:id/manual-stage
   */
  app.post("/api/reports/:id/manual-stage", async (req, res) => {
    try {
      const { id } = req.params;

      const manualStageSchema = z.object({
        stage: z.string().min(1, "Stage mag niet leeg zijn"),
        content: z.string().min(1, "Content mag niet leeg zijn"),
        isManual: z.boolean().optional()
      });

      const validatedData = manualStageSchema.parse(req.body);
      const { stage, content } = validatedData;

      const report = await storage.getReport(id);
      if (!report) {
        throw ServerError.notFound("Report");
      }

      const currentStageResults = (report.stageResults as Record<string, string>) || {};
      const currentConceptVersions = (report.conceptReportVersions as Record<string, string>) || {};

      currentStageResults[stage] = content;

      if (["3_generatie"].includes(stage)) {
        const versionKey = `${stage}_${new Date().toISOString()}`;
        currentConceptVersions[versionKey] = content;
        currentConceptVersions[stage] = content;
      }

      const updatedReport = await storage.updateReport(id, {
        stageResults: currentStageResults,
        conceptReportVersions: currentConceptVersions,
      });

      res.json(createApiSuccessResponse({
        report: updatedReport,
        stageResult: content,
        conceptReport: ["3_generatie"].includes(stage) ? content : undefined,
        isManual: true
      }, "Handmatige content succesvol verwerkt"));

    } catch (error) {
      console.error("Error processing manual stage:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json(createApiErrorResponse(
          'VALIDATION_ERROR',
          ERROR_CODES.VALIDATION_FAILED,
          'Validatiefout in invoergegevens',
          JSON.stringify(error.errors)
        ));
      } else if (error instanceof ServerError) {
        throw error;
      } else {
        res.status(500).json(createApiErrorResponse(
          'PROCESSING_FAILED',
          ERROR_CODES.INTERNAL_SERVER_ERROR,
          'Fout bij verwerken van handmatige content',
          error instanceof Error ? error.message : 'Unknown error'
        ));
      }
    }
  });

  // ============================================================
  // STAGE DELETION
  // ============================================================

  /**
   * Delete/clear a specific stage result to allow re-running
   * DELETE /api/reports/:id/stage/:stage
   */
  app.delete("/api/reports/:id/stage/:stage", asyncHandler(async (req: Request, res: Response) => {
    const { id, stage } = req.params;

    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    const deletedStageIndex = STAGE_ORDER.indexOf(stage as typeof STAGE_ORDER[number]);

    // Remove the stage from stageResults
    const currentStageResults = (report.stageResults as Record<string, string>) || {};
    delete currentStageResults[stage];

    // Cascade delete: remove all stages that come after this one
    if (deletedStageIndex >= 0) {
      for (let i = deletedStageIndex + 1; i < STAGE_ORDER.length; i++) {
        const laterStage = STAGE_ORDER[i];
        delete currentStageResults[laterStage];
      }
    }

    // Also remove from conceptReportVersions
    const currentConceptVersions = (report.conceptReportVersions as Record<string, any>) || {};

    delete currentConceptVersions[stage];

    if (deletedStageIndex >= 0) {
      for (let i = deletedStageIndex + 1; i < STAGE_ORDER.length; i++) {
        const laterStage = STAGE_ORDER[i];
        delete currentConceptVersions[laterStage];
      }
    }

    // Also remove from history array
    if (currentConceptVersions.history && Array.isArray(currentConceptVersions.history)) {
      currentConceptVersions.history = currentConceptVersions.history.filter((entry: any) => {
        if (entry.stageId === stage) return false;
        if (deletedStageIndex >= 0) {
          const entryStageIndex = STAGE_ORDER.indexOf(entry.stageId);
          if (entryStageIndex > deletedStageIndex) return false;
        }
        return true;
      });
    }

    // Update or remove the 'latest' pointer
    let newLatestStage: string | null = null;
    let newLatestVersion: number = 1;

    if (currentConceptVersions.history && Array.isArray(currentConceptVersions.history) && currentConceptVersions.history.length > 0) {
      const sortedHistory = [...currentConceptVersions.history].sort((a: any, b: any) => {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      if (sortedHistory.length > 0) {
        newLatestStage = sortedHistory[0].stageId;
        newLatestVersion = sortedHistory[0].v || 1;
      }
    } else {
      for (let i = deletedStageIndex - 1; i >= 0; i--) {
        const earlierStage = STAGE_ORDER[i];
        if (currentConceptVersions[earlierStage]) {
          newLatestStage = earlierStage;
          newLatestVersion = currentConceptVersions[earlierStage].v || 1;
          break;
        }
      }
    }

    if (newLatestStage) {
      currentConceptVersions.latest = {
        pointer: newLatestStage as StageId,
        v: newLatestVersion
      };
    } else {
      delete currentConceptVersions.latest;
    }

    const updatedReport = await storage.updateReport(id, {
      stageResults: currentStageResults,
      conceptReportVersions: currentConceptVersions,
    });

    if (!updatedReport) {
      throw ServerError.notFound("Updated report not found");
    }

    console.log(`Deleted stage ${stage} and all subsequent stages for report ${id}`);

    res.json(createApiSuccessResponse({
      report: updatedReport,
      clearedStage: stage,
      cascadeDeleted: deletedStageIndex >= 0 ? STAGE_ORDER.slice(deletedStageIndex + 1) : []
    }, `Stage ${stage} en alle volgende stages zijn verwijderd - workflow kan opnieuw vanaf hier worden uitgevoerd`));
  }));

  // ============================================================
  // DOSSIER CONTEXT
  // ============================================================

  /**
   * Generate or regenerate dossier context summary
   * POST /api/reports/:id/dossier-context
   */
  app.post("/api/reports/:id/dossier-context", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { customPrompt } = req.body;

    console.log(`[${id}] Generating dossier context summary`);

    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    const rawText = (report.dossierData as any)?.rawText || "";
    const stage1Output = (report.stageResults as any)?.["1a_informatiecheck"] || "";

    // Fallback: use stage1Output if rawText is missing
    if (!rawText && !stage1Output) {
      return res.json({
        summary: "Geen brondata beschikbaar voor dit rapport. Voer eerst Stap 1 uit.",
        generated: false
      });
    }

    let promptTemplate = customPrompt || `Je bent een fiscaal assistent. Maak een compacte samenvatting van deze casus voor snelle referentie.

Geef alleen de essentie:
- Klant naam/type
- Kern van de vraag (1 zin)
- Belangrijkste bedragen/feiten
- Status (COMPLEET of INCOMPLEET + wat ontbreekt)

Gebruik bullet points. Max 150 woorden.

{stage1Output}{rawTextSection}`;

    const stage1Section = stage1Output ? `STAP 1 ANALYSE:\n${stage1Output}\n\n` : '';
    const rawTextSection = rawText ? `RAW INPUT:\n${rawText}` : '';
    const finalPrompt = promptTemplate
      .replace('{stage1Output}', stage1Section)
      .replace('{rawTextSection}', rawTextSection);

    let summary;
    try {
      summary = await reportGenerator.generateWithCustomPrompt({
        systemPrompt: "Je bent een fiscaal assistent die compacte samenvattingen maakt van klantcases.",
        userPrompt: finalPrompt,
        model: "gemini-3-pro-preview",
        customConfig: {
          provider: "google",
          temperature: 1.0,
          maxOutputTokens: 8192,
          thinkingLevel: "low"
        },
        operationId: "dossier-context"
      });
    } catch (error: any) {
      console.error(`[${id}] Dossier context generation failed:`, {
        error: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details
      });
      throw error;
    }

    await storage.updateReport(id, {
      dossierContextSummary: summary,
      updatedAt: new Date()
    });

    console.log(`[${id}] Dossier context generated (${summary.length} chars)`);

    res.json(createApiSuccessResponse({
      summary,
      reportId: id
    }));
  }));
}
