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

    // Define processing stages in correct grouping
    const preparationStages = [
      "1_informatiecheck",
      "2_complexiteitscheck", 
      "3_generatie"
    ];

    const reviewerStages = [
      "4a_BronnenSpecialist",
      "4b_FiscaalTechnischSpecialist",
      "4c_ScenarioGatenAnalist",
      "4d_DeVertaler",
      "4e_DeAdvocaat",
      "4f_DeKlantpsycholoog"
    ];

    const finalizationStages = [
      "5_feedback_verwerker",
      "final_check"
    ];

    // Combine all stages for progress tracking
    const allStages = [...preparationStages, ...reviewerStages, ...finalizationStages];
    
    const stageLabels: Record<string, string> = {
      "1_informatiecheck": "1. Informatiecheck",
      "2_complexiteitscheck": "2. Complexiteitscheck",
      "3_generatie": "3. Basis rapport generatie",
      "4a_BronnenSpecialist": "4a. Bronnen Specialist review",
      "4b_FiscaalTechnischSpecialist": "4b. Fiscaal Technisch Specialist review",
      "4c_ScenarioGatenAnalist": "4c. Scenario Gaten Analist review",
      "4d_DeVertaler": "4d. De Vertaler review",
      "4e_DeAdvocaat": "4e. De Advocaat review",
      "4f_DeKlantpsycholoog": "4f. De Klantpsycholoog review",
      "5_feedback_verwerker": "5. Feedback verwerking",
      "final_check": "6. Final check"
    };

    let stageResults: Record<string, string> = {};
    let conceptReportVersions: Record<string, string> = {};

    // Helper function to execute a stage
    const executeStage = async (stageKey: string, stageNumber: number) => {
      const stageLabel = stageLabels[stageKey];
      
      // Update progress
      await this.updateJobProgress(job.id, {
        currentStage: stageLabel,
        stageNumber,
        totalStages: allStages.length,
        message: `🔄 Bezig met ${stageLabel} - AI model wordt aangeroepen...`,
      });

      try {
        console.log(`🚀 [${job.id}] Starting stage: ${stageKey} (${stageLabel})`);
        
        // Update progress with more detailed message
        await this.updateJobProgress(job.id, {
          currentStage: stageLabel,
          stageNumber,
          totalStages: allStages.length,
          message: `🤖 ${stageLabel} - AI model analyse gestart...`,
        });
        
        // Execute the actual AI-powered stage
        const stageExecution = await this.reportGenerator.executeStage(
          stageKey,
          dossier,
          bouwplan,
          stageResults,
          conceptReportVersions,
          undefined, // customInput
          job.id // jobId for detailed logging
        );

        // Update stage results
        stageResults[stageKey] = stageExecution.stageOutput;
        
        if (stageExecution.conceptReport) {
          conceptReportVersions[stageKey] = stageExecution.conceptReport;
        }

        console.log(`✅ [${job.id}] Stage ${stageKey} completed successfully`);
        
        // Log the stage output length for debugging
        console.log(`📄 [${job.id}] Stage ${stageKey} output length: ${stageExecution.stageOutput.length} characters`);

      } catch (error) {
        console.error(`❌ [${job.id}] Error in stage ${stageKey}:`, error);
        throw new Error(`Fout in ${stageLabel}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    // Phase 1: Execute preparation stages (1-3)
    console.log(`🏁 [${job.id}] Starting Phase 1: Preparation stages (1-3)`);
    for (let i = 0; i < preparationStages.length; i++) {
      await executeStage(preparationStages[i], i + 1);
      
      // Save progress after critical stages
      await db
        .update(reports)
        .set({
          stageResults: stageResults,
          conceptReportVersions: conceptReportVersions,
          currentStage: preparationStages[i],
          updatedAt: new Date(),
        })
        .where(eq(reports.id, job.reportId));
    }

    // Phase 2: Execute all reviewer stages (4a-4f) - they all run in parallel conceptually but sequentially
    console.log(`🏁 [${job.id}] Starting Phase 2: Reviewer stages (4a-4f)`);
    for (let i = 0; i < reviewerStages.length; i++) {
      await executeStage(reviewerStages[i], preparationStages.length + i + 1);
    }

    // Save all reviewer results
    await db
      .update(reports)
      .set({
        stageResults: stageResults,
        conceptReportVersions: conceptReportVersions,
        currentStage: "reviews_completed",
        updatedAt: new Date(),
      })
      .where(eq(reports.id, job.reportId));

    console.log(`🏁 [${job.id}] Starting Phase 3: Finalization stages (5, final_check)`);
    // Phase 3: Execute finalization stages (5, final_check)
    for (let i = 0; i < finalizationStages.length; i++) {
      await executeStage(finalizationStages[i], preparationStages.length + reviewerStages.length + i + 1);
      
      // Save progress after each finalization stage
      await db
        .update(reports)
        .set({
          stageResults: stageResults,
          conceptReportVersions: conceptReportVersions,
          currentStage: finalizationStages[i],
          updatedAt: new Date(),
        })
        .where(eq(reports.id, job.reportId));
    }

    // Get the final report content (latest concept report version)
    const finalContent = conceptReportVersions[allStages[allStages.length - 1]] || 
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