import type { DossierData, BouwplanData, PromptConfig, AiConfig, StageConfig } from "@shared/schema";

// Internal type for stage configuration
interface StagePromptConfig {
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}
import { SourceValidator } from "./source-validator";
import { AIModelFactory, AIModelParameters } from "./ai-models/ai-model-factory";
import { AIConfigResolver } from "./ai-config-resolver";
import { PromptBuilder, StagePromptConfig } from "./prompt-builder";
import { storage } from "../storage";
import { ServerError } from "../middleware/errorHandler";
import { ERROR_CODES } from "@shared/errors";
import { REPORT_CONFIG, getStageConfig } from "../config/index";

export class ReportGenerator {
  /**
   * Validates that a stage has a configured prompt.
   * Throws an error with user-friendly message if prompt is missing.
   *
   * @param stageName - The stage identifier (e.g. "1_informatiecheck")
   * @param stageConfig - The stage configuration object
   * @throws {Error} NO_PROMPT_CONFIGURED error if prompt is missing or empty
   */
  private validateStagePrompt(stageName: string, stageConfig?: StagePromptConfig): void {
    if (!stageConfig?.prompt || stageConfig.prompt.trim() === "") {
      throw new Error(`NO_PROMPT_CONFIGURED|Geen prompt ingesteld voor stap ${stageName} — configureer dit in Instellingen.`);
    }
  }

  private getStageDisplayName(stageName: string): string {
    const stageNames: Record<string, string> = {
      '1_informatiecheck': 'Informatie Check',
      '2_complexiteitscheck': 'Complexiteits Check',
      '3_generatie': 'Rapport Generatie',
      '4a_BronnenSpecialist': 'Bronnen Specialist Review',
      '4b_FiscaalTechnischSpecialist': 'Fiscaal Technisch Review',
      '4c_ScenarioGatenAnalist': 'Scenario Analyse',
      '4d_DeVertaler': 'Vertaling Review',
      '4e_DeAdvocaat': 'Juridisch Review',
      '4f_DeKlantpsycholoog': 'Klant Psychologie Review',
      '6_change_summary': 'Change Summary'
    };
    return stageNames[stageName] || stageName;
  }

  private sourceValidator: SourceValidator;
  private modelFactory: AIModelFactory;
  private configResolver: AIConfigResolver;
  private promptBuilder: PromptBuilder;

  constructor() {
    this.sourceValidator = new SourceValidator();
    this.modelFactory = AIModelFactory.getInstance();
    this.configResolver = new AIConfigResolver();
    this.promptBuilder = new PromptBuilder();
  }

  // Test method for AI functionality
  async testAI(prompt: string): Promise<string> {
    const defaultConfig: AiConfig = {
      provider: "google",
      model: "gemini-2.5-pro",
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 2048
    };

    try {
      const response = await this.modelFactory.callModel(defaultConfig, prompt, {
        jobId: "test-ai"
      });

      return response.content;
    } catch (error: any) {
      console.error('Test AI error:', error);
      throw ServerError.ai(
        'AI service test mislukt. Controleer de AI configuratie.',
        { prompt: prompt.substring(0, 100), error: error.message }
      );
    }
  }

