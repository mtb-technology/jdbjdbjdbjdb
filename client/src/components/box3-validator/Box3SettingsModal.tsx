import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RotateCcw, Info, Calculator, FileInput, RefreshCw, Mail } from "lucide-react";
import {
  FORFAITAIRE_RENDEMENTEN,
  BOX3_TARIEVEN,
} from "@/constants/box3.constants";

// =============================================================================
// DEFAULT PROMPTS
// =============================================================================

/**
 * INTAKE PROMPT - For new dossiers and initial document uploads
 * Focuses on identifying all documents, detecting years, and initial categorization
 * NOTE: No email generation - that's handled separately via the email endpoint
 */
export const DEFAULT_INTAKE_PROMPT = `Je bent een fiscaal specialist die documenten voor Box 3 bezwaarprocedures analyseert.

## Context
Een klant stuurt documenten aan voor een Box 3 bezwaarprocedure. Dit kunnen documenten zijn voor één of MEERDERE belastingjaren (2017-2024).

## De 5 documentcategorieën per belastingjaar:
1. **aangifte_ib** - Aangifte inkomstenbelasting van dat jaar
2. **bankrekeningen** - Rente-overzichten, jaaropgaves van banken
3. **beleggingen** - Begin/eindstand, dividend, aan/verkopen
4. **vastgoed** - WOZ-waarde (T+1), evt. huurinkomsten
5. **schulden** - Schulden en betaalde rente

## Jouw taak - INTAKE ANALYSE
Analyseer ALLE input (mail tekst + ELKE bijlage via vision) en:

1. **Identificeer alle belastingjaren** die in de documenten voorkomen
2. **Analyseer ELKE bijlage apart** - bepaal type en belastingjaar
3. **Extraheer kerncijfers** uit aangiftes:
   - Box 3 belastbaar inkomen (na drempel)
   - Box 3 belasting bedrag
   - Rendementsgrondslag
   - Totaal bezittingen/schulden
4. **Bepaal status per jaar** per documentcategorie

## BELANGRIJK voor afbeeldingen:
- Bekijk ELKE afbeelding zorgvuldig via vision
- Zoek naar jaarcijfers, data, bedragen
- Let op: foto's van brieven, schermafdrukken, scans
- Geef in samenvatting aan wat je ZIET in de afbeelding

## Output formaat (STRIKT JSON)
\`\`\`json
{
  "gedetecteerde_jaren": ["2022", "2023"],
  "bijlage_analyse": [
    {
      "bestandsnaam": "image_1.jpg",
      "document_type": "aangifte_ib|bankrekeningen|beleggingen|vastgoed|schulden|overig|onleesbaar",
      "belastingjaar": 2023,
      "samenvatting": "Wat zie je in dit document? Beschrijf kort de inhoud.",
      "geextraheerde_waarden": {
        "box_3_belastbaar_inkomen": 12345,
        "box_3_belasting_bedrag": 456,
        "rendementsgrondslag": 78900,
        "totaal_bezittingen": 100000,
        "totaal_schulden": 5000,
        "ontvangen_rente": 150,
        "ontvangen_dividend": 500
      }
    }
  ],
  "per_jaar_status": {
    "2023": {
      "aangifte_ib": { "status": "compleet|onvolledig|ontbreekt", "feedback": "..." },
      "bankrekeningen": { "status": "compleet|onvolledig|ontbreekt|n.v.t.", "feedback": "..." },
      "beleggingen": { "status": "compleet|onvolledig|ontbreekt|n.v.t.", "feedback": "..." },
      "vastgoed": { "status": "compleet|onvolledig|ontbreekt|n.v.t.", "feedback": "..." },
      "schulden": { "status": "compleet|onvolledig|ontbreekt|n.v.t.", "feedback": "..." }
    }
  },
  "gevonden_data": {
    "algemeen": {
      "belastingjaar": "2023",
      "fiscale_partner": true
    },
    "fiscus_box3": {
      "belastbaar_inkomen_na_drempel": 12345,
      "betaalde_belasting": 456,
      "rendementsgrondslag": 78900,
      "totaal_bezittingen_bruto": 100000
    }
  },
  "global_status": "compleet|onvolledig|actie_vereist"
}
\`\`\`

## Let op:
- Analyseer ELKE bijlage, ook als bestandsnaam nietszeggend is (image_1.jpg etc)
- Als je een jaar niet kunt bepalen, gebruik dan de context uit de mail of andere documenten
- Bij meerdere jaren: maak voor ELK jaar een aparte entry in per_jaar_status
- geextraheerde_waarden: alleen invullen wat je ECHT ziet, niet raden`;

