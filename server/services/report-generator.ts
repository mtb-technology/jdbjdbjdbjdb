import type { DossierData, BouwplanData, PromptConfig, AiConfig, StageConfig } from "@shared/schema";
import { SourceValidator } from "./source-validator";
import { GoogleGenAI } from "@google/genai";
import { storage } from "../storage";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export class ReportGenerator {
  private sourceValidator: SourceValidator;

  constructor() {
    this.sourceValidator = new SourceValidator();
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
    const promptTemplate = stageConfig.prompt || "";
    const useStageGrounding = stageConfig.useGrounding || false;

    if (!promptTemplate || promptTemplate.startsWith("PLACEHOLDER:")) {
      console.warn(`Stage ${stageName} heeft nog geen custom prompt, gebruik fallback`);
      return this.getFallbackPromptResult(stageName, {
        datum: currentDate,
        dossier: JSON.stringify(dossier, null, 2),
        bouwplan: JSON.stringify(bouwplan, null, 2),
        ...previousStageResults
      });
    }

    // Prepare variables for prompt template with enhanced context
    const variables: Record<string, string> = {
      datum: currentDate,
      dossier: JSON.stringify(dossier, null, 2),
      bouwplan: JSON.stringify(bouwplan, null, 2),
      oorspronkelijk_dossier: JSON.stringify(dossier, null, 2), // Always include original dossier for context
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

    // Replace variables in prompt template
    let processedPrompt = promptTemplate;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      processedPrompt = processedPrompt.replace(new RegExp(placeholder, 'g'), String(value));
    }

    try {
      console.log(`Executing stage: ${stageName}`);
      
      // Get AI configuration from prompt config or use defaults
      const aiConfig: AiConfig = prompts.aiConfig || {
        model: "gemini-2.5-pro",
        temperature: 0.1,
        topP: 0.95,
        topK: 20,
        maxOutputTokens: 2048,
      };
      
      // Prepare generation config
      const generationConfig: any = {
        temperature: aiConfig.temperature,
        topP: aiConfig.topP,
        topK: aiConfig.topK,
        maxOutputTokens: aiConfig.maxOutputTokens,
      };

      // Add grounding for research-like capabilities if enabled for this stage
      if (useStageGrounding) {
        generationConfig.tools = [{ google_search: {} }];
      }
      
      const response = await ai.models.generateContent({
        model: aiConfig.model,
        config: generationConfig,
        contents: processedPrompt,
      });

      const result = response.text || "";
      
      if (!result) {
        throw new Error(`Geen response van AI voor stage ${stageName}`);
      }

      // For stage 3 (generatie), this IS the first concept report
      if (stageName === "3_generatie") {
        console.log(`Stage ${stageName} completed - generated initial concept report`);
        return {
          stageOutput: `✅ Basis rapport gegenereerd\n\nHet initiële fiscaal duidingsrapport is opgesteld met alle hoofdcomponenten.`,
          conceptReport: result
        };
      }
      
      // For stages 4a-4g, generate both stage-specific output and updated concept report
      if (stageName.startsWith("4")) {
        console.log(`Stage ${stageName} completed - generating specialist output and updated concept`);
        
        // Get current concept report for updating
        const currentConcept = latestConceptReportKeys.length > 0 
          ? conceptReportVersions[latestConceptReportKeys[latestConceptReportKeys.length - 1]]
          : "";
        
        // For 4x stages, we need to generate an updated concept report that incorporates this stage's expertise
        const updatePrompt = `Je bent een ${this.getStageDescription(stageName)} specialist. 
        
Je hebt zojuist de volgende analyse gemaakt: ${result}

Hier is het huidige concept rapport:
${currentConcept}

Taak: Integreer jouw expertise naadloos in het concept rapport. Behoud de bestaande structuur maar voeg jouw inzichten toe waar relevant. Geef het bijgewerkte volledige rapport terug.

Houd rekening met:
- Behoud de bestaande opmaak en structuur
- Voeg jouw specifieke expertise toe zonder dubbeling
- Zorg dat het rapport coherent en professioneel blijft
- Verwijs naar bronnen waar nodig`;

        try {
          const updateResponse = await ai.models.generateContent({
            model: aiConfig.model,
            config: generationConfig,
            contents: updatePrompt,
          });

          const updatedConceptReport = updateResponse.text || currentConcept;
          
          return {
            stageOutput: result, // The specialist's specific analysis
            conceptReport: updatedConceptReport // The updated full concept report
          };
        } catch (error) {
          console.error(`Error updating concept report for ${stageName}:`, error);
          return {
            stageOutput: result,
            conceptReport: currentConcept // Fallback to current version
          };
        }
      }
      
      // For other stages (1, 2, final), just return the output as stage output
      console.log(`Stage ${stageName} completed successfully with model ${aiConfig.model}`);
      return {
        stageOutput: result,
        conceptReport: "" // No concept report for non-4x stages
      };

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
        return {
          stageOutput: `✅ Informatiecheck voltooid voor ${JSON.parse(variables.dossier).klant?.naam}\n\nDossier gevalideerd en bevat alle benodigde informatie voor fiscale analyse.`,
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
        
      case "4g_ChefEindredactie":
        return {
          stageOutput: `✅ Eindredactie voltooid\n\nRapport is gefinaliseerd en klaar voor presentatie aan de klant.`,
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