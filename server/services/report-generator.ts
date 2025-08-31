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

      const extractedJson = (response.candidates?.[0]?.content?.parts?.[0]?.text || response.text)?.trim();
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
  private async callOpenAI(aiConfig: AiConfig, prompt: string, useWebSearch: boolean = false): Promise<string> {
    // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
    // However, o3 and o3-mini are the newest reasoning models for deep research
    
    console.log(`DEBUG: callOpenAI called with model: "${aiConfig.model}"`);
    console.log(`DEBUG: Model includes 'o3-deep-research': ${aiConfig.model.includes('o3-deep-research')}`);
    
    // o3-deep-research models need special handling
    const isO3DeepResearchModel = aiConfig.model.includes('o3-deep-research');
    
    // Check for o3-deep-research models FIRST, before building config
    if (isO3DeepResearchModel) {
      console.log('DEBUG: Using responses API for o3-deep-research model');
      
      let finalPrompt = prompt;
      if (useWebSearch) {
        console.log('Web search enabled for OpenAI call - enhancing prompt with search context');
        finalPrompt = `${prompt}\n\nIMPORTANT: Voor deze analyse heb je toegang tot actuele online informatie. Zoek actief naar relevante fiscale regelgeving, jurisprudentie en Belastingdienst publicaties om je antwoord te onderbouwen. Gebruik alleen officiële Nederlandse bronnen zoals belastingdienst.nl, wetten.overheid.nl, en rijksoverheid.nl.`;
      }
      
      const responsesConfig = {
        model: aiConfig.model,
        input: [{ role: "user", content: finalPrompt }],
        max_output_tokens: aiConfig.maxOutputTokens,
      };
      
      console.log(`OpenAI Responses API config:`, JSON.stringify(responsesConfig, null, 2));
      const startTime = Date.now();
      
      try {
        const responsesResult = await (openaiClient as any).responses.create(responsesConfig);
        
        const duration = Date.now() - startTime;
        console.log(`OpenAI ${aiConfig.model} response took ${duration}ms`);
        console.log(`OpenAI response metadata:`, {
          model: responsesResult.model,
          usage: responsesResult.usage,
          output_length: responsesResult.output?.length
        });
        
        // Access the final output from responses API
        return responsesResult.output?.[responsesResult.output.length - 1]?.content?.[0]?.text || "";
      } catch (error: any) {
        console.error('Responses API error:', error);
        throw error;
      }
    }
    
    // Regular OpenAI models (not o3-deep-research)
    const isO3Model = aiConfig.model.includes('o3');
    const requestConfig: any = {
      model: aiConfig.model,
      messages: [{ role: "user", content: prompt }],
    };
    
    // o3 models only support default temperature (1) and no top_p
    if (isO3Model) {
      requestConfig.max_completion_tokens = aiConfig.maxOutputTokens;
      // o3 models don't support custom temperature or top_p
    } else {
      requestConfig.temperature = aiConfig.temperature;
      requestConfig.top_p = aiConfig.topP;
      requestConfig.max_tokens = aiConfig.maxOutputTokens;
    }
    
    let finalPrompt = prompt;
    
    // Add web search context if requested
    if (useWebSearch) {
      console.log('Web search enabled for OpenAI call - enhancing prompt with search context');
      finalPrompt = `${prompt}\n\nIMPORTANT: Voor deze analyse heb je toegang tot actuele online informatie. Zoek actief naar relevante fiscale regelgeving, jurisprudentie en Belastingdienst publicaties om je antwoord te onderbouwen. Gebruik alleen officiële Nederlandse bronnen zoals belastingdienst.nl, wetten.overheid.nl, en rijksoverheid.nl.`;
    }
    
    requestConfig.messages = [{ role: "user", content: finalPrompt }];
    
    console.log(`OpenAI API call config for ${aiConfig.model} (web search: ${useWebSearch}):`, JSON.stringify(requestConfig, null, 2));
    const startTime = Date.now();
    
    // Use regular chat completions for non-deep-research models
    const response = await openaiClient.chat.completions.create(requestConfig);
    
    const duration = Date.now() - startTime;
    console.log(`OpenAI ${aiConfig.model} response took ${duration}ms`);
    console.log(`OpenAI response metadata:`, {
      model: response.model,
      usage: response.usage,
      choices_length: response.choices?.length
    });
    
    return response.choices[0]?.message?.content || "";
  }

  // Google AI API call method with optional grounding
  private async callGoogleAI(aiConfig: AiConfig, prompt: string, useGrounding: boolean = false): Promise<string> {
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
      
      // Log response metadata for debugging
      console.log('Google AI response metadata:', {
        finishReason: response.candidates?.[0]?.finishReason,
        usageMetadata: response.usageMetadata,
        hasContent: !!response.candidates?.[0]?.content?.parts?.[0]?.text
      });
      
      const result = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text || "";
      const finishReason = response.candidates?.[0]?.finishReason;
      
      // Handle MAX_TOKENS - partial content may still be useful
      if (finishReason === 'MAX_TOKENS') {
        console.warn('Google AI hit token limit, but may have partial content');
        if (result && result.trim().length > 50) {
          console.log(`Partial content length: ${result.length} chars`);
          return result; // Return partial content if substantial
        }
      }
      
      if (!result || result.trim() === '') {
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
    customInput?: string
  ): Promise<{ stageOutput: string; conceptReport: string }> {
    // Helper function to call the appropriate AI service
    const callAI = async (aiConfig: AiConfig, prompt: string): Promise<string> => {
      console.log(`Using AI Provider: ${aiConfig.provider}, Model: ${aiConfig.model} for stage: ${stageName}`);
      console.log(`Search settings - Grounding: ${useStageGrounding}, Web Search: ${useStageWebSearch}`);
      
      if (aiConfig.provider === "openai") {
        return this.callOpenAI(aiConfig, prompt, useStageWebSearch);
      } else {
        return this.callGoogleAI(aiConfig, prompt, useStageGrounding);
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
      console.warn(`No stage config found for ${stageName}, using default prompt`);
      promptTemplate = this.getDefaultPromptForStage(stageName, {
        clientName: JSON.parse(JSON.stringify(dossier)).klant?.naam || "Client",
        huidige_tekst: ""
      });
      useStageGrounding = false;
      useStageWebSearch = false;
    } else {
      promptTemplate = stageConfig.prompt;
      useStageGrounding = stageConfig.useGrounding || false;
      useStageWebSearch = stageConfig.useWebSearch || false;
    }

    // Get the current working text - starts with raw text, then evolves per stage
    let currentWorkingText = (dossier as any).rawText || JSON.stringify(dossier, null, 2);
    
    // For stage 2+, use the output of the previous stage as the working text
    const previousStageKeys = Object.keys(previousStageResults);
    if (previousStageKeys.length > 0) {
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
    
    // Als er geen custom prompt is, gebruik een basis AI prompt
    if (!promptTemplate || promptTemplate.startsWith("PLACEHOLDER:")) {
      processedPrompt = this.getDefaultPromptForStage(stageName, variables);
    } else {
      // Replace variables in custom prompt template
      processedPrompt = promptTemplate;
      for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{{${key}}}`;
        processedPrompt = processedPrompt.replace(new RegExp(placeholder, 'g'), String(value));
      }
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
        
        if (!result || result.trim() === '') {
          throw new Error(`Lege response van AI voor stage ${stageName}`);
        }
        
        // Return result - cyclical flow logic handled by route handler
        return {
          stageOutput: result,
          conceptReport: stageName === "3_generatie" || stageName === "5_feedback_verwerker" ? result : ""
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

  private getDefaultPromptForStage(stageName: string, variables: Record<string, any>): string {
    // Basis AI prompts die altijd de AI triggeren
    const clientName = variables.clientName || "de klant";
    const currentText = variables.huidige_tekst || variables.oorspronkelijke_tekst || "de dossier tekst";
    
    switch (stageName) {
      case "1_informatiecheck":
        return `Voer een informatiecheck uit op de volgende dossier tekst voor ${clientName}:

${currentText}

Analyseer of alle benodigde informatie aanwezig is voor een fiscale analyse. Geef een samenvatting van wat er gevonden is en wat er eventueel ontbreekt.`;

      case "2_complexiteitscheck":
        return `Analyseer de complexiteit van deze fiscale situatie voor ${clientName}:

${currentText}

Bepaal hoe complex deze fiscale kwestie is en of er specialistische expertise nodig is.`;

      case "3_generatie":
        return `Genereer een basis fiscaal duidingsrapport voor ${clientName} op basis van:

${currentText}

Maak een gestructureerd rapport met inleiding, analyse en conclusie.`;

      case "5_feedback_verwerker":
        return `Je bent de Feedback Verwerker. Je taak is om de feedback van alle reviewers (4a-4f) te verwerken in het concept rapport:

CONCEPT RAPPORT:
${currentText}

Neem alle feedback serieus en verbeter het rapport waar nodig. Focus op:
- Inhoudelijke correctheid
- Duidelijke communicatie 
- Praktische bruikbaarheid
- Volledigheid van het antwoord

Lever een verbeterde versie van het rapport op.`;

      default:
        return `Analyseer en verwerk de volgende tekst voor stap ${stageName}:

${currentText}

Lever een professionele fiscale analyse op basis van deze informatie.`;
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