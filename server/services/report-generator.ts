import type { DossierData, BouwplanData, PromptConfig } from "@shared/schema";
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

    // Stage 1: Informatiecheck
    console.log("Starting Stage 1: Informatiecheck");
    const informatieCheckResult = await this.executePromptStage(
      "1_informatiecheck",
      prompts["1_informatiecheck"],
      {
        datum: currentDate,
        dossier: JSON.stringify(dossier, null, 2)
      }
    );

    // Stage 2: Complexiteitscheck  
    console.log("Starting Stage 2: Complexiteitscheck");
    const complexiteitsCheckResult = await this.executePromptStage(
      "2_complexiteitscheck", 
      prompts["2_complexiteitscheck"],
      {
        datum: currentDate,
        dossier: JSON.stringify(dossier, null, 2),
        bouwplan: JSON.stringify(bouwplan, null, 2),
        informatiecheck_result: informatieCheckResult
      }
    );

    // Stage 3: Generatie (basis rapport)
    console.log("Starting Stage 3: Generatie");
    const generatieResult = await this.executePromptStage(
      "3_generatie",
      prompts["3_generatie"],
      {
        datum: currentDate,
        dossier: JSON.stringify(dossier, null, 2),
        bouwplan: JSON.stringify(bouwplan, null, 2),
        informatiecheck_result: informatieCheckResult,
        complexiteitscheck_result: complexiteitsCheckResult
      }
    );

    // Stage 4a: BronnenSpecialist
    console.log("Starting Stage 4a: BronnenSpecialist");
    const bronnenSpecialistResult = await this.executePromptStage(
      "4a_BronnenSpecialist",
      prompts["4a_BronnenSpecialist"],
      {
        datum: currentDate,
        rapport: generatieResult,
        dossier: JSON.stringify(dossier, null, 2)
      }
    );

    // Stage 4b: FiscaalTechnischSpecialist
    console.log("Starting Stage 4b: FiscaalTechnischSpecialist");
    const fiscaalTechnischResult = await this.executePromptStage(
      "4b_FiscaalTechnischSpecialist",
      prompts["4b_FiscaalTechnischSpecialist"],
      {
        datum: currentDate,
        rapport: bronnenSpecialistResult,
        dossier: JSON.stringify(dossier, null, 2)
      }
    );

    // Stage 4c: ScenarioGatenAnalist
    console.log("Starting Stage 4c: ScenarioGatenAnalist");
    const scenarioGatenResult = await this.executePromptStage(
      "4c_ScenarioGatenAnalist",
      prompts["4c_ScenarioGatenAnalist"],
      {
        datum: currentDate,
        rapport: fiscaalTechnischResult,
        dossier: JSON.stringify(dossier, null, 2)
      }
    );

    // Stage 4d: DeVertaler
    console.log("Starting Stage 4d: DeVertaler");
    const deVertalerResult = await this.executePromptStage(
      "4d_DeVertaler",
      prompts["4d_DeVertaler"],
      {
        datum: currentDate,
        rapport: scenarioGatenResult,
        dossier: JSON.stringify(dossier, null, 2),
        bouwplan: JSON.stringify(bouwplan, null, 2)
      }
    );

    // Stage 4e: DeAdvocaat
    console.log("Starting Stage 4e: DeAdvocaat");
    const deAdvocaatResult = await this.executePromptStage(
      "4e_DeAdvocaat",
      prompts["4e_DeAdvocaat"],
      {
        datum: currentDate,
        rapport: deVertalerResult,
        dossier: JSON.stringify(dossier, null, 2)
      }
    );

    // Stage 4f: DeKlantpsycholoog
    console.log("Starting Stage 4f: DeKlantpsycholoog");
    const deKlantpsycholoogResult = await this.executePromptStage(
      "4f_DeKlantpsycholoog",
      prompts["4f_DeKlantpsycholoog"],
      {
        datum: currentDate,
        rapport: deAdvocaatResult,
        dossier: JSON.stringify(dossier, null, 2)
      }
    );

    // Stage 4g: ChefEindredactie
    console.log("Starting Stage 4g: ChefEindredactie");
    const chefEindredactieResult = await this.executePromptStage(
      "4g_ChefEindredactie",
      prompts["4g_ChefEindredactie"],
      {
        datum: currentDate,
        rapport: deKlantpsycholoogResult,
        dossier: JSON.stringify(dossier, null, 2),
        bouwplan: JSON.stringify(bouwplan, null, 2)
      }
    );

    // Final Check
    console.log("Starting Final Check voor Mathijs");
    const finalResult = await this.executePromptStage(
      "final_check",
      prompts["final_check"],
      {
        datum: currentDate,
        rapport: chefEindredactieResult,
        dossier: JSON.stringify(dossier, null, 2),
        bouwplan: JSON.stringify(bouwplan, null, 2)
      }
    );

    console.log("All stages completed successfully");
    return finalResult;
  }

  private async executePromptStage(
    stageName: string, 
    promptTemplate: string, 
    variables: Record<string, any>
  ): Promise<string> {
    try {
      if (!promptTemplate || promptTemplate.startsWith("PLACEHOLDER:")) {
        console.warn(`Stage ${stageName} heeft nog geen custom prompt, gebruik fallback`);
        return this.getFallbackPromptResult(stageName, variables);
      }

      // Replace variables in prompt template
      let processedPrompt = promptTemplate;
      for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{{${key}}}`;
        processedPrompt = processedPrompt.replace(new RegExp(placeholder, 'g'), String(value));
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        config: {
          temperature: 0.1,
        },
        contents: processedPrompt,
      });

      const result = response.text || "";
      
      if (!result) {
        throw new Error(`Geen response van AI voor stage ${stageName}`);
      }

      console.log(`Stage ${stageName} completed successfully`);
      return result;

    } catch (error) {
      console.error(`Error in stage ${stageName}:`, error);
      
      // Fallback to basic generation for this stage
      console.log(`Using fallback for stage ${stageName}`);
      return this.getFallbackPromptResult(stageName, variables);
    }
  }

  private getFallbackPromptResult(stageName: string, variables: Record<string, any>): string {
    // Temporary fallback until user loads custom prompts
    switch (stageName) {
      case "1_informatiecheck":
        return "Dossier informatie geverifieerd en gevalideerd.";
      
      case "2_complexiteitscheck":
        return "Complexiteit van de fiscale situatie geanalyseerd.";
      
      case "3_generatie":
        return this.generateBasicReport(variables);
        
      default:
        if (variables.rapport) {
          return variables.rapport;
        }
        return "Stage resultaat nog niet beschikbaar - configureer custom prompts.";
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
            Het rapport is gegenereerd met placeholder prompts - configureer de volledige prompt set via instellingen voor complete functionaliteit.
          </p>
        </div>
        
        <div class="space-y-4">
          <h2 class="text-xl font-semibold">Klant Informatie</h2>
          <p>Naam: ${dossierData.klant?.naam || 'Onbekend'}</p>
          <p>Situatie: ${dossierData.klant?.situatie || 'Niet gespecificeerd'}</p>
        </div>
        
        <div class="text-xs text-muted-foreground border-t pt-4">
          <p><strong>Disclaimer:</strong> Dit rapport is gegenereerd met basis templates. Voor volledige functionaliteit, configureer alle 11 prompts via de instellingen.</p>
        </div>
      </div>
    `;
  }
}