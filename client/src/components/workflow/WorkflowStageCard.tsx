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
  getResultLabel,
  supportsManualMode,
  getStatusCardClasses,
  copyToClipboard,
} from "@/utils/stageCardUtils";

// Types
import type { WorkflowStageCardProps, ReportDepth, ReportLanguage, PendingFile } from "@/types/workflowStageCard.types";

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
  onResetStage,
  onCancel,
  reportDepth: externalReportDepth,
  onReportDepthChange,
  reportLanguage: externalReportLanguage,
  onReportLanguageChange,
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
  emailOutput,
  isGeneratingEmail,
  showExpressMode,
  hasStage3,
  onExpressComplete,
  substepResults,
}: WorkflowStageCardProps) {
  // Local UI state
  const [copied, setCopied] = useState(false);
  const [isRawInputCollapsed, setIsRawInputCollapsed] = useState(true);
  const [customContext, setCustomContext] = useState("");
  const [showCustomContext, setShowCustomContext] = useState(false);
  const [localReportDepth, setLocalReportDepth] = useState<ReportDepth>("balanced");
  const [localReportLanguage, setLocalReportLanguage] = useState<ReportLanguage>("nl");
  const [pendingAttachments, setPendingAttachments] = useState<PendingFile[]>([]);

  // Use external or local reportDepth
  const reportDepth = externalReportDepth ?? localReportDepth;
  const handleReportDepthChange = onReportDepthChange ?? setLocalReportDepth;

  // Use external or local reportLanguage
  const reportLanguage = externalReportLanguage ?? localReportLanguage;
  const handleReportLanguageChange = onReportLanguageChange ?? setLocalReportLanguage;

  // Calculated values
  const resultLabel = useMemo(() => getResultLabel(stageKey), [stageKey]);
  const hasManualMode = useMemo(() => supportsManualMode(stageKey), [stageKey]);
  const cardClasses = useMemo(
    () => getStatusCardClasses(stageStatus),
    [stageStatus]
  );

  // Handlers
  const handleExecuteClick = useCallback(() => {
    onExecute(customContext.trim() || undefined, reportDepth, pendingAttachments.length > 0 ? pendingAttachments : undefined, reportLanguage);
    // Clear pending attachments after execute
    setPendingAttachments([]);
  }, [onExecute, customContext, reportDepth, pendingAttachments, reportLanguage]);

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
        stageName={stageName}
        stageIcon={stageIcon}
        stageStatus={stageStatus}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
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
              {/* 1. OUTPUT EERST - Het belangrijkste bovenaan */}
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
                  emailOutput={emailOutput}
                  isGeneratingEmail={isGeneratingEmail}
                  showFeedbackProcessor={showFeedbackProcessor}
                  reportId={reportId}
                  onFeedbackProcessed={onFeedbackProcessed}
                  substepResults={substepResults}
                />
              )}

              {/* 2. ACTIES - Action Buttons (only for AI mode or non-manual stages) */}
              {(!hasManualMode || manualMode === "ai") && (
                <StageActionButtons
                  stageKey={stageKey}
                  stageStatus={stageStatus}
                  canExecute={canExecute}
                  isProcessing={isProcessing}
                  customContext={customContext}
                  showCustomContext={showCustomContext}
                  onToggleCustomContext={handleToggleCustomContext}
                  onCustomContextChange={setCustomContext}
                  onExecute={handleExecuteClick}
                  onResetStage={onResetStage}
                  onCancel={onCancel}
                  reportDepth={reportDepth}
                  onReportDepthChange={handleReportDepthChange}
                  reportLanguage={reportLanguage}
                  onReportLanguageChange={handleReportLanguageChange}
                  reportId={reportId}
                  showExpressMode={showExpressMode}
                  hasStage3={hasStage3}
                  onExpressComplete={onExpressComplete}
                  pendingAttachments={pendingAttachments}
                  onAttachmentsChange={setPendingAttachments}
                  isUploadingAttachments={isProcessing}
                  blockReason={blockReason}
                />
              )}

              {/* 3. MANUAL MODE - Alleen als nodig */}
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

              {/* 4. DEV TOOLS - Altijd onderaan */}
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
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
});
