/**
 * CaseHeader Component
 *
 * Document header showing dossier number (read-only), editable client name,
 * and workflow progress/actions.
 */

import { memo, useState, useMemo } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileText, Edit2, Save, X, MoreHorizontal, Pencil, Eye, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CaseHeaderProps } from "@/types/caseDetail.types";
import { ExpressModeButton } from "@/components/workflow/ExpressModeButton";
import { ExpressModeResults } from "@/components/workflow/ExpressModeResults";
import { ReportAdjustmentDialog } from "@/components/workflow/ReportAdjustmentDialog";
import { ExportDialog } from "@/components/export/ExportDialog";
import { WORKFLOW_STAGES } from "@/components/workflow/constants";
import { countCompletedStages } from "@/utils/workflowUtils";
import { getLatestConceptText } from "@shared/constants";
import { REVIEW_STAGES } from "@shared/constants";

/**
 * Editable field component for inline editing
 */
interface EditableFieldProps {
  isEditing: boolean;
  displayValue: string;
  editedValue: string;
  isPending: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onChange: (value: string) => void;
  inputClassName?: string;
}

const EditableField = memo(function EditableField({
  isEditing,
  displayValue,
  editedValue,
  isPending,
  onEdit,
  onSave,
  onCancel,
  onChange,
  inputClassName = "",
}: EditableFieldProps) {
  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={editedValue}
          onChange={(e) => onChange(e.target.value)}
          className={inputClassName}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
            if (e.key === "Escape") onCancel();
          }}
        />
        <Button
          size="sm"
          onClick={onSave}
          disabled={isPending}
        >
          <Save className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={isPending}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <span className="flex items-center gap-2 group">
      <span>{displayValue}</span>
      <button
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-accent rounded"
        onClick={onEdit}
      >
        <Edit2 className="h-4 w-4" />
      </button>
    </span>
  );
});

