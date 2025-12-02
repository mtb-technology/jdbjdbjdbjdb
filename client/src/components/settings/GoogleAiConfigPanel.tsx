/**
 * GoogleAiConfigPanel Component
 *
 * Google-specific AI parameters panel.
 * Extracted from lines 839-947 of settings.tsx.
 */

import { memo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain } from "lucide-react";
import { AI_PARAMETER_LIMITS } from "@/constants/settings.constants";
import type { GoogleAiConfigPanelProps } from "@/types/settings.types";

export const GoogleAiConfigPanel = memo(function GoogleAiConfigPanel({
  temperature,
  maxOutputTokens,
  topP,
  topK,
  thinkingLevel,
  model,
  onConfigChange,
  testIdPrefix = "",
}: GoogleAiConfigPanelProps) {
  const isGemini3 = model === "gemini-3-pro-preview";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
      <div className="col-span-2">
        <Label className="text-xs font-medium text-blue-900 dark:text-blue-100 mb-2 flex items-center">
          <Brain className="h-3 w-3 mr-1" />
          Google AI Specifieke Parameters
        </Label>
      </div>

      {/* Temperature */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-blue-900 dark:text-blue-100">Temperature</Label>
        <Input
          type="number"
          step={AI_PARAMETER_LIMITS.temperature.step}
          min={AI_PARAMETER_LIMITS.temperature.min}
          max={AI_PARAMETER_LIMITS.temperature.max}
          value={temperature}
          onChange={(e) => onConfigChange("temperature", parseFloat(e.target.value) || 0)}
          className="h-8 text-xs"
          placeholder="0.0 - 2.0"
          data-testid={testIdPrefix ? `${testIdPrefix}-temperature` : "input-temperature"}
        />
        <p className="text-xs text-blue-700 dark:text-blue-300">0 = precies, 1 = gebalanceerd, 2 = creatief</p>
      </div>

      {/* Max Output Tokens */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-blue-900 dark:text-blue-100">Max Output Tokens</Label>
        <Input
          type="number"
          step={AI_PARAMETER_LIMITS.maxOutputTokens.step}
          min={AI_PARAMETER_LIMITS.maxOutputTokens.min}
          max={AI_PARAMETER_LIMITS.maxOutputTokens.max}
          value={maxOutputTokens}
          onChange={(e) => onConfigChange("maxOutputTokens", parseInt(e.target.value) || 8192)}
          className="h-8 text-xs"
          placeholder="100 - 8192"
          data-testid={testIdPrefix ? `${testIdPrefix}-max-tokens` : "input-max-tokens"}
        />
        <p className="text-xs text-blue-700 dark:text-blue-300">Maximaal aantal tokens in de response</p>
      </div>

      {/* Top P */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-blue-900 dark:text-blue-100">Top P</Label>
        <Input
          type="number"
          step={AI_PARAMETER_LIMITS.topP.step}
          min={AI_PARAMETER_LIMITS.topP.min}
          max={AI_PARAMETER_LIMITS.topP.max}
          value={topP}
          onChange={(e) => onConfigChange("topP", parseFloat(e.target.value) || 0.95)}
          className="h-8 text-xs"
          placeholder="0.1 - 1.0"
          data-testid={testIdPrefix ? `${testIdPrefix}-topP` : "input-topP"}
        />
        <p className="text-xs text-blue-700 dark:text-blue-300">0.1 = gefocust, 1.0 = gevarieerd</p>
      </div>

      {/* Top K */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-blue-900 dark:text-blue-100">Top K</Label>
        <Input
          type="number"
          step={AI_PARAMETER_LIMITS.topK.step}
          min={AI_PARAMETER_LIMITS.topK.min}
          max={AI_PARAMETER_LIMITS.topK.max}
          value={topK}
          onChange={(e) => onConfigChange("topK", parseInt(e.target.value) || 20)}
          className="h-8 text-xs"
          placeholder="1 - 40"
          data-testid={testIdPrefix ? `${testIdPrefix}-topK` : "input-topK"}
        />
        <p className="text-xs text-blue-700 dark:text-blue-300">Aantal top kandidaten voor sampling</p>
      </div>

      {/* Thinking Level - Gemini 3 only */}
      {isGemini3 && (
        <div className="space-y-2 col-span-2">
          <Label className="text-xs font-medium text-blue-900 dark:text-blue-100">Thinking Level (Gemini 3)</Label>
          <Select
            value={thinkingLevel || "high"}
            onValueChange={(value) => onConfigChange("thinkingLevel", value)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high">
                <div className="flex flex-col">
                  <span className="font-medium">High - Maximale Reasoning</span>
                  <span className="text-xs text-muted-foreground">Voor complexe taken (langzamer, dieper denken)</span>
                </div>
              </SelectItem>
              <SelectItem value="low">
                <div className="flex flex-col">
                  <span className="font-medium">Low - Minimale Latency</span>
                  <span className="text-xs text-muted-foreground">Voor simpele taken (sneller, minder denken)</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-blue-700 dark:text-blue-300">Controleert diepte van reasoning proces</p>
        </div>
      )}
    </div>
  );
});