/**
 * YEAR VALIDATION PROMPT - For revalidating a specific year
 * Focuses on deep analysis of one year with complete kansrijkheid calculation
 */
export const DEFAULT_YEAR_VALIDATION_PROMPT = `Je bent een fiscaal specialist die documenten voor Box 3 bezwaar zaken valideert.

## Context
Je valideert documenten voor een SPECIFIEK belastingjaar. Focus alleen op dit jaar.

## Benodigde documenten (5 categorieën):
1. **Aangifte inkomstenbelasting** - De volledige aangifte
2. **Bankrekeningen** - Daadwerkelijk ontvangen rente + eventuele valutaresultaten
3. **Beleggingen**:
   - Beginstand (1 januari)
   - Eindstand (31 december)
   - Stortingen/onttrekkingen
   - Ontvangen dividenden
4. **Vastgoed & overige bezittingen** - WOZ-waarde op 1 januari T+1, evt. huurinkomsten
5. **Schulden** - Overzicht + betaalde rente

## Jouw taak - JAAR VALIDATIE
Analyseer de documenten en bepaal:

1. **Per categorie**:
   - status: "compleet" | "onvolledig" | "ontbreekt" | "n.v.t."
   - feedback: Wat je gevonden hebt of wat er mist
   - gevonden_in: Welke documenten

2. **Extraheer ALLE relevante waarden** voor kansrijkheid berekening:
   - Uit aangifte: belastbaar inkomen, betaalde belasting, rendementsgrondslag
   - Uit bankafschriften: werkelijk ontvangen rente
   - Uit beleggingsoverzicht: begin/eindwaarde, dividend, mutaties
   - Uit schulden: betaalde rente

3. **Beoordeel global_status**: "compleet" | "actie_vereist" | "onvolledig"

## Output formaat (STRIKT JSON)
\`\`\`json
{
  "belastingjaar": "2023",
  "global_status": "actie_vereist",
  "document_validatie": {
    "aangifte_ib": "compleet",
    "bank": "onvolledig",
    "beleggingen": "compleet",
    "vastgoed": "n.v.t.",
    "schulden": "ontbreekt"
  },
  "validatie": {
    "aangifte_ib": {
      "status": "compleet",
      "feedback": "Volledige aangifte gevonden met alle Box 3 gegevens",
      "gevonden_in": ["aangifte_2023.pdf"]
    },
    "bankrekeningen": {
      "status": "onvolledig",
      "feedback": "Saldo gevonden maar rente-overzicht ontbreekt",
      "gevonden_in": ["bankafschrift.pdf"]
    }
  },
  "gevonden_data": {
    "algemeen": {
      "belastingjaar": 2023
    },
    "fiscus_box3": {
      "belastbaar_inkomen_na_drempel": 1234,
      "betaalde_belasting": 456,
      "rendementsgrondslag": 78900
    },
    "werkelijk_rendement_input": {
      "bank_rente_ontvangen": 150,
      "beleggingen_waarde_1jan": 50000,
      "beleggingen_waarde_31dec": 52000,
      "beleggingen_dividend": 800,
      "beleggingen_mutaties_gevonden": true,
      "schulden_rente_betaald": null
    }
  },
  "bijlage_analyse": [
    {
      "bestandsnaam": "aangifte_2023.pdf",
      "document_type": "aangifte_ib",
      "belastingjaar": 2023,
      "samenvatting": "Volledige aangifte IB 2023",
      "geextraheerde_waarden": {}
    }
  ],
  "draft_mail": {
    "onderwerp": "Re: Box 3 bezwaar 2023 - Ontbrekende documenten",
    "body": "Geachte heer/mevrouw,\\n\\n..."
  }
}
\`\`\``;

/**
 * EMAIL GENERATION PROMPT - For generating follow-up emails
 * Focuses on clear, professional communication about missing documents
 */
