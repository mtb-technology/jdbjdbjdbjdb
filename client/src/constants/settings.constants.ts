/**
 * Settings Constants
 *
 * Centralized constants for the Settings page.
 * MUST match server/config/index.ts AI_MODELS for consistency.
 */

import type { AiConfig, AiModelsByProvider, PromptStage, StageKey } from "@/types/settings.types";

/**
 * Available AI models by provider
 * MUST match server/config/index.ts AI_MODELS
 */
export const AI_MODELS: AiModelsByProvider = {
  google: [
    { value: "gemini-3-pro-preview", label: "🧠 Gemini 3 Pro (Nieuwste - Advanced Reasoning)" },
    { value: "gemini-2.5-pro", label: "🌟 Gemini 2.5 Pro (Beste kwaliteit)" },
    { value: "gemini-2.5-flash", label: "⚡ Gemini 2.5 Flash (Snelste)" },
    { value: "gemini-2.5-pro-deep-research", label: "🔬 Gemini 2.5 Pro Deep Research (Diepgaande analyse)" },
  ],
  openai: [
    { value: "gpt-5", label: "🚀 GPT-5 (Nieuwste - Responses API)" },
    { value: "gpt-4o", label: "GPT-4o (Beste kwaliteit)" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini (Snel & Efficiënt)" },
    { value: "o3-mini", label: "o3-mini (Reasoning)" },
    { value: "o3", label: "o3 (Advanced Reasoning)" },
    { value: "o3-deep-research-2025-06-26", label: "o3 Deep Research (Deep Analysis)" },
    { value: "o4-mini-deep-research-2025-06-26", label: "o4-mini Deep Research (Fast Deep Analysis)" },
  ],
} as const;

/**
 * Prompt stages configuration
 */
export const PROMPT_STAGES: readonly PromptStage[] = [
  { key: "1_informatiecheck", label: "1. Informatiecheck", description: "Validatie en opslag dossier", type: "generator" },
  { key: "2_complexiteitscheck", label: "2. Complexiteitscheck", description: "Validatie en opslag bouwplan", type: "generator" },
  { key: "3_generatie", label: "3. Generatie", description: "Basis rapport generatie", type: "generator" },
  { key: "4a_BronnenSpecialist", label: "4a. Bronnen Specialist", description: "Review bronnen → JSON feedback", type: "reviewer" },
  { key: "4b_FiscaalTechnischSpecialist", label: "4b. Fiscaal Technisch Specialist", description: "Review fiscale techniek → JSON feedback", type: "reviewer" },
  { key: "4c_ScenarioGatenAnalist", label: "4c. Scenario Gaten Analist", description: "Review scenarios → JSON feedback", type: "reviewer" },
  { key: "4e_DeAdvocaat", label: "4e. De Advocaat", description: "Review juridisch → JSON feedback", type: "reviewer" },
  { key: "4f_HoofdCommunicatie", label: "4f. Hoofd Communicatie", description: "Review communicatie en klantgerichtheid → JSON feedback", type: "reviewer" },
  { key: "editor", label: "Editor (Chirurgische Redacteur)", description: "Past wijzigingen van reviewers toe op rapport", type: "generator" },
] as const;

/**
 * Default AI configuration
 * Used when initializing new stage configs or resetting to defaults
 */
export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: "google",
  model: "gemini-2.5-pro",
  temperature: 0.1,
  topP: 0.95,
  topK: 20,
  maxOutputTokens: 8192,
};

/**
 * Default model per provider
 */
export const DEFAULT_MODEL_BY_PROVIDER = {
  google: "gemini-2.5-pro",
  openai: "gpt-4o",
} as const;

/**
 * AI Parameter limits for validation and UI
 */
export const AI_PARAMETER_LIMITS = {
  temperature: { min: 0, max: 2, step: 0.1 },
  maxOutputTokens: { min: 100, max: 8192, step: 256 },
  topP: { min: 0.1, max: 1, step: 0.05 },
  topK: { min: 1, max: 40, step: 1 },
} as const;

/**
 * Get stage config key for accessing PromptConfig
 */
export function getStageConfigKey(stageKey: StageKey): keyof Omit<import("@shared/schema").PromptConfig, "aiConfig"> {
  return stageKey as keyof Omit<import("@shared/schema").PromptConfig, "aiConfig">;
}
