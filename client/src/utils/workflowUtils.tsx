/**
 * Workflow Utility Functions
 *
 * Pure utility functions extracted from WorkflowView.tsx for:
 * - Status mapping logic
 * - Stage completion checks
 * - Icon mapping
 *
 * These functions are stateless and easily testable.
 */

import {
  FileText,
  Activity,
  Wand2,
  Users,
  Zap,
  GitCompare,
  Play,
} from "lucide-react";
import { WORKFLOW_STAGES, type WorkflowStage } from "@/components/workflow/constants";

/**
 * Stage status types used by WorkflowStageCard
 */
export type StageStatus = "error" | "processing" | "completed" | "idle" | "blocked" | "feedback_ready";

/**
 * Raw stage status from getStageStatus function
 */
export type RawStageStatus = "completed" | "current" | "pending";

/**
 * Stage group names for sidebar navigation
 */
export type StageGroup = "intake" | "generatie" | "review" | "afronding";

/**
 * Stage group configuration
 */
export interface StageGroupConfig {
  key: StageGroup;
  label: string;
  filter: (stage: WorkflowStage) => boolean;
  getDisplayName?: (stage: WorkflowStage) => string;
}

/**
 * Sidebar stage group configurations
 */
export const STAGE_GROUPS: StageGroupConfig[] = [
  {
    key: "intake",
    label: "Intake",
    filter: (s) => ["1_informatiecheck", "2_complexiteitscheck"].includes(s.key),
    getDisplayName: (s) => s.label.replace(/^\d+[a-z]?\.\s*/, ""),
  },
  {
    key: "generatie",
    label: "Generatie",
    filter: (s) => s.key === "3_generatie",
    getDisplayName: () => "Rapport",
  },
  {
    key: "review",
    label: "Review",
    filter: (s) => s.key.startsWith("4") && s.key !== "4_change_summary",
    getDisplayName: (s) =>
      s.label
        .replace(/^\d+[a-z]?\.\s*/, "")
        .replace("Specialist", "")
        .replace("Hoofd ", "")
        .trim(),
  },
  {
    key: "afronding",
    label: "Afronding",
    filter: (s) => s.key === "6_change_summary",
    getDisplayName: () => "Samenvatting",
  },
];

/**
 * Stage icon color mapping - Using JdB brand colors
 */
const STAGE_ICON_COLORS: Record<string, string> = {
  "1_informatiecheck": "text-jdb-blue-primary",
  "2_complexiteitscheck": "text-purple-600",
  "3_generatie": "text-jdb-success",
  "4a_BronnenSpecialist": "text-jdb-gold",
  "4b_FiscaalTechnischSpecialist": "text-jdb-danger",
  "4c_ScenarioGatenAnalist": "text-indigo-600",
  "4e_DeAdvocaat": "text-jdb-gold",
  "4f_HoofdCommunicatie": "text-teal-600",
  "6_change_summary": "text-jdb-text-subtle",
};

/**
 * Stage icon component mapping
 */
const STAGE_ICONS: Record<string, typeof FileText> = {
  "1_informatiecheck": FileText,
  "2_complexiteitscheck": Activity,
  "3_generatie": Wand2,
  "4a_BronnenSpecialist": Users,
  "4b_FiscaalTechnischSpecialist": Zap,
  "4c_ScenarioGatenAnalist": Activity,
  "4e_DeAdvocaat": Users,
  "4f_HoofdCommunicatie": Users,
  "6_change_summary": GitCompare,
};

/**
 * Get the icon component for a stage
 */
export function getStageIconComponent(stageKey: string): typeof FileText {
  return STAGE_ICONS[stageKey] || Play;
}

/**
 * Get the icon color class for a stage
 */
export function getStageIconColor(stageKey: string): string {
  return STAGE_ICON_COLORS[stageKey] || "text-jdb-blue-primary";
}

/**
 * Create a stage icon element
 */
export function createStageIcon(stageKey: string): JSX.Element {
  const IconComponent = getStageIconComponent(stageKey);
  const colorClass = getStageIconColor(stageKey);
  return <IconComponent className={`h-5 w-5 ${colorClass}`} />;
}

/**
 * Map raw stage status to WorkflowStageCard status
 */
export function mapToCardStatus(
  rawStatus: RawStageStatus,
  isFeedbackReady: boolean,
  isProcessing: boolean
): StageStatus {
  if (isFeedbackReady) return "feedback_ready";
  if (rawStatus === "completed") return "completed";
  if (isProcessing) return "processing";
  return "idle";
}

/**
 * Check if a stage is a reviewer stage
 */
export function isReviewerStage(stageKey: string): boolean {
  return stageKey.startsWith("4") && stageKey !== "4_change_summary";
}

/**
 * Check if a reviewer stage has feedback ready to process
 */
export function checkFeedbackReady(
  stageKey: string,
  hasFeedback: boolean,
  hasConceptVersion: boolean
): boolean {
  return isReviewerStage(stageKey) && hasFeedback && !hasConceptVersion;
}

/**
 * Check if a stage can be executed based on previous stage completion
 */
export function canExecuteStage(
  stageIndex: number,
  stageResults: Record<string, string>,
  conceptReportVersions: Record<string, unknown>
): boolean {
  // First stage can always execute
  if (stageIndex === 0) return true;

  const prevStage = WORKFLOW_STAGES[stageIndex - 1];
  if (!prevStage) return false;

  const hasPrevStageResult = !!stageResults[prevStage.key];
  const hasPrevConceptReport = !!conceptReportVersions[prevStage.key];

  // Special case: Stage 3 (generatie) is completed if it has conceptReport OR stageResult
  if (prevStage.key === "3_generatie") {
    return hasPrevStageResult || hasPrevConceptReport;
  }

  return hasPrevStageResult;
}

/**
 * Count completed stages including implicit completions
 */
export function countCompletedStages(
  stageResults: Record<string, string>,
  conceptReportVersions: Record<string, unknown>
): number {
  const stageResultKeys = Object.keys(stageResults);
  const conceptVersions = conceptReportVersions as Record<string, unknown> || {};

  // Count stages that actually exist in WORKFLOW_STAGES
  const completedStageKeys = stageResultKeys.filter((key) =>
    WORKFLOW_STAGES.some((stage) => stage.key === key)
  );

  // Check if stage 3 concept exists
  const hasStage3 = conceptVersions["3_generatie"] || conceptVersions["latest"];

  // Count how many of stages 1-3 are NOT yet in stageResults but should be counted
  let extraStages = 0;
  if (hasStage3) {
    ["1_informatiecheck", "2_complexiteitscheck", "3_generatie"].forEach((stageKey) => {
      if (!completedStageKeys.includes(stageKey)) {
        extraStages++;
      }
    });
  }

  return completedStageKeys.length + extraStages;
}

/**
 * Calculate progress percentage
 */
export function calculateProgressPercentage(stageResults: Record<string, string>): number {
  return Math.round((Object.keys(stageResults).length / WORKFLOW_STAGES.length) * 100);
}

/**
 * Calculate total processing time
 */
export function calculateTotalProcessingTime(stageTimes: Record<string, number>): number {
  return Object.values(stageTimes).reduce((sum, time) => sum + (time || 0), 0);
}

/**
 * Check if workflow is complete
 */
export function isWorkflowComplete(stageResults: Record<string, string>): boolean {
  return Object.keys(stageResults).length >= WORKFLOW_STAGES.length;
}

/**
 * Get stages for a specific group
 */
export function getStagesForGroup(group: StageGroupConfig): WorkflowStage[] {
  return WORKFLOW_STAGES.filter(group.filter);
}
