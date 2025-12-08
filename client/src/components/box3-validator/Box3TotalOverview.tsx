/**
 * Box3TotalOverview Component
 *
 * Displays a summary of all tax years in a multi-year Box 3 dossier.
 * Shows total indicative refund, completion status per year, and aggregated stats.
 */

import { memo, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Calendar,
  CheckCircle,
  AlertCircle,
  Info,
  Users,
} from "lucide-react";
import {
  berekenKansrijkheid,
  formatCurrency,
  extractBelastingjaar,
} from "@/utils/box3Utils";
import type { Box3MultiYearData, Box3YearEntry, Box3FiscalePartners } from "@shared/schema";

// Type for bijlage analyse (from session-level validation)
interface BijlageAnalyse {
  bestandsnaam: string;
  document_type: string;
  belastingjaar?: number | string | null;
  samenvatting: string;
  geextraheerde_waarden?: Record<string, string | number | boolean | null>;
  relevantie?: string;
}

interface Box3TotalOverviewProps {
  multiYearData: Box3MultiYearData;
  onSelectYear?: (jaar: string) => void;
  sessionBijlageAnalyse?: BijlageAnalyse[];
  // Fiscale partners detectie (session-level)
  fiscalePartners?: Box3FiscalePartners;
}

interface YearSummary {
  jaar: string;
  indicatieveTeruggave: number | null;
  isComplete: boolean;
  hasIssues: boolean;
  hasData: boolean;
}

/**
 * Extract indicative refund from session-level bijlage_analyse for a specific year
 * Parses the samenvatting text to find Box 3 inkomen and belasting values
 */
