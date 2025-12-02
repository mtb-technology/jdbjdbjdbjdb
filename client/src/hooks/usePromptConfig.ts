/**
 * usePromptConfig Hook
 *
 * Consolidates the 6 duplicate handler functions from settings.tsx:
 * - handlePromptChange
 * - handleGroundingChange
 * - handleWebSearchChange
 * - handleStepTypeChange
 * - handleVerwerkerPromptChange
 * - handlePolishPromptChange
 *
 * Into a single generic handler with type-safe field updates.
 */

import { useCallback, useMemo } from "react";
import type { PromptConfig, StageConfig } from "@shared/schema";
import type { StageKey, CompletionStats } from "@/types/settings.types";
import { PROMPT_STAGES } from "@/constants/settings.constants";

type StageConfigKey = keyof Omit<PromptConfig, "aiConfig">;

interface UsePromptConfigReturn {
  handleStageConfigChange: <K extends keyof StageConfig>(
    stageKey: StageKey,
    field: K,
    value: StageConfig[K]
  ) => void;
  isPromptEmpty: (prompt: string) => boolean;
  getCompletionStats: CompletionStats;
}

export function usePromptConfig(
  activeConfig: PromptConfig | null,
  setActiveConfig: React.Dispatch<React.SetStateAction<PromptConfig | null>>
): UsePromptConfigReturn {
  /**
   * Generic handler for updating any field in a stage config.
   * Replaces 6 nearly-identical handlers.
   */
  const handleStageConfigChange = useCallback(
    <K extends keyof StageConfig>(stageKey: StageKey, field: K, value: StageConfig[K]) => {
      if (!activeConfig) return;

      const configKey = stageKey as StageConfigKey;
      const currentStageConfig = activeConfig[configKey] as StageConfig;

      setActiveConfig({
        ...activeConfig,
        [stageKey]: {
          ...currentStageConfig,
          [field]: value,
        },
      });
    },
    [activeConfig, setActiveConfig]
  );

  /**
   * Check if a prompt is empty or a placeholder
   */
  const isPromptEmpty = useCallback((prompt: string): boolean => {
    return !prompt || prompt.trim() === "" || prompt.startsWith("PLACEHOLDER:");
  }, []);

  /**
   * Calculate completion stats for all stages
   */
  const getCompletionStats = useMemo((): CompletionStats => {
    if (!activeConfig) {
      return { completed: 0, total: PROMPT_STAGES.length };
    }

    const completed = PROMPT_STAGES.filter((stage) => {
      const stageConfig = activeConfig[stage.key as StageConfigKey] as StageConfig;
      return !isPromptEmpty(stageConfig?.prompt || "");
    }).length;

    return { completed, total: PROMPT_STAGES.length };
  }, [activeConfig, isPromptEmpty]);

  return {
    handleStageConfigChange,
    isPromptEmpty,
    getCompletionStats,
  };
}
