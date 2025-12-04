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

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion, useReducedMotion } from "framer-motion";
import { Eye } from "lucide-react";
import { useState, useEffect, useCallback, memo } from "react";
import { useQueryClient } from "@tanstack/react-query";

// Components
import { WORKFLOW_STAGES } from "./constants";
import { WorkflowStageCard } from "./WorkflowStageCard";
import { StageGroupNavigator } from "./StageGroupNavigator";
import { WorkflowProgressHeader } from "./WorkflowProgressHeader";

// Hooks
import { useCollapsibleSections } from "@/hooks/useCollapsibleSections";
import { useManualModeHandlers } from "@/hooks/useManualModeHandlers";
import { useStageActions } from "@/hooks/useStageActions";

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
}: SimplifiedWorkflowViewProps) {
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const { toggleSection: toggleSectionCollapse, isSectionCollapsed } = useCollapsibleSections();
  const queryClient = useQueryClient();
  const shouldReduceMotion = useReducedMotion();

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
    handleFeedbackProcessed,
    handleReloadPrompts,
    isReloadingPrompts,
  } = useStageActions({ state, dispatch, executeStageM });

  // Calculate derived values
  const currentStage = WORKFLOW_STAGES[state.currentStageIndex];
  const progressPercentage = calculateProgressPercentage(state.stageResults);
  const totalProcessingTime = calculateTotalProcessingTime(state.stageTimes);
  const conceptVersions = (state.currentReport?.conceptReportVersions as Record<string, unknown>) || {};
  const hasStage3 = !!conceptVersions["3_generatie"] || !!conceptVersions["latest"];

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
  }, [currentStage.key, state.stageResults]);

  // Toggle stage expansion
  const toggleStageExpansion = useCallback(
    (stageKey: string) => {
      const newExpanded = new Set(expandedStages);
      if (newExpanded.has(stageKey)) {
        newExpanded.delete(stageKey);
      } else {
        newExpanded.add(stageKey);
      }
      setExpandedStages(newExpanded);
    },
    [expandedStages]
  );

  // Navigate to stage (expand + scroll)
  const handleNavigateToStage = useCallback(
    (stageKey: string) => {
      toggleStageExpansion(stageKey);
      document.getElementById(`stage-${stageKey}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [toggleStageExpansion]
  );

  // Express mode completion handler
  const handleExpressComplete = useCallback(() => {
    if (state.currentReport?.id) {
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${state.currentReport.id}`] });
      window.location.reload();
    }
  }, [state.currentReport?.id, queryClient]);

  return (
    <div className="space-y-6 max-w-full overflow-hidden">
        {/* Progress Header */}
        <WorkflowProgressHeader
          stageResults={state.stageResults}
          conceptReportVersions={state.conceptReportVersions}
          currentStageLabel={currentStage.label}
          progressPercentage={progressPercentage}
          totalProcessingTime={totalProcessingTime}
          isReloadingPrompts={isReloadingPrompts}
          onReloadPrompts={handleReloadPrompts}
          reportId={state.currentReport?.id}
          hasStage3={hasStage3}
          onExpressComplete={handleExpressComplete}
        />

        {/* Workflow Layout with Sidebar */}
        <div className="flex gap-4">
          {/* Sidebar Navigator */}
          <StageGroupNavigator
            stageResults={state.stageResults}
            conceptReportVersions={state.conceptReportVersions}
            currentStageIndex={state.currentStageIndex}
            onNavigate={handleNavigateToStage}
          />

          {/* Main Workflow Content */}
          <motion.div
            className="flex-1 min-w-0"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
            animate={shouldReduceMotion ? false : { opacity: 1, y: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.5, delay: 0.1 }}
          >
            <Card className="bg-white dark:bg-jdb-panel overflow-hidden">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-jdb-blue-primary shadow-sm">
                    <Eye className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <span className="text-xl font-semibold text-jdb-text-heading">AI Workflow</span>
                    <p className="text-sm text-jdb-text-subtle font-normal mt-1">
                      Volledige transparantie - bekijk wat naar de AI gaat en terugkomt
                    </p>
                  </div>
                </CardTitle>
              </CardHeader>

              <CardContent className="p-4 md:p-6 space-y-4 overflow-hidden">
                {WORKFLOW_STAGES.map((stage, index) => {
                  const stageResult = state.stageResults[stage.key] || "";
                  const stagePrompt = state.stagePrompts[stage.key] || "";
                  const conceptVersion = state.conceptReportVersions[stage.key];

                  const isActive = index === state.currentStageIndex;
                  const rawStageStatus = getStageStatus(index);
                  const isProcessing = state.stageProcessing[stage.key];

                  // Check feedback ready status for reviewer stages
                  const isReviewer = isReviewerStage(stage.key);
                  const hasFeedback = !!state.stageResults[stage.key];
                  const hasConceptVersion = !!conceptVersion;
                  const isFeedbackReady = checkFeedbackReady(stage.key, hasFeedback, hasConceptVersion);

                  // Map status to WorkflowStageCard expected type
                  const stageStatus = mapToCardStatus(rawStageStatus, isFeedbackReady, isProcessing);

                  // Block reason for Stage 2
                  let blockReason: string | undefined | null;
                  if (stage.key === "2_complexiteitscheck") {
                    const stage1Result = state.stageResults["1_informatiecheck"];
                    if (!isInformatieCheckComplete(stage1Result)) {
                      blockReason = getStage2BlockReason(stage1Result);
                    }
                  }

                  // Can execute check
                  const canExecute = canExecuteStage(
                    index,
                    state.stageResults,
                    state.conceptReportVersions
                  );

                  // Show feedback processor for reviewer stages
                  const substepResults = state.substepResults[stage.key] || {};
                  const hasRawFeedback = !!substepResults.review || !!stageResult;
                  const showFeedbackProcessor = isReviewer && hasRawFeedback;

                  return (
                    <div key={stage.key} id={`stage-${stage.key}`}>
                      <WorkflowStageCard
                        stageKey={stage.key}
                        stageName={stage.label}
                        stageIcon={createStageIcon(stage.key)}
                        stageStatus={stageStatus}
                        isExpanded={expandedStages.has(stage.key) || isActive}
                        onToggleExpand={() => toggleStageExpansion(stage.key)}
                        stageResult={stageResult}
                        stagePrompt={stagePrompt}
                        conceptVersion={conceptVersion}
                        reportId={state.currentReport?.id}
                        stage1Result={state.stageResults["1_informatiecheck"]}
                        canExecute={canExecute}
                        isProcessing={isProcessing}
                        onExecute={(customContext, reportDepth) => handleExecuteStage(stage.key, customContext, reportDepth)}
                        onResetStage={() => handleResetStage(stage.key)}
                        isInputCollapsed={isSectionCollapsed(stage.key, "input")}
                        isOutputCollapsed={isSectionCollapsed(stage.key, "output")}
                        isPromptCollapsed={isSectionCollapsed(stage.key, "prompt")}
                        onToggleInput={() => toggleSectionCollapse(stage.key, "input")}
                        onToggleOutput={() => toggleSectionCollapse(stage.key, "output")}
                        onTogglePrompt={() => toggleSectionCollapse(stage.key, "prompt")}
                        showFeedbackProcessor={showFeedbackProcessor}
                        onFeedbackProcessed={(response) => handleFeedbackProcessed(stage.key, response)}
                        blockReason={blockReason || undefined}
                        onForceContinue={
                          stage.key === "1_informatiecheck"
                            ? () => {
                                dispatch({ type: "SET_CURRENT_STAGE_INDEX", index: index + 1 });
                                toggleStageExpansion("2_complexiteitscheck");
                              }
                            : undefined
                        }
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
                  );
                })}
              </CardContent>
            </Card>
          </motion.div>
        </div>
    </div>
  );
});
