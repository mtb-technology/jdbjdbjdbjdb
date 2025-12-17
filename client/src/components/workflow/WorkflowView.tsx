/**
 * WorkflowView - Main Workflow Component
 *
 * Refactored orchestrator following Clean Code and SOLID principles.
 *
 * Changes from original 869-line version:
 * - Extracted manual mode handlers into useManualModeHandlers hook
 * - Extracted stage actions into useStageActions hook
 * - Extracted status logic into workflowUtils.ts
 * - Extracted sidebar navigator into StageGroupNavigator component
 * - Extracted progress header into WorkflowProgressHeader component
 * - Consolidated 4 duplicate sidebar blocks into 1 reusable component
 *
 * Responsibilities:
 * - Overall workflow state management
 * - Progress tracking
 * - Stage orchestration
 * - Delegates stage rendering to WorkflowStageCard
 */

import { motion, useReducedMotion } from "framer-motion";
import { useState, useEffect, useCallback, memo } from "react";
import { useQueryClient } from "@tanstack/react-query";

// Components
import { WORKFLOW_STAGES } from "./constants";
import { WorkflowStageCard } from "./WorkflowStageCard";
import { ActiveJobsBanner } from "./ActiveJobsBanner";

// Hooks
import { useCollapsibleSections } from "@/hooks/useCollapsibleSections";
import { useManualModeHandlers } from "@/hooks/useManualModeHandlers";
import { useStageActions } from "@/hooks/useStageActions";
import { useActiveJobs, useJobPolling, type JobStageProgress } from "@/hooks/useJobPolling";

// Utils
import {
  createStageIcon,
  mapToCardStatus,
  isReviewerStage,
  checkFeedbackReady,
  canExecuteStage,
  calculateProgressPercentage,
  calculateTotalProcessingTime,
  isWorkflowComplete,
} from "@/utils/workflowUtils";
import { isInformatieCheckComplete, getStage2BlockReason } from "@/lib/workflowParsers";
import { REVIEW_STAGES } from "@shared/constants";
import { QUERY_KEYS } from "@/lib/queryKeys";

// Types
import type { SimplifiedWorkflowViewProps, ReportDepth } from "./types";

