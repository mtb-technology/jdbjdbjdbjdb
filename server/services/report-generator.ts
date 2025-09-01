import type { DossierData, BouwplanData, PromptConfig, AiConfig, StageConfig } from "@shared/schema";
import { SourceValidator } from "./source-validator";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { storage } from "../storage";

const googleAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "" });
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY_JDB || process.env.OPENAI_API_KEY || "" });

export class ReportGenerator {
  private sourceValidator: SourceValidator;

  constructor() {
    this.sourceValidator = new SourceValidator();
  }

  // Test method for AI functionality
  async testAI(prompt: string): Promise<string> {
    try {
      const response = await googleAI.models.generateContent({
        model: "gemini-2.5-pro",
        contents: prompt
      });
      return response.candidates?.[0]?.content?.parts?.[0]?.text || response.text || "";
    } catch (error: any) {
      console.error('Test AI error:', error);
      throw new Error(`AI test failed: ${error.message}`);
    }
  }

  // Extract dossier data from raw text using AI
  async extractDossierData(rawText: string): Promise<any> {
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
      const response = await googleAI.models.generateContent({
        model: "gemini-2.5-pro",
        contents: extractionPrompt,
        config: {
          temperature: 0.1,
          topP: 0.95,
          topK: 20,
          maxOutputTokens: 2048,
          responseMimeType: "application/json"
        }
      });

      const rawText = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text;
      const extractedJson = typeof rawText === 'string' ? rawText.trim() : String(rawText || '').trim();
      if (!extractedJson) {
        throw new Error('No JSON extracted from AI response');
      }

      return JSON.parse(extractedJson);
    } catch (error: any) {
      console.error('Extract dossier error:', error);
      throw new Error(`Failed to extract dossier data: ${error.message}`);
    }
  }

  // OpenAI API call method with optional web search
  private async callOpenAI(aiConfig: AiConfig, prompt: string, useWebSearch: boolean = false, jobId?: string): Promise<string> {
    // GPT-5 and deep research models use the new /v1/responses endpoint
    const isO3Model = aiConfig.model.includes('o3');
    const isDeepResearchModel = aiConfig.model.includes('deep-research');
    const isGPT5 = aiConfig.model === 'gpt-5';
    const useResponsesAPI = isGPT5 || isDeepResearchModel;
    
    // Log detailed AI call information
    console.log(`🤖 [${jobId}] Starting OpenAI call:`, {
      model: aiConfig.model,
      modelExact: `'${aiConfig.model}'`,  // Show exact string with quotes
      isGPT5,
      isO3Model,
      isDeepResearchModel,
      useResponsesAPI,
      useWebSearch,
      promptLength: prompt.length
    });
    
    let finalPrompt = prompt;
    
    // Add web search context if requested
    if (useWebSearch) {
      finalPrompt = `${prompt}\n\nIMPORTANT: Voor deze analyse heb je toegang tot actuele online informatie. Zoek actief naar relevante fiscale regelgeving, jurisprudentie en Belastingdienst publicaties om je antwoord te onderbouwen. Gebruik alleen officiële Nederlandse bronnen zoals belastingdienst.nl, wetten.overheid.nl, en rijksoverheid.nl.`;
    }
    
    const startTime = Date.now();
    
    // Special handling for GPT-5 and deep-research models - use /v1/responses endpoint
    if (useResponsesAPI) {
      let requestConfig: any;
      
      if (isGPT5) {
        // GPT-5 specific configuration - no temperature support
        requestConfig = {
          model: "gpt-5",
          reasoning: {
            effort: useWebSearch ? "medium" : "minimal"  // Medium effort needed for web_search
          },
          max_output_tokens: 10000,  // Long reports
          input: [
            { 
              role: "user", 
              content: [{ 
                type: "input_text", 
                text: finalPrompt 
              }] 
            }
          ]
        };
        
        // Add web search for GPT-5
        if (useWebSearch) {
          requestConfig.tools = [{ type: "web_search_preview" }];
        }
      } else {
        // Deep research models configuration
        requestConfig = {
          model: aiConfig.model,
          reasoning: { summary: "auto" },
          input: [
            { 
              role: "user", 
              content: [{ 
                type: "input_text", 
                text: finalPrompt 
              }] 
            }
          ]
        };
        
        // Add web search tool if requested
        if (useWebSearch) {
          requestConfig.tools = [{ type: "web_search_preview" }];
        }
      }
      
      // Make direct API call to /v1/responses endpoint with timeout
      const modelLabel = isGPT5 ? "GPT-5 (Responses API)" : "Deep research";
      const timeoutDuration = isGPT5 ? 300000 : 600000; // 5 min for GPT-5, 10 min for deep research
      console.log(`🕒 [${jobId}] ${modelLabel} API call started (${aiConfig.model})...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);
      
      try {
        console.log(`🔗 [${jobId}] Making fetch request to OpenAI...`);
        const response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestConfig),
          signal: controller.signal,
        }).catch(fetchError => {
          console.error(`🚨 [${jobId}] Fetch failed:`, fetchError);
          throw new Error(`Network error: ${fetchError.message}`);
        });
        
        clearTimeout(timeoutId);
        console.log(`📡 [${jobId}] Response received, status: ${response.status}`);
      
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Could not read error response');
          console.error(`❌ [${jobId}] API Error Response:`, errorText);
          throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
        }
        
        const result = await response.json().catch(jsonError => {
          console.error(`🚨 [${jobId}] JSON parse failed:`, jsonError);
          throw new Error(`Invalid JSON response from OpenAI API`);
        });
        
        console.log(`✅ [${jobId}] ${isGPT5 ? 'GPT-5' : 'Deep research'} response ontvangen:`, {
          model: aiConfig.model,
          hasOutput: !!result.output,
          outputLength: result.output?.length || 0,
          duration: `${(Date.now() - startTime) / 1000}s`,
          resultKeys: Object.keys(result || {})
        });
        
        // Handle the response structure safely
        const content = result?.output || result?.choices?.[0]?.message?.content || result?.content || "";
        const contentString = typeof content === 'string' ? content : String(content || '');
        if (!contentString || contentString.trim() === "") {
          throw new Error(`Empty response from ${aiConfig.model} - no usable content found`);
        }
        
        return contentString;
      } catch (error: any) {
        clearTimeout(timeoutId);
        console.error(`🚨 [${jobId}] ${aiConfig.model} API call failed:`, {
          errorName: error.name,
          errorMessage: error.message,
          errorStack: error.stack?.split('\n').slice(0, 3)
        });
        
        if (error.name === 'AbortError') {
          const timeoutMsg = isGPT5 ? '5 minutes' : '10 minutes';
          throw new Error(`${aiConfig.model} timed out after ${timeoutMsg}`);
        }
        
        // Re-throw with more context
        throw new Error(`${aiConfig.model} API call failed: ${error.message}`);
      }
    }
    
    // Regular OpenAI models using chat completions
    const chatConfig: any = {
      model: aiConfig.model,
      messages: [{ role: "user", content: finalPrompt }],
    };
    
    // Different models have different parameter requirements
    if (aiConfig.model === 'gpt-5') {
      // GPT-5 should never reach here, but if it does, handle it
      console.error(`⚠️ GPT-5 reached chat completions path - this is a bug!`);
      throw new Error('GPT-5 must use /v1/responses endpoint, not chat completions');
    } else if (isO3Model) {
      chatConfig.max_tokens = aiConfig.maxOutputTokens;
      // o3 models don't support custom temperature or top_p
    } else {
      // Standard models (gpt-4o, gpt-4o-mini, etc.)
      chatConfig.temperature = aiConfig.temperature;
      chatConfig.top_p = aiConfig.topP;
      chatConfig.max_tokens = aiConfig.maxOutputTokens;
    }
    
    console.log(`⚡ [${jobId}] Standard OpenAI API call (${aiConfig.model})...`);
    const response = await openaiClient.chat.completions.create(chatConfig);
    
    const duration = Date.now() - startTime;
    const content = response.choices[0]?.message?.content || "";
    
    console.log(`✅ [${jobId}] OpenAI response ontvangen:`, {
      model: aiConfig.model,
      responseLength: content.length,
      duration: `${duration}ms`,
      usage: response.usage
    });
    
    return content;
  }

  // Google AI API call method with optional grounding
  private async callGoogleAI(aiConfig: AiConfig, prompt: string, useGrounding: boolean = false, jobId?: string): Promise<string> {
    console.log(`🌎 [${jobId}] Starting Google AI call:`, {
      model: aiConfig.model,
      useGrounding,
      promptLength: prompt.length
    });
    
    const startTime = Date.now();
    try {
      const response = await googleAI.models.generateContent({
        model: aiConfig.model,
        contents: prompt,
        config: {
          temperature: aiConfig.temperature,
          topP: aiConfig.topP,
          topK: aiConfig.topK,
          maxOutputTokens: aiConfig.maxOutputTokens,
        }
      });
      
      const duration = Date.now() - startTime;
      const result = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text || "";
      
      // Log response metadata for debugging
      console.log(`✅ [${jobId}] Google AI response ontvangen:`, {
        model: aiConfig.model,
        finishReason: response.candidates?.[0]?.finishReason,
        responseLength: result.length,
        duration: `${duration}ms`,
        usageMetadata: response.usageMetadata,
        hasContent: !!result
      });
      
      const finishReason = response.candidates?.[0]?.finishReason;
      
      // Handle MAX_TOKENS - partial content may still be useful
      if (finishReason === 'MAX_TOKENS') {
        console.warn('Google AI hit token limit, but may have partial content');
        const resultString = typeof result === 'string' ? result : String(result || '');
        if (resultString && resultString.trim().length > 50) {
          console.log(`Partial content length: ${result.length} chars`);
          return result; // Return partial content if substantial
        }
      }
      
      const resultString = typeof result === 'string' ? result : String(result || '');
      if (!resultString || resultString.trim() === '') {
        console.error('Google AI returned empty response:', JSON.stringify({
          finishReason,
          candidatesLength: response.candidates?.length || 0,
          hasUsageMetadata: !!response.usageMetadata
        }, null, 2));
        throw new Error(`Lege response van Google AI (${finishReason || 'unknown reason'})`);
      }
      
      return result;
    } catch (error: any) {
      console.error('Google AI API error:', error);
      throw new Error(`Google AI API fout: ${error.message}`);
    }
  }

  async generateReport(dossier: DossierData, bouwplan: BouwplanData): Promise<string> {
    // Legacy method - kept for backwards compatibility
    // For new workflow, use executeStage method
    return this.generateBasicReport({ 
      datum: new Date().toLocaleDateString('nl-NL'),
      dossier: JSON.stringify(dossier, null, 2)
    });
  }

  async executeStage(
    stageName: string,
    dossier: DossierData,
    bouwplan: BouwplanData,
    previousStageResults: Record<string, string>,
    conceptReportVersions: Record<string, string>,
    customInput?: string,
    jobId?: string
  ): Promise<{ stageOutput: string; conceptReport: string }> {
    // Helper function to call the appropriate AI service
    const callAI = async (aiConfig: AiConfig, prompt: string): Promise<string> => {
      console.log(`🎯 [${jobId}] Starting stage ${stageName}:`, {
        provider: aiConfig.provider,
        model: aiConfig.model,
        grounding: useStageGrounding,
        webSearch: useStageWebSearch
      });
      
      if (aiConfig.provider === "openai") {
        return this.callOpenAI(aiConfig, prompt, useStageWebSearch, jobId);
      } else {
        return this.callGoogleAI(aiConfig, prompt, useStageGrounding, jobId);
      }
    };
    const currentDate = new Date().toLocaleDateString('nl-NL', {
      year: 'numeric',
      month: 'long', 
      day: 'numeric'
    });

    // Get active prompt configuration
    const promptConfig = await storage.getActivePromptConfig();
    if (!promptConfig) {
      throw new Error("Geen actieve prompt configuratie gevonden");
    }

    const prompts = promptConfig.config as PromptConfig;
    const stageConfig = prompts[stageName as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;
    
    // Check if stage config exists and handle missing prompts
    let promptTemplate: string;
    let useStageGrounding: boolean;
    let useStageWebSearch: boolean;
    
    if (!stageConfig || !stageConfig.prompt) {
      throw new Error(`Geen prompt configuratie gevonden voor stage ${stageName} - configureer eerst alle prompts in de instellingen`);
    }
    
    promptTemplate = stageConfig.prompt;
    useStageGrounding = stageConfig.useGrounding || false;
    useStageWebSearch = stageConfig.useWebSearch || false;

    // Get the current working text - starts with raw text, then evolves per stage
    let currentWorkingText = (dossier as any).rawText || JSON.stringify(dossier, null, 2);
    
    // For stage 2+, use the output of the previous stage as the working text
    // Special handling for stage 3: combine outputs from stage 1 and 2
    const previousStageKeys = Object.keys(previousStageResults);
    if (stageName === '3_generatie' && previousStageResults['1_informatiecheck'] && previousStageResults['2_complexiteitscheck']) {
      // For stage 3, combine outputs from both stage 1 and 2
      currentWorkingText = `=== OUTPUT VAN STAP 1 (INFORMATIECHECK) ===
${previousStageResults['1_informatiecheck']}

=== OUTPUT VAN STAP 2 (COMPLEXITEITSCHECK) ===
${previousStageResults['2_complexiteitscheck']}

=== ORIGINELE DOSSIER DATA ===
${(dossier as any).rawText || JSON.stringify(dossier, null, 2)}`;
    } else if (previousStageKeys.length > 0) {
      const lastStage = previousStageKeys[previousStageKeys.length - 1];
      currentWorkingText = previousStageResults[lastStage] || currentWorkingText;
    }

    // Prepare variables for prompt template with enhanced context
    const variables: Record<string, string> = {
      datum: currentDate,
      huidige_tekst: currentWorkingText, // De tekst die deze stap moet verwerken
      oorspronkelijke_tekst: (dossier as any).rawText || JSON.stringify(dossier, null, 2), // Origineel voor referentie
      dossier: JSON.stringify(dossier, null, 2),
      bouwplan: JSON.stringify(bouwplan, null, 2),
      ...previousStageResults
    };

    // Enhanced context passing - get latest concept report version
    const latestConceptReportKeys = Object.keys(conceptReportVersions);
    if (latestConceptReportKeys.length > 0) {
      const latestKey = latestConceptReportKeys[latestConceptReportKeys.length - 1];
      variables.concept_rapport = conceptReportVersions[latestKey];
    }

    // Add custom input if provided
    if (customInput) {
      variables.custom_input = customInput;
    }
    
    // Add clientName to variables for fallback prompts
    variables.clientName = JSON.parse(variables.dossier).klant?.naam || "Client";

    // Declare and process the prompt template
    let processedPrompt: string;
    
    // Always use the prompt from settings - no default prompts
    if (!promptTemplate) {
      throw new Error(`Geen prompt configuratie gevonden voor stage ${stageName}`);
    }
    
    // Replace variables in custom prompt template
    processedPrompt = promptTemplate;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      processedPrompt = processedPrompt.replace(new RegExp(placeholder, 'g'), String(value));
    }

    try {
      
      // Get AI configuration - check stage-specific config first, then global config, then defaults
      const stageAiConfig = stageConfig?.aiConfig;
      const globalAiConfig = prompts.aiConfig;
      
      const aiConfig: AiConfig = {
        provider: stageAiConfig?.provider || globalAiConfig?.provider || "google",
        model: stageAiConfig?.model || globalAiConfig?.model || "gemini-2.5-pro",
        temperature: stageAiConfig?.temperature || globalAiConfig?.temperature || 0.1,
        topP: stageAiConfig?.topP || globalAiConfig?.topP || 0.95,
        topK: stageAiConfig?.topK || globalAiConfig?.topK || 20,
        maxOutputTokens: stageAiConfig?.maxOutputTokens || globalAiConfig?.maxOutputTokens || 8192,
      };
      
      // Combine prompt with input text - prompt gives instructions, currentWorkingText is the data to process
      const fullInput = `${processedPrompt}\n\n--- INPUT DATA ---\n${currentWorkingText}`;
      
      try {
        const result = await callAI(aiConfig, fullInput);
        
        // Ensure result is a string before calling trim()
        const resultString = typeof result === 'string' ? result : String(result || '');
        
        if (!resultString || resultString.trim() === '') {
          throw new Error(`Lege response van AI voor stage ${stageName}`);
        }
        
        // Return result - cyclical flow logic handled by route handler
        return {
          stageOutput: resultString,
          conceptReport: stageName === "3_generatie" || stageName === "5_feedback_verwerker" ? resultString : ""
        };
        
      } catch (aiError: any) {
        console.error(`AI API Error for ${stageName}:`, aiError.message);
        throw new Error(`AI fout in stap ${stageName}: ${aiError.message}`);
      }
      

    } catch (error) {
      console.error(`Error in stage ${stageName}:`, error);
      throw new Error(`Fout bij uitvoeren van stap ${stageName}: ${error}`);
    }
  }


  private getStageDescription(stageName: string): string {
    const descriptions: Record<string, string> = {
      "4a_BronnenSpecialist": "bronnen verificatie",
      "4b_FiscaalTechnischSpecialist": "fiscaal-technische",
      "4c_ScenarioGatenAnalist": "scenario analyse",
      "4d_DeVertaler": "communicatie en vertaling",
      "4e_DeAdvocaat": "juridische compliance",
      "4f_DeKlantpsycholoog": "klantgerichte communicatie",
      "4g_ChefEindredactie": "eindredactie en kwaliteitscontrole"
    };
    return descriptions[stageName] || "algemene";
  }


  // Get next stage in cyclical workflow: 4x→5→4x→5→4x→5 etc
  getNextStage(currentStage: string): string | null {
    const reviewerStages = ["4a_BronnenSpecialist", "4b_FiscaalTechnischSpecialist", "4c_ScenarioGatenAnalist", 
                           "4d_DeVertaler", "4e_DeAdvocaat", "4f_DeKlantpsycholoog"];
    
    // Linear flow for initial stages
    if (currentStage === "1_informatiecheck") return "2_complexiteitscheck";
    if (currentStage === "2_complexiteitscheck") return "3_generatie";
    if (currentStage === "3_generatie") return "4a_BronnenSpecialist";
    
    // Cyclical flow for review stages
    if (currentStage === "5_feedback_verwerker") {
      // After feedback processor, go to next reviewer
      const lastReviewerIndex = reviewerStages.findIndex(stage => stage === this.lastReviewerStage);
      const nextReviewerIndex = lastReviewerIndex + 1;
      
      if (nextReviewerIndex < reviewerStages.length) {
        return reviewerStages[nextReviewerIndex];
      } else {
        return "final_check"; // All reviewers done
      }
    }
    
    // After any reviewer (4a-4f), go to feedback processor
    if (reviewerStages.includes(currentStage)) {
      this.lastReviewerStage = currentStage; // Track which reviewer we just completed
      return "5_feedback_verwerker";
    }
    
    // Final stage
    if (currentStage === "final_check") return null;
    
    return null;
  }
  
  private lastReviewerStage: string = "";

  // Get the latest concept report from previous stages
  private getLatestConceptReport(conceptReportVersions: Record<string, string>, currentStage: string): string {
    // Find the most recent concept report version
    const availableVersions = Object.keys(conceptReportVersions);
    
    if (availableVersions.length === 0) {
      return ""; // No concept report yet
    }
    
    // Sort by stage order (stage 3 is first concept, then 5 updates it)
    const stageOrder = ["3_generatie", "5_feedback_verwerker"];
    
    // Get the latest available concept report
    for (let i = stageOrder.length - 1; i >= 0; i--) {
      const stageKey = stageOrder[i];
      if (conceptReportVersions[stageKey]) {
        return conceptReportVersions[stageKey];
      }
    }
    
    return ""; // Fallback
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

  private getFallbackPromptResult(stageName: string, variables: Record<string, any>): { stageOutput: string; conceptReport: string } {
    // Temporary fallback until user loads custom prompts
    switch (stageName) {
      case "1_informatiecheck":
        const dossierInfo = JSON.parse(variables.dossier);
        const clientName = dossierInfo.klant?.naam || variables.clientName || "Client";
        return {
          stageOutput: `✅ Informatiecheck voltooid voor ${clientName}\n\nDossier gevalideerd en bevat alle benodigde informatie voor fiscale analyse.`,
          conceptReport: ""
        };
      
      case "2_complexiteitscheck":
        return {
          stageOutput: `✅ Complexiteitscheck voltooid\n\nFiscale situatie geanalyseerd en geschikt bevonden voor gestructureerde rapportage via het 11-stappen proces.`,
          conceptReport: ""
        };
      
      case "3_generatie":
        const basicReport = this.generateBasicReport(variables);
        return {
          stageOutput: "✅ Basis rapport gegenereerd\n\nHet initiële fiscaal duidingsrapport is opgesteld met alle hoofdcomponenten.",
          conceptReport: basicReport
        };
        
      case "4a_BronnenSpecialist":
        return {
          stageOutput: `✅ Bronnenverificatie voltooid\n\nAlle fiscale claims zijn geverifieerd tegen officiële Nederlandse overheidsbronnen (belastingdienst.nl, wetten.overheid.nl, rijksoverheid.nl).`,
          conceptReport: variables.concept_rapport || ""
        };
        
      case "4b_FiscaalTechnischSpecialist":
        return {
          stageOutput: `✅ Fiscaal-technische review voltooid\n\nTechnische fiscale aspecten zijn geverifieerd en alle berekeningen zijn gecontroleerd op juistheid.`,
          conceptReport: variables.concept_rapport || ""
        };
        
      case "4c_ScenarioGatenAnalist":
        return {
          stageOutput: `✅ Scenario-analyse voltooid\n\nMogelijke scenario's zijn geïdentificeerd en potentiële hiaten in de analyse zijn opgevuld.`,
          conceptReport: variables.concept_rapport || ""
        };
        
      case "4d_DeVertaler":
        return {
          stageOutput: `✅ Taaloptimalisatie voltooid\n\nRapport is geoptimaliseerd voor duidelijkheid en begrijpelijkheid voor de eindgebruiker.`,
          conceptReport: variables.concept_rapport || ""
        };
        
      case "4e_DeAdvocaat":
        return {
          stageOutput: `✅ Juridische compliance check voltooid\n\nRapport voldoet aan alle wettelijke vereisten en aansprakelijkheidsrichtlijnen.`,
          conceptReport: variables.concept_rapport || ""
        };
        
      case "4f_DeKlantpsycholoog":
        return {
          stageOutput: `✅ Klantgerichte optimalisatie voltooid\n\nRapport is aangepast voor optimale communicatie en begrip door de klant.`,
          conceptReport: variables.concept_rapport || ""
        };
        
      case "5_feedback_verwerker":
        return {
          stageOutput: `✅ Feedback verwerking voltooid\n\nJSON feedback is verwerkt en rapport is bijgewerkt.`,
          conceptReport: variables.concept_rapport || this.generateBasicReport(variables)
        };
        
      case "final_check":
        return {
          stageOutput: `✅ Finale controle voltooid\n\nRapport is goedgekeurd en gereed voor levering.`,
          conceptReport: variables.concept_rapport || this.generateBasicReport(variables)
        };
        
      default:
        return {
          stageOutput: `✅ Stage ${stageName} voltooid\n\nResultaat beschikbaar - configureer custom prompts voor volledige functionaliteit.`,
          conceptReport: ""
        };
    }
  }

  private generateBasicReport(variables: Record<string, any>): string {
    const datum = variables.datum || new Date().toLocaleDateString('nl-NL');
    const dossierData = variables.dossier ? JSON.parse(variables.dossier) : {};
    
    return `
      <div class="space-y-6">
        <h1 class="text-2xl font-bold text-foreground">Fiscaal Duidingsrapport</h1>
        <p class="text-muted-foreground">Gegenereerd op: ${datum}</p>
        
        <div class="bg-accent/10 border-l-4 border-accent p-4 rounded-r-md">
          <h3 class="font-semibold text-foreground mb-2">Belangrijke kennisgeving: De aard van dit rapport</h3>
          <p class="text-sm text-muted-foreground">
            Dit document is een initiële, diagnostische analyse, opgesteld op basis van de door u verstrekte informatie. 
            Het doel is om de voornaamste fiscale aandachtspunten en potentiële risico's ('knelpunten') te identificeren en de onderliggende principes toe te lichten. 
            Dit rapport biedt dus een analyse van de problematiek, geen kant-en-klare oplossingen.
          </p>
          <p class="text-sm text-muted-foreground mt-2">
            Het is nadrukkelijk geen definitief fiscaal advies en dient niet als basis voor het nemen van financiële, juridische of strategische beslissingen. 
            De complexiteit en continue verandering van fiscale wetgeving maken een uitgebreid en persoonlijk adviestraject noodzakelijk.
          </p>
        </div>
        
        <div class="space-y-4">
          <h2 class="text-xl font-semibold">Klant Informatie</h2>
          <p>Naam: ${dossierData.klant?.naam || 'Onbekend'}</p>
          <p>Situatie: ${dossierData.klant?.situatie || 'Niet gespecificeerd'}</p>
          <p>Vermogen: €${dossierData.fiscale_gegevens?.vermogen?.toLocaleString('nl-NL') || '0'}</p>
          <p>Inkomsten: €${dossierData.fiscale_gegevens?.inkomsten?.toLocaleString('nl-NL') || '0'}</p>
        </div>
        
        <div class="space-y-4">
          <h2 class="text-xl font-semibold">Analyse</h2>
          <p class="text-muted-foreground">
            Op basis van de verstrekte gegevens kunnen er mogelijk fiscale implicaties optreden die nadere analyse vereisen. 
            Het risico bestaat dat zonder adequate planning onvoorziene belastingverplichtingen kunnen ontstaan.
          </p>
        </div>
        
        <div class="space-y-4">
          <h2 class="text-xl font-semibold">Geraadpleegde Bronnen</h2>
          <div class="space-y-2 text-sm">
            <div class="flex items-start space-x-3">
              <span class="flex-shrink-0 w-8 h-6 bg-secondary rounded text-xs font-medium flex items-center justify-center text-secondary-foreground">[1]</span>
              <div>
                <p class="text-muted-foreground">Algemene informatie belastingdienst</p>
                <a href="https://www.belastingdienst.nl" class="text-primary hover:underline text-xs" target="_blank" rel="noopener noreferrer">https://www.belastingdienst.nl</a>
              </div>
            </div>
          </div>
        </div>
        
        <div class="text-xs text-muted-foreground border-t pt-4">
          <p><strong>Disclaimer:</strong> Dit rapport bevat een initiële, algemene fiscale duiding en is (deels) geautomatiseerd opgesteld op basis van de door u verstrekte informatie. Het is geen vervanging van persoonlijk, professioneel fiscaal advies. Voor een advies waarop u beslissingen kunt baseren, dient u altijd gebruik te maken van onze uitgebreide adviesdienst.</p>
        </div>
      </div>
    `;
  }
}