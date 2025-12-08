/**
 * KansrijkheidAnalyse Component
 *
 * Displays profitability analysis for Box 3 claims.
 */

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Calculator,
  AlertTriangle,
  Info,
} from "lucide-react";
import {
  berekenKansrijkheid,
  getForfaitaireRendementen,
  formatCurrency,
} from "@/utils/box3Utils";
import type { Box3ValidationResult, Box3ManualOverrides } from "@shared/schema";

interface KansrijkheidAnalyseProps {
  validationResult: Box3ValidationResult;
  belastingjaar: string | undefined;
  manualOverrides?: Box3ManualOverrides | null;
}

/**
 * Extract key figures from bijlage_analyse geextraheerde_waarden
 * Only extracts values that match the specified belastingjaar
 */
function extractKerncijfers(validationResult: Box3ValidationResult, belastingjaar: string | undefined) {
  const kerncijfers: {
    belastingBedrag: number | null;
    belastbaarInkomen: number | null;
    rendementsgrondslag: number | null;
    totaalBezittingen: number | null;
  } = {
    belastingBedrag: null,
    belastbaarInkomen: null,
    rendementsgrondslag: null,
    totaalBezittingen: null,
  };

  // Check if validationResult's belastingjaar matches the requested year
  // This handles per-year validationResults in multi-year dossiers
  const resultJaar = validationResult.gevonden_data?.algemeen?.belastingjaar || validationResult.belastingjaar;
  const resultJaarStr = resultJaar ? String(resultJaar) : null;

  // Only use fiscus_box3 data if the validation result is for this specific year
  // or if no year filter is specified
  const fiscus = validationResult.gevonden_data?.fiscus_box3;
  if (fiscus && (!belastingjaar || resultJaarStr === belastingjaar)) {
    kerncijfers.belastbaarInkomen = fiscus.belastbaar_inkomen_na_drempel ?? null;
    kerncijfers.totaalBezittingen = fiscus.totaal_bezittingen_bruto ?? null;
  }

  // Look through bijlage_analyse for additional values
  // STRICT filtering: only include entries that explicitly match the year
  const analyseArray = validationResult.bijlage_analyse || [];
  for (const analyse of analyseArray) {
    // If we have a year filter, ONLY include entries that match
    if (belastingjaar) {
      // Skip entries without a year OR with a different year
      if (!analyse.belastingjaar || String(analyse.belastingjaar) !== belastingjaar) {
        continue;
      }
    }

    const waarden = analyse.geextraheerde_waarden;
    if (!waarden) continue;

    // Look for Box 3 belasting bedrag
    for (const [key, value] of Object.entries(waarden)) {
      const keyLower = key.toLowerCase();
      if (typeof value === 'number') {
        if (keyLower.includes('box 3 belasting') && keyLower.includes('bedrag')) {
          kerncijfers.belastingBedrag = value;
        } else if (keyLower.includes('box 3 belastbaar inkomen') || keyLower.includes('belastbaar inkomen')) {
          if (kerncijfers.belastbaarInkomen === null) {
            kerncijfers.belastbaarInkomen = value;
          }
        } else if (keyLower.includes('rendementsgrondslag')) {
          kerncijfers.rendementsgrondslag = value;
        }
      }
    }
  }

  return kerncijfers;
}

