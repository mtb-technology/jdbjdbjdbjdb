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

  constructor() {
    this.sourceValidator = new SourceValidator();
    this.modelFactory = AIModelFactory.getInstance();
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

    // Determine which AI configuration to use (stage-specific or global)
    const stageAiConfig = stageConfig?.aiConfig;
    const globalAiConfig = globalConfig?.aiConfig;

    // Intelligent model selection for hybrid workflow
    const getOptimalModel = (stageName: string): string => {
      // If explicitly configured in database, use that
      if (stageAiConfig?.model || globalAiConfig?.model) {
        return stageAiConfig?.model || globalAiConfig?.model;
      }
      
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
        case '4d_DeVertaler':
        case '4e_DeAdvocaat':
        case '4f_DeKlantpsycholoog':
          return REPORT_CONFIG.simpleTaskModel; // Fast for routine reviews

        case '6_change_summary':
          return REPORT_CONFIG.simpleTaskModel; // Fast for analysis

        default:
          return REPORT_CONFIG.defaultModel;
      }
    };
    
    const selectedModel = getOptimalModel(stageName);
    
    // Build merged AI config with proper fallbacks - fully configurable via database
    const provider = stageAiConfig?.provider || globalAiConfig?.provider || (selectedModel.startsWith('gpt') ? 'openai' : 'google');
    const rawMaxTokens = Math.max(
      stageAiConfig?.maxOutputTokens || 8192,
      globalAiConfig?.maxOutputTokens || 8192,
      8192
    );

    // Apply provider-specific limits
    const maxOutputTokens = provider === 'google'
      ? Math.min(rawMaxTokens, 32768)  // Google AI max is 32768
      : rawMaxTokens;  // OpenAI has higher limits

    const aiConfig: AiConfig = {
      provider,
      model: selectedModel,
      temperature: stageAiConfig?.temperature ?? globalAiConfig?.temperature ?? 0.1,
      topP: stageAiConfig?.topP ?? globalAiConfig?.topP ?? 0.95,
      topK: stageAiConfig?.topK ?? globalAiConfig?.topK ?? 20,
      maxOutputTokens,
      reasoning: stageAiConfig?.reasoning || globalAiConfig?.reasoning,
      verbosity: stageAiConfig?.verbosity || globalAiConfig?.verbosity
    };
    
    // Log actual config for debugging
    console.log(`📊 [${jobId}] Hybrid model selection:`, {
      stage: stageName,
      selectedModel: selectedModel,
      provider: aiConfig.provider,
      maxOutputTokens: aiConfig.maxOutputTokens,
      isHybridSelection: !stageAiConfig?.model && !globalAiConfig?.model
    });

    // Dynamic token adjustment based on model type and stage requirements
    if (stageName.startsWith("4")) {
      // Deep Research models need much more tokens (reasoning + conclusion)
      if (aiConfig.model?.includes('deep-research')) {
        // Stage 4a (BronnenSpecialist) needs the most tokens for source validation
        if (stageName === "4a_BronnenSpecialist") {
          aiConfig.maxOutputTokens = Math.max(aiConfig.maxOutputTokens, 32768);
          console.log(`📦 [${jobId}] Set maxOutputTokens to ${aiConfig.maxOutputTokens} for Deep Research BronnenSpecialist`);
        } else {
          // Other reviewer stages still need more tokens than default
          aiConfig.maxOutputTokens = Math.max(aiConfig.maxOutputTokens, 24576);
          console.log(`📈 [${jobId}] Increased maxOutputTokens to ${aiConfig.maxOutputTokens} for Deep Research reviewer stage ${stageName}`);
        }
      } else if (aiConfig.model?.includes('gpt-4o')) {
        // GPT-4o also benefits from more tokens for complex analysis
        aiConfig.maxOutputTokens = Math.max(aiConfig.maxOutputTokens, 16384);
        console.log(`🎯 [${jobId}] Set maxOutputTokens to ${aiConfig.maxOutputTokens} for GPT-4o reviewer stage ${stageName}`);
      } else if (aiConfig.maxOutputTokens < 4096) {
        aiConfig.maxOutputTokens = Math.max(aiConfig.maxOutputTokens, 4096);
        console.log(`📈 [${jobId}] Increased maxOutputTokens to ${aiConfig.maxOutputTokens} for reviewer stage ${stageName}`);
      }
    }

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

  // Legacy method for backwards compatibility
  async generateReport(dossier: DossierData, bouwplan: BouwplanData): Promise<string> {
    return this.generateBasicReport({ 
      datum: new Date().toLocaleDateString('nl-NL'),
      dossier: JSON.stringify(dossier, null, 2)
    });
  }

  async generateBasicReport(data: any): Promise<string> {
    const prompt = `Genereer een fiscaal rapport op basis van de volgende gegevens:
    
Datum: ${data.datum}
Dossier: ${data.dossier}

Maak een professioneel rapport met:
- Inleiding
- Analyse
- Conclusies
- Aanbevelingen`;

    const config: AiConfig = {
      provider: "google",
      model: "gemini-2.5-pro",
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 4096
    };

    const response = await this.modelFactory.callModel(config, prompt, {
      jobId: "basic-report"
    });

    return response.content;
  }

  async finalizeReport(stageResults: Record<string, string>): Promise<string> {
    // Use the latest generation result (3_generatie) as the final report
    const generationResult = stageResults["3_generatie"] || "";

    if (!generationResult) {
      throw new Error("Geen generatie resultaat beschikbaar voor rapport samenstelling");
    }

    return generationResult;
  }

  // Helper methods for building prompts
  private buildInformatieCheckPrompt(
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: StagePromptConfig
  ): { systemPrompt: string; userInput: string } {
    this.validateStagePrompt("1_informatiecheck", stageConfig);

    // System Prompt: De instructie voor de AI
    const systemPrompt = `${stageConfig.prompt}

### Datum: ${currentDate}`;

    // User Input: De rawText (dit is de ENIGE keer dat we rawText gebruiken!)
    const rawText = (dossier as any).rawText || JSON.stringify(dossier, null, 2);
    const userInput = rawText;

    return { systemPrompt, userInput };
  }

  private buildComplexiteitsCheckPrompt(
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: StagePromptConfig,
    previousStageResults?: Record<string, string>
  ): { systemPrompt: string; userInput: string } {
    this.validateStagePrompt("2_complexiteitscheck", stageConfig);

    // System Prompt: De instructie voor de AI
    const systemPrompt = `${stageConfig.prompt}

### Datum: ${currentDate}`;

    // User Input: ALLEEN de volledige JSON output van stap 1
    const userInput = previousStageResults?.['1_informatiecheck'] || '{}';

    console.log(`🔍 [2_complexiteitscheck] Building prompt:`, {
      hasStageConfig: !!stageConfig,
      hasPreviousResults: !!previousStageResults,
      step1ResultLength: userInput.length,
      step1ResultPreview: userInput.substring(0, 200)
    });

    return { systemPrompt, userInput };
  }

  private buildGeneratiePrompt(
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: StagePromptConfig,
    previousStageResults?: Record<string, string>
  ): { systemPrompt: string; userInput: string } {
    this.validateStagePrompt("3_generatie", stageConfig);

    // System Prompt: De instructie voor de AI
    const systemPrompt = `${stageConfig.prompt}

### Datum: ${currentDate}`;

    // User Input: ALLEEN de volledige JSON output van stap 2
    const userInput = previousStageResults?.['2_complexiteitscheck'] || '{}';

    return { systemPrompt, userInput };
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

    // System Prompt: De instructie voor de reviewer
    const systemPrompt = `${stageConfig.prompt}

### Datum: ${currentDate}`;

    // User Input: Het volledige JSON_Stap_3 object (niet alleen de tekst!)
    // We moeten hier het volledige JSON object uit stap 3 pakken
    const step3Output = previousStageResults?.['3_generatie'] || '{}';

    // Als het al een JSON object is, gebruik het direct
    // Anders proberen we het te construeren
    let jsonStep3;
    try {
      jsonStep3 = JSON.parse(step3Output);
    } catch {
      // Als het geen JSON is, maak dan een JSON object met de tekst
      jsonStep3 = {
        taal: "nl",
        concept_rapport_tekst: step3Output,
        origineel_dossier: dossier
      };
    }

    const userInput = JSON.stringify(jsonStep3, null, 2);

    return { systemPrompt, userInput };
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
    
    const prompt = stageConfig.prompt;

    let fullPrompt = `${prompt}\n\n### Datum: ${currentDate}`;
    
    // Add all concept report versions for comparison
    fullPrompt += `\n\n### Concept Report Versies:`;
    Object.entries(conceptReportVersions).forEach(([stage, content]) => {
      if (content && content.trim()) {
        fullPrompt += `\n\n#### ${stage}:\n${content}`;
      }
    });
    
    // Add reviewer stage results for context
    if (previousStageResults && Object.keys(previousStageResults).length > 0) {
      fullPrompt += `\n\n### Reviewer Feedback:`;
      Object.entries(previousStageResults)
        .filter(([key]) => key.startsWith("4"))
        .forEach(([stage, result]) => {
          fullPrompt += `\n\n#### ${stage}:\n${result}`;
        });
    }
    
    fullPrompt += `\n\n### Dossier Context:\n${JSON.stringify(dossier, null, 2)}`;
    
    return fullPrompt;
  }

  private buildEditorPrompt(
    currentReportText: string,
    previousStageResults: Record<string, string>,
    currentDate: string,
    stageConfig?: StagePromptConfig
  ): string {
    this.validateStagePrompt("editor", stageConfig);

    const prompt = stageConfig.prompt;

    // Find the most recent reviewer feedback (last 4x stage)
    const reviewerStages = Object.keys(previousStageResults)
      .filter(key => key.startsWith("4"))
      .sort();

    const lastReviewerStage = reviewerStages[reviewerStages.length - 1];
    const wijzigingenJSON = lastReviewerStage ? previousStageResults[lastReviewerStage] : "[]";

    return `${prompt}

### Datum: ${currentDate}

### Huidige Rapport Tekst:
${currentReportText}

### Wijzigingen JSON (van ${lastReviewerStage || "laatste reviewer"}):
${wijzigingenJSON}

### Instructie:
Pas de wijzigingen uit het WijzigingenJSON toe op de Huidige Rapport Tekst.
Voor elke wijziging:
- Bij "change_type": "REPLACE": Zoek "locatie_origineel" en vervang met "suggestie_tekst"
- Bij "change_type": "ADD": Voeg "suggestie_tekst" toe bij "locatie_toevoegen"

Als een "locatie_origineel" niet gevonden kan worden, geef dan een DUIDELIJKE ERROR met de bevinding_id.

Geef ALLEEN de volledige, bijgewerkte rapporttekst terug. GEEN uitleg, GEEN JSON, ALLEEN de tekst.`;
  }
}