/**
 * Settings Types
 *
 * Type definitions for the Settings page components and hooks.
 * Centralizes types to eliminate `any` usage and improve type safety.
 */

import type { AiConfig, StageConfig, PromptConfig } from "@shared/schema";

// Re-export shared types for convenience
export type { AiConfig, StageConfig, PromptConfig };

/**
 * AI Provider type
 */
export type AiProvider = "google" | "openai";

/**
 * Stage configuration field names that can be updated
 */
export type StageConfigField = keyof Omit<StageConfig, "aiConfig">;

/**
 * Stage keys from PROMPT_STAGES
 */
export type StageKey =
  | "1a_informatiecheck"
  | "1b_informatiecheck_email"
  | "2_complexiteitscheck"
  | "3_generatie"
  | "4a_BronnenSpecialist"
  | "4b_FiscaalTechnischSpecialist"
  | "4c_ScenarioGatenAnalist"
  | "4e_DeAdvocaat"
  | "4f_HoofdCommunicatie"
  | "editor"
  | "adjustment";

/**
 * Stage type for workflow stages
 */
export type StageType = "generator" | "reviewer" | "processor";

/**
 * Prompt stage definition
 */
export interface PromptStage {
  key: StageKey;
  label: string;
  description: string;
  type: StageType;
}

/**
 * API Response wrapper type - handles the new API response format
 * Replaces `any` usage in lines 394, 462
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
  };
}

/**
 * Mutation context for optimistic updates
 * Replaces `any` on line 153
 */
export interface MutationContext {
  previousData: unknown;
}

/**
 * Completion stats for prompt configuration
 */
export interface CompletionStats {
  completed: number;
  total: number;
}

/**
 * AI Model option for select dropdowns
 */
export interface AiModelOption {
  value: string;
  label: string;
}

/**
 * AI Models by provider
 */
export interface AiModelsByProvider {
  google: readonly AiModelOption[];
  openai: readonly AiModelOption[];
}

/**
 * Props for StageConfigCard component
 */
export interface StageConfigCardProps {
  stage: PromptStage;
  stageConfig: StageConfig | undefined;
  globalAiConfig: AiConfig;
  isEmpty: boolean;
  onPromptChange: (value: string) => void;
  onGroundingChange: (value: boolean) => void;
  onWebSearchChange: (value: boolean) => void;
  onPolishPromptChange: (value: string) => void;
  onStageAiConfigChange: (key: keyof AiConfig, value: AiConfig[keyof AiConfig]) => void;
  onStageOpenAIParamsChange: (paramType: "reasoning" | "verbosity", value: string) => void;
  onProviderChange: (value: AiProvider) => void;
}

/**
 * Props for AiProviderSelect component
 */
export interface AiProviderSelectProps {
  provider: AiProvider;
  model: string;
  onProviderChange: (value: AiProvider) => void;
  onModelChange: (value: string) => void;
  size?: "default" | "sm";
  showLabels?: boolean;
  testIdPrefix?: string;
}

/**
 * Props for GoogleAiConfigPanel component
 */
export interface GoogleAiConfigPanelProps {
  temperature: number;
  maxOutputTokens: number;
  topP: number;
  topK: number;
  thinkingLevel?: string;
  model: string;
  onConfigChange: (key: keyof AiConfig, value: number | string) => void;
  testIdPrefix?: string;
}

/**
 * Props for OpenAiConfigPanel component
 */
export interface OpenAiConfigPanelProps {
  temperature: number;
  maxOutputTokens: number;
  reasoningEffort?: string;
  verbosity?: string;
  onConfigChange: (key: keyof AiConfig, value: number | string) => void;
  onParamsChange: (paramType: "reasoning" | "verbosity", value: string) => void;
  testIdPrefix?: string;
}

/**
 * Props for GlobalAiConfigCard component
 */
export interface GlobalAiConfigCardProps {
  aiConfig: AiConfig;
  onAiConfigChange: (key: keyof AiConfig, value: AiConfig[keyof AiConfig]) => void;
}

/**
 * Props for PipelineHeader component
 */
export interface PipelineHeaderProps {
  stats: CompletionStats;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  onSave: () => void;
  onBackup: () => void;
  onRestoreClick: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onRestore: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Props for WorkflowInfoCard component
 */
export interface WorkflowInfoCardProps {
  // Currently no props needed, but interface allows future extension
}

/**
 * Extract data from API response, handling both old and new formats
 */
export function extractApiData<T>(responseData: unknown): T {
  if (
    responseData &&
    typeof responseData === "object" &&
    "success" in responseData &&
    (responseData as ApiResponse<T>).success === true
  ) {
    return (responseData as ApiResponse<T>).data as T;
  }
  return responseData as T;
}
