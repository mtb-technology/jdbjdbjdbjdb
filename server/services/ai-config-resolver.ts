import type { AiConfig } from "@shared/schema";
import { logger } from "./logger";

/**
 * AI Config Resolver - Simpele functies voor config resolution
 *
 * Merged database config met provider limits om finale AiConfig te produceren.
 * Geen class nodig - dit zijn stateless transformaties.
 *
 * @see docs/ARCHITECTURE.md
 */

/** Provider-specific maximum token limits (API limieten) */
const PROVIDER_MAX_LIMITS = {
  google: 65535, // Gemini 2.5/3 output limit
  openai: 200000,
} as const;

/**
 * Resolve complete AI configuration for a specific stage.
 */
export function resolveForStage(
  stageName: string,
  stageConfig?: { aiConfig?: AiConfig; polishPrompt?: string },
  globalConfig?: { aiConfig?: AiConfig },
  jobId?: string
): AiConfig {
  const stageAiConfig = stageConfig?.aiConfig;
  const globalAiConfig = globalConfig?.aiConfig;

  if (!stageAiConfig && !globalAiConfig) {
    throw new Error(
      `AI configuratie ontbreekt voor stage "${stageName}". ` +
      `Configureer AI settings in de Settings pagina.`
    );
  }

  const baseConfig = stageAiConfig || globalAiConfig!;
  validateRequiredFields(baseConfig, stageName);

  const mergedConfig = mergeConfigs(stageAiConfig, globalAiConfig!);
  const provider = resolveProvider(mergedConfig);
  const configWithLimits = applyProviderLimits(mergedConfig, provider);
  const finalConfig = enableDeepResearchIfNeeded(
    configWithLimits,
    stageName,
    stageAiConfig,
    stageConfig?.polishPrompt
  );

  if (jobId) {
    logger.debug(jobId, 'Config resolved', {
      stage: stageName,
      model: finalConfig.model,
      provider: finalConfig.provider,
      temperature: finalConfig.temperature,
      maxTokens: finalConfig.maxOutputTokens,
      useDeepResearch: (finalConfig as any).useDeepResearch,
      source: stageAiConfig ? 'stage-specific' : 'global'
    });
  }

  return finalConfig;
}

/**
 * Resolve config for non-stage operations (test_ai, follow_up_assistant, etc.)
 */
export function resolveForOperation(
  operationKey: string,
  promptConfig: { [key: string]: any; aiConfig?: AiConfig },
  jobId?: string
): AiConfig {
  const operationConfig = promptConfig[operationKey]?.aiConfig || promptConfig[operationKey];
  const globalConfig = promptConfig.aiConfig;

  const config = isValidAiConfig(operationConfig) ? operationConfig : globalConfig;

  if (!config || !isValidAiConfig(config)) {
    throw new Error(
      `AI configuratie ontbreekt voor "${operationKey}". ` +
      `Configureer dit in de Settings pagina onder de juiste sectie.`
    );
  }

  validateRequiredFields(config, operationKey);

  const provider = resolveProvider(config);
  const configWithLimits = applyProviderLimits(config, provider);

  if (jobId) {
    logger.debug(jobId, `Config resolved for ${operationKey}`, {
      model: configWithLimits.model,
      provider: configWithLimits.provider,
      temperature: configWithLimits.temperature,
      maxTokens: configWithLimits.maxOutputTokens
    });
  }

  return configWithLimits;
}

// --- Private helpers ---

function isValidAiConfig(config: any): config is AiConfig {
  return config &&
    typeof config === 'object' &&
    typeof config.model === 'string' &&
    config.model.length > 0;
}

function validateRequiredFields(config: AiConfig, context: string): void {
  const requiredFields: (keyof AiConfig)[] = ['model', 'temperature', 'maxOutputTokens'];
  const missingFields = requiredFields.filter(field => config[field] === undefined || config[field] === null);

  if (missingFields.length > 0) {
    throw new Error(
      `AI configuratie voor "${context}" mist vereiste velden: ${missingFields.join(', ')}. ` +
      `Configureer deze in de Settings pagina.`
    );
  }
}

function mergeConfigs(stageConfig: AiConfig | undefined, globalConfig: AiConfig): AiConfig {
  if (!stageConfig) return { ...globalConfig };

  return {
    provider: stageConfig.provider ?? globalConfig.provider,
    model: stageConfig.model ?? globalConfig.model,
    temperature: stageConfig.temperature ?? globalConfig.temperature,
    topP: stageConfig.topP ?? globalConfig.topP,
    topK: stageConfig.topK ?? globalConfig.topK,
    maxOutputTokens: stageConfig.maxOutputTokens ?? globalConfig.maxOutputTokens,
    thinkingLevel: stageConfig.thinkingLevel ?? globalConfig.thinkingLevel,
    reasoning: stageConfig.reasoning ?? globalConfig.reasoning,
    verbosity: stageConfig.verbosity ?? globalConfig.verbosity
  };
}

function resolveProvider(config: AiConfig): 'google' | 'openai' {
  if (config.provider) return config.provider;

  const model = config.model || '';
  return model.startsWith('gpt') || model.startsWith('o3') || model.startsWith('o4')
    ? 'openai'
    : 'google';
}

function applyProviderLimits(config: AiConfig, provider: 'google' | 'openai'): AiConfig {
  const limit = PROVIDER_MAX_LIMITS[provider];

  if (config.maxOutputTokens > limit) {
    logger.warn('ai-config', `maxOutputTokens (${config.maxOutputTokens}) overschrijdt ${provider} limiet (${limit}). Wordt beperkt tot ${limit}.`);
    return { ...config, maxOutputTokens: limit };
  }

  return config;
}

function enableDeepResearchIfNeeded(
  config: AiConfig,
  stageName: string,
  stageAiConfig?: AiConfig,
  polishPrompt?: string
): AiConfig {
  if (stageName !== '3_generatie') return config;
  if (config.model !== 'gemini-3-pro-preview') return config;
  if (stageAiConfig && (stageAiConfig as any).useDeepResearch === false) return config;

  return {
    ...config,
    useDeepResearch: true,
    useGrounding: (stageAiConfig as any)?.useGrounding ?? true,
    maxQuestions: (stageAiConfig as any)?.maxQuestions,
    parallelExecutors: (stageAiConfig as any)?.parallelExecutors,
    thinkingLevel: config.thinkingLevel,
    polishPrompt: polishPrompt
  } as any;
}

/**
 * @deprecated Use resolveForStage() and resolveForOperation() directly.
 * This class is kept for backwards compatibility only.
 */
export class AIConfigResolver {
  resolveForStage = resolveForStage;
  resolveForOperation = resolveForOperation;
}
