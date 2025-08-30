import { db } from "./db";
import { jobs, reports } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { ReportGenerator } from "./services/report-generator";
import type { Job, InsertJob, DossierData, BouwplanData } from "@shared/schema";

export type JobType = "report_generation";
export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface JobProgress {
  currentStage: string;
  stageNumber: number;
  totalStages: number;
  message: string;
}

export class JobQueue {
  private processingJobs = new Set<string>();
  private pollInterval = 5000; // Check for new jobs every 5 seconds
  private reportGenerator: ReportGenerator;

  constructor() {
    this.reportGenerator = new ReportGenerator();
    this.startJobProcessor();
  }

  async createJob(type: JobType, reportId: string): Promise<string> {
    const [job] = await db
      .insert(jobs)
      .values({
        type,
        reportId,
        status: "queued" as JobStatus,
        progress: JSON.stringify({
          currentStage: "Wachten op start...",
          stageNumber: 0,
          totalStages: 11,
          message: "Job toegevoegd aan wachtrij",
        }),
      })
      .returning();
    
    console.log(`Job ${job.id} created for report ${reportId}`);
    return job.id;
  }

  async getJob(jobId: string): Promise<Job | undefined> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    return job;
  }

  async getJobsByStatus(status: JobStatus): Promise<Job[]> {
    return await db.select().from(jobs).where(eq(jobs.status, status));
  }

  async updateJobProgress(jobId: string, progress: JobProgress): Promise<void> {
    await db
      .update(jobs)
      .set({
        progress: JSON.stringify(progress),
      })
      .where(eq(jobs.id, jobId));
  }

  async markJobAsProcessing(jobId: string): Promise<void> {
    await db
      .update(jobs)
      .set({
        status: "processing" as JobStatus,
        startedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }

  async markJobAsCompleted(jobId: string, result: any): Promise<void> {
    await db
      .update(jobs)
      .set({
        status: "completed" as JobStatus,
        result,
        completedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }

  async markJobAsFailed(jobId: string, error: string): Promise<void> {
    await db
      .update(jobs)
      .set({
        status: "failed" as JobStatus,
        error,
        completedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }

  private async startJobProcessor(): Promise<void> {
    setInterval(async () => {
      try {
        await this.processNextJob();
      } catch (error) {
        console.error("Error in job processor:", error);
      }
    }, this.pollInterval);
  }

  private async processNextJob(): Promise<void> {
    // Get next queued job
    const queuedJobs = await this.getJobsByStatus("queued");
    
    if (queuedJobs.length === 0) {
      return; // No jobs to process
    }

    // Get the oldest job
    const nextJob = queuedJobs[0];
    
    // Check if we're already processing this job
    if (this.processingJobs.has(nextJob.id)) {
      return;
    }

    // Mark as processing
    this.processingJobs.add(nextJob.id);
    
    try {
      await this.executeJob(nextJob);
    } finally {
      this.processingJobs.delete(nextJob.id);
    }
  }

  private async executeJob(job: Job): Promise<void> {
    console.log(`Starting job ${job.id} of type ${job.type}`);
    
    try {
      await this.markJobAsProcessing(job.id);
      
      if (job.type === "report_generation") {
        await this.processReportGeneration(job);
      } else {
        throw new Error(`Unknown job type: ${job.type}`);
      }
      
    } catch (error) {
      console.error(`Job ${job.id} failed:`, error);
      await this.markJobAsFailed(job.id, error instanceof Error ? error.message : String(error));
    }
  }

  private async processReportGeneration(job: Job): Promise<void> {
    if (!job.reportId) {
      throw new Error("No report ID provided for report generation job");
    }

    // Get the report data
    const [report] = await db.select().from(reports).where(eq(reports.id, job.reportId));
    if (!report) {
      throw new Error("Report not found");
    }

    // Extract dossier and bouwplan data
    const dossier = report.dossierData as DossierData;
    const bouwplan = report.bouwplanData as BouwplanData || {
      taal: "nl",
      structuur: { inleiding: true, knelpunten: ["Algemene fiscale vraag"], scenario_analyse: true, vervolgstappen: true }
    };

    // Define all processing stages in order
    const stageKeys = [
      "1_informatiecheck",
      "2_complexiteitscheck", 
      "3_generatie",
      "4a_BronnenSpecialist",
      "4b_FiscaalTechnischSpecialist",
      "4c_ScenarioGatenAnalist",
      "4d_DeVertaler",
      "4e_DeAdvocaat",
      "4f_DeKlantpsycholoog",
      "5_feedback_verwerker",
      "final_check"
    ];

    const stageLabels = [
      "1. Informatiecheck",
      "2. Complexiteitscheck", 
      "3. Basis rapport generatie",
      "4a. Bronnen Specialist review",
      "4b. Fiscaal Technisch Specialist review",
      "4c. Scenario Gaten Analist review",
      "4d. De Vertaler review",
      "4e. De Advocaat review",
      "4f. De Klantpsycholoog review",
      "5. Feedback verwerking",
      "11. Final check"
    ];

    let stageResults: Record<string, string> = {};
    let conceptReportVersions: Record<string, string> = {};

    for (let i = 0; i < stageKeys.length; i++) {
      const stageKey = stageKeys[i];
      const stageLabel = stageLabels[i];
      
      // Update progress
      await this.updateJobProgress(job.id, {
        currentStage: stageLabel,
        stageNumber: i + 1,
        totalStages: stageKeys.length,
        message: `AI verwerkt ${stageLabel}...`,
      });

      try {
        console.log(`Executing stage: ${stageKey} (${stageLabel})`);
        
        // Execute the actual AI-powered stage
        const stageExecution = await this.reportGenerator.executeStage(
          stageKey,
          dossier,
          bouwplan,
          stageResults,
          conceptReportVersions
        );

        // Update stage results
        stageResults[stageKey] = stageExecution.stageOutput;
        
        if (stageExecution.conceptReport) {
          conceptReportVersions[stageKey] = stageExecution.conceptReport;
        }

        console.log(`Stage ${stageKey} completed successfully`);

        // Update the database with intermediate results every few stages
        if (i % 3 === 0 || i === stageKeys.length - 1) {
          await db
            .update(reports)
            .set({
              stageResults: stageResults,
              conceptReportVersions: conceptReportVersions,
              currentStage: stageKey,
              updatedAt: new Date(),
            })
            .where(eq(reports.id, job.reportId));
        }

      } catch (error) {
        console.error(`Error in stage ${stageKey}:`, error);
        throw new Error(`Fout in ${stageLabel}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Get the final report content (latest concept report version)
    const finalContent = conceptReportVersions[stageKeys[stageKeys.length - 1]] || 
                        Object.values(conceptReportVersions).pop() || 
                        "Rapport generatie voltooid";

    // Mark as completed
    await this.markJobAsCompleted(job.id, {
      reportContent: finalContent,
      stageResults,
      conceptReportVersions,
      generatedAt: new Date().toISOString(),
    });

    // Update the report with final status
    await db
      .update(reports)
      .set({
        status: "generated",
        generatedContent: finalContent,
        stageResults: stageResults,
        conceptReportVersions: conceptReportVersions,
        currentStage: "final_check",
        updatedAt: new Date(),
      })
      .where(eq(reports.id, job.reportId));

    console.log(`Job ${job.id} completed successfully with AI-generated report`);
  }
}

// Singleton instance
export const jobQueue = new JobQueue();