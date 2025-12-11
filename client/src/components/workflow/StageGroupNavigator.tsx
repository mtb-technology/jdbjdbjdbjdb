/**
 * StageGroupNavigator Component
 *
 * Sidebar navigation for workflow stages.
 * Replaces 4 duplicate code blocks (lines 583-719) from WorkflowView.tsx.
 */

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Loader2 } from "lucide-react";
import { WORKFLOW_STAGES, type WorkflowStage } from "./constants";
import { STAGE_GROUPS, type StageGroupConfig } from "@/utils/workflowUtils";
import type { JobStageProgress } from "@/hooks/useJobPolling";

interface StageGroupNavigatorProps {
  stageResults: Record<string, string>;
  conceptReportVersions: Record<string, unknown>;
  currentStageIndex: number;
  onNavigate: (stageKey: string) => void;
  jobStageProgress?: JobStageProgress[];
}

interface StageButtonProps {
  stage: WorkflowStage;
  hasResult: boolean;
  isActive: boolean;
  isProcessing: boolean;
  displayName: string;
  onClick: () => void;
}

/**
 * Individual stage button in the navigator
 */
const StageButton = memo(function StageButton({
  stage,
  hasResult,
  isActive,
  isProcessing,
  displayName,
  onClick,
}: StageButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 transition-colors ${
        isProcessing
          ? "bg-blue-50 text-blue-600 font-medium"
          : isActive
          ? "bg-jdb-blue-primary/10 text-jdb-blue-primary font-medium"
          : hasResult
          ? "text-jdb-success hover:bg-jdb-bg"
          : "text-jdb-text-subtle hover:bg-jdb-bg"
      }`}
    >
      {isProcessing ? (
        <Loader2 className="w-3 h-3 text-blue-600 flex-shrink-0 animate-spin" />
      ) : hasResult ? (
        <CheckCircle className="w-3 h-3 text-jdb-success flex-shrink-0" />
      ) : isActive ? (
        <div className="w-3 h-3 rounded-full border-2 border-jdb-blue-primary flex-shrink-0" />
      ) : (
        <div className="w-3 h-3 rounded-full border border-jdb-text-subtle/30 flex-shrink-0" />
      )}
      <span className="truncate">{displayName}</span>
    </button>
  );
});

interface StageGroupSectionProps {
  group: StageGroupConfig;
  stages: WorkflowStage[];
  stageResults: Record<string, string>;
  conceptReportVersions: Record<string, unknown>;
  currentStageIndex: number;
  onNavigate: (stageKey: string) => void;
  jobStageProgress?: JobStageProgress[];
}

/**
 * Group section with label and stage buttons
 */
const StageGroupSection = memo(function StageGroupSection({
  group,
  stages,
  stageResults,
  conceptReportVersions,
  currentStageIndex,
  onNavigate,
  jobStageProgress,
}: StageGroupSectionProps) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-jdb-text-subtle uppercase tracking-wider px-2 mb-1">
        {group.label}
      </p>
      {stages.map((stage) => {
        // Check job progress for this stage
        const jobStage = jobStageProgress?.find((s) => s.stageId === stage.key);
        const isProcessing = jobStage?.status === "processing";
        const isCompletedByJob = jobStage?.status === "completed";

        // Check for result - special case for stage 3 which uses conceptReportVersions
        // Also consider job progress completed status
        const hasResult =
          isCompletedByJob ||
          (stage.key === "3_generatie"
            ? !!stageResults[stage.key] || !!conceptReportVersions[stage.key]
            : !!stageResults[stage.key]);

        const stageIndex = WORKFLOW_STAGES.findIndex((s) => s.key === stage.key);
        const isActive = stageIndex === currentStageIndex;
        const displayName = group.getDisplayName ? group.getDisplayName(stage) : stage.label;

        return (
          <StageButton
            key={stage.key}
            stage={stage}
            hasResult={hasResult}
            isActive={isActive}
            isProcessing={isProcessing}
            displayName={displayName}
            onClick={() => onNavigate(stage.key)}
          />
        );
      })}
    </div>
  );
});

/**
 * Main navigator component
 */
export const StageGroupNavigator = memo(function StageGroupNavigator({
  stageResults,
  conceptReportVersions,
  currentStageIndex,
  onNavigate,
  jobStageProgress,
}: StageGroupNavigatorProps) {
  return (
    <div className="hidden 2xl:block w-44 flex-shrink-0">
      <div className="sticky top-24">
        <Card className="bg-white dark:bg-jdb-panel">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold text-jdb-text-heading">Stappen</CardTitle>
          </CardHeader>
          <CardContent className="p-2 space-y-1">
            <div className="space-y-3">
              {STAGE_GROUPS.map((group) => {
                const stages = WORKFLOW_STAGES.filter(group.filter);
                if (stages.length === 0) return null;

                return (
                  <StageGroupSection
                    key={group.key}
                    group={group}
                    stages={stages}
                    stageResults={stageResults}
                    conceptReportVersions={conceptReportVersions}
                    currentStageIndex={currentStageIndex}
                    onNavigate={onNavigate}
                    jobStageProgress={jobStageProgress}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
});
