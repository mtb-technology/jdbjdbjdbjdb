/**
 * StageCardHeader Component
 *
 * Header section for workflow stage cards with status badge, progress, and expand controls.
 * Extracted from WorkflowStageCard.tsx lines 232-294.
 */

import { memo, useCallback } from "react";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle,
  ChevronRight,
  ChevronDown,
  Clock,
  Activity,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import type { StageCardHeaderProps, StageStatus } from "@/types/workflowStageCard.types";

/**
 * Get status badge element based on stage status
 */
function getStatusBadge(stageStatus: StageStatus) {
  switch (stageStatus) {
    case "completed":
      return (
        <Badge variant="success">
          <CheckCircle className="w-3 h-3 mr-1" />
          Voltooid
        </Badge>
      );
    case "feedback_ready":
      return (
        <Badge className="bg-orange-500 text-white">
          <Sparkles className="w-3 h-3 mr-1" />
          Review Beschikbaar
        </Badge>
      );
    case "processing":
      return (
        <Badge className="bg-jdb-blue-primary text-white">
          <Activity className="w-3 h-3 mr-1 animate-spin" />
          Bezig...
        </Badge>
      );
    case "blocked":
      return (
        <Badge variant="warning">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Geblokkeerd
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Fout
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-jdb-text-subtle">
          <Clock className="w-3 h-3 mr-1" />
          Nog niet gestart
        </Badge>
      );
  }
}

export const StageCardHeader = memo(function StageCardHeader({
  stageName,
  stageIcon,
  stageStatus,
  isExpanded,
  onToggleExpand,
  isProcessing,
  progress,
  blockReason,
}: StageCardHeaderProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggleExpand();
      }
    },
    [onToggleExpand]
  );

  return (
    <CardHeader
      className="cursor-pointer hover:bg-jdb-bg/50 dark:hover:bg-jdb-border/10 transition-colors"
      onClick={onToggleExpand}
      role="button"
      aria-expanded={isExpanded}
      aria-label={`${stageName} - ${isExpanded ? "Inklappen" : "Uitklappen"}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-jdb-text-subtle" />
          ) : (
            <ChevronRight className="w-5 h-5 text-jdb-text-subtle" />
          )}
          <div className="p-2 bg-jdb-blue-light dark:bg-jdb-blue-primary/10 rounded-lg">
            {stageIcon}
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              {stageName}
            </CardTitle>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {getStatusBadge(stageStatus)}
        </div>
      </div>

      {/* Progress Bar */}
      {isProcessing && progress && (
        <div className="mt-3 space-y-2">
          <Progress value={progress.progress} className="h-2" />
          <div className="flex justify-between text-xs text-gray-500">
            <span>{progress.status}</span>
            {progress.estimatedTime && (
              <span>~{Math.ceil(progress.estimatedTime / 1000)}s resterend</span>
            )}
          </div>
        </div>
      )}

      {/* Block Reason */}
      {stageStatus === "blocked" && blockReason && (
        <div className="mt-2 p-2 bg-orange-100 border border-orange-300 rounded text-sm text-orange-800">
          <AlertTriangle className="w-4 h-4 inline mr-2" />
          {blockReason}
        </div>
      )}
    </CardHeader>
  );
});
