/**
 * OpenAiConfigPanel Component
 *
 * OpenAI-specific AI parameters panel.
 * Extracted from lines 949-1030 of settings.tsx.
 */

import { memo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap } from "lucide-react";
import { AI_PARAMETER_LIMITS } from "@/constants/settings.constants";
import type { OpenAiConfigPanelProps } from "@/types/settings.types";

export const OpenAiConfigPanel = memo(function OpenAiConfigPanel({
  temperature,
  maxOutputTokens,
  reasoningEffort,
  verbosity,
  onConfigChange,
  onParamsChange,
  testIdPrefix = "",
}: OpenAiConfigPanelProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 p-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg">
      <div className="col-span-2">
        <Label className="text-xs font-medium text-orange-900 dark:text-orange-100 mb-2 flex items-center">
          <Zap className="h-3 w-3 mr-1" />
          OpenAI Specifieke Parameters
        </Label>
      </div>

      {/* Temperature */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-orange-900 dark:text-orange-100">Temperature</Label>
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
        <p className="text-xs text-orange-700 dark:text-orange-300">0 = precies, 1 = gebalanceerd, 2 = creatief</p>
      </div>

      {/* Max Output Tokens */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-orange-900 dark:text-orange-100">Max Output Tokens</Label>
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
        <p className="text-xs text-orange-700 dark:text-orange-300">Maximaal aantal tokens in de response</p>
      </div>

      {/* Reasoning Effort */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-orange-900 dark:text-orange-100">Reasoning Effort</Label>
        <Select
          value={reasoningEffort ?? "medium"}
          onValueChange={(value) => onParamsChange("reasoning", value)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="minimal">Minimal (Snelst, GPT-4o-mini)</SelectItem>
            <SelectItem value="low">Low (Snel)</SelectItem>
            <SelectItem value="medium">Medium (Balans)</SelectItem>
            <SelectItem value="high">High (Diep)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Verbosity */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-orange-900 dark:text-orange-100">Verbosity</Label>
        <Select
          value={verbosity ?? "medium"}
          onValueChange={(value) => onParamsChange("verbosity", value)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low (Beknopt)</SelectItem>
            <SelectItem value="medium">Medium (Standaard)</SelectItem>
            <SelectItem value="high">High (Uitgebreid)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
});
