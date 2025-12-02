/**
 * WorkflowStageCard - Individual Stage Rendering Component
 *
 * Refactored orchestrator following Clean Code and SOLID principles.
 *
 * Changes from original 698-line version:
 * - Extracted header into StageCardHeader component
 * - Extracted manual mode into ManualModePanel component
 * - Extracted action buttons into StageActionButtons component
 * - Extracted dev tools into DevToolsPanel component
 * - Extracted output section into StageOutputSection component
 * - Extracted helper functions into stageCardUtils.ts
 *
 * Responsibilities:
 * - Overall stage card orchestration
 * - State management for UI toggles
 * - Delegates rendering to extracted components
 */

import { Card, CardContent } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useCallback, useMemo, memo } from "react";

// Extracted Components
import {
  StageCardHeader,
  ManualModePanel,
  StageActionButtons,
  DevToolsPanel,
  StageOutputSection,
} from "./stage-card";

// Utils
import {
  getOutputPreview,
  getResultLabel,
  supportsManualMode,
  getStatusCardClasses,
  copyToClipboard,
} from "@/utils/stageCardUtils";

// Types
import type { WorkflowStageCardProps } from "@/types/workflowStageCard.types";

// Re-export props type for consumers
export type { WorkflowStageCardProps } from "@/types/workflowStageCard.types";

export const WorkflowStageCard = memo(function WorkflowStageCard({
  stageKey,
  stageName,
  stageIcon,
  stageStatus,
  isExpanded,
  onToggleExpand,
  stageResult,
  stagePrompt,
  reportId,
  stage1Result,
  canExecute,
  isProcessing,
  onExecute,
  onForceContinue,
  onResetStage,
  progress,
  isInputCollapsed,
  isOutputCollapsed,
  isPromptCollapsed,
  onToggleInput,
  onToggleOutput,
  onTogglePrompt,
  showFeedbackProcessor,
  onFeedbackProcessed,
  blockReason,
  manualMode = "ai",
  onToggleManualMode,
  manualContent = "",
  onManualContentChange,
  onManualExecute,
}: WorkflowStageCardProps) {
  // Local UI state
  const [copied, setCopied] = useState(false);
  const [isRawInputCollapsed, setIsRawInputCollapsed] = useState(true);
  const [customContext, setCustomContext] = useState("");
  const [showCustomContext, setShowCustomContext] = useState(false);

  // Calculated values
  const outputPreview = useMemo(
    () => getOutputPreview(stageResult, stageKey),
    [stageResult, stageKey]
  );
  const resultLabel = useMemo(() => getResultLabel(stageKey), [stageKey]);
  const hasManualMode = useMemo(() => supportsManualMode(stageKey), [stageKey]);
  const cardClasses = useMemo(
    () => getStatusCardClasses(stageStatus),
    [stageStatus]
  );

  // Handlers
  const handleExecuteClick = useCallback(() => {
    onExecute(customContext.trim() || undefined);
  }, [onExecute, customContext]);

  const handleCopy = useCallback((text: string) => {
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleToggleRawInput = useCallback(() => {
    setIsRawInputCollapsed((prev) => !prev);
  }, []);

  const handleToggleCustomContext = useCallback(() => {
    setShowCustomContext((prev) => !prev);
  }, []);

  return (
    <Card
      className={`
        overflow-hidden
        ${cardClasses}
        transition-all duration-300
      `}
    >
      <StageCardHeader
        stageKey={stageKey}
        stageName={stageName}
        stageIcon={stageIcon}
        stageStatus={stageStatus}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
        outputPreview={outputPreview}
        resultLabel={resultLabel}
        isProcessing={isProcessing}
        progress={progress}
        blockReason={blockReason}
      />

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <CardContent className="space-y-4">
              {/* Manual Mode Panel for supported stages */}
              {hasManualMode && onToggleManualMode && (
                <ManualModePanel
                  stageKey={stageKey}
                  stageName={stageName}
                  manualMode={manualMode}
                  onToggleManualMode={onToggleManualMode}
                  stagePrompt={stagePrompt}
                  manualContent={manualContent}
                  onManualContentChange={onManualContentChange || (() => {})}
                  onManualExecute={onManualExecute || (() => {})}
                  isProcessing={isProcessing}
                />
              )}

              {/* Action Buttons - Only show for AI mode or non-manual stages */}
              {(!hasManualMode || manualMode === "ai") && (
                <StageActionButtons
                  stageStatus={stageStatus}
                  canExecute={canExecute}
                  isProcessing={isProcessing}
                  customContext={customContext}
                  showCustomContext={showCustomContext}
                  onToggleCustomContext={handleToggleCustomContext}
                  onCustomContextChange={setCustomContext}
                  onExecute={handleExecuteClick}
                  onResetStage={onResetStage}
                />
              )}

              {/* Developer Tools Panel */}
              {stagePrompt && (
                <DevToolsPanel
                  stagePrompt={stagePrompt}
                  isRawInputCollapsed={isRawInputCollapsed}
                  isPromptCollapsed={isPromptCollapsed}
                  onToggleRawInput={handleToggleRawInput}
                  onTogglePrompt={onTogglePrompt}
                  onCopy={handleCopy}
                  copied={copied}
                />
              )}

              {/* Output Section */}
              {stageResult && (
                <StageOutputSection
                  stageKey={stageKey}
                  stageName={stageName}
                  stageResult={stageResult}
                  resultLabel={resultLabel}
                  isOutputCollapsed={isOutputCollapsed}
                  onToggleOutput={onToggleOutput}
                  onCopy={handleCopy}
                  copied={copied}
                  stage1Result={stage1Result}
                  onForceContinue={onForceContinue}
                  showFeedbackProcessor={showFeedbackProcessor}
                  reportId={reportId}
                  onFeedbackProcessed={onFeedbackProcessed}
                  manualMode={manualMode}
                  onToggleManualMode={onToggleManualMode}
                  manualContent={manualContent}
                  onManualContentChange={onManualContentChange}
                  onManualExecute={onManualExecute}
                />
              )}
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
});
