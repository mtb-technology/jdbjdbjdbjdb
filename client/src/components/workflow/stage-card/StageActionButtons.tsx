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
  Scale,
  BookOpen,
  Upload,
  FileText,
  X,
  Loader2,
  Paperclip,
  Info,
  Languages,
  Zap,
} from "lucide-react";
import { ExpressModeButton } from "../ExpressModeButton";
import type { StageActionButtonsProps, ReportDepth, ReportLanguage, PendingFile } from "@/types/workflowStageCard.types";

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
  const hasContent = customContext.trim().length > 0 || pendingAttachments.length > 0;

  // Collapsed state: just a subtle text link
  if (!showCustomContext) {
    return (
      <button
        onClick={onToggleCustomContext}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <MessageSquare className="w-3.5 h-3.5" />
        <span>+ Context toevoegen</span>
        {hasContent && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
            {pendingAttachments.length > 0 ? `${pendingAttachments.length} bijlage(s)` : "ingevuld"}
          </Badge>
        )}
      </button>
    );
  }

  // Expanded state: full input panel
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Extra context</span>
        <button
          onClick={onToggleCustomContext}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Sluiten
        </button>
      </div>

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
              className="gap-2 h-8 text-xs"
            >
              {isUploadingAttachments ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploaden...</>
              ) : (
                <><Upload className="h-3.5 w-3.5" /> Bijlages</>
              )}
            </Button>
            <span className="text-[10px] text-muted-foreground">PDF, TXT, JPG, PNG</span>
          </div>

          {/* Pending files badges */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pendingAttachments.map((file) => (
                <Badge key={file.name} variant="secondary" className="gap-1 pr-0.5 text-[10px]">
                  <FileText className="h-3 w-3" />
                  <span>{file.name}</span>
                  <button
                    onClick={() => handleRemoveFile(file.name)}
                    className="ml-0.5 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-sm p-0.5"
                  >
                    <X className="h-2.5 w-2.5" />
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
        placeholder="Extra instructies voor de AI..."
        className="min-h-[60px] text-sm resize-none"
      />
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

/**
 * Report language selector for Stage 3
 */
interface ReportLanguageSelectorProps {
  reportLanguage: ReportLanguage;
  onReportLanguageChange: (language: ReportLanguage) => void;
}

const LANGUAGE_OPTIONS: { value: ReportLanguage; label: string; flag: string }[] = [
  {
    value: "nl",
    label: "Nederlands",
    flag: "🇳🇱"
  },
  {
    value: "en",
    label: "English",
    flag: "🇬🇧"
  },
];

const ReportLanguageSelector = memo(function ReportLanguageSelector({
  reportLanguage,
  onReportLanguageChange,
}: ReportLanguageSelectorProps) {
  return (
    <div className="bg-green-50 dark:bg-green-950/20 border-2 border-green-200 dark:border-green-800 rounded-lg p-4">
      <div className="flex items-start gap-3 mb-3">
        <Languages className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="font-semibold text-sm text-green-900 dark:text-green-100">
            Rapport Taal
          </h4>
          <p className="text-xs text-green-700 dark:text-green-300 mt-1">
            In welke taal moet het rapport worden geschreven?
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {LANGUAGE_OPTIONS.map((option) => {
          const isSelected = reportLanguage === option.value;
          return (
            <button
              key={option.value}
              onClick={() => onReportLanguageChange(option.value)}
              className={`
                flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all
                ${isSelected
                  ? "border-green-500 bg-green-100 dark:bg-green-900/40"
                  : "border-gray-200 dark:border-gray-700 hover:border-green-300 hover:bg-green-50 dark:hover:bg-green-950/30"
                }
              `}
            >
              <span className="text-xl">{option.flag}</span>
              <span className={`text-sm font-medium ${isSelected ? "text-green-700 dark:text-green-300" : "text-gray-700 dark:text-gray-300"}`}>
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
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
  reportLanguage = "nl",
  onReportLanguageChange,
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
  // Is stage completed? Show compact view
  const isCompleted = stageStatus === "completed";

  // COMPACT VIEW: Stage is completed - show minimal actions in one line
  if (isCompleted && !isProcessing && !showCustomContext) {
    const handleRerunClick = () => {
      if (window.confirm("Weet je zeker dat je deze stap opnieuw wilt uitvoeren? Het huidige resultaat wordt overschreven.")) {
        onExecute();
      }
    };

    // Get labels for Stage 3 settings
    const depthLabel = DEPTH_OPTIONS.find(o => o.value === reportDepth)?.label || "Gebalanceerd";
    const languageOption = LANGUAGE_OPTIONS.find(o => o.value === reportLanguage);

    return (
      <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
        {/* Stage 3: Show selected depth and language */}
        {isStage3 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] px-2 py-0.5">
              <BookOpen className="w-3 h-3 mr-1" />
              {depthLabel}
            </Badge>
            <Badge variant="outline" className="text-[10px] px-2 py-0.5">
              <span className="mr-1">{languageOption?.flag || "🇳🇱"}</span>
              {languageOption?.label || "Nederlands"}
            </Badge>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            onClick={handleRerunClick}
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Opnieuw
          </Button>

          <Button
            onClick={onToggleCustomContext}
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <Paperclip className="w-3.5 h-3.5 mr-1.5" />
            + Context
          </Button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Reset Stage Button */}
          {onResetStage && (
            <Button
              onClick={onResetStage}
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-red-600"
              title="Wis resultaat"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  // EXPANDED CONTEXT VIEW: User opened custom context panel (simplified for completed stages)
  if (isCompleted && !isProcessing && showCustomContext) {
    const isStage1a = stageKey === "1a_informatiecheck";

    return (
      <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-800">
        {/* Simplified context input */}
        <div className="space-y-2">
          {/* File upload for stage 1a */}
          {isStage1a && onAttachmentsChange && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.pdf,.txt,.jpg,.jpeg,.png';
                  input.multiple = true;
                  input.onchange = (e) => {
                    const files = (e.target as HTMLInputElement).files;
                    if (files && onAttachmentsChange) {
                      const newFiles = Array.from(files).map(file => ({
                        file,
                        name: file.name,
                        size: file.size,
                        type: file.type,
                      }));
                      onAttachmentsChange([...(pendingAttachments || []), ...newFiles]);
                    }
                  };
                  input.click();
                }}
              >
                <Upload className="h-3.5 w-3.5" />
                Bijlages
              </Button>
              {pendingAttachments && pendingAttachments.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {pendingAttachments.length} bestand(en)
                </span>
              )}
            </div>
          )}

          <Textarea
            value={customContext}
            onChange={(e) => onCustomContextChange(e.target.value)}
            placeholder="Extra context of instructies..."
            className="min-h-[80px] text-sm"
          />
        </div>

        <div className="flex gap-2">
          <Button
            onClick={onExecute}
            className="flex-1"
            size="sm"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Uitvoeren
          </Button>
          <Button
            onClick={onToggleCustomContext}
            variant="ghost"
            size="sm"
          >
            Annuleren
          </Button>
        </div>
      </div>
    );
  }

  // FULL VIEW: Stage not completed, or user opened custom context
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

      {/* Report Language Selector - Only show for Stage 3 */}
      {isStage3 && effectiveCanExecute && onReportLanguageChange && (
        <ReportLanguageSelector
          reportLanguage={reportLanguage}
          onReportLanguageChange={onReportLanguageChange}
        />
      )}

      {/* Custom Context Section (expanded) - only when user clicked it */}
      {effectiveCanExecute && showCustomContext && (
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

      {/* Action row: button + subtle context link */}
      <div className="flex items-center gap-3">
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

        {/* Express Mode Button - Show for Stage 3 (not completed) */}
        {isStage3 && stageStatus !== "completed" && showExpressMode && reportId && onExpressComplete && (
          <ExpressModeButton
            reportId={reportId}
            onComplete={onExpressComplete}
            includeGeneration={true}
            hasStage3={false}
            reportDepth={reportDepth}
            reportLanguage={reportLanguage}
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

      {/* Subtle context link - below button when not expanded */}
      {effectiveCanExecute && !showCustomContext && (
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
    </div>
  );
});
