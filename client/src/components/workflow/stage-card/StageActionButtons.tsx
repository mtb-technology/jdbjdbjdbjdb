/**
 * StageActionButtons Component
 *
 * Action buttons for executing, re-running, and resetting workflow stages.
 * Extracted from WorkflowStageCard.tsx lines 426-509.
 */

import { memo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  RefreshCw,
  Trash2,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Zap,
  Scale,
  BookOpen,
  Upload,
  FileText,
  X,
  Loader2,
  Paperclip,
  Info,
} from "lucide-react";
import { ExpressModeButton } from "../ExpressModeButton";
import type { StageActionButtonsProps, ReportDepth, PendingFile } from "@/types/workflowStageCard.types";

/**
 * Custom context input section
 */
interface CustomContextSectionProps {
  stageKey: string;
  stageStatus: string;
  customContext: string;
  showCustomContext: boolean;
  onToggleCustomContext: () => void;
  onCustomContextChange: (value: string) => void;
  // Attachment props for Stage 1a
  pendingAttachments?: PendingFile[];
  onAttachmentsChange?: (files: PendingFile[]) => void;
  isUploadingAttachments?: boolean;
}

const CustomContextSection = memo(function CustomContextSection({
  stageKey,
  stageStatus,
  customContext,
  showCustomContext,
  onToggleCustomContext,
  onCustomContextChange,
  pendingAttachments = [],
  onAttachmentsChange,
  isUploadingAttachments = false,
}: CustomContextSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isStage1a = stageKey === "1a_informatiecheck";

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0 || !onAttachmentsChange) return;

    const newFiles: PendingFile[] = Array.from(files).map(file => ({
      file,
      name: file.name,
      size: file.size,
      type: file.type,
    }));

    onAttachmentsChange([...pendingAttachments, ...newFiles]);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (fileName: string) => {
    if (!onAttachmentsChange) return;
    onAttachmentsChange(pendingAttachments.filter(f => f.name !== fileName));
  };

  const isRerun = stageStatus === "completed";

  return (
    <div className="bg-purple-50 dark:bg-purple-950/20 border-2 border-purple-200 dark:border-purple-800 rounded-lg p-4">
      <button
        onClick={onToggleCustomContext}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-start gap-3">
          <MessageSquare className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-semibold text-sm text-purple-900 dark:text-purple-100 flex items-center gap-1.5">
              {isRerun
                ? "Extra Context & Bijlages voor Re-run"
                : "Extra Context (optioneel)"}
              {/* Subtle info tooltip for re-run on Stage 1a */}
              {isStage1a && isRerun && (
                <span className="relative group">
                  <Info className="w-3.5 h-3.5 text-purple-400 hover:text-purple-600 cursor-help" />
                  <span className="absolute left-0 top-full mt-1 w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                    Re-run bouwt voort op vorige analyse. De AI weet wat er ontbrak en markeert opgeloste items automatisch.
                  </span>
                </span>
              )}
            </h4>
            <p className="text-xs text-purple-700 dark:text-purple-300 mt-1">
              {isStage1a && isRerun
                ? "Upload aanvullende documenten of voeg extra instructies toe"
                : isStage1a
                  ? "Voeg extra instructies of context toe die de AI moet gebruiken"
                  : "Voeg extra instructies of context toe die de AI moet gebruiken"}
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
          {/* Attachment upload for Stage 1a */}
          {isStage1a && onAttachmentsChange && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.jpg,.jpeg,.png"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingAttachments}
                  className="gap-2 border-purple-300 hover:border-purple-400 hover:bg-purple-100"
                >
                  {isUploadingAttachments ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Uploaden...</>
                  ) : (
                    <><Upload className="h-4 w-4" /> {isRerun ? "Aanvullende Bijlages" : "Extra Bijlages"}</>
                  )}
                </Button>
                <span className="text-xs text-purple-600">PDF, TXT, JPG, PNG</span>
              </div>

              {/* Pending files badges */}
              {pendingAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pendingAttachments.map((file) => (
                    <Badge key={file.name} variant="secondary" className="gap-2 pr-1 bg-purple-100 text-purple-800">
                      <FileText className="h-3 w-3" />
                      <span className="text-xs">{file.name}</span>
                      <span className="text-xs text-purple-600">
                        ({Math.round(file.size / 1024)}KB)
                      </span>
                      <button
                        onClick={() => handleRemoveFile(file.name)}
                        className="ml-1 hover:bg-purple-200 rounded-sm p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          <Textarea
            value={customContext}
            onChange={(e) => onCustomContextChange(e.target.value)}
            placeholder={isStage1a && isRerun
              ? "Bijv: 'Hierbij de gevraagde bankafschriften. Let op: de waarde van het pand is €450k (zie taxatierapport).'"
              : "Bijv: 'De klant heeft bevestigd dat het vermogen €500k is, niet €300k zoals eerder vermeld. Neem dit mee in de analyse.'"}
            className="min-h-[100px] text-sm"
          />
          <div className="flex items-start gap-2 text-xs text-purple-700 dark:text-purple-300">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>
              {isStage1a && isRerun
                ? pendingAttachments.length > 0
                  ? `${pendingAttachments.length} nieuwe bijlage(s) worden toegevoegd aan de bestaande bijlages. Alle documenten worden opnieuw geanalyseerd.`
                  : "Alle eerder geüploade bijlages worden automatisch meegenomen. Upload hier alleen aanvullende documenten."
                : "Deze context wordt toegevoegd aan de originele prompt. De AI zal rekening houden met deze extra informatie."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Report depth selector for Stage 3
 */
interface ReportDepthSelectorProps {
  reportDepth: ReportDepth;
  onReportDepthChange: (depth: ReportDepth) => void;
}

const DEPTH_OPTIONS: { value: ReportDepth; label: string; description: string; icon: typeof Zap; pages: string }[] = [
  {
    value: "concise",
    label: "Beknopt",
    description: "To-the-point, alleen de essentie",
    icon: Zap,
    pages: "~3-5 pagina's"
  },
  {
    value: "balanced",
    label: "Gebalanceerd",
    description: "Degelijk rapport met onderbouwing",
    icon: Scale,
    pages: "~6-10 pagina's"
  },
  {
    value: "comprehensive",
    label: "Uitgebreid",
    description: "Maximale diepgang en detail",
    icon: BookOpen,
    pages: "~10-15 pagina's"
  },
];

const ReportDepthSelector = memo(function ReportDepthSelector({
  reportDepth,
  onReportDepthChange,
}: ReportDepthSelectorProps) {
  return (
    <div className="bg-blue-50 dark:bg-blue-950/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg p-4">
      <div className="flex items-start gap-3 mb-3">
        <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-100">
            Rapport Diepgang
          </h4>
          <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
            Kies hoeveel detail en onderbouwing het rapport moet bevatten
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {DEPTH_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = reportDepth === option.value;
          return (
            <button
              key={option.value}
              onClick={() => onReportDepthChange(option.value)}
              className={`
                flex flex-col items-center p-3 rounded-lg border-2 transition-all
                ${isSelected
                  ? "border-blue-500 bg-blue-100 dark:bg-blue-900/40"
                  : "border-gray-200 dark:border-gray-700 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                }
              `}
            >
              <Icon className={`w-5 h-5 mb-1 ${isSelected ? "text-blue-600" : "text-gray-500"}`} />
              <span className={`text-sm font-medium ${isSelected ? "text-blue-700 dark:text-blue-300" : "text-gray-700 dark:text-gray-300"}`}>
                {option.label}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {option.pages}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-blue-600 dark:text-blue-400 mt-3 text-center">
        {DEPTH_OPTIONS.find(o => o.value === reportDepth)?.description}
      </p>
    </div>
  );
});

export const StageActionButtons = memo(function StageActionButtons({
  stageKey,
  stageStatus,
  canExecute,
  isProcessing,
  customContext,
  showCustomContext,
  onToggleCustomContext,
  onCustomContextChange,
  onExecute,
  onResetStage,
  onCancel,
  reportDepth = "balanced",
  onReportDepthChange,
  reportId,
  showExpressMode,
  hasStage3,
  onExpressComplete,
  pendingAttachments,
  onAttachmentsChange,
  isUploadingAttachments,
  blockReason,
}: StageActionButtonsProps) {
  // Check if this is Stage 3 (generatie)
  const isStage3 = stageKey === "3_generatie";
  // Check if this is Stage 2 (complexiteitscheck)
  const isStage2 = stageKey === "2_complexiteitscheck";
  // Execution is blocked if there's a blockReason
  const isBlocked = !!blockReason;
  // Effective canExecute takes blockReason into account
  const effectiveCanExecute = canExecute && !isBlocked;

  return (
    <div className="space-y-3">
      {/* Block Reason Warning - Show when stage is blocked */}
      {isBlocked && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
          <Loader2 className="w-4 h-4 text-amber-600 animate-spin flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">Stage geblokkeerd</p>
            <p className="text-xs text-amber-700 mt-0.5">{blockReason}</p>
          </div>
        </div>
      )}

      {/* Report Depth Selector - Only show for Stage 3 */}
      {isStage3 && effectiveCanExecute && onReportDepthChange && (
        <ReportDepthSelector
          reportDepth={reportDepth}
          onReportDepthChange={onReportDepthChange}
        />
      )}

      {/* Custom Context Section - Always show when stage can execute */}
      {effectiveCanExecute && (
        <CustomContextSection
          stageKey={stageKey}
          stageStatus={stageStatus}
          customContext={customContext}
          showCustomContext={showCustomContext}
          onToggleCustomContext={onToggleCustomContext}
          onCustomContextChange={onCustomContextChange}
          pendingAttachments={pendingAttachments}
          onAttachmentsChange={onAttachmentsChange}
          isUploadingAttachments={isUploadingAttachments}
        />
      )}

      <div className="flex gap-2">
        {/* Cancel button - only show when processing */}
        {isProcessing && onCancel && (
          <Button
            onClick={onCancel}
            variant="ghost"
            size="icon"
            className="text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            title="Stop AI uitvoering"
          >
            <X className="w-4 h-4" />
          </Button>
        )}

        <Button
          onClick={onExecute}
          disabled={!effectiveCanExecute || isProcessing}
          className="flex-1"
          variant={stageStatus === "completed" ? "outline" : "default"}
          title={isBlocked ? blockReason : undefined}
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

        {/* Express Mode Button - Show for Stage 2 (completed) or Stage 3+ */}
        {showExpressMode && reportId && onExpressComplete && (
          <ExpressModeButton
            reportId={reportId}
            onComplete={onExpressComplete}
            includeGeneration={isStage2 || (isStage3 && !hasStage3)}
            hasStage3={hasStage3}
          />
        )}

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
