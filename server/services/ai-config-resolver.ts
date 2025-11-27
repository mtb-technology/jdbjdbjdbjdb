import type { AiConfig } from "@shared/schema";
import { REPORT_CONFIG } from "../config/index";

/**
 * AIConfigResolver - Centralized AI Configuration Resolution
 *
 * Eliminates code duplication by providing a single source of truth for:
 * - Model selection based on stage complexity
 * - Config fallback logic (stage → global → defaults)
 * - Provider-specific token limits
 * - Token adjustment based on model type
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
   * Token requirements per model type and stage
   */
  private static readonly TOKEN_REQUIREMENTS = {
    'deep-research': {
      '3_generatie': 32768,       // Deep research needs large output for comprehensive reports
      '4a_BronnenSpecialist': 32768,
      'default': 24576
    },
    'gpt-4o': {
      'default': 16384
    },
    'default': {
      'default': 4096
    }
  } as const;

  /**
   * Provider-specific maximum token limits
   */
  private static readonly PROVIDER_LIMITS = {
    'google': 32768,
    'openai': 200000 // OpenAI has much higher limits
  } as const;

  /**
   * Resolve complete AI configuration for a specific stage
   */
  resolveForStage(
    stageName: string,
    stageConfig?: { aiConfig?: AiConfig; polishPrompt?: string },
    globalConfig?: { aiConfig?: AiConfig },
    jobId?: string
  ): AiConfig {
    const stageAiConfig = stageConfig?.aiConfig;
    const globalAiConfig = globalConfig?.aiConfig;

    // Step 1: Determine optimal model
    const selectedModel = this.selectOptimalModel(stageName, stageAiConfig, globalAiConfig);

    // Step 2: Determine provider
    const provider = this.resolveProvider(stageAiConfig, globalAiConfig, selectedModel);

    // Step 3: Build base config with fallbacks
    const baseConfig = this.buildBaseConfig(stageAiConfig, globalAiConfig, selectedModel, provider);

    // Step 4: Apply provider-specific limits
    const configWithLimits = this.applyProviderLimits(baseConfig, provider);

    // Step 5: Apply stage-specific token adjustments
    const finalConfig = this.applyTokenAdjustments(configWithLimits, stageName, selectedModel, jobId);

    // Step 6: Enable deep research for Stage 3 if using Gemini 3 Pro
    const configWithDeepResearch = this.enableDeepResearchIfNeeded(finalConfig, stageName, stageAiConfig, stageConfig?.polishPrompt);

    // Log for debugging
    if (jobId) {
      console.log(`📊 [${jobId}] AIConfigResolver resolved:`, {
        stage: stageName,
        model: configWithDeepResearch.model,
        provider: configWithDeepResearch.provider,
        maxTokens: configWithDeepResearch.maxOutputTokens,
        useDeepResearch: (configWithDeepResearch as any).useDeepResearch,
        hasPolishPrompt: !!(configWithDeepResearch as any).polishPrompt,
        isHybridSelection: !stageAiConfig?.model && !globalAiConfig?.model
      });
    }

    return configWithDeepResearch;
  }

  /**
   * Select optimal model based on stage complexity
   * Implements hybrid workflow strategy
   */
  private selectOptimalModel(
    stageName: string,
    stageAiConfig?: AiConfig,
    globalAiConfig?: AiConfig
  ): string {
    // Explicit configuration takes precedence
    if (stageAiConfig?.model) return stageAiConfig.model;
    if (globalAiConfig?.model) return globalAiConfig.model;

    // Hybrid workflow logic based on stage complexity
    switch (stageName) {
      case '1_informatiecheck':
      case '2_complexiteitscheck':
        return REPORT_CONFIG.simpleTaskModel; // Fast automated checks

      case '3_generatie':
        return REPORT_CONFIG.complexTaskModel; // Powerful for large reports

      case '4a_BronnenSpecialist':
      case '4b_FiscaalTechnischSpecialist':
        return REPORT_CONFIG.reviewerModel; // Balanced for critical reviews

      case '4c_ScenarioGatenAnalist':
      case '4e_DeAdvocaat':
      case '4f_HoofdCommunicatie':
        return REPORT_CONFIG.simpleTaskModel; // Fast for routine reviews

      case '6_change_summary':
        return REPORT_CONFIG.simpleTaskModel; // Fast for analysis

      default:
        return REPORT_CONFIG.defaultModel;
    }
  }

  /**
   * Resolve provider from config or infer from model name
   */
  private resolveProvider(
    stageAiConfig?: AiConfig,
    globalAiConfig?: AiConfig,
    model?: string
  ): 'google' | 'openai' {
    if (stageAiConfig?.provider) return stageAiConfig.provider;
    if (globalAiConfig?.provider) return globalAiConfig.provider;

    // Infer from model name
    return model?.startsWith('gpt') || model?.startsWith('o3') || model?.startsWith('o4')
      ? 'openai'
      : 'google';
  }

  /**
   * Build base configuration with proper fallbacks
   */
  private buildBaseConfig(
    stageAiConfig: AiConfig | undefined,
    globalAiConfig: AiConfig | undefined,
    model: string,
    provider: 'google' | 'openai'
  ): AiConfig {
    const baseMaxTokens = Math.max(
      stageAiConfig?.maxOutputTokens ?? 8192,
      globalAiConfig?.maxOutputTokens ?? 8192,
      8192
    );

    return {
      provider,
      model,
      temperature: stageAiConfig?.temperature ?? globalAiConfig?.temperature ?? 0.1,
      topP: stageAiConfig?.topP ?? globalAiConfig?.topP ?? 0.95,
      topK: stageAiConfig?.topK ?? globalAiConfig?.topK ?? 20,
      maxOutputTokens: baseMaxTokens,
      reasoning: stageAiConfig?.reasoning ?? globalAiConfig?.reasoning,
      verbosity: stageAiConfig?.verbosity ?? globalAiConfig?.verbosity
    };
  }

  /**
   * Apply provider-specific maximum token limits
   */
  private applyProviderLimits(config: AiConfig, provider: 'google' | 'openai'): AiConfig {
    const limit = AIConfigResolver.PROVIDER_LIMITS[provider];

    return {
      ...config,
      maxOutputTokens: Math.min(config.maxOutputTokens, limit)
    };
  }

  /**
   * Apply stage and model-specific token adjustments
   */
  private applyTokenAdjustments(
    config: AiConfig,
    stageName: string,
    model: string,
    jobId?: string
  ): AiConfig {
    let adjustedTokens = config.maxOutputTokens;

    // Deep Research models need more tokens for comprehensive reports
    if (model.includes('deep-research')) {
      const requirements = AIConfigResolver.TOKEN_REQUIREMENTS['deep-research'];

      // Stage-specific token requirements
      let stageRequirement: number;
      if (stageName === '3_generatie') {
        stageRequirement = requirements['3_generatie'];
      } else if (stageName === '4a_BronnenSpecialist') {
        stageRequirement = requirements['4a_BronnenSpecialist'];
      } else {
        stageRequirement = requirements.default;
      }

      adjustedTokens = Math.max(config.maxOutputTokens, stageRequirement);

      if (jobId) {
        console.log(`📦 [${jobId}] Increased tokens for Deep Research (${stageName}): ${adjustedTokens}`);
      }

      return {
        ...config,
        maxOutputTokens: adjustedTokens
      };
    }

    // Only adjust for reviewer stages (4a-4f) for non-deep-research models
    if (!stageName.startsWith('4')) {
      return config;
    }
    // GPT-4o also benefits from more tokens
    else if (model.includes('gpt-4o')) {
      const requirements = AIConfigResolver.TOKEN_REQUIREMENTS['gpt-4o'];
      adjustedTokens = Math.max(config.maxOutputTokens, requirements.default);

      if (jobId) {
        console.log(`🎯 [${jobId}] Increased tokens for GPT-4o: ${adjustedTokens}`);
      }
    }
    // Fallback for other models
    else if (config.maxOutputTokens < 4096) {
      const requirements = AIConfigResolver.TOKEN_REQUIREMENTS.default;
      adjustedTokens = Math.max(config.maxOutputTokens, requirements.default);

      if (jobId) {
        console.log(`📈 [${jobId}] Applied minimum tokens: ${adjustedTokens}`);
      }
    }

    return {
      ...config,
      maxOutputTokens: adjustedTokens
    };
  }

  /**
   * Enable deep research for Stage 3 when using Gemini 3 Pro
   * Deep research is automatically enabled unless explicitly disabled
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

    // Enable deep research with default settings
    return {
      ...config,
      useDeepResearch: true,
      useGrounding: true, // Deep research requires grounding
      maxQuestions: (stageAiConfig as any)?.maxQuestions || 5,
      parallelExecutors: (stageAiConfig as any)?.parallelExecutors || 3,
      thinkingLevel: config.thinkingLevel || 'high',
      polishPrompt: polishPrompt // Pass through polish instructions from stage config
    } as any;
  }
}
