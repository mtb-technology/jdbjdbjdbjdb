import type { DossierData, BouwplanData } from "@shared/schema";
import { SourceValidator } from "./source-validator";

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

    let reportContent = '';

    // Generate introduction if requested
    if (bouwplan.structuur.inleiding) {
      reportContent += this.generateInleiding(dossier);
    }

    // Generate knelpunten sections
    if (bouwplan.structuur.knelpunten.length > 0) {
      reportContent += this.generateKnelpunten(dossier, bouwplan.structuur.knelpunten);
    }

    // Generate scenario analysis if requested
    if (bouwplan.structuur.scenario_analyse) {
      reportContent += this.generateScenarioAnalyse(dossier);
    }

    // Generate vervolgstappen if requested
    if (bouwplan.structuur.vervolgstappen) {
      reportContent += this.generateVervolgstappen(dossier);
    }

    // Always add sources section
    reportContent += this.generateBronnenlijst();

    return reportContent;
  }

  private generateInleiding(dossier: DossierData): string {
    return `
      <section class="space-y-4">
        <h2 class="text-xl font-semibold text-foreground border-b border-border pb-2">
          <i class="fas fa-info-circle mr-2 text-primary"></i>
          Inleiding
        </h2>
        <div class="prose prose-sm max-w-none">
          <p class="text-muted-foreground leading-relaxed">
            Op basis van de door u verstrekte informatie analyseren wij de fiscale aspecten van uw situatie betreffende ${dossier.klant.situatie}. 
            Dit rapport identificeert de belangrijkste aandachtspunten en mogelijke fiscale gevolgen die kunnen optreden bij de voorgenomen transacties.
            Uw vermogenspositie van €${dossier.fiscale_gegevens.vermogen.toLocaleString('nl-NL')} en jaarlijkse inkomsten van 
            €${dossier.fiscale_gegevens.inkomsten.toLocaleString('nl-NL')} vormen de basis voor deze analyse.
          </p>
        </div>
      </section>
    `;
  }

  private generateKnelpunten(dossier: DossierData, knelpunten: string[]): string {
    let knelpuntenContent = `
      <section class="space-y-6">
        <h2 class="text-xl font-semibold text-foreground border-b border-border pb-2">
          <i class="fas fa-triangle-exclamation mr-2 text-destructive"></i>
          Geïdentificeerde Fiscale Knelpunten
        </h2>
    `;

    knelpunten.forEach((knelpunt, index) => {
      knelpuntenContent += this.generateKnelpuntSection(knelpunt, index + 1, dossier);
    });

    knelpuntenContent += '</section>';
    return knelpuntenContent;
  }

  private generateKnelpuntSection(knelpunt: string, index: number, dossier: DossierData): string {
    const knelpuntInfo = this.getKnelpuntInfo(knelpunt, dossier);
    
    return `
      <div class="bg-muted/50 rounded-lg p-5 space-y-4">
        <h3 class="font-semibold text-foreground">
          Knelpunt ${index}: ${knelpuntInfo.title}
        </h3>
        <div class="space-y-3">
          <p class="text-sm text-muted-foreground leading-relaxed">
            ${knelpuntInfo.description}
          </p>
          ${knelpuntInfo.toelichting ? `
            <div class="bg-background rounded-md p-3">
              <p class="text-xs text-muted-foreground">
                <i class="fas fa-lightbulb mr-1 text-accent"></i>
                <strong>Toelichting:</strong> ${knelpuntInfo.toelichting}
              </p>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private getKnelpuntInfo(knelpunt: string, dossier: DossierData): {
    title: string;
    description: string;
    toelichting?: string;
  } {
    switch (knelpunt.toLowerCase()) {
      case 'schenkbelasting':
        return {
          title: 'Schenkbelasting bij vermogensoverdracht',
          description: `Bij de overdracht van vermogen tussen (ex-)echtgenoten kan schenkbelasting verschuldigd worden indien de overdracht wordt aangemerkt als een schenking. Het huidige tarief bedraagt 20% over het meerdere boven de vrijstelling van €6.604 (2024) <span class="text-primary font-medium">[Bron 1]</span>.`,
          toelichting: `Een mogelijk scenario is dat de vermogensoverdracht kwalificeert onder de echtscheidingsvrijstelling, waardoor geen schenkbelasting verschuldigd zou zijn <span class="text-primary font-medium">[Bron 2]</span>.`
        };
      case 'vermogensoverdracht':
        return {
          title: 'Inkomstenbelasting gevolgen vermogensoverdracht',
          description: `De overdracht van bepaalde vermogensbestanddelen kan leiden tot een belastbare gebeurtenis in box 1 of box 3 van de inkomstenbelasting. Dit risico bestaat met name bij de overdracht van ondernemingsvermogen of beleggingen <span class="text-primary font-medium">[Bron 3]</span>.`
        };
      case 'erfbelasting':
        return {
          title: 'Erfbelasting bij overlijden',
          description: `Bij overlijden van een der echtgenoten kan erfbelasting verschuldigd worden over het nagelaten vermogen. De vrijstelling voor de langstlevende echtgenoot bedraagt €700.000 (2024) <span class="text-primary font-medium">[Bron 1]</span>.`
        };
      default:
        return {
          title: `Fiscaal knelpunt: ${knelpunt}`,
          description: `Dit knelpunt vereist nadere analyse in uw specifieke situatie. Het kan leiden tot onverwachte fiscale gevolgen indien niet tijdig wordt gehandeld <span class="text-primary font-medium">[Bron 1]</span>.`
        };
    }
  }

  private generateScenarioAnalyse(dossier: DossierData): string {
    return `
      <section class="space-y-4">
        <h2 class="text-xl font-semibold text-foreground border-b border-border pb-2">
          <i class="fas fa-chart-bar mr-2 text-primary"></i>
          Scenario Analyse
        </h2>
        
        <div class="overflow-hidden">
          <table class="min-w-full divide-y divide-border">
            <thead class="bg-muted">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Scenario</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Fiscale Gevolgen</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Risico</th>
              </tr>
            </thead>
            <tbody class="bg-background divide-y divide-border">
              <tr>
                <td class="px-4 py-3 text-sm text-foreground">Directe overdracht</td>
                <td class="px-4 py-3 text-sm text-muted-foreground">Mogelijk schenkbelasting verschuldigd</td>
                <td class="px-4 py-3">
                  <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                    Hoog
                  </span>
                </td>
              </tr>
              <tr>
                <td class="px-4 py-3 text-sm text-foreground">Gestructureerde overdracht</td>
                <td class="px-4 py-3 text-sm text-muted-foreground">Gebruik echtscheidingsvrijstelling</td>
                <td class="px-4 py-3">
                  <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Laag
                  </span>
                </td>
              </tr>
              <tr>
                <td class="px-4 py-3 text-sm text-foreground">Gefaseerde aanpak</td>
                <td class="px-4 py-3 text-sm text-muted-foreground">Optimaal gebruik van vrijstellingen</td>
                <td class="px-4 py-3">
                  <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    Gemiddeld
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  private generateVervolgstappen(dossier: DossierData): string {
    const vervolgstappen = [
      {
        title: 'Juridische structuur bepalen',
        description: 'Vaststellen of de overdracht kwalificeert voor de echtscheidingsvrijstelling'
      },
      {
        title: 'Timing optimaliseren', 
        description: 'Bepalen van het optimale moment voor de vermogensoverdracht'
      },
      {
        title: 'Documentatie voorbereiden',
        description: 'Opstellen van de benodigde juridische documenten voor de overdracht'
      },
      {
        title: 'Aangifte voorbereiden',
        description: 'Documentatie en aangifte schenkbelasting indien van toepassing'
      }
    ];

    let vervolgstappenContent = `
      <section class="space-y-4">
        <h2 class="text-xl font-semibold text-foreground border-b border-border pb-2">
          <i class="fas fa-arrow-right mr-2 text-primary"></i>
          Aanbevolen Vervolgstappen
        </h2>
        
        <div class="space-y-3">
    `;

    vervolgstappen.forEach((stap, index) => {
      vervolgstappenContent += `
        <div class="flex items-start space-x-3">
          <div class="flex-shrink-0 w-6 h-6 bg-primary rounded-full flex items-center justify-center mt-0.5">
            <span class="text-xs font-medium text-primary-foreground">${index + 1}</span>
          </div>
          <div>
            <p class="text-sm font-medium text-foreground">${stap.title}</p>
            <p class="text-sm text-muted-foreground">${stap.description}</p>
          </div>
        </div>
      `;
    });

    vervolgstappenContent += `
        </div>
      </section>
    `;

    return vervolgstappenContent;
  }

  private generateBronnenlijst(): string {
    const bronnen = [
      {
        title: 'Tarieven schenkbelasting 2024',
        url: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/vermogen_en_aanmerkelijk_belang/schenk_en_erfbelasting/tarieven'
      },
      {
        title: 'Echtscheidingsvrijstelling vermogensoverdracht',
        url: 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/vermogen_en_aanmerkelijk_belang/schenk_en_erfbelasting/schenkbelasting/vrijstellingen_schenkbelasting'
      },
      {
        title: 'Inkomstenbelasting bij vermogensoverdracht',
        url: 'https://wetten.overheid.nl/BWBR0011353/2024-01-01'
      }
    ];

    let bronnenContent = `
      <section class="space-y-4">
        <h2 class="text-xl font-semibold text-foreground border-b border-border pb-2">
          <i class="fas fa-book mr-2 text-primary"></i>
          Geraadpleegde Bronnen
        </h2>
        
        <div class="space-y-2 text-sm">
    `;

    bronnen.forEach((bron, index) => {
      bronnenContent += `
        <div class="flex items-start space-x-3">
          <span class="flex-shrink-0 w-8 h-6 bg-secondary rounded text-xs font-medium flex items-center justify-center text-secondary-foreground">[${index + 1}]</span>
          <div>
            <p class="text-muted-foreground">${bron.title}</p>
            <a href="${bron.url}" class="text-primary hover:underline text-xs" target="_blank" rel="noopener noreferrer">${bron.url}</a>
          </div>
        </div>
      `;
    });

    bronnenContent += `
        </div>
      </section>
    `;

    return bronnenContent;
  }
}
