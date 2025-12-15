import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, ChevronDown, ChevronUp, Edit3, Lightbulb } from "lucide-react";
import type { BouwplanData, BouwplanThema, BouwplanRisico, BouwplanSectie } from "@shared/schema";
import { parseBouwplanData } from "@/lib/workflowParsers";
import { DenkwijzeSummary } from "./DenkwijzeSummary";

// Helper functions to extract text from union types
function getThemaText(thema: BouwplanThema): string {
  return typeof thema === 'string' ? thema : thema.thema;
}

function getThemaReden(thema: BouwplanThema): string | undefined {
  return typeof thema === 'string' ? undefined : thema.reden;
}

function getRisicoText(risico: BouwplanRisico): string {
  return typeof risico === 'string' ? risico : risico.risico;
}

function getRisicoReden(risico: BouwplanRisico): string | undefined {
  return typeof risico === 'string' ? undefined : risico.reden;
}

function getRisicoErnst(risico: BouwplanRisico): string | undefined {
  return typeof risico === 'string' ? undefined : risico.ernst;
}

interface ComplexiteitsCheckViewerProps {
  /** Raw AI output from Stage 2 (Complexiteitscheck) */
  rawOutput: string;
  /** Callback when user edits the bouwplan JSON */
  onEditedBouwplan?: (editedBouwplan: BouwplanData) => void;
  /** Summary from Stage 1 (samenvatting_onderwerp) */
  samenvatting?: string;
}

/**
 * Displays structured output for Stage 2 (Complexiteitscheck/Bouwplan)
 * Shows:
 * - Detected fiscal themes
 * - Identified risks
 * - Proposed report structure
 * - Ability to edit the bouwplan JSON manually
 */
