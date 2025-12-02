/**
 * RawOutputPanel Component
 *
 * Debug panel for viewing raw prompt and JSON output.
 */

import { memo, useState } from "react";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import type { Box3ValidationResult } from "@shared/schema";

interface RawOutputPanelProps {
  validationResult: Box3ValidationResult;
  lastUsedPrompt: string | null;
  systemPrompt: string;
}

export const RawOutputPanel = memo(function RawOutputPanel({
  validationResult,
  lastUsedPrompt,
  systemPrompt,
}: RawOutputPanelProps) {
  const [showRawOutput, setShowRawOutput] = useState(false);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setShowRawOutput(!showRawOutput)}
        className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="h-4 w-4" />
          <span>Prompt & Raw Output</span>
        </div>
        {showRawOutput ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {showRawOutput && (
        <div className="p-4 space-y-4 border-t bg-muted/10">
          {/* Used Prompt */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">
              Gebruikte Prompt
            </Label>
            <pre className="bg-background border rounded p-3 text-xs font-mono overflow-auto max-h-64 whitespace-pre-wrap">
              {lastUsedPrompt || systemPrompt}
            </pre>
          </div>
          {/* Raw JSON Output */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">
              Raw JSON Output
            </Label>
            <pre className="bg-background border rounded p-3 text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap">
              {JSON.stringify(validationResult, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
});
