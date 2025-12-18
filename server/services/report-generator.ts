import type { DossierData, BouwplanData, PromptConfig, AiConfig, StageConfig } from "@shared/schema";
import type { ConceptReportVersions, ConceptReportSnapshot, StageResults, PromptConfigData, StagePromptConfig as StagePromptConfigType } from "@shared/types/report-data";
import { extractSnapshotContent } from "@shared/types/report-data";
import { SourceValidator } from "./source-validator";
import { AIModelFactory, AIModelParameters } from "./ai-models/ai-model-factory";
import { AIConfigResolver } from "./ai-config-resolver";
import { PromptBuilder, StagePromptConfig } from "./prompt-builder";
import { storage } from "../storage";
import { ServerError } from "../middleware/errorHandler";
import { ERROR_CODES, getErrorCategory, isAIError } from "@shared/errors";
import { getStageName } from "@shared/constants";
import { REPORT_CONFIG, getStageConfig } from "../config/index";
import { logger } from "./logger";

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
    return getStageName(stageName);
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
  async testAI(prompt: string, customConfig?: Partial<AiConfig>): Promise<string> {
    // Haal config uit database via AIConfigResolver - GEEN hardcoded defaults
    const promptConfigRecord = await storage.getActivePromptConfig();
    if (!promptConfigRecord?.config) {
      throw ServerError.validation(
        'No active prompt config',
        'Geen actieve prompt configuratie gevonden. Configureer dit in Settings.'
      );
    }

    const promptConfig = promptConfigRecord.config as PromptConfig;
    const baseConfig = this.configResolver.resolveForOperation('test_ai', promptConfig, 'test-ai');

    // Merge custom config als override (bijv. voor specifieke maxOutputTokens)
    const finalConfig: AiConfig = {
      ...baseConfig,
      ...customConfig
    };

    logger.info('test-ai', 'Using AI config from database', {
      provider: finalConfig.provider,
      model: finalConfig.model,
      maxOutputTokens: finalConfig.maxOutputTokens,
      temperature: finalConfig.temperature
    });

    try {
      const response = await this.modelFactory.callModel(finalConfig, prompt, {
        jobId: "test-ai"
      });

      return response.content;
    } catch (error: any) {
      logger.error('test-ai', 'Test AI error', {}, error instanceof Error ? error : undefined);
      throw ServerError.ai(
        'AI service test mislukt. Controleer de AI configuratie in Settings.',
        { prompt: prompt.substring(0, 100), error: error.message }
      );
    }
  }

  // Generate content with custom prompt (for Follow-up Assistant, Dossier Context, etc.)
  async generateWithCustomPrompt(params: {
    systemPrompt: string;
    userPrompt: string;
    model: string;
    customConfig?: Partial<AiConfig>;
    operationId?: string; // Optional: for logging clarity (e.g., "dossier-context", "follow-up-assistant")
  }): Promise<string> {
    const { systemPrompt, userPrompt, model, customConfig, operationId = "custom-prompt" } = params;

    // Haal config uit database via AIConfigResolver - GEEN hardcoded defaults
    const promptConfigRecord = await storage.getActivePromptConfig();
    if (!promptConfigRecord?.config) {
      throw ServerError.validation(
        'No active prompt config',
        'Geen actieve prompt configuratie gevonden. Configureer dit in Settings.'
      );
    }

    const promptConfig = promptConfigRecord.config as PromptConfig;
    const baseConfig = this.configResolver.resolveForOperation('follow_up_assistant', promptConfig, operationId);

    // Bepaal provider van meegegeven model (override)
    const provider = model.startsWith("gpt") || model.startsWith("o3") ? "openai" : "google";

    // Merge: base config + model override + custom config
    const aiConfig: AiConfig = {
      ...baseConfig,
      provider,
      model,
      ...customConfig
    };

    logger.info(operationId, 'Using AI config from database', {
      provider: aiConfig.provider,
      model: aiConfig.model,
      maxOutputTokens: aiConfig.maxOutputTokens,
      temperature: aiConfig.temperature
    });

    try {
      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

      const response = await this.modelFactory.callModel(aiConfig, fullPrompt, {
        jobId: operationId
      });

      logger.info(operationId, 'Model call succeeded', { responseLength: response.content.length });

      return response.content;
    } catch (error: any) {
      logger.error(operationId, 'Model call failed', {
        errorType: error.constructor.name,
        message: error.message,
        code: error.code
      }, error instanceof Error ? error : undefined);
      throw ServerError.ai(
        'AI kon geen antwoord genereren. Controleer de configuratie in Settings.',
        {
          model,
          error: error.message,
          provider: aiConfig.provider
        }
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
      // ✅ FIX: Use configurable AI config instead of hardcoded values
      const promptConfig = await storage.getActivePromptConfig();
      const globalConfig: any = promptConfig?.config || {};

      // Use dossier_extraction stage config or fall back to global
      const extractionConfig = globalConfig['dossier_extraction'] || {};
      const aiConfig = this.configResolver.resolveForStage(
        'dossier_extraction',
        extractionConfig,
        globalConfig,
        'extract-dossier'
      );

      logger.info('extract-dossier', 'Using AI config', {
        provider: aiConfig.provider,
        model: aiConfig.model,
        maxOutputTokens: aiConfig.maxOutputTokens
      });

      const response = await this.modelFactory.callModel(aiConfig, extractionPrompt, {
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
        logger.error('extract-dossier', 'JSON parse error', { rawContent: extractedJson.substring(0, 500) }, parseError instanceof Error ? parseError : undefined);
        throw ServerError.business(
          ERROR_CODES.AI_INVALID_RESPONSE,
          'AI heeft geen geldig JSON formaat teruggegeven'
        );
      }
    } catch (error: any) {
      if (error instanceof ServerError) {
        throw error;
      }

      logger.error('extract-dossier', 'Extract dossier error', {}, error instanceof Error ? error : undefined);
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
    previousStageResults: StageResults,
    conceptReportVersions: ConceptReportVersions,
    customInput?: string
  ): Promise<string | { systemPrompt: string; userInput: string }> {
    const currentDate = new Date().toLocaleDateString('nl-NL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Get active prompt configuration from database
    const promptConfig = await storage.getActivePromptConfig();
    const configData = promptConfig?.config as PromptConfigData | undefined;
    const stageConfig = configData?.[stageName as keyof PromptConfigData] as StagePromptConfig | undefined;

    // Helper function to resolve 'latest' pointer to actual content
    const resolveLatestContent = (): string => {
      const latest = conceptReportVersions?.latest;

      if (latest && typeof latest === 'object' && 'pointer' in latest && latest.pointer) {
        // Resolve the pointer to get the actual snapshot
        const snapshot = conceptReportVersions[latest.pointer];
        const content = extractSnapshotContent(snapshot);
        if (content) {
          logger.debug(stageName, `Using concept from ${latest.pointer} v${latest.v}`, { chars: content.length });
          return content;
        }
      }

      // Fallback: Try stage 3 if no latest or resolution failed
      const stage3Snapshot = conceptReportVersions?.["3_generatie"];
      const stage3Content = extractSnapshotContent(stage3Snapshot);
      if (stage3Content) {
        logger.debug(stageName, 'Fallback to stage 3_generatie', { chars: stage3Content.length });
        return stage3Content;
      }

      logger.warn(stageName, 'No concept content found - using empty string');
      return "";
    };

    // Build the prompt based on stage
    let prompt: string | { systemPrompt: string; userInput: string };

    switch (stageName) {
      case "1a_informatiecheck":
        prompt = this.buildInformatieCheckPrompt(dossier, bouwplan, currentDate, stageConfig, previousStageResults);
        break;
      case "1b_informatiecheck_email":
        prompt = this.buildInformatieEmailPrompt(dossier, bouwplan, currentDate, stageConfig, previousStageResults);
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
          resolveLatestContent(),
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
            resolveLatestContent(),
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

  /**
   * Generate prompt for a stage without executing AI
   */
  async generatePromptOnly(
    stageName: string,
    dossier: DossierData,
    bouwplan: BouwplanData,
    previousStageResults: StageResults,
    conceptReportVersions: ConceptReportVersions
  ): Promise<string> {
    const promptResult = await this.generatePromptForStage(
      stageName,
      dossier,
      bouwplan,
      previousStageResults,
      conceptReportVersions
    );

    // Convert prompt to string
    const promptString = typeof promptResult === 'string'
      ? promptResult
      : `${promptResult.systemPrompt}\n\n### USER INPUT:\n${promptResult.userInput}`;

    return promptString;
  }

  async executeStage(
    stageName: string,
    dossier: DossierData,
    bouwplan: BouwplanData,
    previousStageResults: StageResults,
    conceptReportVersions: ConceptReportVersions,
    customInput?: string,
    jobId?: string,
    onProgress?: (progress: { stage: string; message: string; progress: number }) => void,
    visionAttachments?: Array<{ mimeType: string; data: string; filename: string }>,
    reportDepth?: "concise" | "balanced" | "comprehensive",
    signal?: AbortSignal,
    reportLanguage?: "nl" | "en"
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
    let promptString = typeof promptResult === 'string'
      ? promptResult
      : `${promptResult.systemPrompt}\n\n### USER INPUT:\n${promptResult.userInput}`;

    // Add language instruction for ALL stages when language is English
    // This ensures review stages (4a-4f) output in the same language as the generated report
    if (reportLanguage === "en") {
      const languageInstruction = stageName === "3_generatie"
        ? "\n\n[LANGUAGE INSTRUCTION]\nIMPORTANT: Write the entire report in English. All headings, paragraphs, and content should be in professional English. Do NOT use Dutch anywhere in the output."
        : "\n\n[LANGUAGE INSTRUCTION]\nIMPORTANT: The report you are reviewing is written in ENGLISH. You MUST write ALL your feedback, suggestions, and analysis in English. Do NOT use Dutch in your response.";

      if (typeof promptResult === 'string') {
        promptString = promptResult + languageInstruction;
      } else {
        // Append to system prompt for structured prompts
        promptResult.systemPrompt = promptResult.systemPrompt + languageInstruction;
        promptString = `${promptResult.systemPrompt}\n\n### USER INPUT:\n${promptResult.userInput}`;
      }

      logger.info(jobId || stageName, `${stageName}: Using ENGLISH language instruction`);
    }

    // Get active prompt configuration from database for AI config
    const promptConfigRecord = await storage.getActivePromptConfig();
    const globalConfig = (promptConfigRecord?.config as PromptConfigData) ?? {};
    const stageConfigForAI = globalConfig[stageName as keyof PromptConfigData] as StagePromptConfigType | undefined;

    // ✅ REFACTORED: Use centralized AIConfigResolver instead of duplicated logic
    const aiConfig = this.configResolver.resolveForStage(
      stageName,
      stageConfigForAI ?? {},
      globalConfig,
      jobId
    );

    // Get stage-specific settings
    const useGrounding = stageConfigForAI?.useGrounding ?? false;
    const useWebSearch = stageConfigForAI?.useWebSearch ?? false;

    logger.info(jobId || stageName, `Starting stage ${stageName}`, {
      provider: aiConfig.provider,
      model: aiConfig.model,
      grounding: useGrounding,
      webSearch: useWebSearch
    });

    // Get stage-specific timeout and maxTokens from REPORT_CONFIG
    const stageConfigFromReport = getStageConfig(stageName as keyof typeof REPORT_CONFIG.stages);
    const stageTimeout = stageConfigFromReport?.timeout;
    const stageMaxTokens = stageConfigFromReport?.maxTokens;

    // Apply stage maxTokens as MINIMUM FLOOR (ensures sufficient output capacity)
    // This protects against database configs with too-low maxOutputTokens values
    if (stageMaxTokens && stageMaxTokens > aiConfig.maxOutputTokens) {
      aiConfig.maxOutputTokens = stageMaxTokens;
      logger.info(jobId || stageName, `Applied stage maxTokens floor: ${stageMaxTokens} for ${stageName}`);
    }
    
    // Call the AI model using the factory with stage-specific timeout
    const options: AIModelParameters & { jobId?: string; signal?: AbortSignal; reportLanguage?: "nl" | "en" } = {
      jobId,
      useWebSearch,
      useGrounding,
      timeout: stageTimeout, // Pass stage-specific timeout
      onProgress, // Pass through for deep research progress updates
      visionAttachments, // Pass through for multimodal PDF/image processing
      reportDepth, // Pass through for Stage 3 deep research depth control
      signal, // Pass through for graceful cancellation
      reportLanguage // Pass through for language selection
    };

    if (visionAttachments && visionAttachments.length > 0) {
      logger.info(jobId || stageName, `Sending ${visionAttachments.length} vision attachment(s) to AI for OCR/analysis`);
    }

    try {
      const response = await this.modelFactory.callModel(aiConfig, promptResult, options);

      // Process the response based on stage type
      let stageOutput = response.content;
      let conceptReport = "";

      // For generation stages, the output IS the concept report
      if (["3_generatie"].includes(stageName)) {
        conceptReport = stageOutput;
      }
      // For reviewer stages (4a-4f), do NOT return a concept report
      // They only produce feedback, not new versions of the report
      else if (stageName.startsWith("4")) {
        conceptReport = ""; // Explicitly empty - reviewers don't create new versions
      }
      // For other stages, keep the previous concept report
      else {
        const latest = conceptReportVersions?.latest;
        if (latest && typeof latest === 'object' && 'pointer' in latest && latest.pointer) {
          // Resolve pointer to get actual content
          conceptReport = extractSnapshotContent(conceptReportVersions[latest.pointer]) ?? "";
        } else {
          conceptReport = "";
        }
      }

      return { stageOutput, conceptReport, prompt: promptString };

    } catch (error: any) {
      logger.error(jobId || stageName, `Model failed (${aiConfig.model})`, { message: error.message }, error instanceof Error ? error : undefined);

      // Use typed error category detection instead of fragile string matching
      const errorCategory = getErrorCategory(error);
      const isRateLimitError = errorCategory === 'rate_limit';

      if (isRateLimitError) {
        // Rate limits ALWAYS fail - no placeholders, no fallbacks
        logger.error(jobId || stageName, `RATE LIMIT - Failing stage ${stageName} immediately`);
        throw error; // Re-throw to make the stage actually fail
      }

      // NO FALLBACKS - use only configured model for quality consistency
      const stageDisplayName = this.getStageDisplayName(stageName);

      // Use typed error categories for specific error handling
      const isAuthError = errorCategory === 'authentication';
      const isTokenLimitError = errorCategory === 'token_limit';

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
        const suggestedTokens = Math.min(aiConfig.maxOutputTokens * 2, 65535);
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

      logger.warn(jobId || stageName, `Returning error response for failed stage ${stageName} (no fallbacks)`);

      // For reviewer stages, don't return a concept report even on error
      let errorConceptReport = "";
      if (!stageName.startsWith("4")) {
        const latest = conceptReportVersions?.latest;
        if (latest && typeof latest === 'object' && 'pointer' in latest && latest.pointer) {
          errorConceptReport = extractSnapshotContent(conceptReportVersions[latest.pointer]) ?? placeholderResponse;
        } else {
          errorConceptReport = placeholderResponse;
        }
      }

      return {
        stageOutput: placeholderResponse,
        conceptReport: errorConceptReport,
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
    stageConfig?: StagePromptConfig,
    previousStageResults?: Record<string, string>
  ): { systemPrompt: string; userInput: string } {
    this.validateStagePrompt("1a_informatiecheck", stageConfig);
    // After validation, stageConfig is guaranteed to exist
    return this.promptBuilder.build("1a_informatiecheck", stageConfig!, () =>
      this.promptBuilder.buildInformatieCheckData(dossier, previousStageResults)
    );
  }

  private buildInformatieEmailPrompt(
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: StagePromptConfig,
    previousStageResults?: Record<string, string>
  ): { systemPrompt: string; userInput: string } {
    this.validateStagePrompt("1b_informatiecheck_email", stageConfig);
    // Pass 1a result to email generator
    return this.promptBuilder.build("1b_informatiecheck_email", stageConfig!, () =>
      this.promptBuilder.buildInformatieEmailData(previousStageResults || {})
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
    return this.promptBuilder.build("2_complexiteitscheck", stageConfig!, () =>
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
    return this.promptBuilder.build("3_generatie", stageConfig!, () =>
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
    return this.promptBuilder.build(stageName, stageConfig!, () =>
      this.promptBuilder.buildReviewerData(conceptReport, dossier, bouwplan)
    );
  }

  private buildChangeSummaryPrompt(
    conceptReportVersions: ConceptReportVersions,
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: StagePromptConfig,
    previousStageResults?: StageResults
  ): string {
    this.validateStagePrompt("6_change_summary", stageConfig);
    return this.promptBuilder.buildCombined("6_change_summary", stageConfig!, () =>
      this.promptBuilder.buildChangeSummaryData(conceptReportVersions)
    );
  }

  private buildEditorPrompt(
    currentReportText: string,
    previousStageResults: StageResults,
    currentDate: string,
    stageConfig?: StagePromptConfig
  ): string {
    this.validateStagePrompt("editor", stageConfig);

    // Build concept versions object with the current report text
    const conceptVersions: ConceptReportVersions = {
      '3_generatie': {
        v: 1,
        content: currentReportText,
      },
      latest: {
        pointer: '3_generatie',
        v: 1,
        content: currentReportText,
      }
    };

    return this.promptBuilder.buildCombined("5_eindredactie", stageConfig!, () =>
      this.promptBuilder.buildEditorData(previousStageResults, conceptVersions)
    );
  }

  /**
   * Generate Fiscale Briefing (Stage 7)
   *
   * Creates an executive summary for the fiscalist after Express Mode completes.
   * Combines dossier data, generated report, and all reviewer feedback into
   * a concise briefing that helps the fiscalist quickly onboard to the case.
   */
  async generateFiscaleBriefing(params: {
    dossier: DossierData;
    bouwplan: BouwplanData | null;
    conceptReport: string | null;
    stageResults: StageResults;
    jobId?: string;
  }): Promise<{ briefing: string; prompt: string }> {
    const { dossier, bouwplan, conceptReport, stageResults, jobId } = params;
    const stageName = "7_fiscale_briefing";

    // Get active prompt configuration
    const promptConfig = await storage.getActivePromptConfig();
    const stageConfig: any = promptConfig?.config?.[stageName as keyof typeof promptConfig.config] || {};
    const globalConfig: any = promptConfig?.config || {};

    // Validate that we have a prompt configured
    this.validateStagePrompt(stageName, stageConfig);

    // Build the prompt using PromptBuilder
    const promptResult = this.promptBuilder.build(stageName, stageConfig, () =>
      this.promptBuilder.buildFiscaleBriefingData(dossier, bouwplan, conceptReport, stageResults)
    );

    const promptString = `${promptResult.systemPrompt}\n\n### USER INPUT:\n${promptResult.userInput}`;

    // Resolve AI config for this stage
    const aiConfig = this.configResolver.resolveForStage(
      stageName,
      stageConfig,
      globalConfig,
      jobId
    );

    // Force JSON response format for structured output
    const options: AIModelParameters & { jobId?: string } = {
      jobId,
      responseFormat: 'json' // Force JSON output
    };

    logger.info(jobId || 'fiscale-briefing', 'Generating Fiscale Briefing', {
      provider: aiConfig.provider,
      model: aiConfig.model
    });

    // DEBUG: Log the full prompt for troubleshooting
    const parsedInput = JSON.parse(promptResult.userInput);
    logger.debug(jobId || 'fiscale-briefing', 'Fiscale Briefing debug', {
      hasOrigineleIntakeTekst: !!parsedInput.dossier_context?.originele_intake_tekst,
      origineleIntakeTekstLength: parsedInput.dossier_context?.originele_intake_tekst?.length || 0,
      workflowFase: parsedInput.workflow_uitleg?.fase,
      hasBouwplan: parsedInput.workflow_uitleg?.beschikbare_data?.bouwplan
    });

    try {
      const response = await this.modelFactory.callModel(aiConfig, promptResult, options);

      return {
        briefing: response.content,
        prompt: promptString
      };
    } catch (error: any) {
      logger.error(jobId || 'fiscale-briefing', 'Fiscale Briefing generation failed', { message: error.message }, error instanceof Error ? error : undefined);

      // Return error as structured JSON so frontend can handle it gracefully
      const errorBriefing = JSON.stringify({
        error: true,
        message: `Fiscale Briefing kon niet worden gegenereerd: ${error.message}`,
        client_context: {
          type: "onbekend",
          jaren: [],
          korte_omschrijving: "Briefing generatie mislukt"
        },
        fiscaal_vraagstuk: "Er is een fout opgetreden bij het genereren van de briefing.",
        gekozen_strategie: {
          hoofdlijn: "Niet beschikbaar",
          onderbouwing: []
        },
        aandachtspunten_review: [{
          punt: "Bekijk het rapport handmatig",
          urgentie: "hoog"
        }],
        confidence_level: "laag",
        confidence_toelichting: "Automatische briefing mislukt"
      });

      return {
        briefing: errorBriefing,
        prompt: promptString
      };
    }
  }
}