export const CaseHeader = memo(function CaseHeader({
  report,
  isEditingClient,
  editedClient,
  isPending,
  onEditClient,
  onSaveClient,
  onCancelEdit,
  onClientChange,
  // Workflow props
  stageResults = {},
  conceptReportVersions = {},
  onExpressComplete,
  onAdjustmentApplied,
  isReloadingPrompts = false,
  onReloadPrompts,
  rolledBackChanges,
  // Header action props
  onShowPreview,
  reportId,
}: CaseHeaderProps) {
  const [isAdjustmentDialogOpen, setIsAdjustmentDialogOpen] = useState(false);
  const [showExpressResults, setShowExpressResults] = useState(false);

  // Extract dossier number from title (e.g., "D-0044 - Client" -> "D-0044")
  const dossierNumber = report.title.match(/^D-\d{4}/)?.[0] || `D-${String(report.dossierNumber || 0).padStart(4, '0')}`;

  // Workflow calculations
  const completedCount = countCompletedStages(stageResults, conceptReportVersions);
  const totalStages = WORKFLOW_STAGES.length;
  const hasStage2 = !!stageResults["2_complexiteitscheck"];
  const hasStage3 = !!conceptReportVersions["3_generatie"] || !!(conceptReportVersions as any)?.latest;
  const allReviewStagesCompleted = REVIEW_STAGES.every(key => !!stageResults[key]);
  const latestConceptContent = getLatestConceptText(conceptReportVersions as any);
  const latestVersion = (conceptReportVersions as any)?.latest?.v || 1;

  // Progress info for progress bar
  const progressInfo = useMemo(() => {
    const percentage = Math.round((completedCount / totalStages) * 100);
    let status: "not-started" | "in-progress" | "complete" = "not-started";
    let statusLabel = "Niet gestart";

    if (completedCount === totalStages) {
      status = "complete";
      statusLabel = "Voltooid";
    } else if (completedCount > 0) {
      status = "in-progress";
      statusLabel = `${completedCount} van ${totalStages}`;
    }

    return { percentage, status, statusLabel };
  }, [completedCount, totalStages]);

  return (
    <Card className="mb-6">
      <CardHeader className="py-4">
        <div className="flex items-center justify-between">
          {/* Left side: Dossier info */}
          <div className="flex items-center gap-4">
            {/* Dossier Number Badge */}
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {dossierNumber}
              </span>
            </div>

            {/* Client Name - Editable */}
            <h1 className="text-xl font-semibold">
              <EditableField
                isEditing={isEditingClient}
                displayValue={report.clientName}
                editedValue={editedClient}
                isPending={isPending}
                onEdit={onEditClient}
                onSave={onSaveClient}
                onCancel={() => onCancelEdit("client")}
                onChange={onClientChange}
                inputClassName="text-xl font-semibold h-9 w-56"
              />
            </h1>
          </div>

          {/* Right side: Workflow controls */}
          <div className="flex items-center gap-3">
            {/* Progress Bar - wider */}
            <div className="w-32">
              <div className="flex items-center justify-end text-xs mb-1">
                <span className={cn(
                  "font-medium",
                  progressInfo.status === "complete" ? "text-emerald-600" :
                  progressInfo.status === "in-progress" ? "text-amber-600" :
                  "text-muted-foreground"
                )}>
                  {progressInfo.statusLabel}
                </span>
              </div>
              <Progress
                value={progressInfo.percentage}
                className={cn(
                  "h-1.5",
                  progressInfo.status === "complete" && "[&>div]:bg-emerald-500",
                  progressInfo.status === "in-progress" && "[&>div]:bg-amber-500"
                )}
              />
            </div>

            {/* Actions Menu - show after Stage 2 */}
            {report.id && hasStage2 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9">
                    <MoreHorizontal className="h-4 w-4 mr-1" />
                    Acties
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {/* Express Mode - only show when not all reviews completed */}
                  {!allReviewStagesCompleted && onExpressComplete && (
                    <>
                      <DropdownMenuItem asChild>
                        <ExpressModeButton
                          reportId={report.id}
                          onComplete={onExpressComplete}
                          includeGeneration={!hasStage3}
                          hasStage3={hasStage3}
                          variant="menuItem"
                        />
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {hasStage3 && (
                    <DropdownMenuItem onClick={() => setIsAdjustmentDialogOpen(true)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Rapport Aanpassen
                    </DropdownMenuItem>
                  )}
                  {allReviewStagesCompleted && (
                    <DropdownMenuItem onClick={() => setShowExpressResults(true)}>
                      <Eye className="h-4 w-4 mr-2" />
                      Bekijk Wijzigingen
                    </DropdownMenuItem>
                  )}
                  {onReloadPrompts && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onReloadPrompts} disabled={isReloadingPrompts}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${isReloadingPrompts ? "animate-spin" : ""}`} />
                        Herlaad Prompts
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Preview Button - show when Stage 3 has content */}
            {hasStage3 && onShowPreview && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={onShowPreview}
              >
                <Eye className="h-4 w-4 mr-1.5" />
                Preview
              </Button>
            )}

            {/* Export Button */}
            {(reportId || report.id) && (
              <ExportDialog
                reportId={reportId || report.id}
                reportTitle={report.title}
                clientName={report.clientName}
              />
            )}
          </div>
        </div>
      </CardHeader>

      {/* Dialogs */}
      {report.id && (
        <ReportAdjustmentDialog
          reportId={report.id}
          isOpen={isAdjustmentDialogOpen}
          onOpenChange={setIsAdjustmentDialogOpen}
          onAdjustmentApplied={onAdjustmentApplied}
        />
      )}

      {showExpressResults && report.id && (
        <ExpressModeResults
          reportId={report.id}
          stageResults={stageResults}
          finalContent={latestConceptContent}
          finalVersion={latestVersion}
          initialRolledBackChanges={rolledBackChanges}
          fiscaleBriefing={stageResults['7_fiscale_briefing']}
          onClose={() => setShowExpressResults(false)}
          onSaveComplete={onAdjustmentApplied}
        />
      )}
    </Card>
  );
});
