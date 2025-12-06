/**
 * StageActionButtons Component
 *
 * Action buttons for executing, re-running, and resetting workflow stages.
 * Extracted from WorkflowStageCard.tsx lines 426-509.
 */

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Play,
  RefreshCw,
  Trash2,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Zap,
  Scale,
  BookOpen,
} from "lucide-react";
import { ExpressModeButton } from "../ExpressModeButton";
import type { StageActionButtonsProps, ReportDepth } from "@/types/workflowStageCard.types";

/**
 * Custom context input section
 */
interface CustomContextSectionProps {
  stageStatus: string;
  customContext: string;
  showCustomContext: boolean;
  onToggleCustomContext: () => void;
  onCustomContextChange: (value: string) => void;
}

const CustomContextSection = memo(function CustomContextSection({
  stageStatus,
  customContext,
  showCustomContext,
  onToggleCustomContext,
  onCustomContextChange,
}: CustomContextSectionProps) {
  return (
    <div className="bg-purple-50 dark:bg-purple-950/20 border-2 border-purple-200 dark:border-purple-800 rounded-lg p-4">
      <button
        onClick={onToggleCustomContext}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-start gap-3">
          <MessageSquare className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-semibold text-sm text-purple-900 dark:text-purple-100">
              {stageStatus === "completed"
                ? "Extra Context voor Re-run (optioneel)"
                : "Extra Context (optioneel)"}
            </h4>
            <p className="text-xs text-purple-700 dark:text-purple-300 mt-1">
              Voeg extra instructies of context toe die de AI moet gebruiken
            </p>
          </div>
        </div>
        {showCustomContext ? (
          <ChevronDown className="w-5 h-5 text-purple-600" />
        ) : (
          <ChevronRight className="w-5 h-5 text-purple-600" />
        )}
      </button>

      {showCustomContext && (
        <div className="mt-3 space-y-3">
          <Textarea
            value={customContext}
            onChange={(e) => onCustomContextChange(e.target.value)}
            placeholder="Bijv: 'De klant heeft bevestigd dat het vermogen €500k is, niet €300k zoals eerder vermeld. Neem dit mee in de analyse.'"
            className="min-h-[100px] text-sm"
          />
          <div className="flex items-start gap-2 text-xs text-purple-700 dark:text-purple-300">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>
              Deze context wordt toegevoegd aan de originele prompt. De AI zal
              rekening houden met deze extra informatie.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Report depth selector for Stage 3
 */
interface ReportDepthSelectorProps {
  reportDepth: ReportDepth;
  onReportDepthChange: (depth: ReportDepth) => void;
}

const DEPTH_OPTIONS: { value: ReportDepth; label: string; description: string; icon: typeof Zap; pages: string }[] = [
  {
    value: "concise",
    label: "Beknopt",
    description: "To-the-point, alleen de essentie",
    icon: Zap,
    pages: "~3-5 pagina's"
  },
  {
    value: "balanced",
    label: "Gebalanceerd",
    description: "Degelijk rapport met onderbouwing",
    icon: Scale,
    pages: "~6-10 pagina's"
  },
  {
    value: "comprehensive",
    label: "Uitgebreid",
    description: "Maximale diepgang en detail",
    icon: BookOpen,
    pages: "~10-15 pagina's"
  },
];

const ReportDepthSelector = memo(function ReportDepthSelector({
  reportDepth,
  onReportDepthChange,
}: ReportDepthSelectorProps) {
  return (
    <div className="bg-blue-50 dark:bg-blue-950/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg p-4">
      <div className="flex items-start gap-3 mb-3">
        <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-100">
            Rapport Diepgang
          </h4>
          <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
            Kies hoeveel detail en onderbouwing het rapport moet bevatten
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {DEPTH_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = reportDepth === option.value;
          return (
            <button
              key={option.value}
              onClick={() => onReportDepthChange(option.value)}
              className={`
                flex flex-col items-center p-3 rounded-lg border-2 transition-all
                ${isSelected
                  ? "border-blue-500 bg-blue-100 dark:bg-blue-900/40"
                  : "border-gray-200 dark:border-gray-700 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                }
              `}
            >
              <Icon className={`w-5 h-5 mb-1 ${isSelected ? "text-blue-600" : "text-gray-500"}`} />
              <span className={`text-sm font-medium ${isSelected ? "text-blue-700 dark:text-blue-300" : "text-gray-700 dark:text-gray-300"}`}>
                {option.label}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {option.pages}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-blue-600 dark:text-blue-400 mt-3 text-center">
        {DEPTH_OPTIONS.find(o => o.value === reportDepth)?.description}
      </p>
    </div>
  );
});

export const StageActionButtons = memo(function StageActionButtons({
  stageKey,
  stageStatus,
  canExecute,
  isProcessing,
  customContext,
  showCustomContext,
  onToggleCustomContext,
  onCustomContextChange,
  onExecute,
  onResetStage,
  reportDepth = "balanced",
  onReportDepthChange,
  reportId,
  showExpressMode,
  hasStage3,
  onExpressComplete,
}: StageActionButtonsProps) {
  // Check if this is Stage 3 (generatie)
  const isStage3 = stageKey === "3_generatie";
  // Check if this is Stage 2 (complexiteitscheck)
  const isStage2 = stageKey === "2_complexiteitscheck";

  return (
    <div className="space-y-3">
      {/* Report Depth Selector - Only show for Stage 3 */}
      {isStage3 && canExecute && onReportDepthChange && (
        <ReportDepthSelector
          reportDepth={reportDepth}
          onReportDepthChange={onReportDepthChange}
        />
      )}

      {/* Custom Context Section - Always show when stage can execute */}
      {canExecute && (
        <CustomContextSection
          stageStatus={stageStatus}
          customContext={customContext}
          showCustomContext={showCustomContext}
          onToggleCustomContext={onToggleCustomContext}
          onCustomContextChange={onCustomContextChange}
        />
      )}

      <div className="flex gap-2">
        <Button
          onClick={onExecute}
          disabled={!canExecute || isProcessing}
          className="flex-1"
          variant={stageStatus === "completed" ? "outline" : "default"}
        >
          {isProcessing ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Bezig...
            </>
          ) : stageStatus === "completed" ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              {customContext.trim()
                ? "Opnieuw uitvoeren met Extra Context"
                : "Opnieuw uitvoeren"}
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Uitvoeren
            </>
          )}
        </Button>

        {/* Express Mode Button - Show for Stage 2 (completed) or Stage 3+ */}
        {showExpressMode && reportId && onExpressComplete && (
          <ExpressModeButton
            reportId={reportId}
            onComplete={onExpressComplete}
            includeGeneration={isStage2 || (isStage3 && !hasStage3)}
            hasStage3={hasStage3}
          />
        )}

        {/* Reset Stage Button - Only show if stage is completed and onResetStage is provided */}
        {stageStatus === "completed" && onResetStage && (
          <Button
            onClick={onResetStage}
            disabled={isProcessing}
            variant="outline"
            size="icon"
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
            title="Wis stage resultaat om opnieuw uit te voeren"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
});
