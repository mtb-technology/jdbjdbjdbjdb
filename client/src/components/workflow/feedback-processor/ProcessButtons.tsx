/**
 * ProcessButtons Component
 *
 * Action buttons for preview and process operations.
 */

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Play, CheckCircle, Eye, Loader2 } from "lucide-react";
import type { ViewMode } from "@/types/feedbackProcessor.types";

interface ProcessButtonsProps {
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

export const ProcessButtons = memo(function ProcessButtons({
  viewMode,
  hasDecisions,
  userInstructions,
  isProcessing,
  hasProcessed,
  isPreviewLoading,
  acceptedCount,
  onPreview,
  onProcess,
}: ProcessButtonsProps) {
  const isPreviewDisabled =
    (viewMode === "text" &&
      (userInstructions.length > 50000 || !userInstructions.trim())) ||
    (viewMode === "structured" && !hasDecisions) ||
    isPreviewLoading;

  const isProcessDisabled =
    (viewMode === "text" &&
      (!userInstructions.trim() || userInstructions.length > 50000)) ||
    (viewMode === "structured" && !hasDecisions) ||
    isProcessing ||
    hasProcessed;

  return (
    <div className="flex justify-end gap-3">
      <Button
        variant="outline"
        onClick={onPreview}
        disabled={isPreviewDisabled}
        className="min-w-[140px]"
        data-testid="button-preview-prompt"
      >
        {isPreviewLoading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Laden...</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            <span>Preview Prompt</span>
          </div>
        )}
      </Button>

      <Button
        onClick={onProcess}
        disabled={isProcessDisabled}
        className="min-w-[160px]"
        variant={hasProcessed ? "outline" : "default"}
        data-testid="button-process-feedback"
      >
        {isProcessing ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Verwerkt...</span>
          </div>
        ) : hasProcessed ? (
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            <span>Verwerkt</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Play className="h-4 w-4" />
            <span>
              {viewMode === "structured"
                ? `Verwerk ${acceptedCount} wijzigingen`
                : "Verwerk Feedback"}
            </span>
          </div>
        )}
      </Button>
    </div>
  );
});
