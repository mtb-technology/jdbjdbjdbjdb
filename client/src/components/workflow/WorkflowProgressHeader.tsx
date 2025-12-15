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
import { CheckCircle, Clock, Workflow, RefreshCw, Pencil, Eye, Settings, Zap } from "lucide-react";
import { ExpressModeButton } from "./ExpressModeButton";
import { ExpressModeResults } from "./ExpressModeResults";
import { ReportAdjustmentDialog } from "./ReportAdjustmentDialog";
import { WORKFLOW_STAGES } from "./constants";
import { countCompletedStages } from "@/utils/workflowUtils";
import { getLatestConceptText } from "@shared/constants";

interface WorkflowProgressHeaderProps {
  stageResults: Record<string, string>;
  conceptReportVersions: Record<string, unknown>;
  currentStageLabel: string;
  progressPercentage: number;
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
  currentStageLabel,
  progressPercentage,
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

            {/* Stats and Actions */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4 flex-shrink-0">
              {/* Completed Steps Badge */}
              <motion.div whileHover={shouldReduceMotion ? {} : { scale: 1.05 }} className="inline-flex">
                <Badge
                  variant="outline"
                  className="text-sm font-semibold px-4 py-2 bg-white dark:bg-jdb-panel"
                >
                  <CheckCircle className="h-4 w-4 mr-2 text-jdb-success" />
                  {completedCount}/{WORKFLOW_STAGES.length} Stappen
                </Badge>
              </motion.div>

              {/* Processing Time */}
              {totalProcessingTime > 0 && (
                <motion.div
                  className="flex items-center gap-2 text-sm text-jdb-text-body font-medium"
                  initial={shouldReduceMotion ? false : { opacity: 0 }}
                  animate={shouldReduceMotion ? false : { opacity: 1 }}
                  transition={shouldReduceMotion ? {} : { delay: 0.3 }}
                >
                  <div className="p-2 rounded-lg bg-jdb-blue-light dark:bg-jdb-blue-primary/20">
                    <Clock className="h-4 w-4 text-jdb-blue-primary" />
                  </div>
                  {totalProcessingTime}s totale tijd
                </motion.div>
              )}

              {/* Express Mode Badge - show when all review stages are completed */}
              {allReviewStagesCompleted && (
                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.9 }}
                  animate={shouldReduceMotion ? false : { opacity: 1, scale: 1 }}
                  className="inline-flex"
                >
                  <Badge
                    variant="default"
                    className="text-sm font-semibold px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white"
                  >
                    <Zap className="h-3.5 w-3.5 mr-1.5" />
                    Express Mode
                  </Badge>
                </motion.div>
              )}

              {/* Express Mode Button - available after stage 2 OR stage 3, but not if all review stages done */}
              {reportId && (hasStage2 || hasStage3) && !allReviewStagesCompleted && (
                <motion.div whileHover={shouldReduceMotion ? {} : { scale: 1.05 }} className="inline-flex">
                  <ExpressModeButton
                    reportId={reportId}
                    onComplete={onExpressComplete}
                    includeGeneration={!hasStage3}
                    hasStage3={hasStage3}
                  />
                </motion.div>
              )}

              {/* Rapport Aanpassen Button - only after Stage 3 */}
              {reportId && hasStage3 && (
                <motion.div whileHover={shouldReduceMotion ? {} : { scale: 1.05 }} className="inline-flex">
                  <Button
                    onClick={() => setIsAdjustmentDialogOpen(true)}
                    variant="outline"
                    size="sm"
                    className="text-sm font-medium"
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Rapport Aanpassen
                  </Button>
                </motion.div>
              )}

              {/* Bekijk Wijzigingen Button - only when all review stages are completed */}
              {reportId && allReviewStagesCompleted && (
                <motion.div whileHover={shouldReduceMotion ? {} : { scale: 1.05 }} className="inline-flex">
                  <Button
                    onClick={() => setShowExpressResults(true)}
                    variant="outline"
                    size="sm"
                    className="text-sm font-medium"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Bekijk Wijzigingen
                  </Button>
                </motion.div>
              )}

              {/* Settings Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0">
                    <Settings className="h-4 w-4" />
                    <span className="sr-only">Instellingen</span>
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
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-muted-foreground text-xs"
                    disabled
                  >
                    Meer opties binnenkort...
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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

          {/* Progress Bar */}
          <motion.div
            className="mt-6 space-y-3"
            initial={shouldReduceMotion ? false : { opacity: 0 }}
            animate={shouldReduceMotion ? false : { opacity: 1 }}
            transition={shouldReduceMotion ? {} : { delay: 0.2 }}
          >
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-jdb-text-heading">
                Voortgang: {progressPercentage}%
              </span>
              <span className="text-sm text-jdb-text-subtle">{currentStageLabel}</span>
            </div>
            <div className="relative">
              <div className="h-3 bg-jdb-border dark:bg-jdb-border/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-jdb-blue-primary rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
            </div>
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  );
});
