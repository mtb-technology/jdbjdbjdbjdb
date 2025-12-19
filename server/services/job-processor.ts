/**
 * Job Processor Service
 *
 * Background worker that processes jobs from the database queue.
 * Handles both single stage executions and Express Mode (multi-stage).
 *
 * Jobs survive browser disconnects and server restarts.
 */

import { storage } from "../storage";
import { ReportGenerator } from "./report-generator";
import { ReportProcessor } from "./report-processor";
import { PromptBuilder } from "./prompt-builder";
import { getLatestConceptText } from "@shared/constants";
import { summarizeFeedback } from "../utils/feedback-summarizer";
import { notifyStageComplete, notifyExpressModeComplete, notifyJobFailed, isSlackEnabled } from "./slack-notifier";
import { logger } from "./logger";
import { Box3ExtractionPipeline, type PipelineDocument } from "./box3-extraction-pipeline";
import { getPdfParse } from "./pdf-text-extractor";
import type { Job, DossierData, BouwplanData, StageId, PromptConfig, Box3DocumentClassification } from "@shared/schema";
import type {
  ConceptReportVersions,
  StageResults,
  DossierDataExtended,
  PromptConfigData,
} from "@shared/types/report-data";

// Job types
export type JobType = "single_stage" | "express_mode" | "generation" | "box3_validation" | "box3_revalidation";

// Progress structure stored in jobs.progress JSON
export interface JobProgress {
  currentStage: string;
  percentage: number;
  message: string;
  stages: Array<{
    stageId: string;
    status: "pending" | "processing" | "completed" | "failed";
    percentage: number;
    changesCount?: number;
    error?: string;
  }>;
}

// Job configuration stored in jobs.result when job is created (input params)
export interface SingleStageJobConfig {
  stageId: string;
  customInput?: string;
  reportDepth?: "quick" | "balanced" | "comprehensive";
  reportLanguage?: "nl" | "en";
}

export interface ExpressModeJobConfig {
  includeGeneration: boolean;
  autoAccept: boolean;
  stages?: string[];
  reportDepth?: "concise" | "balanced" | "comprehensive";
  reportLanguage?: "nl" | "en";
}

// Box3 revalidation job config (dossierId stored in reportId field)
export interface Box3RevalidationJobConfig {
  // No additional config needed - dossier ID is in reportId
}

class JobProcessor {
  private isRunning = false;
  private pollInterval = 3000; // 3 seconds
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reportGenerator: ReportGenerator;
  private reportProcessor: ReportProcessor;

  constructor() {
    this.reportGenerator = new ReportGenerator();

    // Create AI handler for ReportProcessor using same approach as routes.ts
    const aiHandler = {
      generateContent: async (params: { prompt: string; temperature: number; topP: number; maxOutputTokens: number }) => {
        const result = await this.reportGenerator.testAI(params.prompt, {
          temperature: params.temperature,
          topP: params.topP,
          maxOutputTokens: params.maxOutputTokens
        });
        return { content: result };
      }
    };
    this.reportProcessor = new ReportProcessor(aiHandler);
  }