export const KansrijkheidAnalyse = memo(function KansrijkheidAnalyse({
  validationResult,
  belastingjaar,
  manualOverrides,
}: KansrijkheidAnalyseProps) {
  const kansrijkheid = berekenKansrijkheid(validationResult, belastingjaar, manualOverrides);
  const heeftBerekening = kansrijkheid.werkelijkRendement !== null;
  const forfaitair = getForfaitaireRendementen(belastingjaar);

  // Extract key figures even when full calculation isn't possible
  const kerncijfers = extractKerncijfers(validationResult, belastingjaar);

  return (
    <Card
      className={`border-2 ${
        kansrijkheid.isKansrijk === true
          ? "border-green-500 bg-green-500/5"
          : kansrijkheid.isKansrijk === false
            ? "border-orange-500 bg-orange-500/5"
            : "border-muted"
      }`}
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span>Kansrijkheid Analyse</span>
            {kansrijkheid.isKansrijk === true && (
              <Badge className="bg-green-500 hover:bg-green-600">
                <TrendingUp className="h-3 w-3 mr-1" />
                Kansrijk
              </Badge>
            )}
            {kansrijkheid.isKansrijk === false && (
              <Badge className="bg-orange-500 hover:bg-orange-600">
                <TrendingDown className="h-3 w-3 mr-1" />
                Mogelijk niet kansrijk
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rendement Comparison */}
        {heeftBerekening ? (
          <div className="grid md:grid-cols-3 gap-4">
            {/* Werkelijk Rendement */}
            <div className="bg-muted/30 rounded-lg p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">
                Werkelijk Rendement
              </p>
              <p
                className={`text-2xl font-bold ${
                  kansrijkheid.werkelijkRendement! < 0
                    ? "text-red-500"
                    : "text-foreground"
                }`}
              >
                {formatCurrency(kansrijkheid.werkelijkRendement)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                (rente + dividend + koersresultaat)
              </p>
            </div>

            {/* Forfaitair Rendement */}
            <div className="bg-muted/30 rounded-lg p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">
                Forfaitair Rendement
              </p>
              {kansrijkheid.forfaitairRendement !== null ? (
                <p className="text-2xl font-bold">
                  {formatCurrency(kansrijkheid.forfaitairRendement)}
                </p>
              ) : (
                <p className="text-lg text-muted-foreground">—</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                (uit aangifte IB)
              </p>
            </div>

            {/* Indicatieve Teruggave */}
            <div
              className={`rounded-lg p-4 text-center ${
                kansrijkheid.isKansrijk ? "bg-green-500/10" : "bg-muted/30"
              }`}
            >
              <p className="text-xs text-muted-foreground mb-1">
                Indicatieve Teruggave
              </p>
              {kansrijkheid.indicatieveTeruggave !== null ? (
                <p
                  className={`text-2xl font-bold ${
                    kansrijkheid.indicatieveTeruggave > 0
                      ? "text-green-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {formatCurrency(kansrijkheid.indicatieveTeruggave)}
                </p>
              ) : (
                <p className="text-lg text-muted-foreground">—</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                (verschil ×{" "}
                {(kansrijkheid.gebruiktTarief * 100).toFixed(0)}% box 3
                tarief)
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Show key figures from documents even without full calculation */}
            {(kerncijfers.belastingBedrag !== null ||
              kerncijfers.belastbaarInkomen !== null ||
              kerncijfers.rendementsgrondslag !== null) ? (
              <>
                <div className="bg-muted/30 rounded-lg p-4 text-center mb-4">
                  <Info className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Onvoldoende data om werkelijk rendement te berekenen
                  </p>
                </div>

                {/* Key figures from aangifte */}
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-primary" />
                    Kerncijfers uit aangifte ({belastingjaar}):
                  </p>
                  <div className="grid md:grid-cols-3 gap-4">
                    {kerncijfers.belastingBedrag !== null && (
                      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-center">
                        <p className="text-xs text-muted-foreground mb-1">
                          Betaalde Box 3 Belasting
                        </p>
                        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                          {formatCurrency(kerncijfers.belastingBedrag)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          (forfaitair berekend)
                        </p>
                      </div>
                    )}
                    {kerncijfers.belastbaarInkomen !== null && (
                      <div className="bg-muted/30 rounded-lg p-4 text-center">
                        <p className="text-xs text-muted-foreground mb-1">
                          Belastbaar Inkomen Box 3
                        </p>
                        <p className="text-2xl font-bold">
                          {formatCurrency(kerncijfers.belastbaarInkomen)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          (na aftrek heffingsvrij vermogen)
                        </p>
                      </div>
                    )}
                    {kerncijfers.rendementsgrondslag !== null && (
                      <div className="bg-muted/30 rounded-lg p-4 text-center">
                        <p className="text-xs text-muted-foreground mb-1">
                          Rendementsgrondslag
                        </p>
                        <p className="text-2xl font-bold">
                          {formatCurrency(kerncijfers.rendementsgrondslag)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          (bezittingen min schulden)
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Explanation of what's needed for full analysis */}
                <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    <strong>Om kansrijkheid te bepalen:</strong> Upload ook jaaropgaves van banken (voor ontvangen rente)
                    en eventueel beleggingsoverzichten. Dan kunnen we berekenen of het werkelijk rendement lager was
                    dan het forfaitaire rendement.
                  </p>
                </div>
              </>
            ) : (
              <div className="bg-muted/30 rounded-lg p-4 text-center">
                <Info className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Onvoldoende data om werkelijk rendement te berekenen
                </p>
              </div>
            )}
          </div>
        )}

        {/* Breakdown of actual return */}
        {heeftBerekening && (
          <div className="border-t pt-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Opbouw werkelijk rendement:
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              {kansrijkheid.bankRente !== null && (
                <div className="flex justify-between bg-muted/20 rounded px-2 py-1">
                  <span className="text-muted-foreground">Bankrente</span>
                  <span className="font-medium">
                    {formatCurrency(kansrijkheid.bankRente)}
                  </span>
                </div>
              )}
              {kansrijkheid.beleggingenDividend !== null && (
                <div className="flex justify-between bg-muted/20 rounded px-2 py-1">
                  <span className="text-muted-foreground">Dividend</span>
                  <span className="font-medium">
                    {formatCurrency(kansrijkheid.beleggingenDividend)}
                  </span>
                </div>
              )}
              {kansrijkheid.beleggingenBegin !== null &&
                kansrijkheid.beleggingenEind !== null && (
                  <div className="flex justify-between bg-muted/20 rounded px-2 py-1">
                    <span className="text-muted-foreground">Koersresultaat</span>
                    <span
                      className={`font-medium ${
                        kansrijkheid.beleggingenEind -
                          kansrijkheid.beleggingenBegin <
                        0
                          ? "text-red-500"
                          : ""
                      }`}
                    >
                      {formatCurrency(
                        kansrijkheid.beleggingenEind -
                          kansrijkheid.beleggingenBegin
                      )}
                    </span>
                  </div>
                )}
              {kansrijkheid.schuldenRente !== null &&
                kansrijkheid.schuldenRente > 0 && (
                  <div className="flex justify-between bg-muted/20 rounded px-2 py-1">
                    <span className="text-muted-foreground">Rente schulden</span>
                    <span className="font-medium text-red-500">
                      -{formatCurrency(kansrijkheid.schuldenRente)}
                    </span>
                  </div>
                )}
            </div>
          </div>
        )}

        {/* Missing data for complete calculation */}
        {kansrijkheid.missendVoorBerekening.length > 0 && (
          <div className="border-t pt-4">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-orange-600">
                  Ontbrekend voor nauwkeurige berekening:
                </p>
                <ul className="text-muted-foreground mt-1 space-y-0.5">
                  {kansrijkheid.missendVoorBerekening.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Used forfaitaire percentages */}
        {forfaitair && (
          <div className="border-t pt-4">
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <Calculator className="h-3 w-3" />
              Gebruikte forfaitaire percentages ({kansrijkheid.gebruiktJaar}):
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="bg-muted/20 rounded px-2 py-1.5">
                <span className="text-muted-foreground">Spaargeld:</span>
                <span className="font-medium ml-1">
                  {forfaitair.spaargeld.toFixed(2)}%
                </span>
              </div>
              <div className="bg-muted/20 rounded px-2 py-1.5">
                <span className="text-muted-foreground">Beleggingen:</span>
                <span className="font-medium ml-1">
                  {forfaitair.beleggingen.toFixed(2)}%
                </span>
              </div>
              <div className="bg-muted/20 rounded px-2 py-1.5">
                <span className="text-muted-foreground">Schulden:</span>
                <span className="font-medium ml-1">
                  {forfaitair.schulden.toFixed(2)}%
                </span>
              </div>
              <div className="bg-muted/20 rounded px-2 py-1.5">
                <span className="text-muted-foreground">Box 3 tarief:</span>
                <span className="font-medium ml-1">
                  {(kansrijkheid.gebruiktTarief * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div className="text-xs text-muted-foreground bg-muted/20 rounded p-2 flex items-start gap-2">
          <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>
            Dit is een indicatieve berekening. De definitieve berekening hangt
            af van alle vermogensbestanddelen, stortingen/onttrekkingen, en de
            exacte forfaitaire percentages van het betreffende belastingjaar.
          </span>
        </div>
      </CardContent>
    </Card>
  );
});
