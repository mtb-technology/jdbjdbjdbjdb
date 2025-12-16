/**
 * CaseHeader Component
 *
 * Document header showing dossier number (read-only) and editable client name.
 * Title is auto-generated as "D-{dossierNumber} - {clientName}".
 */

import { memo } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Calendar, GitBranch, Edit2, Save, X } from "lucide-react";
import type { CaseHeaderProps } from "@/types/caseDetail.types";

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
  versionCheckpoints,
  currentVersion,
}: CaseHeaderProps) {
  // Extract dossier number from title (e.g., "D-0044 - Client" -> "D-0044")
  const dossierNumber = report.title.match(/^D-\d{4}/)?.[0] || `D-${String(report.dossierNumber || 0).padStart(4, '0')}`;

  return (
    <Card className="mb-6">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {/* Dossier Number - Fixed/System field */}
            <div className="flex items-center gap-3 mb-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {dossierNumber}
              </span>
            </div>

            {/* Client Name - Editable, this becomes the title */}
            <h1 className="text-2xl font-bold tracking-tight mb-3">
              <EditableField
                isEditing={isEditingClient}
                displayValue={report.clientName}
                editedValue={editedClient}
                isPending={isPending}
                onEdit={onEditClient}
                onSave={onSaveClient}
                onCancel={() => onCancelEdit("client")}
                onChange={onClientChange}
                inputClassName="text-2xl font-bold h-10 w-64"
              />
            </h1>

            {/* Metadata row */}
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                <span>
                  {report.updatedAt
                    ? new Date(report.updatedAt).toLocaleDateString("nl-NL")
                    : new Date(report.createdAt).toLocaleDateString("nl-NL")}
                </span>
              </div>
              {versionCheckpoints.length > 0 && (
                <div className="flex items-center gap-1">
                  <GitBranch className="h-4 w-4" />
                  <span>
                    Versie {currentVersion} van {versionCheckpoints.length}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
});
