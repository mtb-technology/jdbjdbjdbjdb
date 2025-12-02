/**
 * AiProviderSelect Component
 *
 * Reusable provider and model selection dropdowns.
 * Used in both per-stage config and global config.
 */

import { memo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Brain, Zap } from "lucide-react";
import { AI_MODELS } from "@/constants/settings.constants";
import type { AiProvider, AiProviderSelectProps } from "@/types/settings.types";

export const AiProviderSelect = memo(function AiProviderSelect({
  provider,
  model,
  onProviderChange,
  onModelChange,
  size = "default",
  showLabels = true,
  testIdPrefix = "",
}: AiProviderSelectProps) {
  const triggerClass = size === "sm" ? "h-8 text-xs" : "";
  const labelClass = size === "sm" ? "text-xs font-medium text-blue-900 dark:text-blue-100" : "text-sm font-medium";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Provider Selection */}
      <div className="space-y-2">
        {showLabels && <Label className={labelClass}>AI Provider</Label>}
        <Select
          value={provider}
          onValueChange={(value: AiProvider) => onProviderChange(value)}
          data-testid={testIdPrefix ? `${testIdPrefix}-provider` : "select-ai-provider"}
        >
          <SelectTrigger className={triggerClass} data-testid={testIdPrefix ? `${testIdPrefix}-provider` : "select-ai-provider"}>
            <SelectValue placeholder="Kies provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="google">
              <div className="flex items-center space-x-2">
                <Brain className="h-3 w-3" />
                <span>Google AI</span>
              </div>
            </SelectItem>
            <SelectItem value="openai">
              <div className="flex items-center space-x-2">
                <Zap className="h-3 w-3" />
                <span>OpenAI</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Model Selection */}
      <div className="space-y-2">
        {showLabels && <Label className={labelClass}>Model</Label>}
        <Select value={model} onValueChange={onModelChange}>
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder="Kies model" />
          </SelectTrigger>
          <SelectContent>
            {AI_MODELS[provider]?.map((modelOption) => (
              <SelectItem key={modelOption.value} value={modelOption.value}>
                <span className={size === "sm" ? "text-xs" : ""}>{modelOption.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
});
