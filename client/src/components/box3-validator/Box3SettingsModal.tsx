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
import { RotateCcw, Info, Calculator } from "lucide-react";
import {
  FORFAITAIRE_RENDEMENTEN,
  BOX3_TARIEVEN,
} from "@/constants/box3.constants";

// Default Box 3 Validator System Prompt
export const DEFAULT_BOX3_SYSTEM_PROMPT = `Je bent een fiscaal specialist die documenten voor Box 3 bezwaar zaken valideert.

## Context
Een klant heeft een informatieverzoek ontvangen waarin de volgende 5 documentcategorieën worden gevraagd:

1. **Aangifte inkomstenbelasting** - De volledige aangifte van het betreffende belastingjaar
2. **Bankrekeningen** - Een overzicht van de daadwerkelijk ontvangen rente en eventuele valutaresultaten
3. **Beleggingen** - Een overzicht met:
   - Beginstand (1 januari)
   - Eindstand (31 december)
   - Eventuele stortingen/onttrekkingen
   - Ontvangen dividenden
4. **Vastgoed & overige bezittingen** - De WOZ-waarde op 1 januari van het jaar erna (T+1). Indien verhuurd: een overzicht van de huurinkomsten.
5. **Schulden** - Een overzicht van de schulden en de betaalde rente

## Jouw taak
Analyseer ALLE input (mail tekst + bijlages) en bepaal per categorie:
- **status**: "compleet" (alle benodigde info aanwezig), "onvolledig" (deels aanwezig), of "ontbreekt" (niet gevonden)
- **feedback**: Gedetailleerde uitleg wat je hebt gevonden of wat er mist
- **gevonden_in**: In welke document(en) je de informatie hebt gevonden

Detecteer ook het **belastingjaar** uit de documenten.

Genereer tot slot een **concept reactie-mail** waarin je:
- De klant bedankt voor de aangeleverde documenten
- Duidelijk aangeeft wat compleet is
- Specifiek benoemt wat er nog ontbreekt of onvolledig is
- Professioneel en vriendelijk communiceert

## Output formaat (STRIKT JSON)
Geef je antwoord als valide JSON in exact dit formaat:

\`\`\`json
{
  "belastingjaar": "2023",
  "validatie": {
    "aangifte_ib": {
      "status": "compleet|onvolledig|ontbreekt",
      "feedback": "Gedetailleerde uitleg...",
      "gevonden_in": ["document1.pdf", "mail tekst"]
    },
    "bankrekeningen": {
      "status": "compleet|onvolledig|ontbreekt",
      "feedback": "Gedetailleerde uitleg...",
      "gevonden_in": []
    },
    "beleggingen": {
      "status": "compleet|onvolledig|ontbreekt",
      "feedback": "Gedetailleerde uitleg...",
      "gevonden_in": []
    },
    "vastgoed": {
      "status": "compleet|onvolledig|ontbreekt",
      "feedback": "Gedetailleerde uitleg...",
      "gevonden_in": []
    },
    "schulden": {
      "status": "compleet|onvolledig|ontbreekt",
      "feedback": "Gedetailleerde uitleg...",
      "gevonden_in": []
    }
  },
  "concept_mail": {
    "onderwerp": "Re: Informatieverzoek Box 3 bezwaar [jaar]",
    "body": "Geachte heer/mevrouw,\\n\\nHartelijk dank voor..."
  }
}
\`\`\``;

interface Box3SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  systemPrompt: string;
  onSystemPromptChange: (prompt: string) => void;
}

export function Box3SettingsModal({
  open,
  onOpenChange,
  systemPrompt,
  onSystemPromptChange,
}: Box3SettingsModalProps) {
  const [localPrompt, setLocalPrompt] = useState(systemPrompt);

  useEffect(() => {
    setLocalPrompt(systemPrompt);
  }, [systemPrompt]);

  const handleSave = () => {
    onSystemPromptChange(localPrompt);
    onOpenChange(false);
  };

  const handleReset = () => {
    setLocalPrompt(DEFAULT_BOX3_SYSTEM_PROMPT);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Box 3 Validator Instellingen</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* System Prompt */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="system-prompt">Systeem Prompt (COG)</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="h-8"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset naar default
              </Button>
            </div>
            <Textarea
              id="system-prompt"
              value={localPrompt}
              onChange={(e) => setLocalPrompt(e.target.value)}
              className="font-mono text-sm min-h-[500px]"
              placeholder="Voer de systeem prompt in..."
            />
            <p className="text-xs text-muted-foreground">
              Deze prompt wordt naar Gemini 3 Pro gestuurd samen met de input van de gebruiker.
              De AI moet JSON teruggeven in het gespecificeerde formaat.
            </p>
          </div>

          {/* Forfaitaire Rendementen Tabel */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" />
              <Label>Forfaitaire Rendementen per Belastingjaar</Label>
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
                    .sort(([a], [b]) => Number(b) - Number(a)) // Nieuwste jaar eerst
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

          {/* Actions */}
          <div className="flex justify-end gap-2">
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
