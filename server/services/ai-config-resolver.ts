import type { AiConfig } from "@shared/schema";

/**
 * AIConfigResolver - Centralized AI Configuration Resolution
 *
 * BELANGRIJK: Alle AI configuratie MOET uit de database komen (prompt_configs).
 * Er zijn GEEN hardcoded defaults - als config ontbreekt, krijg je een error.
 * Dit voorkomt "schaduw logica" waar de code andere waarden gebruikt dan wat
 * in Settings staat geconfigureerd.
 *
 * Usage:
 *   const resolver = new AIConfigResolver();
 *   const config = resolver.resolveForStage(
 *     "4a_BronnenSpecialist",
 *     stageConfig,
 *     globalConfig,
 *     jobId
 *   );
 */
export class AIConfigResolver {
  /**
   * Provider-specific maximum token limits (API limieten, geen defaults)
   */
  private static readonly PROVIDER_MAX_LIMITS = {
    'google': 65536,
    'openai': 200000
  } as const;

  /**
   * Resolve complete AI configuration for a specific stage.
   * GEEN hardcoded defaults - config moet in database staan.
   */
  resolveForStage(
    stageName: string,
    stageConfig?: { aiConfig?: AiConfig; polishPrompt?: string },
    globalConfig?: { aiConfig?: AiConfig },
    jobId?: string
  ): AiConfig {
    const stageAiConfig = stageConfig?.aiConfig;
    const globalAiConfig = globalConfig?.aiConfig;

    // VALIDATION: Er MOET een aiConfig zijn (stage of global)
    if (!stageAiConfig && !globalAiConfig) {
      throw new Error(
        `AI configuratie ontbreekt voor stage "${stageName}". ` +
        `Configureer AI settings in de Settings pagina.`
      );
    }

    // Bepaal welke config te gebruiken (stage override of global)
    const baseConfig = stageAiConfig || globalAiConfig!;

    // VALIDATION: Vereiste velden moeten aanwezig zijn
    this.validateRequiredFields(baseConfig, stageName);

    // Merge stage config over global config (stage heeft prioriteit)
    const mergedConfig = this.mergeConfigs(stageAiConfig, globalAiConfig!);

    // Bepaal provider (uit config of infer van model)
    const provider = this.resolveProvider(mergedConfig);

    // Apply provider max limits (API limieten, niet defaults)
    const configWithLimits = this.applyProviderLimits(mergedConfig, provider);

    // Enable deep research for Stage 3 if using Gemini 3 Pro
    const finalConfig = this.enableDeepResearchIfNeeded(
      configWithLimits,
      stageName,
      stageAiConfig,
      stageConfig?.polishPrompt
    );

    // Log for debugging
    if (jobId) {
      console.log(`📊 [${jobId}] AIConfigResolver resolved:`, {
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
   * Haalt config uit een specifieke key in de prompt config.
   */
  resolveForOperation(
    operationKey: string,
    promptConfig: { [key: string]: any; aiConfig?: AiConfig },
    jobId?: string
  ): AiConfig {
    // Zoek eerst naar operation-specifieke config, dan global aiConfig
    const operationConfig = promptConfig[operationKey]?.aiConfig || promptConfig[operationKey];
    const globalConfig = promptConfig.aiConfig;

    // Check of we een bruikbare config hebben
    const config = this.isValidAiConfig(operationConfig) ? operationConfig : globalConfig;

    if (!config || !this.isValidAiConfig(config)) {
      throw new Error(
        `AI configuratie ontbreekt voor "${operationKey}". ` +
        `Configureer dit in de Settings pagina onder de juiste sectie.`
      );
    }

    this.validateRequiredFields(config, operationKey);

    const provider = this.resolveProvider(config);
    const configWithLimits = this.applyProviderLimits(config, provider);

    if (jobId) {
      console.log(`📊 [${jobId}] AIConfigResolver resolved for ${operationKey}:`, {
        model: configWithLimits.model,
        provider: configWithLimits.provider,
        temperature: configWithLimits.temperature,
        maxTokens: configWithLimits.maxOutputTokens
      });
    }

    return configWithLimits;
  }

  /**
   * Check of een object een geldige AiConfig is
   */
  private isValidAiConfig(config: any): config is AiConfig {
    return config &&
           typeof config === 'object' &&
           typeof config.model === 'string' &&
           config.model.length > 0;
  }

  /**
   * Valideer dat vereiste velden aanwezig zijn in de config
   */
  private validateRequiredFields(config: AiConfig, context: string): void {
    const requiredFields: (keyof AiConfig)[] = ['model', 'temperature', 'maxOutputTokens'];
    const missingFields = requiredFields.filter(field => config[field] === undefined || config[field] === null);

    if (missingFields.length > 0) {
      throw new Error(
        `AI configuratie voor "${context}" mist vereiste velden: ${missingFields.join(', ')}. ` +
        `Configureer deze in de Settings pagina.`
      );
    }
  }

  /**
   * Merge stage config over global config (stage heeft prioriteit)
   */
  private mergeConfigs(stageConfig: AiConfig | undefined, globalConfig: AiConfig): AiConfig {
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

  /**
   * Resolve provider from config or infer from model name
   */
  private resolveProvider(config: AiConfig): 'google' | 'openai' {
    if (config.provider) return config.provider;

    // Infer from model name
    const model = config.model || '';
    return model.startsWith('gpt') || model.startsWith('o3') || model.startsWith('o4')
      ? 'openai'
      : 'google';
  }

  /**
   * Apply provider-specific maximum token limits (API limieten, niet defaults)
   * Dit voorkomt dat we meer tokens vragen dan de API aankan.
   */
  private applyProviderLimits(config: AiConfig, provider: 'google' | 'openai'): AiConfig {
    const limit = AIConfigResolver.PROVIDER_MAX_LIMITS[provider];

    // Alleen limiteren als config meer vraagt dan API aankan
    if (config.maxOutputTokens > limit) {
      console.warn(
        `⚠️ maxOutputTokens (${config.maxOutputTokens}) overschrijdt ${provider} limiet (${limit}). ` +
        `Wordt beperkt tot ${limit}.`
      );
      return {
        ...config,
        maxOutputTokens: limit
      };
    }

    return config;
  }

  /**
   * Enable deep research for Stage 3 when using Gemini 3 Pro.
   * Deep research settings komen uit config, niet hardcoded.
   */
  private enableDeepResearchIfNeeded(
    config: AiConfig,
    stageName: string,
    stageAiConfig?: AiConfig,
    polishPrompt?: string
  ): AiConfig {
    // Only auto-enable for Stage 3 (Generatie)
    if (stageName !== '3_generatie') {
      return config;
    }

    // Only enable for Gemini 3 Pro model
    if (config.model !== 'gemini-3-pro-preview') {
      return config;
    }

    // Check if explicitly disabled in stage config
    if (stageAiConfig && (stageAiConfig as any).useDeepResearch === false) {
      return config;
    }

    // Enable deep research - settings komen uit stageAiConfig
    // Als niet geconfigureerd, gebruik defaults die in Settings UI staan
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
}