export function ComplexiteitsCheckViewer({
  rawOutput,
  onEditedBouwplan,
  samenvatting
}: ComplexiteitsCheckViewerProps) {
  const [showRawJson, setShowRawJson] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedJson, setEditedJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const parsedOutput = parseBouwplanData(rawOutput);

  if (!parsedOutput) {
    // Fallback: show raw output if parsing fails
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <p className="font-semibold mb-2">Fout bij het parsen van de complexiteitscheck output</p>
          <p className="text-xs mb-3">De AI heeft geen geldig JSON formaat geretourneerd. Hieronder de ruwe output:</p>
          <pre className="whitespace-pre-wrap break-all text-xs bg-black/10 p-3 rounded mt-2 max-h-[400px] overflow-y-auto" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
            {rawOutput}
          </pre>
        </AlertDescription>
      </Alert>
    );
  }

  // Initialize edited JSON on first edit
  const handleStartEditing = () => {
    setEditedJson(JSON.stringify(parsedOutput, null, 2));
    setIsEditing(true);
    setJsonError(null);
  };

  // Save edited JSON
  const handleSaveEdit = () => {
    try {
      const parsed = JSON.parse(editedJson);
      setJsonError(null);
      setIsEditing(false);

      // Notify parent about the edited bouwplan
      if (onEditedBouwplan) {
        onEditedBouwplan(parsed as BouwplanData);
      }
    } catch (error) {
      setJsonError("Ongeldige JSON. Controleer de syntax.");
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setJsonError(null);
  };

  // Use edited version if available, otherwise use parsed
  const displayData = isEditing ? parsedOutput : parsedOutput;

  // Check if we have any reasoning data
  const hasReasoning = !!(
    displayData.denkwijze_samenvatting ||
    displayData.fiscale_kernthemas?.some(t => typeof t === 'object' && t.reden) ||
    displayData.geidentificeerde_risicos?.some(r => typeof r === 'object' && r.reden)
  );

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
        <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
        <div className="flex-1">
          <h3 className="font-semibold text-green-900 dark:text-green-100">
            Stap 2: Bouwplan Akkoord?
          </h3>
          <p className="text-sm text-green-700 dark:text-green-300 mt-1">
            De AI heeft het dossier geanalyseerd en een bouwplan voor het rapport opgesteld.
            Controleer hieronder het plan. Als het plan klopt, kunt u de AI het volledige rapport laten schrijven (Stap 3).
          </p>
        </div>
      </div>

      {/* AI Denkwijze Summary - NEW */}
      <DenkwijzeSummary
        stageName="Complexiteitscheck"
        samenvatting={displayData.denkwijze_samenvatting}
        isLegacyData={!hasReasoning}
      />

      {/* Bouwplan Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Samenvatting Bouwplan</CardTitle>
          <CardDescription>
            Gedetecteerde thema's, risico's en voorgestelde structuur
          </CardDescription>
        </CardHeader>
          <CardContent className="space-y-6">
            {/* Samenvatting Onderwerp (from Stage 1) */}
            {samenvatting && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Hoofdvraag / Onderwerp
                </h4>
                <blockquote className="border-l-4 border-primary pl-4 py-2 italic text-sm bg-muted/30">
                  "{samenvatting}"
                </blockquote>
              </div>
            )}

            {/* Fiscale Kernthema's - with inline reasoning */}
            {displayData.fiscale_kernthemas && displayData.fiscale_kernthemas.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Gedetecteerde Kernthema's
                </h4>
                <ul className="space-y-3">
                  {displayData.fiscale_kernthemas.map((thema, idx) => {
                    const text = getThemaText(thema);
                    const reden = getThemaReden(thema);
                    return (
                      <li key={idx} className="border-l-2 border-blue-200 dark:border-blue-800 pl-3">
                        <div className="flex items-start gap-2 text-sm">
                          <Badge variant="outline" className="mt-0.5 shrink-0">
                            {idx + 1}
                          </Badge>
                          <span className="font-medium">{text}</span>
                        </div>
                        {reden && (
                          <p className="mt-1 ml-8 text-xs text-muted-foreground flex items-start gap-1.5">
                            <Lightbulb className="h-3 w-3 mt-0.5 shrink-0 text-purple-500" />
                            <span className="italic">{reden}</span>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Geïdentificeerde Risico's - with inline reasoning */}
            {displayData.geidentificeerde_risicos && displayData.geidentificeerde_risicos.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Geïdentificeerde Risico's
                </h4>
                <ul className="space-y-3">
                  {displayData.geidentificeerde_risicos.map((risico, idx) => {
                    const text = getRisicoText(risico);
                    const reden = getRisicoReden(risico);
                    const ernst = getRisicoErnst(risico);
                    return (
                      <li key={idx} className="border-l-2 border-orange-200 dark:border-orange-800 pl-3">
                        <div className="flex items-start gap-2 text-sm">
                          <Badge
                            variant="destructive"
                            className={`mt-0.5 shrink-0 ${
                              ernst === 'hoog' ? 'bg-red-600' :
                              ernst === 'middel' ? 'bg-orange-500' :
                              ernst === 'laag' ? 'bg-yellow-500' : ''
                            }`}
                          >
                            {ernst ? ernst.charAt(0).toUpperCase() : '⚠️'}
                          </Badge>
                          <span className="font-medium">{text}</span>
                        </div>
                        {reden && (
                          <p className="mt-1 ml-8 text-xs text-muted-foreground flex items-start gap-1.5">
                            <Lightbulb className="h-3 w-3 mt-0.5 shrink-0 text-purple-500" />
                            <span className="italic">{reden}</span>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Voorgestelde Rapportstructuur - with inline reasoning */}
            {displayData.bouwplan_voor_rapport && Object.keys(displayData.bouwplan_voor_rapport).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Voorgestelde Rapportstructuur
                </h4>
                <ol className="space-y-3">
                  {Object.entries(displayData.bouwplan_voor_rapport).map(([key, sectie], idx) => (
                    <li key={key} className="border-l-2 border-gray-200 dark:border-gray-700 pl-3">
                      <div className="flex items-start gap-2 text-sm">
                        <Badge variant="secondary" className="mt-0.5 shrink-0 text-xs">
                          {idx + 1}
                        </Badge>
                        <span className="font-medium">{sectie.koptekst}</span>
                      </div>
                      {sectie.reden_inclusie && (
                        <p className="mt-1 ml-8 text-xs text-muted-foreground flex items-start gap-1.5">
                          <Lightbulb className="h-3 w-3 mt-0.5 shrink-0 text-purple-500" />
                          <span className="italic">{sectie.reden_inclusie}</span>
                        </p>
                      )}
                      {sectie.subdoelen && sectie.subdoelen.length > 0 && (
                        <ul className="ml-8 mt-2 space-y-1 list-disc list-inside text-xs text-muted-foreground">
                          {sectie.subdoelen.map((subdoel, subIdx) => (
                            <li key={subIdx}>{subdoel}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </CardContent>
        </Card>

      {/* Smart Edit Option */}
      <Card className="border-dashed">
        <CardContent className="pt-4">
          <button
            onClick={() => !isEditing && handleStartEditing()}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {isEditing ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            <Edit3 className="h-4 w-4" />
            <span className="font-medium">Geavanceerd: Bewerk ruwe Bouwplan-JSON</span>
          </button>

          {isEditing && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Als de AI iets is vergeten (bijv. "Risico 4"), voeg het hieronder toe aan de JSON.
                De wijzigingen worden direct doorgevoerd naar Stap 3.
              </p>

              <Textarea
                value={editedJson}
                onChange={(e) => setEditedJson(e.target.value)}
                className="font-mono text-xs h-[400px] resize-none"
                placeholder="Bewerk de JSON hier..."
              />

              {jsonError && (
                <Alert variant="destructive">
                  <AlertDescription className="text-xs">
                    {jsonError}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveEdit}
                  className="flex-1"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Wijzigingen Opslaan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCancelEdit}
                  className="flex-1"
                >
                  Annuleren
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Next Step Info */}
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription>
          Het bouwplan is akkoord en klaar voor de volgende stap.
          <strong> Gebruik de navigatie hierboven om naar Stap 3 (Generatie) te gaan wanneer je klaar bent.</strong>
        </AlertDescription>
      </Alert>

      {/* Raw JSON Toggle (for transparency) */}
      <Card className="border-dashed">
        <CardContent className="pt-4">
          <button
            onClick={() => setShowRawJson(!showRawJson)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {showRawJson ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            <span className="font-medium">Transparantie: {showRawJson ? 'Verberg' : 'Toon'} originele AI output</span>
          </button>

          {showRawJson && (
            <div className="mt-3">
              <pre className="p-4 bg-muted rounded-lg text-xs overflow-x-auto max-h-[400px] overflow-y-auto">
                <code>{JSON.stringify(parsedOutput, null, 2)}</code>
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
