/**
 * ManualModePanel Component
 *
 * Manual mode toggle and interface for deep research stages.
 * Extracted from WorkflowStageCard.tsx lines 305-424.
 */

import { memo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles,
  Activity,
  ExternalLink,
  Copy,
  Check,
  CheckCircle,
  RefreshCw,
} from "lucide-react";
import { normalizePromptToString } from "@/lib/promptUtils";
import type { ManualModePanelProps } from "@/types/workflowStageCard.types";

/**
 * Mode toggle section
 */
interface ModeToggleProps {
  manualMode: "ai" | "manual";
  onToggleManualMode: (mode: "ai" | "manual") => void;
}

const ModeToggle = memo(function ModeToggle({
  manualMode,
  onToggleManualMode,
}: ModeToggleProps) {
  return (
    <div className="bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-200 dark:border-amber-800 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 space-y-3">
          <div>
            <h4 className="font-semibold text-sm text-amber-900 dark:text-amber-100">
              Deep Research Mode
            </h4>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Deze stap vereist diepgaand onderzoek. Kies hoe je deze stap wilt
              uitvoeren:
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => onToggleManualMode("ai")}
              variant={manualMode === "ai" ? "default" : "outline"}
              size="sm"
              className="flex-1"
            >
              <Activity className="w-4 h-4 mr-2" />
              AI Automatisch
            </Button>
            <Button
              onClick={() => onToggleManualMode("manual")}
              variant={manualMode === "manual" ? "default" : "outline"}
              size="sm"
              className="flex-1"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Handmatig (Gemini Deep Research)
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * Manual mode interface (prompt copy + result paste)
 */
interface ManualModeInterfaceProps {
  stageName: string;
  stagePrompt?: string;
  manualContent: string;
  onManualContentChange: (content: string) => void;
  onManualExecute: () => void;
  isProcessing: boolean;
}

const ManualModeInterface = memo(function ManualModeInterface({
  stageName,
  stagePrompt,
  manualContent,
  onManualContentChange,
  onManualExecute,
  isProcessing,
}: ManualModeInterfaceProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (stagePrompt) {
      navigator.clipboard.writeText(normalizePromptToString(stagePrompt));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [stagePrompt]);

  return (
    <div className="bg-blue-50 dark:bg-blue-950/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-4">
      {stagePrompt && (
        <>
          <div className="flex items-start gap-3">
            <ExternalLink className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-100">
                Kopieer de prompt
              </h4>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                Kopieer onderstaande prompt en plak deze in de Gemini Deep
                Research interface
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-lg border-2 border-blue-300 dark:border-blue-700 overflow-hidden w-full">
            <div className="p-3 border-b border-blue-200 dark:border-blue-800 flex items-center justify-between">
              <span className="text-xs font-medium text-blue-900 dark:text-blue-100">
                Prompt voor Gemini Deep Research
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="h-8 flex-shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Gekopieerd!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Kopieer Prompt
                  </>
                )}
              </Button>
            </div>
            <div className="p-4 max-h-[400px] overflow-y-auto w-full">
              <pre
                className="text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-all w-full min-w-0"
                style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}
              >
                {normalizePromptToString(stagePrompt)}
              </pre>
            </div>
          </div>
        </>
      )}

      <div className="flex items-start gap-3 pt-2">
        <ExternalLink className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 space-y-3">
          <div>
            <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-100">
              Plak het resultaat van Gemini Deep Research
            </h4>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
              Nadat je de prompt in Gemini Deep Research hebt gebruikt, plak het
              resultaat hieronder
            </p>
          </div>
          <Textarea
            value={manualContent}
            onChange={(e) => onManualContentChange(e.target.value)}
            placeholder="Plak hier het resultaat van Gemini Deep Research..."
            className="min-h-[200px] font-mono text-sm"
          />
          <Button
            onClick={onManualExecute}
            disabled={!manualContent.trim() || isProcessing}
            className="w-full"
            size="lg"
          >
            {isProcessing ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Verwerken...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                {stageName} Voltooien met Dit Resultaat
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
});

export const ManualModePanel = memo(function ManualModePanel({
  stageName,
  manualMode,
  onToggleManualMode,
  stagePrompt,
  manualContent,
  onManualContentChange,
  onManualExecute,
  isProcessing,
}: ManualModePanelProps) {
  return (
    <>
      <ModeToggle manualMode={manualMode} onToggleManualMode={onToggleManualMode} />

      {manualMode === "manual" && (
        <ManualModeInterface
          stageName={stageName}
          stagePrompt={stagePrompt}
          manualContent={manualContent}
          onManualContentChange={onManualContentChange}
          onManualExecute={onManualExecute}
          isProcessing={isProcessing}
        />
      )}
    </>
  );
});
