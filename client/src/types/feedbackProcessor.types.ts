/**
 * Feedback Processor Types
 *
 * Type definitions for SimpleFeedbackProcessor and related components.
 */

import type { ChangeProposal } from "@/components/workflow/ChangeProposalCard";
import type { ProcessFeedbackResponse } from "@shared/types/api";

/**
 * Props for SimpleFeedbackProcessor
 */
export interface SimpleFeedbackProcessorProps {
  reportId: string;
  stageId: string;
  stageName: string;
  rawFeedback: string;
  onProcessingComplete?: (result: ProcessFeedbackResponse) => void;
  // Manual mode support
  manualMode?: "ai" | "manual";
  onToggleManualMode?: (mode: "ai" | "manual") => void;
  manualContent?: string;
  onManualContentChange?: (content: string) => void;
  onManualExecute?: () => void;
}

/**
 * Response from prompt preview API
 */
export interface PromptPreviewResponse {
  stageId: string;
  userInstructions: string;
  combinedPrompt: string;
  fullPrompt: string;
  promptLength: number;
  rawFeedback: string;
}

/**
 * AI service status from health endpoint
 */
export interface AIServiceStatus {
  openai: {
    available: boolean;
    latency?: number;
  };
  google: {
    available: boolean;
    latency?: number;
  };
}

/**
 * View mode for feedback processing
 */
export type ViewMode = "structured" | "text";

/**
 * Decision type for proposals
 */
export type ProposalDecision = "accept" | "reject" | "modify";

/**
 * Severity type for bulk actions
 */
export type BulkActionSeverity = "critical" | "important" | "suggestion" | "all";

/**
 * Props for AIStatusIndicator component
 */
export interface AIStatusIndicatorProps {
  aiStatus: AIServiceStatus | undefined;
  onShowDetails: (message: string) => void;
}

/**
 * Props for ManualModePanel component
 */
export interface ManualModePanelProps {
  manualMode: "ai" | "manual";
  onToggleManualMode: (mode: "ai" | "manual") => void;
  manualContent: string;
  onManualContentChange: (content: string) => void;
  onManualExecute: () => void;
  promptPreviewData: PromptPreviewResponse | undefined;
  onCopyPrompt: () => void;
  copied: boolean;
}

/**
 * Props for PromptPreviewModal component
 */
export interface PromptPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stageName: string;
  promptData: PromptPreviewResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  onCopy: () => void;
}

/**
 * Props for FeedbackTextMode component
 */
export interface FeedbackTextModeProps {
  rawFeedback: string;
  stageName: string;
  userInstructions: string;
  onUserInstructionsChange: (value: string) => void;
  isDisabled: boolean;
  onCopyFeedback: () => void;
}

/**
 * Props for FeedbackStructuredMode component
 */
export interface FeedbackStructuredModeProps {
  proposals: ChangeProposal[];
  onProposalDecision: (
    proposalId: string,
    decision: ProposalDecision,
    note?: string
  ) => void;
  onBulkAccept: (severity: BulkActionSeverity) => void;
  onBulkReject: (severity: BulkActionSeverity) => void;
}

/**
 * Props for ProcessButtons component
 */
export interface ProcessButtonsProps {
  viewMode: ViewMode;
  hasDecisions: boolean;
  userInstructions: string;
  isProcessing: boolean;
  hasProcessed: boolean;
  isPreviewLoading: boolean;
  acceptedCount: number;
  onPreview: () => void;
  onProcess: () => void;
}
