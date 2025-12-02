/**
 * useAiConfigHandlers Hook
 *
 * Handles AI configuration updates for both per-stage and global settings.
 * Consolidates:
 * - handleStageAiConfigChange (lines 274-305)
 * - handleStageOpenAIParamsChange (lines 307-346)
 * - handleAiConfigChange (lines 488-508)
 */

import { useCallback } from "react";
import type { PromptConfig, StageConfig, AiConfig } from "@shared/schema";
import type { StageKey, AiProvider } from "@/types/settings.types";
import { DEFAULT_AI_CONFIG, DEFAULT_MODEL_BY_PROVIDER } from "@/constants/settings.constants";
import { useToast } from "@/hooks/use-toast";

type StageConfigKey = keyof Omit<PromptConfig, "aiConfig">;

interface UseAiConfigHandlersReturn {
  handleStageAiConfigChange: (
    stageKey: StageKey,
    aiConfigKey: keyof AiConfig,
    value: AiConfig[keyof AiConfig]
  ) => void;
  handleStageOpenAIParamsChange: (
    stageKey: StageKey,
    paramType: "reasoning" | "verbosity",
    value: string
  ) => void;
  handleStageProviderChange: (stageKey: StageKey, provider: AiProvider) => void;
  handleGlobalAiConfigChange: (key: keyof AiConfig, value: AiConfig[keyof AiConfig]) => void;
}

export function useAiConfigHandlers(
  activeConfig: PromptConfig | null,
  setActiveConfig: React.Dispatch<React.SetStateAction<PromptConfig | null>>,
  globalAiConfig: AiConfig,
  setGlobalAiConfig: React.Dispatch<React.SetStateAction<AiConfig>>
): UseAiConfigHandlersReturn {
  const { toast } = useToast();

  /**
   * Handle per-stage AI config changes
   */
  const handleStageAiConfigChange = useCallback(
    (stageKey: StageKey, aiConfigKey: keyof AiConfig, value: AiConfig[keyof AiConfig]) => {
      if (!activeConfig) return;

      const configKey = stageKey as StageConfigKey;
      const currentStageConfig = activeConfig[configKey] as StageConfig;
      const currentAiConfig = currentStageConfig?.aiConfig || { ...DEFAULT_AI_CONFIG };

      const updates: Partial<AiConfig> = { [aiConfigKey]: value };

      // Auto-adjust parameters for Gemini 3 Pro
      if (aiConfigKey === "model" && value === "gemini-3-pro-preview") {
        updates.temperature = 1.0;
        updates.thinkingLevel = currentAiConfig.thinkingLevel || "high";
      }

      setActiveConfig({
        ...activeConfig,
        [stageKey]: {
          ...currentStageConfig,
          aiConfig: {
            ...currentAiConfig,
            ...updates,
          },
        },
      });
    },
    [activeConfig, setActiveConfig]
  );

  /**
   * Handle nested OpenAI parameters (reasoning, verbosity)
   */
  const handleStageOpenAIParamsChange = useCallback(
    (stageKey: StageKey, paramType: "reasoning" | "verbosity", value: string) => {
      if (!activeConfig) return;

      const configKey = stageKey as StageConfigKey;
      const currentStageConfig = activeConfig[configKey] as StageConfig;
      const currentAiConfig = currentStageConfig?.aiConfig || { ...DEFAULT_AI_CONFIG };

      if (paramType === "reasoning") {
        setActiveConfig({
          ...activeConfig,
          [stageKey]: {
            ...currentStageConfig,
            aiConfig: {
              ...currentAiConfig,
              reasoning: {
                effort: value as "minimal" | "low" | "medium" | "high",
              },
            },
          },
        });
      } else if (paramType === "verbosity") {
        setActiveConfig({
          ...activeConfig,
          [stageKey]: {
            ...currentStageConfig,
            aiConfig: {
              ...currentAiConfig,
              verbosity: value as "low" | "medium" | "high",
            },
          },
        });
      }
    },
    [activeConfig, setActiveConfig]
  );

  /**
   * Handle provider change for a stage (with model reset)
   */
  const handleStageProviderChange = useCallback(
    (stageKey: StageKey, provider: AiProvider) => {
      if (!activeConfig) return;

      const configKey = stageKey as StageConfigKey;
      const currentStageConfig = activeConfig[configKey] as StageConfig;
      const currentAiConfig = currentStageConfig?.aiConfig || {
        provider: globalAiConfig.provider,
        model: globalAiConfig.model,
        temperature: globalAiConfig.temperature,
        topP: globalAiConfig.topP,
        topK: globalAiConfig.topK,
        maxOutputTokens: globalAiConfig.maxOutputTokens,
      };

      const defaultModel = DEFAULT_MODEL_BY_PROVIDER[provider];

      setActiveConfig({
        ...activeConfig,
        [stageKey]: {
          ...currentStageConfig,
          useGrounding: provider === "google" ? (currentStageConfig?.useGrounding || false) : false,
          useWebSearch: provider === "openai" ? (currentStageConfig?.useWebSearch || false) : false,
          aiConfig: {
            ...currentAiConfig,
            provider,
            model: defaultModel,
          },
        },
      });
    },
    [activeConfig, setActiveConfig, globalAiConfig]
  );

  /**
   * Handle global AI config changes
   */
  const handleGlobalAiConfigChange = useCallback(
    (key: keyof AiConfig, value: AiConfig[keyof AiConfig]) => {
      setGlobalAiConfig((prev) => {
        const updates: Partial<AiConfig> = { [key]: value };

        // Auto-adjust parameters for Gemini 3 Pro
        if (key === "model" && value === "gemini-3-pro-preview") {
          updates.temperature = 1.0;
          updates.thinkingLevel = prev.thinkingLevel || "high";

          toast({
            title: "Parameters aangepast voor Gemini 3 Pro",
            description: "Temperature automatisch ingesteld op 1.0 (aanbevolen voor optimale prestaties)",
          });
        }

        return {
          ...prev,
          ...updates,
        };
      });
    },
    [setGlobalAiConfig, toast]
  );

  return {
    handleStageAiConfigChange,
    handleStageOpenAIParamsChange,
    handleStageProviderChange,
    handleGlobalAiConfigChange,
  };
}
