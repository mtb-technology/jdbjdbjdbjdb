/**
 * RawOutputPanel Component - V2
 *
 * Debug panel for viewing raw prompt and JSON output.
 * Works with both V1 (validationResult) and V2 (debugInfo) data.
 */

import { memo, useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Bug, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

// Debug info from API response (V2)
interface DebugInfo {
  fullPrompt?: string;
  rawAiResponse?: string;
  model?: string;
  modelUsed?: string; // Legacy alias for model
  timestamp?: string;
  jaar?: string;
  pipelineSteps?: any;
  pipelineErrors?: string[];
}

// V2 interface - simplified
interface RawOutputPanelPropsV2 {
  debugInfo: DebugInfo;
  systemPrompt: string;
}

// Legacy V1 interface - for backwards compatibility
interface RawOutputPanelPropsV1 {
  validationResult: Record<string, any>;
  lastUsedPrompt: string | null;
  systemPrompt: string;
  debugInfo?: DebugInfo | null;
}

type RawOutputPanelProps = RawOutputPanelPropsV2 | RawOutputPanelPropsV1;

// Type guard
function isV2Props(props: RawOutputPanelProps): props is RawOutputPanelPropsV2 {
  return !('validationResult' in props) && 'debugInfo' in props && props.debugInfo !== null;
}

export const RawOutputPanel = memo(function RawOutputPanel(props: RawOutputPanelProps) {
  const [showRawOutput, setShowRawOutput] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [localDebugInfo, setLocalDebugInfo] = useState<DebugInfo | null>(null);

  // Determine which props format we're using
  const isV2 = isV2Props(props);
  const debugInfo = isV2 ? props.debugInfo : (props as RawOutputPanelPropsV1).debugInfo;
  const systemPrompt = props.systemPrompt;
  const validationResult = isV2 ? null : (props as RawOutputPanelPropsV1).validationResult;
  const lastUsedPrompt = isV2 ? null : (props as RawOutputPanelPropsV1).lastUsedPrompt;

  // Try to load from localStorage if not provided
  useEffect(() => {
    if (!debugInfo) {
      const stored = localStorage.getItem('box3_last_debug_info');
      if (stored) {
        try {
          setLocalDebugInfo(JSON.parse(stored));
        } catch {
          // Ignore parse errors
        }
      }
    }
  }, [debugInfo]);

  const effectiveDebug = debugInfo || localDebugInfo;

  const copyToClipboard = async (text: string, section: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  return (
    <div className="border-2 border-orange-300 rounded-lg overflow-hidden">
      <button
        onClick={() => setShowRawOutput(!showRawOutput)}
        className="w-full flex items-center justify-between p-3 bg-orange-50 hover:bg-orange-100 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm text-orange-700">
          <Bug className="h-4 w-4" />
          <span className="font-medium">Developer: Prompt & Raw AI Output</span>
          {effectiveDebug && (effectiveDebug.model || effectiveDebug.modelUsed) && (
            <Badge variant="outline" className="ml-2 text-xs bg-orange-100 text-orange-800 border-orange-300">
              {effectiveDebug.model || effectiveDebug.modelUsed}
            </Badge>
          )}
        </div>
        {showRawOutput ? (
          <ChevronUp className="h-4 w-4 text-orange-600" />
        ) : (
          <ChevronDown className="h-4 w-4 text-orange-600" />
        )}
      </button>
      {showRawOutput && (
        <div className="p-4 space-y-4 border-t border-orange-200 bg-orange-50/30">
          {/* Full Prompt (Input) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold text-orange-800">
                Volledige Prompt (Input naar AI)
              </Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(
                  effectiveDebug?.fullPrompt || lastUsedPrompt || systemPrompt,
                  'prompt'
                )}
                className="h-7 text-xs"
              >
                {copiedSection === 'prompt' ? (
                  <><Check className="h-3 w-3 mr-1" /> Gekopieerd</>
                ) : (
                  <><Copy className="h-3 w-3 mr-1" /> Kopieer</>
                )}
              </Button>
            </div>
            <pre className="bg-white border rounded p-3 text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap">
              {effectiveDebug?.fullPrompt || lastUsedPrompt || systemPrompt}
            </pre>
          </div>

          {/* Raw AI Response (before JSON parsing) */}
          {effectiveDebug?.rawAiResponse && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold text-orange-800">
                  Raw AI Response (Output van AI, voor parsing)
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(effectiveDebug.rawAiResponse || '', 'raw')}
                  className="h-7 text-xs"
                >
                  {copiedSection === 'raw' ? (
                    <><Check className="h-3 w-3 mr-1" /> Gekopieerd</>
                  ) : (
                    <><Copy className="h-3 w-3 mr-1" /> Kopieer</>
                  )}
                </Button>
              </div>
              <pre className="bg-white border rounded p-3 text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap">
                {effectiveDebug.rawAiResponse}
              </pre>
            </div>
          )}

          {/* Parsed JSON Output (V1 only) */}
          {validationResult && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold text-orange-800">
                  Geparsed validationResult (na JSON parsing)
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(JSON.stringify(validationResult, null, 2), 'parsed')}
                  className="h-7 text-xs"
                >
                  {copiedSection === 'parsed' ? (
                    <><Check className="h-3 w-3 mr-1" /> Gekopieerd</>
                  ) : (
                    <><Copy className="h-3 w-3 mr-1" /> Kopieer</>
                  )}
                </Button>
              </div>
              <pre className="bg-white border rounded p-3 text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap">
                {JSON.stringify(validationResult, null, 2)}
              </pre>
            </div>
          )}

          {/* Metadata */}
          {effectiveDebug && (
            <div className="text-xs text-muted-foreground border-t pt-3 mt-3">
              <p><strong>Model:</strong> {effectiveDebug.model || effectiveDebug.modelUsed || 'unknown'}</p>
              {effectiveDebug.timestamp && <p><strong>Timestamp:</strong> {effectiveDebug.timestamp}</p>}
              {effectiveDebug.jaar && <p><strong>Jaar:</strong> {effectiveDebug.jaar}</p>}
              {effectiveDebug.pipelineErrors && effectiveDebug.pipelineErrors.length > 0 && (
                <p className="text-orange-600"><strong>Pipeline errors:</strong> {effectiveDebug.pipelineErrors.join(', ')}</p>
              )}
            </div>
          )}

          {!effectiveDebug && (
            <div className="text-xs text-orange-600 bg-orange-100 p-3 rounded">
              <p><strong>Let op:</strong> Volledige debug info (prompt + raw output) is alleen beschikbaar na een nieuwe validatie of hervalidatie.</p>
              <p>De huidige data is geladen uit de database en bevat alleen het geparsde resultaat.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
