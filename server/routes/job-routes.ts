/**
 * Job Routes - Background job management endpoints
 *
 * Provides endpoints for:
 * - Creating jobs (single stage or express mode)
 * - Polling job progress
 * - Getting jobs for a report
 */

import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse } from "@shared/errors";
import { z } from "zod";
import type { JobProgress, SingleStageJobConfig, ExpressModeJobConfig } from "../services/job-processor";
import type { StageId, DossierData, BouwplanData } from "@shared/schema";
import { REVIEW_STAGES, getLatestConceptText } from "@shared/constants";

// Schema for creating single stage job
const createSingleStageJobSchema = z.object({
  stageId: z.string(),
  customInput: z.string().optional(),
  reportDepth: z.enum(["quick", "balanced", "comprehensive"]).optional(),
  reportLanguage: z.enum(["nl", "en"]).optional()
});

// Schema for creating express mode job
const createExpressModeJobSchema = z.object({
  includeGeneration: z.boolean().default(false),
  autoAccept: z.boolean().default(true),
  stages: z.array(z.string()).optional(),
  reportDepth: z.enum(["concise", "balanced", "comprehensive"]).optional(),
  reportLanguage: z.enum(["nl", "en"]).optional()
});

export function registerJobRoutes(app: Express): void {

  /**
   * POST /api/reports/:id/jobs/stage
   * Create a job for single stage execution
   * Returns job ID immediately - stage runs in background
   */
  app.post("/api/reports/:id/jobs/stage", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const validatedData = createSingleStageJobSchema.parse(req.body);

    console.log(`📋 [${id}] Creating single stage job for ${validatedData.stageId}`);

    // Check if report exists
    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // Check for existing active jobs for this stage
    const existingJobs = await storage.getJobsForReport(id, ["queued", "processing"]);
    const conflictingJob = existingJobs.find(j => {
      const config = j.result as SingleStageJobConfig | undefined;
      return config?.stageId === validatedData.stageId;
    });

    if (conflictingJob) {
      return res.json(createApiSuccessResponse({
        jobId: conflictingJob.id,
        status: conflictingJob.status,
        message: "Er loopt al een job voor deze stage"
      }));
    }

    // Create the job
    const job = await storage.createJob({
      type: "single_stage",
      status: "queued",
      reportId: id,
      result: {
        stageId: validatedData.stageId,
        customInput: validatedData.customInput,
        reportDepth: validatedData.reportDepth,
        reportLanguage: validatedData.reportLanguage
      } as SingleStageJobConfig
    });

    res.json(createApiSuccessResponse({
      jobId: job.id,
      status: "queued",
      message: `Stage ${validatedData.stageId} wordt op de achtergrond uitgevoerd`
    }, "Job aangemaakt"));
  }));

  /**
   * POST /api/reports/:id/jobs/express-mode
   * Create a job for Express Mode execution
   * Returns job ID immediately - all stages run in background
   */
  app.post("/api/reports/:id/jobs/express-mode", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const validatedData = createExpressModeJobSchema.parse(req.body);

    console.log(`🚀 [${id}] Creating Express Mode job`, {
      includeGeneration: validatedData.includeGeneration,
      reportLanguage: validatedData.reportLanguage
    });

    // Check if report exists
    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // Validate prerequisites
    const conceptVersions = (report.conceptReportVersions as Record<string, any>) || {};
    const stageResultsData = (report.stageResults as Record<string, any>) || {};

    if (validatedData.includeGeneration) {
      // Need stage 2 completed
      const hasStage2 = !!stageResultsData["2_complexiteitscheck"];
      if (!hasStage2) {
        throw ServerError.business(
          "VALIDATION_FAILED",
          "Stage 2 (Complexiteitscheck) moet eerst voltooid zijn voordat Express Mode met Generatie kan worden gebruikt"
        );
      }
    } else {
      // Need stage 3 completed
      const hasStage3 =
        conceptVersions["3_generatie"] ||
        conceptVersions["latest"] ||
        report.generatedContent ||
        stageResultsData["3_generatie"]?.conceptReport;

      if (!hasStage3) {
        throw ServerError.business(
          "VALIDATION_FAILED",
          "Stage 3 (Generatie) moet eerst voltooid zijn voordat Express Mode kan worden gebruikt"
        );
      }
    }

    // Check for existing active express mode jobs
    const existingJobs = await storage.getJobsForReport(id, ["queued", "processing"]);
    const conflictingJob = existingJobs.find(j => j.type === "express_mode");

    if (conflictingJob) {
      return res.json(createApiSuccessResponse({
        jobId: conflictingJob.id,
        status: conflictingJob.status,
        message: "Er loopt al een Express Mode job"
      }));
    }

    // Create the job
    const job = await storage.createJob({
      type: "express_mode",
      status: "queued",
      reportId: id,
      result: {
        includeGeneration: validatedData.includeGeneration,
        autoAccept: validatedData.autoAccept,
        stages: validatedData.stages,
        reportDepth: validatedData.reportDepth,
        reportLanguage: validatedData.reportLanguage
      } as ExpressModeJobConfig
    });

    res.json(createApiSuccessResponse({
      jobId: job.id,
      status: "queued",
      message: "Express Mode wordt op de achtergrond uitgevoerd"
    }, "Express Mode job aangemaakt"));
  }));

  /**
   * GET /api/jobs/active
   * Get all active jobs across all reports (grouped by reportId)
   * Used by cases list to show which cases have active background jobs
   * NOTE: This route MUST be defined BEFORE /api/jobs/:id to avoid "active" being matched as an :id
   */
  app.get("/api/jobs/active", asyncHandler(async (req: Request, res: Response) => {
    const jobs = await storage.getJobsByStatus(["queued", "processing"]);

    // Group jobs by reportId
    const jobsByReport: Record<string, { reportId: string; count: number; types: string[] }> = {};

    for (const job of jobs) {
      if (!job.reportId) continue;

      if (!jobsByReport[job.reportId]) {
        jobsByReport[job.reportId] = {
          reportId: job.reportId,
          count: 0,
          types: []
        };
      }

      jobsByReport[job.reportId].count++;
      if (!jobsByReport[job.reportId].types.includes(job.type)) {
        jobsByReport[job.reportId].types.push(job.type);
      }
    }

    res.json(createApiSuccessResponse({
      totalActiveJobs: jobs.length,
      reportIds: Object.keys(jobsByReport),
      byReport: jobsByReport
    }));
  }));

  /**
   * POST /api/jobs/:id/cancel
   * Cancel a queued or processing job
   */
  app.post("/api/jobs/:id/cancel", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    console.log(`🛑 [${id}] Cancelling job`);

    const job = await storage.getJob(id);
    if (!job) {
      throw ServerError.notFound("Job");
    }

    // Only allow cancellation of queued or processing jobs
    if (job.status !== "queued" && job.status !== "processing") {
      return res.status(400).json({
        success: false,
        error: {
          code: "JOB_NOT_CANCELLABLE",
          message: `Job kan niet worden geannuleerd (status: ${job.status})`
        }
      });
    }

    const cancelledJob = await storage.cancelJob(id);

    res.json(createApiSuccessResponse({
      id: cancelledJob?.id,
      status: cancelledJob?.status,
      message: "Job is geannuleerd"
    }, "Job geannuleerd"));
  }));

  /**
   * GET /api/jobs/:id
   * Get job status and progress
   */
  app.get("/api/jobs/:id", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const job = await storage.getJob(id);
    if (!job) {
      throw ServerError.notFound("Job");
    }

    // Parse progress from JSON string
    let progress: JobProgress | null = null;
    if (job.progress) {
      try {
        progress = JSON.parse(job.progress);
      } catch {
        progress = null;
      }
    }

    res.json(createApiSuccessResponse({
      id: job.id,
      type: job.type,
      status: job.status,
      reportId: job.reportId,
      progress,
      result: job.status === "completed" ? job.result : undefined,
      error: job.status === "failed" ? job.error : undefined,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt
    }));
  }));

  /**
   * GET /api/reports/:id/jobs
   * Get all jobs for a report (optionally filtered by status)
   */
  app.get("/api/reports/:id/jobs", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.query;

    // Check if report exists
    const report = await storage.getReport(id);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    let statusFilter: string | string[] | undefined;
    if (status) {
      statusFilter = (status as string).split(",");
    }

    const jobs = await storage.getJobsForReport(id, statusFilter);

    // Parse progress for each job
    const jobsWithProgress = jobs.map(job => {
      let progress: JobProgress | null = null;
      if (job.progress) {
        try {
          progress = JSON.parse(job.progress);
        } catch {
          progress = null;
        }
      }

      return {
        id: job.id,
        type: job.type,
        status: job.status,
        progress,
        result: job.status === "completed" ? job.result : undefined,
        error: job.status === "failed" ? job.error : undefined,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt
      };
    });

    res.json(createApiSuccessResponse({
      jobs: jobsWithProgress
    }));
  }));

  /**
   * GET /api/reports/:id/jobs/active
   * Get active (queued or processing) jobs for a report
   * Used by frontend to check if any work is in progress
   */
  app.get("/api/reports/:id/jobs/active", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const jobs = await storage.getJobsForReport(id, ["queued", "processing"]);

    // Parse progress for each job
    const activeJobs = jobs.map(job => {
      let progress: JobProgress | null = null;
      if (job.progress) {
        try {
          progress = JSON.parse(job.progress);
        } catch {
          progress = null;
        }
      }

      return {
        id: job.id,
        type: job.type,
        status: job.status,
        progress,
        createdAt: job.createdAt,
        startedAt: job.startedAt
      };
    });

    res.json(createApiSuccessResponse({
      hasActiveJobs: activeJobs.length > 0,
      jobs: activeJobs
    }));
  }));
}
