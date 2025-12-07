/**
 * StageOutputSection Component
 *
 * Output/result display section for workflow stages.
 * Extracted from WorkflowStageCard.tsx lines 591-689.
 */

import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Code2,
} from "lucide-react";
import { InformatieCheckViewer } from "../InformatieCheckViewer";
import { ComplexiteitsCheckViewer } from "../ComplexiteitsCheckViewer";
import { SimpleFeedbackProcessor } from "../SimpleFeedbackProcessor";
import { getSamenvattingFromStage1 } from "@/lib/workflowParsers";
import type { StageOutputSectionProps } from "@/types/workflowStageCard.types";

/**
 * Raw output toggle for reviewer stages
 */
interface RawOutputToggleProps {
  stageResult: string;
  showRawOutput: boolean;
  onToggle: () => void;
}

const RawOutputToggle = memo(function RawOutputToggle({
  stageResult,
  showRawOutput,
  onToggle,
}: RawOutputToggleProps) {
  return (
    <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden mt-4">
      <button
        onClick={onToggle}
        className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-gray-500 dark:text-gray-400"
      >
        <span className="text-[10px] flex items-center gap-1.5">
          <Code2 className="w-3 h-3" />
          Raw JSON Output
        </span>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
            {stageResult.length.toLocaleString()} chars
          </Badge>
          {showRawOutput ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </div>
      </button>
      {showRawOutput && (
        <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900 border-t border-dashed border-gray-300 dark:border-gray-700">
          <div className="bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700 font-mono text-[10px] overflow-x-auto overflow-y-auto max-h-48 w-full">
            <pre
              className="whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300"
              style={{
                wordBreak: "break-word",
                overflowWrap: "anywhere",
                maxWidth: "100%",
              }}
            >
              {stageResult}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
});

export const StageOutputSection = memo(function StageOutputSection({
  stageKey,
  stageName,
  stageResult,
  resultLabel,
  isOutputCollapsed,
  onToggleOutput,
  onCopy,
  copied,
  stage1Result,
  emailOutput,
  isGeneratingEmail,
  showFeedbackProcessor,
  reportId,
  onFeedbackProcessed,
  substepResults,
}: StageOutputSectionProps) {
  const [showRawOutput, setShowRawOutput] = useState(false);

  return (
    <div className="border border-jdb-border rounded-lg overflow-hidden max-w-full bg-green-50/30 dark:bg-green-950/10">
      <div className="w-full px-4 py-3 min-h-[44px] flex items-center justify-between">
        <button
          onClick={onToggleOutput}
          className="flex-1 flex items-center gap-2 text-left hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-jdb-blue-primary focus:ring-offset-2 rounded"
        >
          <span className="font-medium text-sm flex items-center gap-2 text-jdb-text-heading">
            <CheckCircle className="w-4 h-4 text-jdb-success" />
            {resultLabel}
          </span>
          <Badge variant="outline" className="text-xs ml-2">
            {stageResult.length.toLocaleString()} chars
          </Badge>
          {isOutputCollapsed ? (
            <ChevronRight className="w-4 h-4 text-jdb-text-subtle" />
          ) : (
            <ChevronDown className="w-4 h-4 text-jdb-text-subtle" />
          )}
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onCopy(stageResult);
          }}
          className="min-h-[44px] min-w-[44px]"
        >
          {copied ? (
            <Check className="w-4 h-4" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </Button>
      </div>
      {!isOutputCollapsed && (
        <div className="px-4 py-4 bg-jdb-bg/50 dark:bg-jdb-border/5 border-t border-jdb-border overflow-hidden max-w-full space-y-3">
          {/* Special viewers for specific stages */}
          {stageKey === "1a_informatiecheck" && (
            <InformatieCheckViewer
              rawOutput={stageResult}
              emailOutput={emailOutput}
              isGeneratingEmail={isGeneratingEmail}
            />
          )}
          {stageKey === "2_complexiteitscheck" && (
            <ComplexiteitsCheckViewer
              rawOutput={stageResult}
              samenvatting={getSamenvattingFromStage1(stage1Result) || undefined}
            />
          )}

          {/* For reviewer stages: Show Feedback Processor FIRST, then raw output in dropdown */}
          {showFeedbackProcessor && reportId && (
            <>
              <SimpleFeedbackProcessor
                reportId={reportId}
                stageId={stageKey}
                stageName={stageName}
                rawFeedback={stageResult}
                onProcessingComplete={onFeedbackProcessed}
                savedDecisions={substepResults?.[stageKey]?.proposalDecisions}
              />
              <RawOutputToggle
                stageResult={stageResult}
                showRawOutput={showRawOutput}
                onToggle={() => setShowRawOutput(!showRawOutput)}
              />
            </>
          )}

          {/* Default output display for non-reviewer stages (stage 3 etc) */}
          {!["1a_informatiecheck", "1b_informatiecheck_email", "2_complexiteitscheck"].includes(stageKey) &&
            !showFeedbackProcessor && (
              <div className="bg-white dark:bg-gray-900 p-3 rounded border border-gray-300 dark:border-gray-700 font-mono text-xs overflow-x-auto overflow-y-auto max-h-96 w-full max-w-full">
                <pre
                  className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200"
                  style={{
                    wordBreak: "break-word",
                    overflowWrap: "anywhere",
                    maxWidth: "100%",
                  }}
                >
                  {stageResult}
                </pre>
              </div>
            )}
        </div>
      )}
    </div>
  );
});