export const DEFAULT_EMAIL_PROMPT = `Je bent een ervaren fiscalist die professionele e-mails schrijft voor Box 3 bezwaarprocedures.

## Context
Je schrijft een e-mail naar een klant over de status van hun Box 3 bezwaardossier.

## E-mail richtlijnen:
- **Toon**: Professioneel maar vriendelijk
- **Structuur**: Duidelijke alinea's met logische opbouw
- **Compleetheid**: Benoem specifiek wat ontvangen is en wat ontbreekt
- **Actie**: Geef duidelijk aan welke actie de klant moet ondernemen

## E-mail onderdelen:
1. **Opening**: Bedank voor aangeleverde documenten
2. **Overzicht per jaar**: Wat is compleet, wat ontbreekt
3. **Specifieke verzoeken**: Welke documenten nog nodig zijn
4. **Uitleg**: Waarom deze documenten belangrijk zijn voor de zaak
5. **Afsluiting**: Volgende stappen en contactmogelijkheid

## Output formaat (STRIKT JSON)
\`\`\`json
{
  "onderwerp": "Box 3 bezwaar [jaren] - Status en verzoek aanvullende documenten",
  "body": "Geachte heer/mevrouw [Naam],\\n\\nHartelijk dank voor het aanleveren van de documenten voor uw Box 3 bezwaarprocedure.\\n\\n**Ontvangen en compleet:**\\n- ...\\n\\n**Nog benodigd:**\\n- ...\\n\\nMet vriendelijke groet,\\n[Naam]"
}
\`\`\``;

// Legacy export for backwards compatibility
export const DEFAULT_BOX3_SYSTEM_PROMPT = DEFAULT_INTAKE_PROMPT;

// =============================================================================
// TYPES
// =============================================================================

export interface Box3Prompts {
  intake: string;
  yearValidation: string;
  email: string;
}

