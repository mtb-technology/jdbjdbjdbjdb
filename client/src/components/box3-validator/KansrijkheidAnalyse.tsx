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
import type { Box3ValidationResult } from "@shared/schema";

interface KansrijkheidAnalyseProps {
  validationResult: Box3ValidationResult;
  belastingjaar: string | undefined;
}

export const KansrijkheidAnalyse = memo(function KansrijkheidAnalyse({
  validationResult,
  belastingjaar,
}: KansrijkheidAnalyseProps) {
  const kansrijkheid = berekenKansrijkheid(validationResult, belastingjaar);
  const heeftBerekening = kansrijkheid.werkelijkRendement !== null;
  const forfaitair = getForfaitaireRendementen(belastingjaar);

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
          <div className="bg-muted/30 rounded-lg p-4 text-center">
            <Info className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Onvoldoende data om werkelijk rendement te berekenen
            </p>
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
