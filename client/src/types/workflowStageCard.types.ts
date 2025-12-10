/**
 * WorkflowStageCard Type Definitions
 *
 * Type definitions for workflow stage card components.
 */

import type { ReactNode } from "react";
import type { ProcessFeedbackResponse } from "@shared/types/api";

/**
 * Stage status types
 */
export type StageStatus =
  | "idle"
  | "processing"
  | "completed"
  | "blocked"
  | "error"
  | "feedback_ready";

/**
 * Manual mode types
 */
export type ManualMode = "ai" | "manual";

/**
 * Progress information for processing stages
 */
export interface StageProgress {
  progress: number;
  status: string;
  startTime?: number;
  estimatedTime?: number;
}

/**
 * Main props for WorkflowStageCard
 */
export interface WorkflowStageCardProps {
  stageKey: string;
  stageName: string;
  stageIcon: ReactNode;
  stageStatus: StageStatus;
  isExpanded: boolean;
  onToggleExpand: () => void;

  // Content
  stageResult?: string;
  stagePrompt?: string;
  conceptVersion?: string;
  reportId?: string;
  stage1Result?: string;

  // Controls
  canExecute: boolean;
  isProcessing: boolean;
  onExecute: (customContext?: string, reportDepth?: ReportDepth, pendingAttachments?: PendingFile[]) => void;
  onResetStage?: () => void;
  onCancel?: () => void;

  // Stage 1a/1b email generation
  emailOutput?: string;
  isGeneratingEmail?: boolean;

  // Report depth for Stage 3
  reportDepth?: ReportDepth;
  onReportDepthChange?: (depth: ReportDepth) => void;

  // Progress
  progress?: StageProgress;

  // Collapsible sections
  isInputCollapsed: boolean;
  isOutputCollapsed: boolean;
  isPromptCollapsed: boolean;
  onToggleInput: () => void;
  onToggleOutput: () => void;
  onTogglePrompt: () => void;

  // Optional features
  showFeedbackProcessor?: boolean;
  onFeedbackProcessed?: (response: ProcessFeedbackResponse) => void;
  blockReason?: string;
  substepResults?: Record<string, any>;

  // Manual mode
  manualMode?: ManualMode;
  onToggleManualMode?: (mode: ManualMode) => void;
  manualContent?: string;
  onManualContentChange?: (content: string) => void;
  onManualExecute?: () => void;

  // Express Mode inline - for stages 2+
  showExpressMode?: boolean;
  hasStage3?: boolean;
  onExpressComplete?: () => void;
}

/**
 * Props for StageCardHeader component
 */
export interface StageCardHeaderProps {
  stageName: string;
  stageIcon: ReactNode;
  stageStatus: StageStatus;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isProcessing: boolean;
  progress?: StageProgress;
  blockReason?: string;
}

/**
 * Props for ManualModePanel component
 */
export interface ManualModePanelProps {
  stageKey: string;
  stageName: string;
  manualMode: ManualMode;
  onToggleManualMode: (mode: ManualMode) => void;
  stagePrompt?: string;
  manualContent: string;
  onManualContentChange: (content: string) => void;
  onManualExecute: () => void;
  isProcessing: boolean;
}

/**
 * Report depth levels for Stage 3 deep research.
 */
export type ReportDepth = "concise" | "balanced" | "comprehensive";

/**
 * Pending file for upload
 */
export interface PendingFile {
  file: File;
  name: string;
  size: number;
  type: string;
}

/**
 * Props for StageActionButtons component
 */
export interface StageActionButtonsProps {
  stageKey: string;
  stageStatus: StageStatus;
  canExecute: boolean;
  isProcessing: boolean;
  customContext: string;
  showCustomContext: boolean;
  onToggleCustomContext: () => void;
  onCustomContextChange: (value: string) => void;
  onExecute: () => void;
  onResetStage?: () => void;
  onCancel?: () => void;
  /** Report depth for Stage 3 */
  reportDepth?: ReportDepth;
  onReportDepthChange?: (depth: ReportDepth) => void;
  /** Express Mode props - show inline Express button */
  reportId?: string;
  showExpressMode?: boolean;
  hasStage3?: boolean;
  onExpressComplete?: () => void;
  /** Attachment upload props - for Stage 1a re-run */
  pendingAttachments?: PendingFile[];
  onAttachmentsChange?: (files: PendingFile[]) => void;
  isUploadingAttachments?: boolean;
  /** Block reason - if set, stage execution is blocked */
  blockReason?: string;
}

/**
 * Props for DevToolsPanel component
 */
export interface DevToolsPanelProps {
  stagePrompt: string;
  isRawInputCollapsed: boolean;
  isPromptCollapsed: boolean;
  onToggleRawInput: () => void;
  onTogglePrompt: () => void;
  onCopy: (text: string) => void;
  copied: boolean;
}

/**
 * Props for StageOutputSection component
 */
export interface StageOutputSectionProps {
  stageKey: string;
  stageName: string;
  stageResult: string;
  resultLabel: string;
  isOutputCollapsed: boolean;
  onToggleOutput: () => void;
  onCopy: (text: string) => void;
  copied: boolean;
  // Special stage props
  stage1Result?: string;
  // Stage 1a/1b email generation props
  emailOutput?: string;
  isGeneratingEmail?: boolean;
  // Feedback processor props
  showFeedbackProcessor?: boolean;
  reportId?: string;
  onFeedbackProcessed?: (response: ProcessFeedbackResponse) => void;
  // Substep results for persisted decisions
  substepResults?: Record<string, any>;
}
