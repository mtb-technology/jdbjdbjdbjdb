/**
 * GlobalAiConfigCard Component
 *
 * Global AI configuration section.
 * Extracted from lines 1115-1313 of settings.tsx.
 */

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, Zap, Search } from "lucide-react";
import { AI_MODELS, AI_PARAMETER_LIMITS, DEFAULT_MODEL_BY_PROVIDER } from "@/constants/settings.constants";
import type { GlobalAiConfigCardProps, AiProvider } from "@/types/settings.types";

export const GlobalAiConfigCard = memo(function GlobalAiConfigCard({
  aiConfig,
  onAiConfigChange,
}: GlobalAiConfigCardProps) {
  const isGemini3 = aiConfig.model === "gemini-3-pro-preview";

  const handleProviderChange = (value: AiProvider) => {
    const defaultModel = DEFAULT_MODEL_BY_PROVIDER[value];
    onAiConfigChange("provider", value);
    onAiConfigChange("model", defaultModel);
  };

  return (
    <Card className="mt-8">
      <CardHeader>
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Brain className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">AI Model Configuratie (Global Default)</CardTitle>
            <p className="text-sm text-muted-foreground">
              Configureer standaard AI provider en model instellingen. Elke stap kan deze overschrijven.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Provider Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">AI Provider</Label>
          <Select value={aiConfig.provider} onValueChange={(value: AiProvider) => handleProviderChange(value)}>
            <SelectTrigger data-testid="select-ai-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="google">
                <div className="flex items-center space-x-2">
                  <Brain className="h-4 w-4" />
                  <div>
                    <div className="font-medium">Google AI (Gemini)</div>
                    <div className="text-xs text-muted-foreground">Grounding & Research</div>
                  </div>
                </div>
              </SelectItem>
              <SelectItem value="openai">
                <div className="flex items-center space-x-2">
                  <Zap className="h-4 w-4" />
                  <div>
                    <div className="font-medium">OpenAI (GPT/o3)</div>
                    <div className="text-xs text-muted-foreground">Deep Research & Reasoning</div>
                  </div>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Model Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Model Selectie</Label>
          <Select value={aiConfig.model} onValueChange={(value) => onAiConfigChange("model", value)}>
            <SelectTrigger data-testid="select-ai-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {aiConfig.provider &&
                AI_MODELS[aiConfig.provider]?.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    <div className="flex items-center space-x-2">
                      <Brain className="h-4 w-4" />
                      <div>
                        <div className="font-medium">{model.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {model.value.includes("o3")
                            ? "Deep Research & Reasoning"
                            : model.value.includes("flash")
                            ? "Snelle verwerking, lagere kosten"
                            : "Beste kwaliteit, uitgebreide redenering"}
                        </div>
                      </div>
                    </div>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {/* Temperature */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Creativiteit (Temperature)</Label>
          <Input
            type="number"
            step={AI_PARAMETER_LIMITS.temperature.step}
            min={AI_PARAMETER_LIMITS.temperature.min}
            max={AI_PARAMETER_LIMITS.temperature.max}
            value={aiConfig.temperature}
            onChange={(e) => onAiConfigChange("temperature", parseFloat(e.target.value) || 0)}
            placeholder="0.0 - 2.0"
            data-testid="input-temperature"
          />
          <p className="text-xs text-muted-foreground">0 = precies, 1 = gebalanceerd, 2 = creatief</p>
        </div>

        {/* Top P */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Focus (Top P)</Label>
          <Input
            type="number"
            step={AI_PARAMETER_LIMITS.topP.step}
            min={AI_PARAMETER_LIMITS.topP.min}
            max={AI_PARAMETER_LIMITS.topP.max}
            value={aiConfig.topP}
            onChange={(e) => onAiConfigChange("topP", parseFloat(e.target.value) || 0.95)}
            placeholder="0.1 - 1.0"
            data-testid="input-topP"
          />
          <p className="text-xs text-muted-foreground">0.1 = gefocust, 1.0 = gevarieerd</p>
        </div>

        {/* Max Output Tokens */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Max Output Tokens</Label>
          <Input
            type="number"
            step={AI_PARAMETER_LIMITS.maxOutputTokens.step}
            min={AI_PARAMETER_LIMITS.maxOutputTokens.min}
            max={AI_PARAMETER_LIMITS.maxOutputTokens.max}
            value={aiConfig.maxOutputTokens}
            onChange={(e) => onAiConfigChange("maxOutputTokens", parseInt(e.target.value) || 2048)}
            placeholder="100 - 8192"
            data-testid="input-max-tokens"
          />
          <p className="text-xs text-muted-foreground">Maximaal aantal tokens in de response</p>
        </div>

        {/* Top K (Google models only) */}
        {aiConfig.provider === "google" && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">Top K (Google modellen)</Label>
            <Input
              type="number"
              step={AI_PARAMETER_LIMITS.topK.step}
              min={AI_PARAMETER_LIMITS.topK.min}
              max={AI_PARAMETER_LIMITS.topK.max}
              value={aiConfig.topK}
              onChange={(e) => onAiConfigChange("topK", parseInt(e.target.value) || 20)}
              placeholder="1 - 40"
              data-testid="input-topK"
            />
            <p className="text-xs text-muted-foreground">Aantal top kandidaten voor sampling (alleen Google AI)</p>
          </div>
        )}

        {/* Thinking Level (Gemini 3 only) */}
        {aiConfig.provider === "google" && isGemini3 && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">Thinking Level (Gemini 3)</Label>
            <Select
              value={aiConfig.thinkingLevel || "high"}
              onValueChange={(value) => onAiConfigChange("thinkingLevel", value)}
            >
              <SelectTrigger data-testid="select-thinking-level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high">
                  <div className="flex flex-col">
                    <span className="font-medium">High - Maximale Reasoning</span>
                    <span className="text-xs text-muted-foreground">
                      Voor complexe taken (langzamer, dieper denken)
                    </span>
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
            <p className="text-xs text-muted-foreground">
              Controleert diepte van reasoning proces (alleen Gemini 3 Pro)
            </p>
          </div>
        )}

        {/* Deep Research Info */}
        <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <Search className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
            <div>
              <h4 className="font-medium text-green-900 dark:text-green-100 mb-1">Per-Stage Research Grounding</h4>
              <p className="text-sm text-green-700 dark:text-green-300">
                Google Search grounding is nu per prompt stap instelbaar. Elke stap heeft een eigen toggle voor
                research functionaliteit.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
