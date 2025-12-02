/**
 * PipelineHeader Component
 *
 * Header section for the pipeline tab with stats and action buttons.
 * Extracted from lines 582-634 of settings.tsx.
 */

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Save, Download, Upload } from "lucide-react";
import type { PipelineHeaderProps } from "@/types/settings.types";

export const PipelineHeader = memo(function PipelineHeader({
  stats,
  isSaving,
  onSave,
  onBackup,
  onRestoreClick,
  fileInputRef,
  onRestore,
}: PipelineHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold">Prompt Configuratie</h2>
        <p className="text-sm text-muted-foreground">
          Configureer de workflow prompts voor fiscale rapportgeneratie
        </p>
      </div>

      <div className="flex items-center space-x-4">
        <div className="text-right">
          <div className="text-2xl font-bold text-foreground">
            {stats.completed}/{stats.total}
          </div>
          <div className="text-xs text-muted-foreground">Prompts Ingesteld</div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={onBackup}
            variant="outline"
            size="sm"
            data-testid="button-export-json"
          >
            <Download className="h-4 w-4 mr-2" />
            Export JSON
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={onRestore}
            className="hidden"
            data-testid="input-import-file"
          />
          <Button
            onClick={onRestoreClick}
            variant="outline"
            size="sm"
            data-testid="button-import-json"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import JSON
          </Button>
          <Button
            onClick={onSave}
            disabled={isSaving}
            data-testid="button-save-config"
          >
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? "Opslaan..." : "Opslaan"}
          </Button>
        </div>
      </div>
    </div>
  );
});