  // Extract dossier data from raw text using AI
  async extractDossierData(rawText: string): Promise<any> {
    if (!rawText || rawText.trim().length === 0) {
      throw ServerError.validation(
        'Empty rawText provided',
        'Tekst mag niet leeg zijn voor dossier extractie'
      );
    }

    const extractionPrompt = `Extraheer uit de volgende tekst de belangrijkste klant- en fiscale gegevens en structureer deze in JSON formaat.

Gegeven tekst:
${rawText}

Extraheer de volgende informatie:

1. KLANT GEGEVENS:
- naam: Volledige naam van de klant (voor- en achternaam)
- situatie: Korte samenvatting van de fiscale situatie/vraag

2. FISCALE GEGEVENS:
- vermogen: Geschat vermogen in euro's (gebruik 0 als niet bekend)
- inkomsten: Geschat jaarinkomen in euro's (gebruik 0 als niet bekend)

3. RAPPORT STRUCTUUR:
- Bepaal welke knelpunten/problemen er zijn (minimaal 1)

Geef het resultaat terug als JSON in dit exacte formaat:
{
  "dossier": {
    "klant": {
      "naam": "...",
      "situatie": "..."
    },
    "fiscale_gegevens": {
      "vermogen": 0,
      "inkomsten": 0
    }
  },
  "bouwplan": {
    "taal": "nl",
    "structuur": {
      "inleiding": true,
      "knelpunten": ["knelpunt 1", "knelpunt 2"],
      "scenario_analyse": true,
      "vervolgstappen": true
    }
  }
}

ALLEEN JSON TERUGGEVEN, GEEN ANDERE TEKST.`;

    try {
      const config: AiConfig = {
        provider: "google",
        model: "gemini-2.5-pro",
        temperature: 0.1,
        topP: 0.95,
        topK: 20,
        maxOutputTokens: 2048
      };

      const response = await this.modelFactory.callModel(config, extractionPrompt, {
        jobId: "extract-dossier"
      });

      const extractedJson = response.content.trim();
      if (!extractedJson) {
        throw ServerError.business(
          ERROR_CODES.AI_INVALID_RESPONSE,
          'AI heeft geen bruikbare data geëxtraheerd uit de tekst'
        );
      }

      try {
        return JSON.parse(extractedJson);
      } catch (parseError) {
        console.error('JSON parse error:', parseError, 'Raw content:', extractedJson);
        throw ServerError.business(
          ERROR_CODES.AI_INVALID_RESPONSE,
          'AI heeft geen geldig JSON formaat teruggegeven'
        );
      }
    } catch (error: any) {
      if (error instanceof ServerError) {
        throw error;
      }
      
      console.error('Extract dossier error:', error);
      throw ServerError.ai(
        'Kon geen dossiergegevens extraheren uit de tekst. Probeer het opnieuw of pas de tekst aan.',
        { textLength: rawText.length, error: error.message }
      );
    }
  }

