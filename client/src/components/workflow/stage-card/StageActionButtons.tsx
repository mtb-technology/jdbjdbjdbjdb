/**
 * StageActionButtons Component
 *
 * Action buttons for executing, re-running, and resetting workflow stages.
 * Extracted from WorkflowStageCard.tsx lines 426-509.
 */

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Play,
  RefreshCw,
  Trash2,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import type { StageActionButtonsProps } from "@/types/workflowStageCard.types";

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

export const StageActionButtons = memo(function StageActionButtons({
  stageStatus,
  canExecute,
  isProcessing,
  customContext,
  showCustomContext,
  onToggleCustomContext,
  onCustomContextChange,
  onExecute,
  onResetStage,
}: StageActionButtonsProps) {
  return (
    <div className="space-y-3">
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
