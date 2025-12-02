/**
 * StageConfigCard Component
 *
 * Main stage configuration card.
 * Extracted from the 476-line map block (lines 637-1113) of settings.tsx.
 */

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, CheckCircle, Search, Brain } from "lucide-react";
import { AiProviderSelect } from "./AiProviderSelect";
import { GoogleAiConfigPanel } from "./GoogleAiConfigPanel";
import { OpenAiConfigPanel } from "./OpenAiConfigPanel";
import type { StageConfigCardProps, AiProvider } from "@/types/settings.types";

export const StageConfigCard = memo(function StageConfigCard({
  stage,
  stageConfig,
  globalAiConfig,
  isEmpty,
  onPromptChange,
  onGroundingChange,
  onWebSearchChange,
  onPolishPromptChange,
  onStageAiConfigChange,
  onStageOpenAIParamsChange,
  onProviderChange,
}: StageConfigCardProps) {
  const prompt = stageConfig?.prompt || "";
  const useGrounding = stageConfig?.useGrounding || false;
  const useWebSearch = stageConfig?.useWebSearch || false;
  const stepType = stageConfig?.stepType || stage.type || "generator";
  const isReviewer = stepType === "reviewer";
  const isProcessor = stepType === "processor";

  // Get effective AI config (stage override or global)
  const effectiveProvider = (stageConfig?.aiConfig?.provider || globalAiConfig.provider) as AiProvider;
  const effectiveModel = stageConfig?.aiConfig?.model || globalAiConfig.model;
  const effectiveTemperature = stageConfig?.aiConfig?.temperature ?? globalAiConfig.temperature;
  const effectiveMaxOutputTokens = stageConfig?.aiConfig?.maxOutputTokens ?? globalAiConfig.maxOutputTokens;
  const effectiveTopP = stageConfig?.aiConfig?.topP ?? globalAiConfig.topP;
  const effectiveTopK = stageConfig?.aiConfig?.topK ?? globalAiConfig.topK;
  const effectiveThinkingLevel = stageConfig?.aiConfig?.thinkingLevel || globalAiConfig.thinkingLevel;
  const effectiveReasoningEffort = stageConfig?.aiConfig?.reasoning?.effort;
  const effectiveVerbosity = stageConfig?.aiConfig?.verbosity;

  return (
    <Card
      className={`shadow-sm ${
        isReviewer
          ? "border-l-4 border-l-orange-400"
          : isProcessor
          ? "border-l-4 border-l-purple-400"
          : "border-l-4 border-l-blue-400"
      }`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                isEmpty
                  ? "bg-muted text-muted-foreground"
                  : isReviewer
                  ? "bg-orange-500 text-white"
                  : isProcessor
                  ? "bg-purple-500 text-white"
                  : "bg-blue-500 text-white"
              }`}
            >
              {isEmpty ? <AlertCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <CardTitle className="text-lg">{stage.label}</CardTitle>
                <Badge
                  variant={isReviewer ? "destructive" : isProcessor ? "secondary" : "default"}
                  className="text-xs"
                >
                  {isReviewer ? "🔍 Review" : isProcessor ? "⚙️ Processor" : "📝 Generator"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{stage.description}</p>
            </div>
          </div>

          <Badge variant={isEmpty ? "secondary" : "default"}>{isEmpty ? "Niet Ingesteld" : "Actief"}</Badge>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          {/* Step Type Indicator - Reviewer */}
          {isReviewer && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
              <div className="flex items-center space-x-2 mb-2">
                <span className="text-orange-700 font-medium text-sm">🔍 Review Stap</span>
              </div>
              <p className="text-xs text-orange-700">
                Deze stap geeft <strong>JSON feedback</strong> op het rapport. Stap 5 (Verwerker) verwerkt alle
                feedback automatisch.
              </p>
            </div>
          )}

          {/* Step Type Indicator - Processor */}
          {isProcessor && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4">
              <div className="flex items-center space-x-2 mb-2">
                <span className="text-purple-700 font-medium text-sm">⚙️ Processor Stap</span>
              </div>
              <p className="text-xs text-purple-700">
                Deze stap verwerkt <strong>alle JSON feedback</strong> van stap 4a-4g en past het rapport aan.
              </p>
            </div>
          )}

          {/* Grounding Toggle - Google only */}
          {effectiveProvider === "google" && (
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div className="space-y-1">
                <Label className="text-sm font-medium flex items-center">
                  <Search className="mr-2 h-4 w-4" />
                  Google Search Grounding voor deze stap
                </Label>
                <p className="text-xs text-muted-foreground">
                  Zoekt actuele informatie online tijdens deze prompt stap
                </p>
              </div>
              <Switch
                checked={useGrounding}
                onCheckedChange={onGroundingChange}
                data-testid={`switch-grounding-${stage.key}`}
              />
            </div>
          )}

          {/* Web Search Toggle - OpenAI only */}
          {effectiveProvider === "openai" && (
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div className="space-y-1">
                <Label className="text-sm font-medium flex items-center">
                  <Search className="mr-2 h-4 w-4" />
                  Web Search voor deze stap
                </Label>
                <p className="text-xs text-muted-foreground">
                  Gebruikt web search voor actuele informatie tijdens deze prompt stap
                </p>
              </div>
              <Switch
                checked={useWebSearch}
                onCheckedChange={onWebSearchChange}
                data-testid={`switch-websearch-${stage.key}`}
              />
            </div>
          )}

          {/* Per-Stage AI Configuration */}
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-4">
            <div className="flex items-center space-x-2 mb-3">
              <Brain className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <Label className="text-sm font-medium text-blue-900 dark:text-blue-100">
                AI Model voor deze stap
              </Label>
              <Badge variant="outline" className="text-xs">
                Overschrijft global default
              </Badge>
            </div>

            <AiProviderSelect
              provider={effectiveProvider}
              model={effectiveModel}
              onProviderChange={onProviderChange}
              onModelChange={(value) => onStageAiConfigChange("model", value)}
              size="sm"
              showLabels={true}
              testIdPrefix={`select-stage-${stage.key}`}
            />

            {/* Google-specific parameters */}
            {effectiveProvider === "google" && (
              <GoogleAiConfigPanel
                temperature={effectiveTemperature}
                maxOutputTokens={effectiveMaxOutputTokens}
                topP={effectiveTopP}
                topK={effectiveTopK}
                thinkingLevel={effectiveThinkingLevel}
                model={effectiveModel}
                onConfigChange={(key, value) => onStageAiConfigChange(key, value)}
                testIdPrefix={`input-${stage.key}`}
              />
            )}

            {/* OpenAI-specific parameters */}
            {effectiveProvider === "openai" && (
              <OpenAiConfigPanel
                temperature={effectiveTemperature}
                maxOutputTokens={effectiveMaxOutputTokens}
                reasoningEffort={effectiveReasoningEffort}
                verbosity={effectiveVerbosity}
                onConfigChange={(key, value) => onStageAiConfigChange(key, value)}
                onParamsChange={onStageOpenAIParamsChange}
                testIdPrefix={`input-${stage.key}`}
              />
            )}

            {/* Special indicators for specific models */}
            {effectiveModel.includes("o3") && (
              <div className="text-xs text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-950/20 p-2 rounded">
                🧠 <strong>Deep Research Mode:</strong> o3 gebruikt geavanceerde redenering voor complexe analyses
              </div>
            )}
          </div>

          {/* Main Prompt */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {isReviewer
                ? "Review Prompt (→ JSON feedback)"
                : isProcessor
                ? "Processor Prompt (JSON feedback → Rapport update)"
                : "Generator Prompt (→ Rapport content)"}
            </Label>
            <Textarea
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              className="font-mono text-sm min-h-32"
              placeholder={
                isReviewer
                  ? `Review prompt die JSON feedback geeft voor ${stage.label}...`
                  : isProcessor
                  ? `Processor prompt die alle JSON feedback verwerkt in het rapport...`
                  : `Generator prompt voor ${stage.label}...`
              }
              data-testid={`textarea-prompt-${stage.key}`}
            />
          </div>

          {/* Polish Prompt - Only for Stage 3 (Generatie) */}
          {stage.key === "3_generatie" && (
            <div className="space-y-2 mt-4">
              <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-3">
                  <span className="text-lg">✨</span>
                  <Label className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                    Polish Instructies (Deep Research)
                  </Label>
                  <Badge
                    variant="outline"
                    className="text-xs bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300"
                  >
                    Automatisch toegepast
                  </Badge>
                </div>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 mb-3">
                  Deze instructies worden automatisch toegepast in de laatste fase van deep research om het rapport te
                  polijsten (schrijfstijl, nummering, volledigheid).
                </p>
                <Textarea
                  value={stageConfig?.polishPrompt || ""}
                  onChange={(e) => onPolishPromptChange(e.target.value)}
                  className="font-mono text-sm min-h-40 bg-white dark:bg-gray-900"
                  placeholder={`POLIJST INSTRUCTIES (pas dit toe op het eindrapport):

1. SCHRIJFSTIJL
   - Gebruik consequent WIJ-vorm of objectieve schrijfstijl
   - Vermijd IK-vorm volledig
   - Professioneel en zakelijk taalgebruik

2. STRUCTUUR
   - Nummer alle hoofdstukken: 1. / 1.1 / 1.1.1
   - Volg exact de structuur uit de originele prompt
   - Zorg voor logische volgorde en flow

3. VOLLEDIGHEID
   - Controleer kritisch of elke sectie voldoende diepgang heeft
   - Breid waar nodig uit met extra toelichting en onderbouwing
   - Voeg concrete voorbeelden toe waar relevant

4. KWALITEITSCONTROLE
   - Verwijder herhalingen en redundante tekst
   - Zorg voor consistente terminologie
   - Controleer op spelling en grammatica`}
                  data-testid={`textarea-polish-prompt-${stage.key}`}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
