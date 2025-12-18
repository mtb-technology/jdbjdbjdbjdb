/**
 * ToolAiConfigCard Component
 *
 * AI configuration card for tools (test_ai, follow_up_assistant).
 * Simpler than stage config - only AI settings, no prompts.
 */

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Brain, Zap, TestTube, Mail, type LucideIcon } from "lucide-react";
import { AI_MODELS, AI_PARAMETER_LIMITS, DEFAULT_MODEL_BY_PROVIDER, DEFAULT_AI_CONFIG } from "@/constants/settings.constants";
import type { AiConfig } from "@shared/schema";

type AiProvider = "google" | "openai";

interface ToolAiConfigCardProps {
  toolKey: string;
  title: string;
  description: string;
  icon: LucideIcon;
  aiConfig?: { aiConfig?: AiConfig };
  globalAiConfig: AiConfig;
  onAiConfigChange: (toolKey: string, field: keyof AiConfig, value: any) => void;
}

// Tool metadata
export const TOOL_CONFIGS = [
  {
    key: "test_ai",
    title: "AI Test",
    description: "Configuratie voor de AI test functionaliteit op de home pagina",
    icon: TestTube,
  },
  {
    key: "follow_up_assistant",
    title: "Follow-up Assistant",
    description: "Configuratie voor de email assistant tool",
    icon: Mail,
  },
] as const;

export const ToolAiConfigCard = memo(function ToolAiConfigCard({
  toolKey,
  title,
  description,
  icon: Icon,
  aiConfig,
  globalAiConfig,
  onAiConfigChange,
}: ToolAiConfigCardProps) {
  // Get effective config (tool-specific or fallback to global)
  const effectiveConfig = aiConfig?.aiConfig || globalAiConfig;
  const hasOwnConfig = !!aiConfig?.aiConfig?.model;

  const handleProviderChange = (value: AiProvider) => {
    const defaultModel = DEFAULT_MODEL_BY_PROVIDER[value];
    onAiConfigChange(toolKey, "provider", value);
    onAiConfigChange(toolKey, "model", defaultModel);
  };

  const handleFieldChange = (field: keyof AiConfig, value: any) => {
    onAiConfigChange(toolKey, field, value);
  };

  const isGemini3 = effectiveConfig?.model === "gemini-3-pro-preview";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
          <Badge variant={hasOwnConfig ? "default" : "secondary"}>
            {hasOwnConfig ? "Eigen config" : "Gebruikt global"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Provider Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">AI Provider</Label>
          <Select
            value={effectiveConfig?.provider || "google"}
            onValueChange={(value: AiProvider) => handleProviderChange(value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="google">
                <div className="flex items-center space-x-2">
                  <Brain className="h-4 w-4" />
                  <span>Google AI (Gemini)</span>
                </div>
              </SelectItem>
              <SelectItem value="openai">
                <div className="flex items-center space-x-2">
                  <Zap className="h-4 w-4" />
                  <span>OpenAI (GPT/o3)</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Model Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Model</Label>
          <Select
            value={effectiveConfig?.model || "gemini-2.5-pro"}
            onValueChange={(value) => handleFieldChange("model", value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_MODELS[effectiveConfig?.provider || "google"]?.map((model) => (
                <SelectItem key={model.value} value={model.value}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Temperature & Max Tokens in a grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Temperature</Label>
            <Input
              type="number"
              step={AI_PARAMETER_LIMITS.temperature.step}
              min={AI_PARAMETER_LIMITS.temperature.min}
              max={AI_PARAMETER_LIMITS.temperature.max}
              value={effectiveConfig?.temperature ?? DEFAULT_AI_CONFIG.temperature}
              onChange={(e) => handleFieldChange("temperature", parseFloat(e.target.value) || 0)}
              placeholder="0.0 - 2.0"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Max Tokens</Label>
            <Input
              type="number"
              step={AI_PARAMETER_LIMITS.maxOutputTokens.step}
              min={AI_PARAMETER_LIMITS.maxOutputTokens.min}
              max={AI_PARAMETER_LIMITS.maxOutputTokens.max}
              value={effectiveConfig?.maxOutputTokens ?? DEFAULT_AI_CONFIG.maxOutputTokens}
              onChange={(e) => handleFieldChange("maxOutputTokens", parseInt(e.target.value) || 8192)}
              placeholder="100 - 65536"
            />
          </div>
        </div>

        {/* Top P */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Top P</Label>
          <Input
            type="number"
            step={AI_PARAMETER_LIMITS.topP.step}
            min={AI_PARAMETER_LIMITS.topP.min}
            max={AI_PARAMETER_LIMITS.topP.max}
            value={effectiveConfig?.topP ?? DEFAULT_AI_CONFIG.topP}
            onChange={(e) => handleFieldChange("topP", parseFloat(e.target.value) || 0.95)}
            placeholder="0.1 - 1.0"
          />
        </div>

        {/* Top K (Google only) */}
        {effectiveConfig?.provider === "google" && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Top K</Label>
            <Input
              type="number"
              step={AI_PARAMETER_LIMITS.topK.step}
              min={AI_PARAMETER_LIMITS.topK.min}
              max={AI_PARAMETER_LIMITS.topK.max}
              value={effectiveConfig?.topK ?? DEFAULT_AI_CONFIG.topK}
              onChange={(e) => handleFieldChange("topK", parseInt(e.target.value) || 20)}
              placeholder="1 - 40"
            />
          </div>
        )}

        {/* Thinking Level (Gemini 3 only) */}
        {effectiveConfig?.provider === "google" && isGemini3 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Thinking Level</Label>
            <Select
              value={effectiveConfig?.thinkingLevel || "high"}
              onValueChange={(value) => handleFieldChange("thinkingLevel", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High - Maximale Reasoning</SelectItem>
                <SelectItem value="low">Low - Minimale Latency</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Info about using global */}
        {!hasOwnConfig && (
          <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
            Deze tool gebruikt de globale AI configuratie. Wijzig hierboven om een eigen configuratie te gebruiken.
          </p>
        )}
      </CardContent>
    </Card>
  );
});