function extractIndicatieveTeruggaveFromBijlage(
  sessionBijlageAnalyse: BijlageAnalyse[] | undefined,
  jaar: string
): number | null {
  if (!sessionBijlageAnalyse || sessionBijlageAnalyse.length === 0) {
    return null;
  }

  // Filter to entries for this year
  const yearEntries = sessionBijlageAnalyse.filter(
    (a) => a.belastingjaar && String(a.belastingjaar) === jaar
  );

  if (yearEntries.length === 0) {
    return null;
  }

  // Helper to parse currency from text
  const parseCurrency = (text: string): number | null => {
    // Remove currency symbol and dots, replace comma with period
    const cleaned = text.replace(/[€\s.]/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  };

  // Try to find Box 3 belasting from geextraheerde_waarden first
  for (const entry of yearEntries) {
    if (entry.geextraheerde_waarden) {
      const vals = entry.geextraheerde_waarden;
      // Look for various possible field names
      for (const key of Object.keys(vals)) {
        const lowerKey = key.toLowerCase();
        if (
          (lowerKey.includes("box") && lowerKey.includes("3") && lowerKey.includes("belasting")) ||
          lowerKey.includes("inkomstenbelasting") ||
          lowerKey === "belasting"
        ) {
          const val = vals[key];
          if (typeof val === "number") {
            return val;
          }
          if (typeof val === "string") {
            const parsed = parseCurrency(val);
            if (parsed !== null) {
              return parsed;
            }
          }
        }
      }
    }
  }

  // Fallback: parse samenvatting text for belasting values
  for (const entry of yearEntries) {
    const text = entry.samenvatting;
    if (!text) continue;

    // Try patterns like "belasting: €1.234" or "Box 3 belasting: €1.234,56"
    const patterns = [
      /box\s*3[^:]*belasting[:\s]*€?\s*([\d.,]+)/i,
      /belasting[:\s]*€?\s*([\d.,]+)/i,
      /inkomstenbelasting[:\s]*€?\s*([\d.,]+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const parsed = parseCurrency(match[1]);
        if (parsed !== null && parsed > 0) {
          return parsed;
        }
      }
    }
  }

  return null;
}

export const Box3TotalOverview = memo(function Box3TotalOverview({
  multiYearData,
  onSelectYear,
  sessionBijlageAnalyse,
  fiscalePartners,
}: Box3TotalOverviewProps) {
  // Calculate summary for each year
  const yearSummaries = useMemo(() => {
    const summaries: YearSummary[] = [];
    const years = Object.keys(multiYearData.years).sort();

    for (const jaar of years) {
      const entry = multiYearData.years[jaar];
      let indicatieveTeruggave: number | null = null;
      let hasData = false;
      let isComplete = entry.isComplete ?? false;

      // Calculate indicatieve teruggave if we have validation result
      if (entry.validationResult) {
        hasData = true;
        const berekening = berekenKansrijkheid(
          entry.validationResult,
          jaar,
          entry.manualOverrides
        );
        indicatieveTeruggave = berekening.indicatieveTeruggave ?? null;
      }

      // Use stored value if available
      if (entry.indicatieveTeruggave !== undefined) {
        indicatieveTeruggave = entry.indicatieveTeruggave;
      }

      // Fallback: try to extract from session-level bijlage_analyse
      if (indicatieveTeruggave === null && sessionBijlageAnalyse) {
        const extracted = extractIndicatieveTeruggaveFromBijlage(sessionBijlageAnalyse, jaar);
        if (extracted !== null) {
          indicatieveTeruggave = extracted;
          hasData = true; // Mark as having data if we found something
        }
      }

      // Also check if there are attachments for this year (mark as hasData)
      if (!hasData && entry.attachments && entry.attachments.length > 0) {
        hasData = true;
      }

      summaries.push({
        jaar,
        indicatieveTeruggave,
        isComplete,
        hasIssues: !isComplete && hasData,
        hasData,
      });
    }

    return summaries;
  }, [multiYearData, sessionBijlageAnalyse]);

  // Calculate totals
  const totals = useMemo(() => {
    let totalIndicatieveTeruggave = 0;
    let completeYears = 0;
    let incompleteYears = 0;
    let yearsWithData = 0;

    for (const summary of yearSummaries) {
      if (summary.hasData) {
        yearsWithData++;
        if (summary.indicatieveTeruggave !== null) {
          totalIndicatieveTeruggave += summary.indicatieveTeruggave;
        }
        if (summary.isComplete) {
          completeYears++;
        } else {
          incompleteYears++;
        }
      }
    }

    return {
      totalIndicatieveTeruggave,
      completeYears,
      incompleteYears,
      yearsWithData,
      isKansrijk: totalIndicatieveTeruggave > 0,
    };
  }, [yearSummaries]);

  const hasYears = yearSummaries.length > 0;

  return (
    <Card
      className={`border-2 ${
        totals.isKansrijk
          ? "border-green-500 bg-green-500/5"
          : hasYears
            ? "border-muted"
            : "border-dashed border-muted"
      }`}
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span>Totaaloverzicht Alle Jaren</span>
          </div>
          {totals.isKansrijk && (
            <Badge className="bg-green-500 hover:bg-green-600">
              <TrendingUp className="h-3 w-3 mr-1" />
              Kansrijk
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasYears ? (
          <div className="bg-muted/30 rounded-lg p-6 text-center">
            <Calendar className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Nog geen belastingjaren toegevoegd
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Voeg documenten toe per jaar om een berekening te krijgen
            </p>
          </div>
        ) : (
          <>
            {/* Fiscale Partners Alert */}
            {fiscalePartners?.heeft_partner && fiscalePartners.partners && fiscalePartners.partners.length > 0 && (
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-3">
                  <Users className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-blue-800 dark:text-blue-200 flex items-center gap-2">
                      Fiscale Partners Gedetecteerd
                      <Badge variant="secondary" className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                        {fiscalePartners.partners.length} personen
                      </Badge>
                    </p>
                    <div className="mt-2 space-y-1">
                      {fiscalePartners.partners.map((partner) => (
                        <div key={partner.id} className="flex items-center gap-2 text-sm">
                          <Badge variant="outline" className="text-xs">
                            {partner.rol === "hoofdaanvrager" ? "Hoofdaanvrager" : "Partner"}
                          </Badge>
                          <span className="text-blue-700 dark:text-blue-300">
                            {partner.naam || `Partner ${partner.id.replace("partner_", "").toUpperCase()}`}
                          </span>
                          {partner.bsn_laatste_4 && (
                            <span className="text-xs text-muted-foreground">
                              (BSN ...{partner.bsn_laatste_4})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                      Elke partner moet een apart bezwaarschrift indienen. Beide aangiftes per jaar zijn nodig.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Main total */}
            <div className="grid md:grid-cols-3 gap-4">
              {/* Totale Teruggave */}
              <div
                className={`rounded-lg p-4 text-center ${
                  totals.isKansrijk ? "bg-green-500/10" : "bg-muted/30"
                }`}
              >
                <p className="text-xs text-muted-foreground mb-1">
                  Totale Indicatieve Teruggave
                </p>
                <p
                  className={`text-3xl font-bold ${
                    totals.totalIndicatieveTeruggave > 0
                      ? "text-green-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {formatCurrency(totals.totalIndicatieveTeruggave)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  over {totals.yearsWithData} belastingjaar{totals.yearsWithData !== 1 ? "en" : ""}
                </p>
              </div>

              {/* Complete years */}
              <div className="bg-muted/30 rounded-lg p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">
                  Jaren Compleet
                </p>
                <p className="text-2xl font-bold text-green-600">
                  {totals.completeYears}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  van {totals.yearsWithData} met data
                </p>
              </div>

              {/* Incomplete years */}
              <div className="bg-muted/30 rounded-lg p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">
                  Actie Vereist
                </p>
                <p
                  className={`text-2xl font-bold ${
                    totals.incompleteYears > 0
                      ? "text-orange-500"
                      : "text-green-600"
                  }`}
                >
                  {totals.incompleteYears}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  jaar{totals.incompleteYears !== 1 ? "en" : ""} nog niet compleet
                </p>
              </div>
            </div>

            {/* Per-year breakdown */}
            <div className="border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground mb-3">
                Per belastingjaar:
              </p>
              <div className="grid gap-2">
                {yearSummaries.map((summary) => (
                  <button
                    key={summary.jaar}
                    onClick={() => onSelectYear?.(summary.jaar)}
                    className={`flex items-center justify-between p-3 rounded-lg transition-colors text-left w-full ${
                      summary.hasData
                        ? "bg-muted/30 hover:bg-muted/50"
                        : "bg-muted/10 hover:bg-muted/20"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        {summary.isComplete ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : summary.hasIssues ? (
                          <AlertCircle className="h-4 w-4 text-orange-500" />
                        ) : (
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-medium">{summary.jaar}</span>
                      </div>
                      {summary.isComplete && (
                        <Badge variant="secondary" className="text-xs">
                          Compleet
                        </Badge>
                      )}
                      {summary.hasIssues && (
                        <Badge
                          variant="outline"
                          className="text-xs text-orange-600 border-orange-300"
                        >
                          Actie vereist
                        </Badge>
                      )}
                      {!summary.hasData && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          Geen data
                        </Badge>
                      )}
                    </div>
                    <div className="text-right">
                      {summary.indicatieveTeruggave !== null ? (
                        <span
                          className={`font-medium ${
                            summary.indicatieveTeruggave > 0
                              ? "text-green-600"
                              : "text-muted-foreground"
                          }`}
                        >
                          {formatCurrency(summary.indicatieveTeruggave)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Disclaimer */}
            <div className="text-xs text-muted-foreground bg-muted/20 rounded p-2 flex items-start gap-2">
              <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <span>
                Dit is een indicatieve totaalberekening. De definitieve
                teruggave per jaar hangt af van complete documentatie en
                correcte waarden voor elk belastingjaar.
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
});