export const WorkflowView = memo(function WorkflowView({
  state,
  dispatch,
  executeStageM,
  executeSubstepM,
  isCreatingCase,
  rawText,
  clientName,
  getStageStatus,
  hasOcrPending = false,
}: SimplifiedWorkflowViewProps) {
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const { toggleSection: toggleSectionCollapse, isSectionCollapsed, expandSection } = useCollapsibleSections();
  const queryClient = useQueryClient();
  const shouldReduceMotion = useReducedMotion();

  // Track active job progress for real-time sidebar updates
  const { activeJobs, refetch: refetchActiveJobs } = useActiveJobs(state.currentReport?.id || null);
  const activeJob = activeJobs[0]; // Get first active job if any

  // Keep track of the last known job ID to continue polling even after it leaves activeJobs
  // This fixes the race condition where job completes but useActiveJobs polls first
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);

  // Update tracked job when a new active job appears
  useEffect(() => {
    if (activeJob?.id && activeJob.id !== trackedJobId) {
      console.log(`📋 [WorkflowView] Tracking new job: ${activeJob.id}`);
      setTrackedJobId(activeJob.id);
    }
  }, [activeJob?.id, trackedJobId]);

  // Handle job completion - clear processing state and refresh data
  const handleJobComplete = useCallback((job: any) => {
    console.log(`✅ [WorkflowView] Job completed:`, job.id, job.progress?.currentStage);

    // Extract stage ID from job progress
    const stageId = job.progress?.currentStage || job.progress?.stages?.[0]?.stageId;
    if (stageId) {
      console.log(`🔄 [WorkflowView] Clearing processing state for stage: ${stageId}`);
      dispatch({ type: "SET_STAGE_PROCESSING", stage: stageId, isProcessing: false });
    }

    // For express mode jobs, clear all stage processing states
    if (job.type === "express_mode" && job.progress?.stages) {
      job.progress.stages.forEach((stage: any) => {
        dispatch({ type: "SET_STAGE_PROCESSING", stage: stage.stageId, isProcessing: false });
      });
    }

    // Invalidate and refetch report data
    // Use both key formats to handle cache split (legacy API path keys vs structured keys)
    if (state.currentReport?.id) {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports.detail(state.currentReport.id) });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${state.currentReport.id}`] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports.all() });
    }

    // Clear tracked job and refetch active jobs
    setTrackedJobId(null);
    refetchActiveJobs();
  }, [dispatch, state.currentReport?.id, queryClient, refetchActiveJobs]);

  // Use tracked job ID for polling - continues even after job leaves activeJobs
  const { progress: jobProgress } = useJobPolling({
    jobId: trackedJobId,
    reportId: state.currentReport?.id || "",
    enabled: !!trackedJobId,
    onComplete: handleJobComplete,
  });

  // Custom hooks for handlers
  const {
    handleToggleManualMode,
    handleToggleStageManualMode,
    handleManualContentChange,
    handleStageManualContentChange,
    handleManualExecute,
    handleStageManualExecute,
  } = useManualModeHandlers({ state, dispatch });

  const {
    handleExecuteStage,
    handleResetStage,
    handleCancelStage,
    handleFeedbackProcessed,
    handleReloadPrompts,
    isReloadingPrompts,
  } = useStageActions({ state, dispatch, executeStageM });

  // Calculate derived values
  const currentStage = WORKFLOW_STAGES[state.currentStageIndex];
  const progressPercentage = calculateProgressPercentage(state.stageResults);
  const totalProcessingTime = calculateTotalProcessingTime(state.stageTimes);
  const conceptVersions = (state.currentReport?.conceptReportVersions as Record<string, unknown>) || {};
  const hasStage2 = !!state.stageResults["2_complexiteitscheck"];
  const hasStage3 = !!conceptVersions["3_generatie"] || !!conceptVersions["latest"];

  // Detect if all review stages are completed (either via Express Mode or manually)
  const allReviewStagesCompleted = REVIEW_STAGES.every(key => !!state.stageResults[key]);

  // Auto-collapse stage 3 when completed and moved to next stage
  useEffect(() => {
    const stage3Result = state.stageResults["3_generatie"];
    if (stage3Result && expandedStages.has("3_generatie") && currentStage.key !== "3_generatie") {
      setExpandedStages((prev) => {
        const newExpanded = new Set(prev);
        newExpanded.delete("3_generatie");
        return newExpanded;
      });
    }
  }, [currentStage.key, state.stageResults, expandedStages]);

  // Toggle stage expansion - auto-expand output for completed stages
  const toggleStageExpansion = useCallback(
    (stageKey: string) => {
      const newExpanded = new Set(expandedStages);
      const isOpening = !newExpanded.has(stageKey);

      if (isOpening) {
        newExpanded.add(stageKey);
        // Auto-expand output section when opening a completed stage
        const hasResult = !!state.stageResults[stageKey];
        if (hasResult) {
          expandSection(stageKey, "output");
        }
      } else {
        newExpanded.delete(stageKey);
      }
      setExpandedStages(newExpanded);
    },
    [expandedStages, state.stageResults, expandSection]
  );

  // Navigate to stage (expand + scroll)
  const handleNavigateToStage = useCallback(
    (stageKey: string) => {
      toggleStageExpansion(stageKey);
      document.getElementById(`stage-${stageKey}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [toggleStageExpansion]
  );

  // Express mode completion handler - refresh data without page reload
  const handleExpressComplete = useCallback(() => {
    console.log(`🎉 [WorkflowView] Express mode completed, refreshing data...`);

    // Clear all stage processing states (express mode runs all stages)
    WORKFLOW_STAGES.forEach(stage => {
      dispatch({ type: "SET_STAGE_PROCESSING", stage: stage.key, isProcessing: false });
    });

    if (state.currentReport?.id) {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports.detail(state.currentReport.id) });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${state.currentReport.id}`] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports.all() });
    }

    // Refetch active jobs
    refetchActiveJobs();
  }, [state.currentReport?.id, queryClient, dispatch, refetchActiveJobs]);

  // Adjustment applied handler - refresh report data
  const handleAdjustmentApplied = useCallback(() => {
    console.log(`📝 [WorkflowView] Adjustment applied, refreshing data...`);
    if (state.currentReport?.id) {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports.detail(state.currentReport.id) });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${state.currentReport.id}`] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports.all() });
    }
  }, [state.currentReport?.id, queryClient]);

  return (
    <div className="space-y-4 max-w-full overflow-hidden">
        {/* Active Jobs Banner - shows when background jobs are running */}
        {state.currentReport?.id && (
          <ActiveJobsBanner
            reportId={state.currentReport.id}
            onJobComplete={handleExpressComplete}
          />
        )}

        {/* Workflow Stages - Clean list without wrapper */}
        <div className="space-y-3">
                {WORKFLOW_STAGES.map((stage, index) => {
                  const stageResult = state.stageResults[stage.key] || "";
                  const stagePrompt = state.stagePrompts[stage.key] || "";
                  const conceptVersion = state.conceptReportVersions[stage.key];

                  const isActive = index === state.currentStageIndex;
                  const rawStageStatus = getStageStatus(index);

                  // Check if processing via local state OR via active background job
                  // For Express Mode: block ALL stages while it's running
                  const hasActiveExpressMode = activeJob?.type === "express_mode";
                  const isProcessingViaJob = activeJob?.progress?.currentStage === stage.key ||
                    (hasActiveExpressMode && activeJob?.progress?.stages?.some(
                      (s: JobStageProgress) => s.stageId === stage.key && s.status === "processing"
                    ));
                  const isProcessing = state.stageProcessing[stage.key] || isProcessingViaJob;

                  // Block execution if Express Mode is running (can't start new stages)
                  const isBlockedByExpressMode = hasActiveExpressMode;

                  // Check feedback ready status for reviewer stages
                  const isReviewer = isReviewerStage(stage.key);
                  const hasFeedback = !!state.stageResults[stage.key];
                  const hasConceptVersion = !!conceptVersion;
                  const isFeedbackReady = checkFeedbackReady(stage.key, hasFeedback, hasConceptVersion);

                  // Map status to WorkflowStageCard expected type
                  const stageStatus = mapToCardStatus(rawStageStatus, isFeedbackReady ?? false, isProcessing ?? false);

                  // Block reason for Stage 1a (OCR pending) and Stage 2
                  let blockReason: string | undefined | null;
                  if (stage.key === "1a_informatiecheck" && hasOcrPending) {
                    blockReason = "Wacht tot OCR verwerking klaar is. Ga naar Bijlages tab om status te zien.";
                  } else if (stage.key === "2_complexiteitscheck") {
                    const stage1aResult = state.stageResults["1a_informatiecheck"];
                    if (!isInformatieCheckComplete(stage1aResult)) {
                      blockReason = getStage2BlockReason(stage1aResult);
                    }
                  }

                  // Can execute check - also blocked if Express Mode is running
                  const canExecute = !isBlockedByExpressMode && canExecuteStage(
                    index,
                    state.stageResults,
                    state.conceptReportVersions
                  );

                  // Show feedback processor for reviewer stages
                  const substepResults = state.substepResults[stage.key] || {};
                  const hasRawFeedback = !!substepResults.review || !!stageResult;
                  const showFeedbackProcessor = isReviewer && hasRawFeedback;

                  // Show Express Mode button only on stage 3 (where user picks language/depth)
                  const showExpressModeOnStage = stage.key === "3_generatie";

                  // Section headers for grouping
                  const showIntakeHeader = index === 0;
                  const showGeneratieHeader = stage.key === "3_generatie";
                  const showReviewHeader = stage.key === "4a_BronnenSpecialist";

                  // Is this the last stage?
                  const isLastStage = index === WORKFLOW_STAGES.length - 1;

                  // Get previous stage completion status for connector line color
                  const prevStageCompleted = index > 0 && getStageStatus(index - 1) === "completed";

                  return (
                    <div key={stage.key} id={`stage-${stage.key}`}>
                      {/* Section Headers with integrated workflow line */}
                      {showIntakeHeader && (
                        <div className="flex gap-3 mb-2">
                          <div className="w-5 flex-shrink-0" /> {/* Spacer for alignment */}
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Intake
                          </div>
                        </div>
                      )}
                      {showGeneratieHeader && (
                        <div className="flex gap-3 mt-4 mb-2">
                          <div className="w-5 flex-shrink-0 flex justify-center">
                            <div className={`w-0.5 h-full ${prevStageCompleted ? "bg-green-300" : "bg-gray-200 dark:bg-gray-700"}`} />
                          </div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider py-1">
                            Generatie
                          </div>
                        </div>
                      )}
                      {showReviewHeader && (
                        <div className="flex gap-3 mt-4 mb-2">
                          <div className="w-5 flex-shrink-0 flex justify-center">
                            <div className={`w-0.5 h-full ${prevStageCompleted ? "bg-green-300" : "bg-gray-200 dark:bg-gray-700"}`} />
                          </div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider py-1">
                            Review
                          </div>
                        </div>
                      )}

                      {/* Workflow step with connector line */}
                      <div className="flex gap-3">
                        {/* Step indicator column */}
                        <div className="flex flex-col items-center w-5 flex-shrink-0">
                          {/* Step dot/checkmark */}
                          <div className={`
                            w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 z-10
                            ${rawStageStatus === "completed"
                              ? "bg-green-500 text-white"
                              : isProcessing
                                ? "bg-blue-500 text-white animate-pulse"
                                : isActive
                                  ? "bg-blue-500 text-white"
                                  : "bg-gray-200 dark:bg-gray-700 text-gray-400"
                            }
                          `}>
                            {rawStageStatus === "completed" ? (
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : isProcessing ? (
                              <div className="w-2 h-2 bg-white rounded-full" />
                            ) : (
                              <div className="w-2 h-2 bg-current rounded-full opacity-50" />
                            )}
                          </div>
                          {/* Connector line (not for last item) */}
                          {!isLastStage && (
                            <div className={`
                              w-0.5 flex-1 min-h-[12px]
                              ${rawStageStatus === "completed" ? "bg-green-300" : "bg-gray-200 dark:bg-gray-700"}
                            `} />
                          )}
                        </div>

                        {/* Stage card */}
                        <div className="flex-1 min-w-0">
                          <WorkflowStageCard
                        stageKey={stage.key}
                        stageName={stage.label}
                        stageIcon={createStageIcon(stage.key)}
                        stageStatus={stageStatus}
                        isExpanded={expandedStages.has(stage.key) || (isActive && stageStatus !== "completed")}
                        onToggleExpand={() => toggleStageExpansion(stage.key)}
                        stageResult={stageResult}
                        stagePrompt={stagePrompt}
                        conceptVersion={conceptVersion}
                        reportId={state.currentReport?.id}
                        stage1Result={state.stageResults["1a_informatiecheck"]}
                        canExecute={canExecute ?? false}
                        isProcessing={isProcessing ?? false}
                        onExecute={(customContext, reportDepth, pendingAttachments, reportLanguage) => handleExecuteStage(stage.key, customContext, reportDepth, pendingAttachments, reportLanguage)}
                        onResetStage={() => handleResetStage(stage.key)}
                        onCancel={() => handleCancelStage(stage.key)}
                        isInputCollapsed={isSectionCollapsed(stage.key, "input")}
                        isOutputCollapsed={isSectionCollapsed(stage.key, "output")}
                        isPromptCollapsed={isSectionCollapsed(stage.key, "prompt")}
                        onToggleInput={() => toggleSectionCollapse(stage.key, "input")}
                        onToggleOutput={() => toggleSectionCollapse(stage.key, "output")}
                        onTogglePrompt={() => toggleSectionCollapse(stage.key, "prompt")}
                        showFeedbackProcessor={showFeedbackProcessor}
                        onFeedbackProcessed={(response) => handleFeedbackProcessed(stage.key, response)}
                        blockReason={blockReason || undefined}
                        substepResults={state.currentReport?.substepResults as Record<string, any> | undefined}
                        // Email props for stage 1a (from auto-triggered 1b)
                        emailOutput={stage.key === "1a_informatiecheck" ? state.stageResults["1b_informatiecheck_email"] : undefined}
                        isGeneratingEmail={stage.key === "1a_informatiecheck" ? state.stageProcessing["1b_informatiecheck_email"] : undefined}
                        // Express Mode props - show inline button on stage 2+
                        showExpressMode={showExpressModeOnStage}
                        hasStage3={hasStage3}
                        onExpressComplete={handleExpressComplete}
                        // Manual mode props for stage 3
                        {...(stage.key === "3_generatie"
                          ? {
                              manualMode: state.manualMode,
                              onToggleManualMode: handleToggleManualMode,
                              manualContent: state.manualContent,
                              onManualContentChange: handleManualContentChange,
                              onManualExecute: handleManualExecute,
                            }
                          : {})}
                        // Manual mode props for reviewer stages (4A, 4B, etc.)
                        {...(isReviewer
                          ? {
                              manualMode: state.manualModes[stage.key] || "ai",
                              onToggleManualMode: handleToggleStageManualMode(stage.key),
                              manualContent: state.manualContents[stage.key] || "",
                              onManualContentChange: handleStageManualContentChange(stage.key),
                              onManualExecute: handleStageManualExecute(stage.key),
                            }
                          : {})}
                      />
                        </div>
                      </div>
                    </div>
                  );
                })}
        </div>
    </div>
  );
});
