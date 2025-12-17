/**
 * CaseHeader Component
 *
 * Document header showing dossier number (read-only), editable client name,
 * and workflow progress/actions.
 */

import { memo, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileText, Calendar, Edit2, Save, X, CheckCircle, MoreHorizontal, Pencil, Eye, RefreshCw } from "lucide-react";
import type { CaseHeaderProps } from "@/types/caseDetail.types";
import { ExpressModeButton } from "@/components/workflow/ExpressModeButton";
import { ExpressModeResults } from "@/components/workflow/ExpressModeResults";
import { ReportAdjustmentDialog } from "@/components/workflow/ReportAdjustmentDialog";
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
}: CaseHeaderProps) {
  const [isAdjustmentDialogOpen, setIsAdjustmentDialogOpen] = useState(false);
  const [showExpressResults, setShowExpressResults] = useState(false);

  // Extract dossier number from title (e.g., "D-0044 - Client" -> "D-0044")
  const dossierNumber = report.title.match(/^D-\d{4}/)?.[0] || `D-${String(report.dossierNumber || 0).padStart(4, '0')}`;

  // Workflow calculations
  const completedCount = countCompletedStages(stageResults, conceptReportVersions);
  const hasStage2 = !!stageResults["2_complexiteitscheck"];
  const hasStage3 = !!conceptReportVersions["3_generatie"] || !!(conceptReportVersions as any)?.latest;
  const allReviewStagesCompleted = REVIEW_STAGES.every(key => !!stageResults[key]);
  const latestConceptContent = getLatestConceptText(conceptReportVersions as any);
  const latestVersion = (conceptReportVersions as any)?.latest?.v || 1;

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

            {/* Date - compact */}
            <span className="text-sm text-muted-foreground hidden sm:block">
              <Calendar className="h-3.5 w-3.5 inline mr-1" />
              {new Date(report.updatedAt ?? report.createdAt ?? new Date()).toLocaleDateString("nl-NL")}
            </span>
          </div>

          {/* Right side: Workflow controls */}
          <div className="flex items-center gap-3">
            {/* Progress Badge */}
            <Badge variant="outline" className="text-sm font-medium px-3 py-1.5">
              <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
              {completedCount}/{WORKFLOW_STAGES.length}
            </Badge>

            {/* Express Mode OR Completed Badge */}
            {report.id && allReviewStagesCompleted ? (
              <Badge className="bg-green-600 text-white px-3 py-1.5">
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                Voltooid
              </Badge>
            ) : report.id && (hasStage2 || hasStage3) && onExpressComplete ? (
              <ExpressModeButton
                reportId={report.id}
                onComplete={onExpressComplete}
                includeGeneration={!hasStage3}
                hasStage3={hasStage3}
              />
            ) : null}

            {/* Actions Menu */}
            {report.id && hasStage3 && (
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