interface Box3SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompts: Box3Prompts;
  onPromptsChange: (prompts: Box3Prompts) => void;
  // Legacy support
  systemPrompt?: string;
  onSystemPromptChange?: (prompt: string) => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function Box3SettingsModal({
  open,
  onOpenChange,
  prompts,
  onPromptsChange,
  // Legacy props - if provided, use them for backwards compatibility
  systemPrompt,
  onSystemPromptChange,
}: Box3SettingsModalProps) {
  // If using legacy props, convert to new format
  const effectivePrompts: Box3Prompts = prompts || {
    intake: systemPrompt || DEFAULT_INTAKE_PROMPT,
    yearValidation: DEFAULT_YEAR_VALIDATION_PROMPT,
    email: DEFAULT_EMAIL_PROMPT,
  };

  const [localPrompts, setLocalPrompts] = useState<Box3Prompts>(effectivePrompts);
  const [activeTab, setActiveTab] = useState("intake");

  useEffect(() => {
    if (prompts) {
      setLocalPrompts(prompts);
    } else if (systemPrompt) {
      setLocalPrompts((prev) => ({ ...prev, intake: systemPrompt }));
    }
  }, [prompts, systemPrompt]);

  const handleSave = () => {
    if (onPromptsChange) {
      onPromptsChange(localPrompts);
    }
    // Legacy support
    if (onSystemPromptChange && !onPromptsChange) {
      onSystemPromptChange(localPrompts.intake);
    }
    onOpenChange(false);
  };

  const handleReset = (promptType: keyof Box3Prompts) => {
    const defaults: Box3Prompts = {
      intake: DEFAULT_INTAKE_PROMPT,
      yearValidation: DEFAULT_YEAR_VALIDATION_PROMPT,
      email: DEFAULT_EMAIL_PROMPT,
    };
    setLocalPrompts((prev) => ({ ...prev, [promptType]: defaults[promptType] }));
  };

  const handleResetAll = () => {
    setLocalPrompts({
      intake: DEFAULT_INTAKE_PROMPT,
      yearValidation: DEFAULT_YEAR_VALIDATION_PROMPT,
      email: DEFAULT_EMAIL_PROMPT,
    });
  };

  const updatePrompt = (key: keyof Box3Prompts, value: string) => {
    setLocalPrompts((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Box 3 Validator Instellingen</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="intake" className="flex items-center gap-2">
              <FileInput className="h-4 w-4" />
              Intake
            </TabsTrigger>
            <TabsTrigger value="yearValidation" className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Jaar Validatie
            </TabsTrigger>
            <TabsTrigger value="email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              E-mail
            </TabsTrigger>
            <TabsTrigger value="reference" className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Referentie
            </TabsTrigger>
          </TabsList>

          {/* Intake Prompt Tab */}
          <TabsContent value="intake" className="space-y-4 mt-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="intake-prompt" className="text-base font-medium">
                    Intake Prompt
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Gebruikt bij het aanmaken van een nieuw dossier en initiële document uploads
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleReset("intake")}
                  className="h-8"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset
                </Button>
              </div>
              <Textarea
                id="intake-prompt"
                value={localPrompts.intake}
                onChange={(e) => updatePrompt("intake", e.target.value)}
                className="font-mono text-sm min-h-[400px]"
                placeholder="Voer de intake prompt in..."
              />
            </div>
          </TabsContent>

          {/* Year Validation Prompt Tab */}
          <TabsContent value="yearValidation" className="space-y-4 mt-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="year-validation-prompt" className="text-base font-medium">
                    Jaar Validatie Prompt
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Gebruikt bij hervalidatie van een specifiek belastingjaar
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleReset("yearValidation")}
                  className="h-8"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset
                </Button>
              </div>
              <Textarea
                id="year-validation-prompt"
                value={localPrompts.yearValidation}
                onChange={(e) => updatePrompt("yearValidation", e.target.value)}
                className="font-mono text-sm min-h-[400px]"
                placeholder="Voer de jaar validatie prompt in..."
              />
            </div>
          </TabsContent>

          {/* Email Prompt Tab */}
          <TabsContent value="email" className="space-y-4 mt-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="email-prompt" className="text-base font-medium">
                    E-mail Generatie Prompt
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Gebruikt voor het genereren van follow-up e-mails naar de klant
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleReset("email")}
                  className="h-8"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset
                </Button>
              </div>
              <Textarea
                id="email-prompt"
                value={localPrompts.email}
                onChange={(e) => updatePrompt("email", e.target.value)}
                className="font-mono text-sm min-h-[400px]"
                placeholder="Voer de e-mail prompt in..."
              />
            </div>
          </TabsContent>

          {/* Reference Tab - Forfaitaire Rendementen */}
          <TabsContent value="reference" className="space-y-4 mt-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-primary" />
                <Label className="text-base font-medium">Forfaitaire Rendementen per Belastingjaar</Label>
                <Badge variant="outline" className="text-xs">Read-only</Badge>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 font-medium">Jaar</th>
                      <th className="text-right py-2 px-2 font-medium">Spaargeld</th>
                      <th className="text-right py-2 px-2 font-medium">Beleggingen</th>
                      <th className="text-right py-2 px-2 font-medium">Schulden</th>
                      <th className="text-right py-2 px-2 font-medium">Box 3 Tarief</th>
                      <th className="text-right py-2 px-2 font-medium">Heffingsvrij</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(FORFAITAIRE_RENDEMENTEN)
                      .sort(([a], [b]) => Number(b) - Number(a))
                      .map(([jaar, data]) => (
                        <tr key={jaar} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="py-2 px-2 font-medium">{jaar}</td>
                          <td className="text-right py-2 px-2 text-muted-foreground">{data.spaargeld.toFixed(2)}%</td>
                          <td className="text-right py-2 px-2 text-muted-foreground">{data.beleggingen.toFixed(2)}%</td>
                          <td className="text-right py-2 px-2 text-muted-foreground">{data.schulden.toFixed(2)}%</td>
                          <td className="text-right py-2 px-2 text-muted-foreground">{((BOX3_TARIEVEN[jaar] || 0) * 100).toFixed(0)}%</td>
                          <td className="text-right py-2 px-2 text-muted-foreground">
                            €{data.heffingsvrijVermogen.toLocaleString("nl-NL")}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span>
                  Deze percentages worden door de Belastingdienst jaarlijks vastgesteld en worden automatisch
                  toegepast op basis van het gedetecteerde belastingjaar in de documenten.
                </span>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Actions */}
        <div className="flex justify-between items-center pt-4 border-t">
          <Button variant="ghost" size="sm" onClick={handleResetAll}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset alle prompts
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annuleren
            </Button>
            <Button onClick={handleSave}>
              Opslaan
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