  /**
   * Start the job processor polling loop
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('job-processor', 'Already running');
      return;
    }

    this.isRunning = true;
    logger.info('job-processor', `Started - polling for jobs every ${this.pollInterval}ms`);

    this.pollTimer = setInterval(() => this.pollForJobs(), this.pollInterval);

    // Also poll immediately on start
    this.pollForJobs();
  }

  /**
   * Stop the job processor
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('job-processor', 'Stopped');
  }

  /**
   * Poll for queued jobs and process them
   */
  private async pollForJobs(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Get all queued jobs
      const queuedJobs = await storage.getJobsByStatus("queued");

      if (queuedJobs.length > 0) {
        logger.info('job-processor', `Found ${queuedJobs.length} queued job(s)`);
      }

      // Process jobs one at a time (sequential for now)
      for (const job of queuedJobs) {
        await this.processJob(job);
      }
    } catch (error) {
      logger.error('job-processor', 'Error polling for jobs', {}, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Check if a job has been cancelled
   */
  private async isJobCancelled(jobId: string): Promise<boolean> {
    const job = await storage.getJob(jobId);
    return job?.status === "failed" && (job?.error?.includes("cancelled") ?? false);
  }

  /**
   * Process a single job
   */
  private async processJob(job: Job): Promise<void> {
    const startTime = Date.now();
    logger.info(job.id, `Processing job (type: ${job.type})`);

    try {
      // Check if already cancelled before starting
      if (await this.isJobCancelled(job.id)) {
        logger.info(job.id, 'Job was cancelled before processing');
        return;
      }

      // Mark job as processing
      await storage.startJob(job.id);

      // Get the job config from result field (stored at creation time)
      const config = (job.result ?? {}) as SingleStageJobConfig | ExpressModeJobConfig;

      switch (job.type) {
        case "single_stage":
          await this.processSingleStage(job, config as SingleStageJobConfig);
          break;
        case "express_mode":
          await this.processExpressMode(job, config as ExpressModeJobConfig);
          break;
        case "box3_validation":
        case "box3_revalidation":
          // Both use the same processing logic - extract from documents and create blueprint
          await this.processBox3Revalidation(job);
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      const duration = Date.now() - startTime;
      logger.info(job.id, `Job completed in ${duration}ms`);

    } catch (error: any) {
      logger.error(job.id, 'Job failed', {}, error instanceof Error ? error : undefined);
      await storage.failJob(job.id, error.message || "Unknown error");
    }
  }

  /**
   * Process a single stage job
   */
  private async processSingleStage(job: Job, config: SingleStageJobConfig): Promise<void> {
    const { stageId, customInput, reportDepth, reportLanguage: configLanguage } = config;
    const reportId = job.reportId!;

    // Update progress
    await this.updateProgress(job.id, {
      currentStage: stageId,
      percentage: 0,
      message: `Starting ${stageId}...`,
      stages: [{ stageId, status: "processing", percentage: 0 }]
    });

    // Get report
    const report = await storage.getReport(reportId);
    if (!report) {
      throw new Error("Report not found");
    }

    // Use config language OR fall back to persisted language from Stage 3
    const reportLanguage = configLanguage || (report.reportLanguage as "nl" | "en") || "nl";

    // Update progress
    await this.updateProgress(job.id, {
      currentStage: stageId,
      percentage: 25,
      message: `Executing ${stageId}...`,
      stages: [{ stageId, status: "processing", percentage: 25 }]
    });

    // Handle attachments for Stage 1a
    let dossierWithAttachments = report.dossierData as DossierDataExtended;
    let visionAttachments: Array<{ mimeType: string; data: string; filename: string }> = [];

    if (stageId === "1a_informatiecheck") {
      const attachments = await storage.getAttachmentsForReport(reportId);
      if (attachments.length > 0) {
        const textAttachments = attachments.filter(att => att.extractedText && !att.needsVisionOCR);
        const visionNeededAttachments = attachments.filter(att => att.needsVisionOCR);

        if (textAttachments.length > 0) {
          const attachmentTexts = textAttachments
            .map(att => `\n\n=== BIJLAGE: ${att.filename} ===\n${att.extractedText}`)
            .join("");

          const existingRawText = dossierWithAttachments.rawText ?? "";
          dossierWithAttachments = {
            ...dossierWithAttachments,
            rawText: existingRawText + attachmentTexts
          };
        }

        if (visionNeededAttachments.length > 0) {
          visionAttachments = visionNeededAttachments.map(att => ({
            mimeType: att.mimeType,
            data: att.fileData,
            filename: att.filename
          }));
        }

        for (const att of attachments) {
          await storage.updateAttachmentUsage(att.id, stageId);
        }
      }
    }

    // Execute stage
    const result = await this.reportGenerator.executeStage(
      stageId,
      dossierWithAttachments as DossierData,
      report.bouwplanData as BouwplanData,
      (report.stageResults as StageResults) ?? {},
      (report.conceptReportVersions as ConceptReportVersions) ?? {},
      customInput,
      reportId,
      undefined, // onProgress callback
      visionAttachments.length > 0 ? visionAttachments : undefined,
      reportDepth === "quick" ? "concise" : reportDepth, // Map quick -> concise for backward compat
      undefined, // signal
      reportLanguage
    );

    // Update progress
    await this.updateProgress(job.id, {
      currentStage: stageId,
      percentage: 75,
      message: `Saving results...`,
      stages: [{ stageId, status: "processing", percentage: 75 }]
    });

    // Update stage results
    const existingStageResults = (report.stageResults as StageResults) ?? {};
    const updatedStageResults: StageResults = {
      ...existingStageResults,
      [stageId]: result.stageOutput
    };

    const existingPrompts = (report.stagePrompts as Record<string, string>) ?? {};
    await storage.updateReport(reportId, {
      stageResults: updatedStageResults,
      stagePrompts: {
        ...existingPrompts,
        [stageId]: result.prompt
      }
    });

    // Handle concept report for stage 3
    if (stageId === "3_generatie") {
      const timestamp = new Date().toISOString();
      const initialConceptVersions: ConceptReportVersions = {
        "3_generatie": {
          v: 1,
          content: result.stageOutput,
          createdAt: timestamp
        },
        latest: {
          pointer: "3_generatie",
          v: 1,
          content: result.stageOutput,
          createdAt: timestamp
        }
      };

      await storage.updateReport(reportId, {
        conceptReportVersions: initialConceptVersions
      });
    }

    // Complete the job
    await storage.completeJob(job.id, {
      stageId,
      stageOutput: result.stageOutput,
      prompt: result.prompt
    });

    // Update final progress
    await this.updateProgress(job.id, {
      currentStage: stageId,
      percentage: 100,
      message: `${stageId} completed`,
      stages: [{ stageId, status: "completed", percentage: 100 }]
    });
  }

  /**
   * Process Express Mode job (multiple stages)
   */
  private async processExpressMode(job: Job, config: ExpressModeJobConfig): Promise<void> {
    const reportId = job.reportId!;
    const { includeGeneration, autoAccept, reportDepth, reportLanguage: configLanguage } = config;

    // Get report
    let report = await storage.getReport(reportId);
    if (!report) {
      throw new Error("Report not found");
    }

    // Use config language OR fall back to persisted language from Stage 3
    const reportLanguage = configLanguage || (report.reportLanguage as "nl" | "en") || "nl";

    logger.info(job.id, 'Express Mode config', { includeGeneration, autoAccept, reportDepth, reportLanguage });

    // Build stages list
    let stages: string[] = [];
    if (includeGeneration) {
      stages.push("3_generatie");
    }

    const reviewStages = config.stages || [
      "4a_BronnenSpecialist",
      "4b_FiscaalTechnischSpecialist",
      "4c_ScenarioGatenAnalist",
      "4e_DeAdvocaat",
      "4f_HoofdCommunicatie"
    ];
    stages = stages.concat(reviewStages);

    // Initialize progress
    const initialProgress: JobProgress = {
      currentStage: stages[0],
      percentage: 0,
      message: "Starting Express Mode...",
      stages: stages.map(s => ({ stageId: s, status: "pending", percentage: 0 }))
    };
    await this.updateProgress(job.id, initialProgress);

    // Track stage summaries for final result
    const stageSummaries: Array<{
      stageId: string;
      stageName: string;
      changesCount: number;
      changes: Array<{ type: string; description: string; severity: string; section?: string }>;
      processingTimeMs?: number;
    }> = [];

    // Process each stage
    for (let i = 0; i < stages.length; i++) {
      // Check if job was cancelled
      if (await this.isJobCancelled(job.id)) {
        logger.info(job.id, `Job cancelled at stage ${i + 1}/${stages.length}`);
        return;
      }

      const stageId = stages[i];
      const stageStartTime = Date.now();

      // Update progress
      await this.updateProgress(job.id, {
        currentStage: stageId,
        percentage: Math.round((i / stages.length) * 100),
        message: `Processing ${stageId}...`,
        stages: stages.map((s, idx) => ({
          stageId: s,
          status: idx < i ? "completed" : idx === i ? "processing" : "pending",
          percentage: idx < i ? 100 : idx === i ? 25 : 0
        }))
      });

      try {
        const isGenerationStage = stageId === "3_generatie";
        const dossierData = report.dossierData as DossierData;
        const bouwplanData = report.bouwplanData as BouwplanData;
        const currentStageResults = (report.stageResults as StageResults) ?? {};
        const currentConceptVersions = (report.conceptReportVersions as ConceptReportVersions) ?? {};

        if (isGenerationStage) {
          // Stage 3: Generate concept report
          logger.info(job.id, 'Calling executeStage for 3_generatie', { reportDepth, reportLanguage });
          const stageExecution = await this.reportGenerator.executeStage(
            stageId,
            dossierData,
            bouwplanData,
            currentStageResults,
            currentConceptVersions,
            undefined, // customInput
            reportId,
            undefined, // onProgress
            undefined, // visionAttachments
            reportDepth, // reportDepth
            undefined, // signal
            reportLanguage
          );

          // Check if cancelled during AI execution
          if (await this.isJobCancelled(job.id)) {
            logger.info(job.id, 'Job cancelled during generation');
            return;
          }

          // Update stageResults
          const updatedStageResults: StageResults = {
            ...currentStageResults,
            [stageId]: stageExecution.stageOutput
          };

          // Store as first concept version
          const timestamp = new Date().toISOString();
          const newConceptVersions: ConceptReportVersions = {
            ...currentConceptVersions,
            "3_generatie": {
              content: stageExecution.stageOutput,
              v: 1,
              timestamp,
              source: "express_mode_generation"
            },
            latest: {
              pointer: "3_generatie",
              v: 1
            },
            history: [
              ...(currentConceptVersions.history ?? []),
              { stageId: "3_generatie", v: 1, timestamp }
            ]
          };

          await storage.updateReport(reportId, {
            stageResults: updatedStageResults,
            conceptReportVersions: newConceptVersions,
            generatedContent: stageExecution.stageOutput,
            currentStage: stageId as StageId,
            // Persist language for subsequent review stages
            reportLanguage: reportLanguage
          });
          logger.info(job.id, `Stage 3: Persisting report language: ${reportLanguage}`);

          report = await storage.getReport(reportId) || report;

        } else {
          // Reviewer stages (4a-4f): Generate feedback then process it
          const stageExecution = await this.reportGenerator.executeStage(
            stageId,
            dossierData,
            bouwplanData,
            currentStageResults,
            currentConceptVersions,
            undefined, // customInput
            reportId,
            undefined, // onProgress
            undefined, // visionAttachments
            reportDepth, // reportDepth (mainly used by stage 3, but pass through for consistency)
            undefined, // signal
            reportLanguage
          );

          // Check if cancelled during AI execution
          if (await this.isJobCancelled(job.id)) {
            logger.info(job.id, 'Job cancelled during feedback generation');
            return;
          }

          // Update stageResults with feedback
          const updatedStageResults: StageResults = {
            ...currentStageResults,
            [stageId]: stageExecution.stageOutput
          };

          await storage.updateReport(reportId, {
            stageResults: updatedStageResults,
            currentStage: stageId as StageId
          });

          // Update progress
          await this.updateProgress(job.id, {
            currentStage: stageId,
            percentage: Math.round(((i + 0.5) / stages.length) * 100),
            message: `Processing feedback for ${stageId}...`,
            stages: stages.map((s, idx) => ({
              stageId: s,
              status: idx < i ? "completed" : idx === i ? "processing" : "pending",
              percentage: idx < i ? 100 : idx === i ? 75 : 0
            }))
          });

          // Auto-accept and process feedback
          if (autoAccept) {
            let feedbackJSON: unknown;
            try {
              feedbackJSON = JSON.parse(stageExecution.stageOutput);
            } catch {
              feedbackJSON = stageExecution.stageOutput;
            }

            const conceptVersions = (report.conceptReportVersions as ConceptReportVersions) ?? {};
            let latestConceptText = getLatestConceptText(conceptVersions);
            if (!latestConceptText && report.generatedContent) {
              latestConceptText = String(report.generatedContent);
            }

            if (!latestConceptText) {
              throw new Error("No concept report found to process feedback");
            }

            // Get Editor prompt
            const activeConfig = await storage.getActivePromptConfig();
            if (!activeConfig || !activeConfig.config) {
              throw new Error("No active Editor prompt configuration found");
            }

            const parsedConfig = activeConfig.config as PromptConfigData;
            const editorPromptConfig = parsedConfig.editor ?? parsedConfig["5_feedback_verwerker"];

            if (!editorPromptConfig) {
              throw new Error("No Editor prompt configuration found in active config");
            }

            // Build Editor prompt
            const promptBuilder = new PromptBuilder();
            const { systemPrompt, userInput } = promptBuilder.build(
              "editor",
              editorPromptConfig as Parameters<typeof promptBuilder.build>[1],
              () => ({
                BASISTEKST: latestConceptText,
                WIJZIGINGEN_JSON: feedbackJSON
              })
            );

            const combinedPrompt = `${systemPrompt}\n\n### USER INPUT:\n${userInput}`;

            // Process with Editor prompt
            await this.reportProcessor.processStageWithPrompt(
              reportId,
              stageId as StageId,
              combinedPrompt,
              feedbackJSON
            );

            // Check if cancelled during editor processing
            if (await this.isJobCancelled(job.id)) {
              logger.info(job.id, 'Job cancelled during editor processing');
              return;
            }

            // Refresh report
            report = await storage.getReport(reportId) || report;

            // Summarize feedback
            const stageSummary = summarizeFeedback(
              stageId,
              stageExecution.stageOutput,
              Date.now() - stageStartTime
            );
            stageSummaries.push(stageSummary);
          }
        }

        // Update stage as completed
        const stageDuration = Date.now() - stageStartTime;
        await this.updateProgress(job.id, {
          currentStage: stageId,
          percentage: Math.round(((i + 1) / stages.length) * 100),
          message: `${stageId} completed`,
          stages: stages.map((s, idx) => ({
            stageId: s,
            status: idx <= i ? "completed" : "pending",
            percentage: idx <= i ? 100 : 0,
            changesCount: stageSummaries.find(ss => ss.stageId === s)?.changesCount
          }))
        });

        // Send Slack notification for stage completion
        if (isSlackEnabled()) {
          const stageSummary = stageSummaries.find(ss => ss.stageId === stageId);
          await notifyStageComplete(
            {
              id: reportId,
              dossierNumber: report.dossierNumber,
              clientName: report.clientName || "Onbekend",
            },
            {
              stageId,
              stageName: stageSummary?.stageName || stageId,
              changesCount: stageSummary?.changesCount,
              durationMs: stageDuration,
            }
          );
        }

      } catch (stageError: any) {
        logger.error(job.id, `Express Mode failed at ${stageId}`, {}, stageError instanceof Error ? stageError : undefined);

        // Update progress with error
        await this.updateProgress(job.id, {
          currentStage: stageId,
          percentage: Math.round((i / stages.length) * 100),
          message: `Error at ${stageId}: ${stageError.message}`,
          stages: stages.map((s, idx) => ({
            stageId: s,
            status: idx < i ? "completed" : idx === i ? "failed" : "pending",
            percentage: idx < i ? 100 : 0,
            error: idx === i ? stageError.message : undefined
          }))
        });

        // Send Slack notification for failure
        if (isSlackEnabled()) {
          await notifyJobFailed(
            {
              id: reportId,
              dossierNumber: report.dossierNumber,
              clientName: report.clientName || "Onbekend",
            },
            stageId,
            stageError.message || "Unknown error"
          );
        }

        throw stageError;
      }
    }

    // Get final report state
    const finalReport = await storage.getReport(reportId);
    const finalConceptVersions = (finalReport?.conceptReportVersions as ConceptReportVersions) ?? {};
    const latestPointer = finalConceptVersions.latest?.pointer;
    const finalVersion = finalConceptVersions.latest?.v ?? 1;
    const finalContent = latestPointer && finalConceptVersions[latestPointer as keyof ConceptReportVersions]
      ? ((finalConceptVersions[latestPointer as keyof ConceptReportVersions] as { content?: string })?.content ?? String(finalReport?.generatedContent ?? ""))
      : String(finalReport?.generatedContent ?? "");

    // Calculate totals
    const totalChanges = stageSummaries.reduce((sum, s) => sum + s.changesCount, 0);

    // Generate Fiscale Briefing (Stage 7) - executive summary for fiscalist
    let fiscaleBriefing: string | null = null;
    try {
      await this.updateProgress(job.id, {
        currentStage: "7_fiscale_briefing",
        percentage: 95,
        message: "Generating Fiscale Briefing...",
        stages: [
          ...stages.map(s => ({
            stageId: s,
            status: "completed" as const,
            percentage: 100,
            changesCount: stageSummaries.find(ss => ss.stageId === s)?.changesCount
          })),
          { stageId: "7_fiscale_briefing", status: "processing" as const, percentage: 50 }
        ]
      });

      const finalStageResults = (finalReport?.stageResults as StageResults) ?? {};
      const briefingResult = await this.reportGenerator.generateFiscaleBriefing({
        dossier: finalReport?.dossierData as DossierData,
        bouwplan: finalReport?.bouwplanData as BouwplanData,
        conceptReport: finalContent,
        stageResults: finalStageResults,
        jobId: job.id
      });

      fiscaleBriefing = briefingResult.briefing;

      // Save briefing to stageResults
      const updatedStageResults: StageResults = {
        ...finalStageResults,
        "7_fiscale_briefing": fiscaleBriefing
      };
      await storage.updateReport(reportId, { stageResults: updatedStageResults });

      logger.info(job.id, 'Fiscale Briefing generated');
    } catch (briefingError: any) {
      logger.warn(job.id, 'Failed to generate Fiscale Briefing', { message: briefingError.message });
      // Non-fatal - continue without briefing
    }

    // Complete the job with results
    await storage.completeJob(job.id, {
      stages: stageSummaries,
      totalChanges,
      finalVersion,
      finalContent,
      fiscaleBriefing // Include briefing in result
    });

    // Update final progress
    await this.updateProgress(job.id, {
      currentStage: "complete",
      percentage: 100,
      message: `Express Mode completed - ${totalChanges} changes across ${stages.length} stages`,
      stages: stages.map(s => ({
        stageId: s,
        status: "completed",
        percentage: 100,
        changesCount: stageSummaries.find(ss => ss.stageId === s)?.changesCount
      }))
    });

    // Send Slack notification for Express Mode completion
    if (isSlackEnabled()) {
      const jobDuration = Date.now() - (job.startedAt?.getTime() || Date.now());
      await notifyExpressModeComplete(
        {
          id: reportId,
          dossierNumber: finalReport?.dossierNumber || 0,
          clientName: finalReport?.clientName || "Onbekend",
        },
        stageSummaries.map(s => ({
          stageId: s.stageId,
          stageName: s.stageName,
          changesCount: s.changesCount,
          durationMs: s.processingTimeMs || 0,
        })),
        totalChanges,
        jobDuration
      );
    }
  }

  /**
   * Process Box3 Revalidation job
   * Extracts data from documents and creates a new blueprint version.
   */
  private async processBox3Revalidation(job: Job): Promise<void> {
    // For Box3 jobs, use the dedicated box3DossierId field
    const dossierId = job.box3DossierId!;

    // Update progress - starting
    await this.updateBox3Progress(job.id, 0, 5, 'Dossier laden...', 'loading');

    // Get dossier
    const dossier = await storage.getBox3Dossier(dossierId);
    if (!dossier) {
      throw new Error('Dossier niet gevonden');
    }

    // Get all documents
    const documents = await storage.getBox3DocumentsForDossier(dossierId);
    if (documents.length === 0) {
      throw new Error('Geen documenten om te valideren');
    }

    logger.info(job.id, 'Box3 revalidation started', {
      dossierId,
      documentCount: documents.length
    });

    // Update progress - preparing documents
    await this.updateBox3Progress(job.id, 1, 5, `Documenten voorbereiden (${documents.length} stuks)...`, 'preparation');

    // Prepare documents for pipeline
    const pipelineDocs: PipelineDocument[] = [];
    for (const doc of documents) {
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

      // Save extracted text to database for UI access
      if (extractedText !== undefined) {
        await storage.updateBox3Document(doc.id, {
          extractedText: extractedText,
          extractionStatus: extractedText.length > 100 ? 'success' : 'low_yield',
          extractionCharCount: extractedText.length,
        });
      }
    }

    // Check if cancelled before pipeline
    if (await this.isJobCancelled(job.id)) {
      logger.info(job.id, 'Box3 job cancelled before pipeline');
      return;
    }

    // Run extraction pipeline with progress updates
    const pipeline = new Box3ExtractionPipeline((progress) => {
      // Map pipeline steps to job progress
      this.updateBox3Progress(
        job.id,
        progress.stepNumber,
        progress.totalSteps,
        progress.message,
        progress.step
      );
    });

    const pipelineResult = await pipeline.run(pipelineDocs, dossier.intakeText || null);
    const blueprint = pipelineResult.blueprint;

    // Check if cancelled after pipeline
    if (await this.isJobCancelled(job.id)) {
      logger.info(job.id, 'Box3 job cancelled after pipeline');
      return;
    }

    // Log pipeline errors (non-fatal)
    if (pipelineResult.errors.length > 0) {
      logger.warn(job.id, 'Box3 pipeline had non-fatal errors', {
        errorCount: pipelineResult.errors.length,
        errors: pipelineResult.errors
      });
    }

    // Update progress - saving
    await this.updateBox3Progress(job.id, 5, 5, 'Blueprint opslaan...', 'saving');

    // Get current version and increment
    const currentBlueprint = await storage.getLatestBox3Blueprint(dossierId);
    const newVersion = (currentBlueprint?.version || 0) + 1;

    // Store new blueprint
    await storage.createBox3Blueprint({
      dossierId,
      version: newVersion,
      blueprint,
      createdBy: 'pipeline',
    });

    // Extract tax years from blueprint
    const taxYears = this.extractTaxYearsFromBlueprint(blueprint);
    const hasFiscalPartner = blueprint.fiscal_entity?.fiscal_partner?.has_partner || false;

    // Update dossier (including status for initial validation jobs)
    await storage.updateBox3Dossier(dossierId, {
      taxYears: taxYears.length > 0 ? taxYears : null,
      hasFiscalPartner,
      status: taxYears.length > 0 ? 'in_behandeling' : 'intake',
    });

    // Update document classifications (batched)
    if (blueprint.source_documents_registry) {
      const updates: Array<{
        id: string;
        data: {
          classification: Box3DocumentClassification;
          extractionSummary: string | null
        }
      }> = [];

      for (let i = 0; i < blueprint.source_documents_registry.length; i++) {
        const regEntry = blueprint.source_documents_registry[i];
        const matchingDoc = documents[i];

        if (matchingDoc) {
          updates.push({
            id: matchingDoc.id,
            data: {
              classification: {
                document_type: this.mapDetectedTypeToClassification(regEntry.detected_type),
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

    logger.info(job.id, `Box3 Blueprint v${newVersion} created`, { dossierId });

    // Complete the job
    await storage.completeJob(job.id, {
      success: true,
      blueprintVersion: newVersion,
      taxYears,
      documentCount: documents.length,
      pipelineErrors: pipelineResult.errors,
    });
  }

  /**
   * Helper to update Box3 job progress
   */
  private async updateBox3Progress(
    jobId: string,
    step: number,
    totalSteps: number,
    message: string,
    phase: string
  ): Promise<void> {
    await storage.updateJobProgress(jobId, {
      currentStage: phase,
      percentage: Math.round((step / totalSteps) * 100),
      message,
      stages: [{
        stageId: phase,
        status: step >= totalSteps ? "completed" : "processing",
        percentage: Math.round((step / totalSteps) * 100)
      }],
    });
  }

  /**
   * Extract tax years from blueprint
   */
  private extractTaxYearsFromBlueprint(blueprint: any): string[] {
    const years = new Set<string>();
    if (blueprint?.year_summaries) {
      Object.keys(blueprint.year_summaries).forEach(year => years.add(year));
    }
    if (blueprint?.source_documents_registry) {
      blueprint.source_documents_registry.forEach((doc: any) => {
        if (doc.detected_tax_year) {
          years.add(String(doc.detected_tax_year));
        }
      });
    }
    return Array.from(years).sort();
  }

  /**
   * Map detected document type to classification
   */
  private mapDetectedTypeToClassification(detectedType: string): Box3DocumentClassification['document_type'] {
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
   * Helper to update job progress
   */
  private async updateProgress(jobId: string, progress: JobProgress): Promise<void> {
    await storage.updateJobProgress(jobId, progress);
  }
}

// Singleton instance
let jobProcessorInstance: JobProcessor | null = null;

/**
 * Get or create the JobProcessor singleton
 */
export function getJobProcessor(): JobProcessor {
  if (!jobProcessorInstance) {
    jobProcessorInstance = new JobProcessor();
  }
  return jobProcessorInstance;
}

/**
 * Start the job processor (call on server startup)
 */
export function startJobProcessor(): void {
  getJobProcessor().start();
}

/**
 * Stop the job processor (call on server shutdown)
 */
export function stopJobProcessor(): void {
  if (jobProcessorInstance) {
    jobProcessorInstance.stop();
  }
}
