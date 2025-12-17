/**
 * WorkflowProgressHeader Component
 *
 * Progress header section for the workflow view.
 * Extracted from lines 437-571 of WorkflowView.tsx.
 */

import { memo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle, Clock, Workflow, RefreshCw, Pencil, Eye, Settings, Zap, MoreHorizontal } from "lucide-react";
import { ExpressModeButton } from "./ExpressModeButton";
import { ExpressModeResults } from "./ExpressModeResults";
import { ReportAdjustmentDialog } from "./ReportAdjustmentDialog";
import { WORKFLOW_STAGES } from "./constants";
import { countCompletedStages } from "@/utils/workflowUtils";
import { getLatestConceptText } from "@shared/constants";

interface WorkflowProgressHeaderProps {
  stageResults: Record<string, string>;
  conceptReportVersions: Record<string, unknown>;
  totalProcessingTime: number;
  isReloadingPrompts: boolean;
  onReloadPrompts: () => void;
  reportId?: string;
  hasStage2: boolean; // Complexiteitscheck completed
  hasStage3: boolean; // Generatie completed
  onExpressComplete: () => void;
  /** Callback when report adjustments are applied - use to refresh editor content */
  onAdjustmentApplied?: () => void;
  /** Rolled back changes from database - persists between page loads */
  rolledBackChanges?: Record<string, { rolledBackAt: string }>;
  /** Whether all review stages (4a-4f) are completed */
  allReviewStagesCompleted?: boolean;
}

export const WorkflowProgressHeader = memo(function WorkflowProgressHeader({
  stageResults,
  conceptReportVersions,
  totalProcessingTime,
  isReloadingPrompts,
  onReloadPrompts,
  reportId,
  hasStage2,
  hasStage3,
  onExpressComplete,
  onAdjustmentApplied,
  rolledBackChanges,
  allReviewStagesCompleted,
}: WorkflowProgressHeaderProps) {
  const shouldReduceMotion = useReducedMotion();
  const [isAdjustmentDialogOpen, setIsAdjustmentDialogOpen] = useState(false);
  const [showExpressResults, setShowExpressResults] = useState(false);

  // Get latest concept content for ExpressModeResults
  const latestConceptContent = getLatestConceptText(conceptReportVersions as any);
  const latestVersion = (conceptReportVersions as any)?.latest?.v || 1;

  const completedCount = countCompletedStages(stageResults, conceptReportVersions);

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
      animate={shouldReduceMotion ? false : { opacity: 1, y: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.5 }}
    >
      <Card className="bg-white dark:bg-jdb-panel border-jdb-border">
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            {/* Title Section */}
            <motion.div
              className="flex items-center gap-4"
              whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
              transition={shouldReduceMotion ? {} : { type: "spring", stiffness: 400, damping: 17 }}
            >
              <div className="p-4 rounded-xl bg-jdb-blue-primary shadow-sm">
                <Workflow className="h-6 w-6 md:h-7 md:w-7 text-white" />
              </div>
              <div>
                <h2 className="text-xl md:text-2xl font-semibold text-jdb-text-heading">
                  Fiscale Rapport Workflow
                </h2>
                <p className="text-sm text-jdb-text-subtle font-medium">
                  AI-gedreven fiscale analyse systeem
                </p>
              </div>
            </motion.div>

            {/* Stats and Actions - Simplified */}
            <div className="flex items-center gap-3">
              {/* Progress Badge */}
              <Badge
                variant="outline"
                className="text-sm font-medium px-3 py-1.5 bg-white dark:bg-jdb-panel"
              >
                <CheckCircle className="h-4 w-4 mr-2 text-jdb-success" />
                {completedCount}/{WORKFLOW_STAGES.length}
              </Badge>

              {/* Processing Time - compact */}
              {totalProcessingTime > 0 && (
                <span className="text-sm text-jdb-text-subtle hidden sm:flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {totalProcessingTime}s
                </span>
              )}

              {/* Primary Action: Express Mode OR Completed Badge */}
              {reportId && allReviewStagesCompleted ? (
                <Badge className="bg-jdb-success text-white px-3 py-1.5">
                  <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                  Voltooid
                </Badge>
              ) : reportId && (hasStage2 || hasStage3) ? (
                <ExpressModeButton
                  reportId={reportId}
                  onComplete={onExpressComplete}
                  includeGeneration={!hasStage3}
                  hasStage3={hasStage3}
                />
              ) : null}

              {/* Actions Menu - consolidated */}
              {reportId && hasStage3 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9">
                      <MoreHorizontal className="h-4 w-4 mr-1" />
                      Acties
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => setIsAdjustmentDialogOpen(true)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Rapport Aanpassen
                    </DropdownMenuItem>
                    {allReviewStagesCompleted && (
                      <DropdownMenuItem onClick={() => setShowExpressResults(true)}>
                        <Eye className="h-4 w-4 mr-2" />
                        Bekijk Wijzigingen
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onReloadPrompts}
                      disabled={isReloadingPrompts}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${isReloadingPrompts ? "animate-spin" : ""}`} />
                      Herlaad Prompts
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Settings - only show if no actions menu */}
              {!(reportId && hasStage3) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-9 w-9 p-0">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      onClick={onReloadPrompts}
                      disabled={isReloadingPrompts}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${isReloadingPrompts ? "animate-spin" : ""}`} />
                      Herlaad Prompts
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* Adjustment Dialog */}
          {reportId && (
            <ReportAdjustmentDialog
              reportId={reportId}
              isOpen={isAdjustmentDialogOpen}
              onOpenChange={setIsAdjustmentDialogOpen}
              onAdjustmentApplied={onAdjustmentApplied}
            />
          )}

          {/* Express Mode Results View - rebuilt from stageResults */}
          {showExpressResults && reportId && (
            <ExpressModeResults
              reportId={reportId}
              stageResults={stageResults}
              finalContent={latestConceptContent}
              finalVersion={latestVersion}
              initialRolledBackChanges={rolledBackChanges}
              fiscaleBriefing={stageResults['7_fiscale_briefing']}
              onClose={() => setShowExpressResults(false)}
              onSaveComplete={onAdjustmentApplied}
            />
          )}

        </CardContent>
      </Card>
    </motion.div>
  );
});