  async generatePromptForStage(
    stageName: string,
    dossier: DossierData,
    bouwplan: BouwplanData,
    previousStageResults: Record<string, string>,
    conceptReportVersions: Record<string, any>,
    customInput?: string
  ): Promise<string | { systemPrompt: string; userInput: string }> {
    const currentDate = new Date().toLocaleDateString('nl-NL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Get active prompt configuration from database
    const promptConfig = await storage.getActivePromptConfig();
    const stageConfig: any = promptConfig?.config?.[stageName as keyof typeof promptConfig.config] || {};

    // Build the prompt based on stage
    let prompt: string | { systemPrompt: string; userInput: string };

    switch (stageName) {
      case "1_informatiecheck":
        prompt = this.buildInformatieCheckPrompt(dossier, bouwplan, currentDate, stageConfig);
        break;
      case "2_complexiteitscheck":
        prompt = this.buildComplexiteitsCheckPrompt(dossier, bouwplan, currentDate, stageConfig, previousStageResults);
        break;
      case "3_generatie":
        prompt = this.buildGeneratiePrompt(dossier, bouwplan, currentDate, stageConfig, previousStageResults);
        break;
      case "6_change_summary":
        prompt = this.buildChangeSummaryPrompt(
          conceptReportVersions,
          dossier,
          bouwplan,
          currentDate,
          stageConfig,
          previousStageResults
        );
        break;
      case "editor":
        prompt = this.buildEditorPrompt(
          conceptReportVersions?.["latest"]?.content || conceptReportVersions?.["3_generatie"]?.content || "",
          previousStageResults,
          currentDate,
          stageConfig
        );
        break;
      default:
        // For reviewer stages (4a-4f)
        if (stageName.startsWith("4")) {
          prompt = this.buildReviewerPrompt(
            stageName,
            conceptReportVersions?.["3_generatie"]?.content || "",
            dossier,
            bouwplan,
            currentDate,
            stageConfig,
            previousStageResults
          );
        } else {
          throw new Error(`Unknown stage: ${stageName}`);
        }
    }

    // Add custom input if provided - handle both formats
    if (customInput) {
      if (typeof prompt === 'string') {
        prompt = `${prompt}\n\n### Aanvullende Input:\n${customInput}`;
      } else {
        // For the new format, append to userInput
        prompt.userInput = `${prompt.userInput}\n\n### Aanvullende Input:\n${customInput}`;
      }
    }

    return prompt;
  }

  async executeStage(
    stageName: string,
    dossier: DossierData,
    bouwplan: BouwplanData,
    previousStageResults: Record<string, string>,
    conceptReportVersions: Record<string, any>,
    customInput?: string,
    jobId?: string
  ): Promise<{ stageOutput: string; conceptReport: string; prompt: string }> {
    // Generate the prompt using the new method
    const promptResult = await this.generatePromptForStage(
      stageName,
      dossier,
      bouwplan,
      previousStageResults,
      conceptReportVersions,
      customInput
    );

    // Convert prompt to string for logging (backward compatibility)
    const promptString = typeof promptResult === 'string'
      ? promptResult
      : `${promptResult.systemPrompt}\n\n### USER INPUT:\n${promptResult.userInput}`;

    // Get active prompt configuration from database for AI config
    const promptConfig = await storage.getActivePromptConfig();
    const stageConfig: any = promptConfig?.config?.[stageName as keyof typeof promptConfig.config] || {};
    const globalConfig: any = promptConfig?.config || {};

    // ✅ REFACTORED: Use centralized AIConfigResolver instead of duplicated logic
    const aiConfig = this.configResolver.resolveForStage(
      stageName,
      stageConfig,
      globalConfig,
      jobId
    );

    // Get stage-specific settings
    const useGrounding = stageConfig?.useGrounding ?? globalConfig?.useGrounding ?? false;
    const useWebSearch = stageConfig?.useWebSearch ?? globalConfig?.useWebSearch ?? false;

    console.log(`🎯 [${jobId}] Starting stage ${stageName}:`, {
      provider: aiConfig.provider,
      model: aiConfig.model,
      grounding: useGrounding,
      webSearch: useWebSearch
    });

    // Get stage-specific timeout and maxTokens from REPORT_CONFIG
    const stageConfigFromReport = getStageConfig(stageName as keyof typeof REPORT_CONFIG.stages);
    const stageTimeout = stageConfigFromReport?.timeout;
    const stageMaxTokens = stageConfigFromReport?.maxTokens;
    
    // Override AI config with stage-specific limits if defined
    if (stageMaxTokens && stageMaxTokens > aiConfig.maxOutputTokens) {
      aiConfig.maxOutputTokens = stageMaxTokens;
      console.log(`📏 [${jobId}] Applied stage maxTokens: ${stageMaxTokens} for ${stageName}`);
    }
    
    // Call the AI model using the factory with stage-specific timeout
    const options: AIModelParameters & { jobId?: string } = {
      jobId,
      useWebSearch,
      useGrounding,
      timeout: stageTimeout // Pass stage-specific timeout
    };

    try {
      const response = await this.modelFactory.callModel(aiConfig, promptResult, options);

      // Process the response based on stage type
      let stageOutput = response.content;
      let conceptReport = "";

      // For generation stages, the output IS the concept report
      if (["3_generatie"].includes(stageName)) {
        conceptReport = stageOutput;
      }
      // For other stages, keep the previous concept report
      else {
        conceptReport = conceptReportVersions?.["latest"] || "";
      }

      return { stageOutput, conceptReport, prompt: promptString };

    } catch (error: any) {
      console.error(`🚨 [${jobId}] Model failed (${aiConfig.model}):`, error.message);

      // Check for rate limits - these should FAIL IMMEDIATELY with no placeholder
      const isRateLimitError = error.message?.includes('Rate limit') ||
                              error.message?.includes('rate_limit') ||
                              error.message?.includes('rate limit') ||
                              error.errorCode === 'AI_RATE_LIMITED';

      if (isRateLimitError) {
        // Rate limits ALWAYS fail - no placeholders, no fallbacks
        console.error(`💥 [${jobId}] RATE LIMIT - Failing stage ${stageName} immediately`);
        throw error; // Re-throw to make the stage actually fail
      }

      // NO FALLBACKS - use only configured model for quality consistency
      const stageDisplayName = this.getStageDisplayName(stageName);

      // Check for other specific error types
      const isAuthError = error.message?.includes('Authentication failed') || error.message?.includes('API key');
      const isTokenLimitError = error.message?.includes('maxOutputTokens') ||
                                error.message?.includes('token limit') ||
                                error.message?.includes('incomplete');

      let errorGuidance = '';
      if (isAuthError) {
        errorGuidance = `
### Authenticatie Probleem:
De API key voor ${aiConfig.provider === 'google' ? 'Google AI' : 'OpenAI'} is niet geldig of heeft geen toegang.

### Oplossingen:
1. Controleer je API key in de **.env** file
2. Zorg dat de API key actief en geldig is
3. Controleer of de API key toegang heeft tot ${aiConfig.model}`;
      } else if (isTokenLimitError) {
        const suggestedTokens = Math.min(aiConfig.maxOutputTokens * 2, 65536);
        errorGuidance = `
### Token Limiet Probleem:
Het model heeft meer tokens nodig dan geconfigureerd.

### Oplossingen:
1. Ga naar **Instellingen → AI Configuratie**
2. Verhoog "Max Output Tokens" naar minimaal ${suggestedTokens}
3. Of kies een ander model dat beter past bij deze taak`;
      } else {
        errorGuidance = `
### Algemene Oplossingen:
1. Controleer of uw API keys geldig zijn en voldoende credits hebben
2. Controleer de netwerk verbinding
3. Probeer de stap opnieuw uit te voeren
4. Overweeg een ander model te configureren in Instellingen`;
      }

      const placeholderResponse = `## ${stageDisplayName}

⚠️ **AI Model Fout**

De geconfigureerde AI (${aiConfig.model}) kon deze stap niet uitvoeren.

### Technische Details:
- Model: ${aiConfig.model}
- Provider: ${aiConfig.provider}
- Prompt lengte: ${promptString.length} karakters
- Foutmelding: ${error.message}
${errorGuidance}

### Status:
❌ Deze stap is mislukt en moet opnieuw worden uitgevoerd na het oplossen van het probleem.

**Let op:** Dit systeem gebruikt GEEN automatische fallbacks om kwaliteit te garanderen. Los het probleem op of configureer een ander model in Instellingen.`;

      console.log(`⚠️ [${jobId}] Returning error response for failed stage ${stageName} (no fallbacks)`);
      
      return {
        stageOutput: placeholderResponse,
        conceptReport: conceptReportVersions?.["latest"] || placeholderResponse,
        prompt: promptString
      };
    }
  }

  // ✅ DEAD CODE REMOVED: generateReport(), generateBasicReport(), finalizeReport()
  // Modern workflow uses: executeStage() + conceptReportVersions + ReportProcessor

  // ✅ REFACTORED: Prompt building methods now use centralized PromptBuilder
  private buildInformatieCheckPrompt(
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: StagePromptConfig
  ): { systemPrompt: string; userInput: string } {
    this.validateStagePrompt("1_informatiecheck", stageConfig);
    return this.promptBuilder.build("1_informatiecheck", stageConfig, () =>
      this.promptBuilder.buildInformatieCheckData(dossier)
    );
  }

  private buildComplexiteitsCheckPrompt(
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: StagePromptConfig,
    previousStageResults?: Record<string, string>
  ): { systemPrompt: string; userInput: string } {
    this.validateStagePrompt("2_complexiteitscheck", stageConfig);
    return this.promptBuilder.build("2_complexiteitscheck", stageConfig, () =>
      this.promptBuilder.buildComplexiteitsCheckData(previousStageResults || {})
    );
  }

  private buildGeneratiePrompt(
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: StagePromptConfig,
    previousStageResults?: Record<string, string>
  ): { systemPrompt: string; userInput: string } {
    this.validateStagePrompt("3_generatie", stageConfig);
    return this.promptBuilder.build("3_generatie", stageConfig, () =>
      this.promptBuilder.buildGeneratieData(previousStageResults || {})
    );
  }

  private buildReviewerPrompt(
    stageName: string,
    conceptReport: string,
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: StagePromptConfig,
    previousStageResults?: Record<string, string>
  ): { systemPrompt: string; userInput: string } {
    this.validateStagePrompt(stageName, stageConfig);
    return this.promptBuilder.build(stageName, stageConfig, () =>
      this.promptBuilder.buildReviewerData(previousStageResults || {}, dossier, bouwplan)
    );
  }

  private buildChangeSummaryPrompt(
    conceptReportVersions: Record<string, string>,
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: StagePromptConfig,
    previousStageResults?: Record<string, string>
  ): string {
    this.validateStagePrompt("6_change_summary", stageConfig);
    return this.promptBuilder.buildCombined("6_change_summary", stageConfig, () =>
      this.promptBuilder.buildChangeSummaryData(conceptReportVersions)
    );
  }

  private buildEditorPrompt(
    currentReportText: string,
    previousStageResults: Record<string, string>,
    currentDate: string,
    stageConfig?: StagePromptConfig
  ): string {
    this.validateStagePrompt("editor", stageConfig);

    // Get concept versions for editor context
    const conceptVersions = {};  // This will be populated by the caller if needed

    return this.promptBuilder.buildCombined("5_eindredactie", stageConfig, () =>
      this.promptBuilder.buildEditorData(previousStageResults, conceptVersions)
    );
  }
}