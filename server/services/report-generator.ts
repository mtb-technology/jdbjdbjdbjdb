import type { DossierData, BouwplanData, PromptConfig, AiConfig, StageConfig } from "@shared/schema";
import { SourceValidator } from "./source-validator";
import { AIModelFactory, AIModelParameters } from "./ai-models/ai-model-factory";
import { storage } from "../storage";
import { ServerError } from "../middleware/errorHandler";
import { ERROR_CODES } from "@shared/errors";
import { REPORT_CONFIG, getStageConfig } from "../config/index";

export class ReportGenerator {
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
      '4g_ChefEindredactie': 'Eindredactie',
      '5_feedback_verwerker': 'Feedback Verwerking',
      '6_change_summary': 'Change Summary',
      'final_check': 'Finale Check'
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
  ): Promise<string> {
    const currentDate = new Date().toLocaleDateString('nl-NL', {
      year: 'numeric',
      month: 'long', 
      day: 'numeric'
    });

    // Get active prompt configuration from database
    const promptConfig = await storage.getActivePromptConfig();
    const stageConfig: any = promptConfig?.config?.[stageName as keyof typeof promptConfig.config] || {};

    // Build the prompt based on stage
    let prompt: string;

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
      case "5_feedback_verwerker":
        prompt = this.buildFeedbackVerwerkerPrompt(
          previousStageResults,
          conceptReportVersions,
          dossier,
          bouwplan,
          currentDate,
          stageConfig
        );
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
      case "final_check":
        prompt = this.buildFinalCheckPrompt(
          conceptReportVersions?.["latest"] || "",
          dossier,
          bouwplan,
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
            stageConfig
          );
        } else {
          throw new Error(`Unknown stage: ${stageName}`);
        }
    }

    // Add custom input if provided
    if (customInput) {
      prompt = `${prompt}\n\n### Aanvullende Input:\n${customInput}`;
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
    const prompt = await this.generatePromptForStage(
      stageName,
      dossier,
      bouwplan,
      previousStageResults,
      conceptReportVersions,
      customInput
    );

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
        case '4g_ChefEindredactie':
          return REPORT_CONFIG.simpleTaskModel; // Fast for routine reviews
        
        case '5_feedback_verwerker':
          return REPORT_CONFIG.reviewerModel; // Good for consolidation
        
        case '6_change_summary':
          return REPORT_CONFIG.simpleTaskModel; // Fast for analysis
        
        case 'final_check':
          return REPORT_CONFIG.reviewerModel; // Balanced for final review
        
        default:
          return REPORT_CONFIG.defaultModel;
      }
    };
    
    const selectedModel = getOptimalModel(stageName);
    
    // Build merged AI config with proper fallbacks - fully configurable via database
    const aiConfig: AiConfig = {
      provider: stageAiConfig?.provider || globalAiConfig?.provider || (selectedModel.startsWith('gpt') ? 'openai' : 'google'),
      model: selectedModel,
      temperature: stageAiConfig?.temperature ?? globalAiConfig?.temperature ?? 0.1,
      topP: stageAiConfig?.topP ?? globalAiConfig?.topP ?? 0.95,
      topK: stageAiConfig?.topK ?? globalAiConfig?.topK ?? 20,
      maxOutputTokens: Math.max(
        stageAiConfig?.maxOutputTokens || 8192,
        globalAiConfig?.maxOutputTokens || 8192,
        8192
      ),
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
      } else if (aiConfig.model?.includes('gpt-5')) {
        // GPT-5 also benefits from more tokens for complex analysis
        aiConfig.maxOutputTokens = Math.max(aiConfig.maxOutputTokens, 16384);
        console.log(`🎯 [${jobId}] Set maxOutputTokens to ${aiConfig.maxOutputTokens} for GPT-5 reviewer stage ${stageName}`);
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
      const response = await this.modelFactory.callModel(aiConfig, prompt, options);
      
      // Process the response based on stage type
      let stageOutput = response.content;
      let conceptReport = "";

      // For generation stages, the output IS the concept report
      if (["3_generatie", "5_feedback_verwerker", "final_check"].includes(stageName)) {
        conceptReport = stageOutput;
      }
      // For other stages, keep the previous concept report
      else {
        conceptReport = conceptReportVersions?.["latest"] || "";
      }

      return { stageOutput, conceptReport, prompt };

    } catch (error: any) {
      console.error(`🚨 [${jobId}] Model failed (${aiConfig.model}):`, error.message);
      
      // Check if error is due to token limit for Deep Research models
      const isTokenLimitError = error.message.includes('maxOutputTokens') || 
                                error.message.includes('token limit') ||
                                error.message.includes('incomplete');
      
      if (isTokenLimitError && aiConfig.model?.includes('deep-research')) {
        // Provide specific guidance for token limit errors
        const suggestedTokens = Math.min(aiConfig.maxOutputTokens * 2, 65536);
        console.error(`📈 [${jobId}] Deep Research model needs more tokens. Current: ${aiConfig.maxOutputTokens}, Suggested: ${suggestedTokens}`);
        
        const stageDisplayName = this.getStageDisplayName(stageName);
        const placeholderResponse = `## ${stageDisplayName}

⚠️ **Deep Research Model Token Limiet Bereikt**

### Probleem:
Het ${aiConfig.model} model heeft meer tokens nodig om deze analyse volledig uit te voeren.

### Huidige Configuratie:
- Model: ${aiConfig.model}
- Huidige token limiet: ${aiConfig.maxOutputTokens}
- Aanbevolen limiet: ${suggestedTokens}

### Oplossing:
1. Ga naar **Instellingen → AI Configuratie**
2. Selecteer stage "${stageName}"
3. Verhoog "Max Output Tokens" naar minimaal ${suggestedTokens}
4. Of schakel over naar een ander model (bijv. GPT-4o of Gemini 2.5 Pro)
5. Voer deze stap opnieuw uit

### Alternatief:
Gebruik een standaard model zoals **gpt-4o** of **gemini-2.5-pro** die efficiënter omgaan met tokens.

🔄 **Status:** Deze stap moet opnieuw worden uitgevoerd na aanpassing.`;
        
        return {
          stageOutput: placeholderResponse,
          conceptReport: conceptReportVersions?.["latest"] || placeholderResponse,
          prompt
        };
      }
      
      // Default error handling for other errors
      const stageDisplayName = this.getStageDisplayName(stageName);
      
      const placeholderResponse = `## ${stageDisplayName}

De AI-analyse kon niet worden uitgevoerd vanwege technische problemen.

### Technische Details:
- Model: ${aiConfig.model}
- Prompt lengte: ${prompt.length} karakters
- Foutmelding: ${error.message}

### Advies:
1. Probeer de stap opnieuw uit te voeren
2. Controleer of uw API keys correct zijn geconfigureerd
3. Overweeg een ander AI model te gebruiken
4. Neem contact op met support als het probleem aanhoudt

### Status:
⚠️ Deze stap is niet voltooid en moet opnieuw worden uitgevoerd.`;
      
      console.log(`⚠️ [${jobId}] Returning placeholder response for failed stage ${stageName}`);
      
      return {
        stageOutput: placeholderResponse,
        conceptReport: conceptReportVersions?.["latest"] || placeholderResponse,
        prompt
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
    // Combine all stage results into final report
    const finalCheckResult = stageResults.final_check || stageResults["4g_ChefEindredactie"] || "";
    
    if (!finalCheckResult) {
      throw new Error("Geen finale resultaat beschikbaar voor rapport samenstelling");
    }

    // The final check stage should contain the complete, formatted report
    return finalCheckResult;
  }

  // Helper methods for building prompts
  private buildInformatieCheckPrompt(
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: any
  ): string {
    if (!stageConfig?.prompt || stageConfig.prompt.trim() === "") {
      throw new Error("NO_PROMPT_CONFIGURED|Geen prompt ingesteld voor stap 1_informatiecheck — configureer dit in Instellingen.");
    }
    
    const prompt = stageConfig.prompt;

    return `${prompt}

### Datum: ${currentDate}

### Dossier:
${JSON.stringify(dossier, null, 2)}

### Bouwplan:
${JSON.stringify(bouwplan, null, 2)}`;
  }

  private buildComplexiteitsCheckPrompt(
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: any,
    previousStageResults?: Record<string, string>
  ): string {
    if (!stageConfig?.prompt || stageConfig.prompt.trim() === "") {
      throw new Error("NO_PROMPT_CONFIGURED|Geen prompt ingesteld voor stap 2_complexiteitscheck — configureer dit in Instellingen.");
    }
    
    const prompt = stageConfig.prompt;

    let fullPrompt = `${prompt}\n\n### Datum: ${currentDate}`;
    
    // Add previous stage results if available
    if (previousStageResults && Object.keys(previousStageResults).length > 0) {
      fullPrompt += `\n\n### Resultaten uit vorige stappen:`;
      Object.entries(previousStageResults).forEach(([stage, result]) => {
        fullPrompt += `\n\n#### ${stage}:\n${result}`;
      });
    }
    
    fullPrompt += `\n\n### Dossier:\n${JSON.stringify(dossier, null, 2)}\n\n### Bouwplan:\n${JSON.stringify(bouwplan, null, 2)}`;
    
    return fullPrompt;
  }

  private buildGeneratiePrompt(
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: any,
    previousStageResults?: Record<string, string>
  ): string {
    if (!stageConfig?.prompt || stageConfig.prompt.trim() === "") {
      throw new Error("NO_PROMPT_CONFIGURED|Geen prompt ingesteld voor stap 3_generatie — configureer dit in Instellingen.");
    }
    
    const prompt = stageConfig.prompt;

    let fullPrompt = `${prompt}\n\n### Datum: ${currentDate}`;
    
    // Add previous stage results if available  
    if (previousStageResults && Object.keys(previousStageResults).length > 0) {
      fullPrompt += `\n\n### Resultaten uit vorige stappen:`;
      Object.entries(previousStageResults).forEach(([stage, result]) => {
        fullPrompt += `\n\n#### ${stage}:\n${result}`;
      });
    }
    
    fullPrompt += `\n\n### Dossier:\n${JSON.stringify(dossier, null, 2)}\n\n### Bouwplan:\n${JSON.stringify(bouwplan, null, 2)}`;
    
    return fullPrompt;
  }

  private buildReviewerPrompt(
    stageName: string,
    conceptReport: string,
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: any
  ): string {
    if (!stageConfig?.prompt || stageConfig.prompt.trim() === "") {
      throw new Error(`NO_PROMPT_CONFIGURED|Geen prompt ingesteld voor stap ${stageName} — configureer dit in Instellingen.`);
    }
    
    const prompt = stageConfig.prompt;

    return `${prompt}

### Datum: ${currentDate}

### Concept Rapport:
${conceptReport}

### Origineel Dossier:
${JSON.stringify(dossier, null, 2)}

### Bouwplan:
${JSON.stringify(bouwplan, null, 2)}`;
  }

  private buildFeedbackVerwerkerPrompt(
    previousStageResults: Record<string, string>,
    conceptReportVersions: Record<string, string>,
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: any
  ): string {
    if (!stageConfig?.prompt || stageConfig.prompt.trim() === "") {
      throw new Error("NO_PROMPT_CONFIGURED|Geen prompt ingesteld voor stap 5_feedback_verwerker — configureer dit in Instellingen.");
    }
    
    const prompt = stageConfig.prompt;

    // Collect and summarize reviewer feedback - limit to key findings
    const reviewerFeedback = Object.entries(previousStageResults)
      .filter(([key]) => key.startsWith("4"))
      .map(([key, value]) => {
        // Parse JSON feedback and extract key points
        try {
          const feedback = JSON.parse(value);
          if (Array.isArray(feedback)) {
            const keyFindings = feedback
              .slice(0, 3) // Limit to first 3 findings
              .map(f => `- ${f.bevinding_categorie}: ${f.instructie}`)
              .join('\n');
            return `### ${key}:\n${keyFindings}`;
          }
        } catch (e) {
          // If not JSON, truncate to first 200 chars
          const truncated = value.length > 200 ? value.substring(0, 200) + '...' : value;
          return `### ${key}:\n${truncated}`;
        }
        return `### ${key}:\n${value}`;
      })
      .join("\n\n");

    // Truncate original report to first 1000 characters
    const originalReport = conceptReportVersions?.["3_generatie"] || "Geen vorig rapport beschikbaar";
    const truncatedReport = originalReport.length > 1000 
      ? originalReport.substring(0, 1000) + '\n\n[...rapport ingekort voor processing...]' 
      : originalReport;

    // Minimal dossier info - just key fields
    const minimalDossier = {
      onderwerp: dossier.samenvatting_onderwerp || 'Onbekend',
      klantvragen: dossier.klantvraag_verbatim || []
    };

    return `${prompt}

### Datum: ${currentDate}

### Concept Rapport (ingekorte versie):
${truncatedReport}

### Reviewer Feedback:
${reviewerFeedback}

### Dossier Context:
${JSON.stringify(minimalDossier, null, 2)}`;
  }

  private buildChangeSummaryPrompt(
    conceptReportVersions: Record<string, string>,
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: any,
    previousStageResults?: Record<string, string>
  ): string {
    if (!stageConfig?.prompt || stageConfig.prompt.trim() === "") {
      throw new Error("NO_PROMPT_CONFIGURED|Geen prompt ingesteld voor stap 6_change_summary — configureer dit in Instellingen.");
    }
    
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

  private buildFinalCheckPrompt(
    latestReport: string,
    dossier: DossierData,
    bouwplan: BouwplanData,
    currentDate: string,
    stageConfig?: any
  ): string {
    if (!stageConfig?.prompt || stageConfig.prompt.trim() === "") {
      throw new Error("NO_PROMPT_CONFIGURED|Geen prompt ingesteld voor stap final_check — configureer dit in Instellingen.");
    }
    
    const prompt = stageConfig.prompt;

    return `${prompt}

### Datum: ${currentDate}

### Finaal Rapport:
${latestReport}

### Dossier:
${JSON.stringify(dossier, null, 2)}`;
  }
}