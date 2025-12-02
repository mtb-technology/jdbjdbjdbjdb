/**
 * CaseHeader Component
 *
 * Document header with editable title and client name.
 * Extracted from case-detail.tsx lines 429-557.
 */

import { memo } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Calendar, User, GitBranch, Edit2, Save, X } from "lucide-react";
import type { CaseHeaderProps } from "@/types/caseDetail.types";

/**
 * Editable field component for inline editing
 */
interface EditableFieldProps {
  isEditing: boolean;
  value: string;
  displayValue: string;
  editedValue: string;
  isPending: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onChange: (value: string) => void;
  inputClassName?: string;
  iconSize?: "sm" | "md";
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
  iconSize = "md",
}: EditableFieldProps) {
  const iconClass = iconSize === "sm" ? "h-3 w-3" : "h-4 w-4";
  const buttonSize = iconSize === "sm" ? "h-7 px-2" : "";

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
          className={buttonSize}
        >
          <Save className={iconClass} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={isPending}
          className={buttonSize}
        >
          <X className={iconClass} />
        </Button>
      </div>
    );
  }

  return (
    <span className="flex items-center gap-2 group">
      <span>{displayValue}</span>
      <div
        role="button"
        tabIndex={0}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-accent rounded cursor-pointer"
        onClick={onEdit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            onEdit();
          }
        }}
      >
        <Edit2 className={iconClass} />
      </div>
    </span>
  );
});

export const CaseHeader = memo(function CaseHeader({
  report,
  isEditingTitle,
  isEditingClient,
  editedTitle,
  editedClient,
  isPending,
  onEditTitle,
  onEditClient,
  onSaveTitle,
  onSaveClient,
  onCancelEdit,
  onTitleChange,
  onClientChange,
  versionCheckpoints,
  currentVersion,
}: CaseHeaderProps) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle className="flex items-center space-x-2 text-2xl mb-2">
              <FileText className="h-6 w-6" />
              <EditableField
                isEditing={isEditingTitle}
                value={report.title}
                displayValue={report.title}
                editedValue={editedTitle}
                isPending={isPending}
                onEdit={onEditTitle}
                onSave={onSaveTitle}
                onCancel={() => onCancelEdit("title")}
                onChange={onTitleChange}
                inputClassName="text-2xl font-semibold h-10"
              />
            </CardTitle>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <User className="h-4 w-4" />
                <EditableField
                  isEditing={isEditingClient}
                  value={report.clientName}
                  displayValue={report.clientName}
                  editedValue={editedClient}
                  isPending={isPending}
                  onEdit={onEditClient}
                  onSave={onSaveClient}
                  onCancel={() => onCancelEdit("client")}
                  onChange={onClientChange}
                  inputClassName="h-7 text-sm w-48"
                  iconSize="sm"
                />
              </div>
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                <span>
                  Bijgewerkt:{" "}
                  {report.updatedAt
                    ? new Date(report.updatedAt).toLocaleDateString("nl-NL")
                    : "Onbekend"}
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
