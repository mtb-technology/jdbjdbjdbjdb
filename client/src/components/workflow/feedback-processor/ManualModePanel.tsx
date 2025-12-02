/**
 * ManualModePanel Component
 *
 * Panel for manual mode (Gemini Deep Research) workflow.
 */

import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles,
  Activity,
  ExternalLink,
  Copy,
  Check,
  CheckCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { PromptPreviewResponse } from "@/types/feedbackProcessor.types";

interface ManualModePanelProps {
  manualMode: "ai" | "manual";
  onToggleManualMode: (mode: "ai" | "manual") => void;
  manualContent: string;
  onManualContentChange: (content: string) => void;
  onManualExecute: () => void;
  promptPreviewData: PromptPreviewResponse | undefined;
}

export const ManualModePanel = memo(function ManualModePanel({
  manualMode,
  onToggleManualMode,
  manualContent,
  onManualContentChange,
  onManualExecute,
  promptPreviewData,
}: ManualModePanelProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopyPrompt = () => {
    if (promptPreviewData?.fullPrompt) {
      navigator.clipboard.writeText(promptPreviewData.fullPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Gekopieerd!",
        description: "Prompt gekopieerd naar klembord",
      });
    }
  };

  return (
    <>
      {/* Mode Toggle */}
      <div className="bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-200 dark:border-amber-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-3">
            <div>
              <h4 className="font-semibold text-sm text-amber-900 dark:text-amber-100">
                Deep Research Mode
              </h4>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                Deze stap vereist diepgaand onderzoek. Kies hoe je deze stap
                wilt uitvoeren:
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

      {/* Manual Mode Interface */}
      {manualMode === "manual" && (
        <div className="bg-blue-50 dark:bg-blue-950/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-4">
          {/* Step 1: Show prompt preview */}
          <div className="flex items-start gap-3">
            <ExternalLink className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-100">
                Stap 1: Kopieer de prompt
              </h4>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                Klik op "Preview Prompt" om de volledige prompt te zien en te
                kopiëren
              </p>
            </div>
          </div>

          {promptPreviewData && (
            <div className="bg-white dark:bg-gray-900 rounded-lg border-2 border-blue-300 dark:border-blue-700">
              <div className="p-3 border-b border-blue-200 dark:border-blue-800 flex items-center justify-between">
                <span className="text-xs font-medium text-blue-900 dark:text-blue-100">
                  Prompt voor Gemini Deep Research (
                  {promptPreviewData.promptLength.toLocaleString()} karakters)
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyPrompt}
                  className="h-8"
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
              <div className="p-4 max-h-[400px] overflow-auto">
                <pre
                  className="text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-all"
                  style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}
                >
                  {promptPreviewData.fullPrompt}
                </pre>
              </div>
            </div>
          )}

          {/* Step 2: Paste result */}
          <div className="flex items-start gap-3 pt-2">
            <ExternalLink className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-3">
              <div>
                <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-100">
                  Stap 2: Plak het resultaat van Gemini Deep Research
                </h4>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Nadat je de prompt in Gemini Deep Research hebt gebruikt, plak
                  het resultaat hieronder
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
                disabled={!manualContent.trim()}
                className="w-full"
                size="lg"
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Verwerk Handmatig Resultaat
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
