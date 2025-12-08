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
} from "lucide-react";
import {
  berekenKansrijkheid,
  formatCurrency,
  extractBelastingjaar,
} from "@/utils/box3Utils";
import type { Box3MultiYearData, Box3YearEntry } from "@shared/schema";

interface Box3TotalOverviewProps {
  multiYearData: Box3MultiYearData;
  onSelectYear?: (jaar: string) => void;
}

interface YearSummary {
  jaar: string;
  indicatieveTeruggave: number | null;
  isComplete: boolean;
  hasIssues: boolean;
  hasData: boolean;
}

export const Box3TotalOverview = memo(function Box3TotalOverview({
  multiYearData,
  onSelectYear,
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

      summaries.push({
        jaar,
        indicatieveTeruggave,
        isComplete,
        hasIssues: !isComplete && hasData,
        hasData,
      });
    }

    return summaries;
  }, [multiYearData]);

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
