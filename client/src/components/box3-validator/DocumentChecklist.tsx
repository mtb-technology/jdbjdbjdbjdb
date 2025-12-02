/**
 * DocumentChecklist Component
 *
 * Displays the 5 document categories with their status and feedback.
 */

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileCheck,
  ChevronDown,
  ChevronUp,
  FileText,
  Banknote,
  TrendingUp,
  Building,
  Calculator,
} from "lucide-react";
import { StatusIcon, StatusBadge } from "./StatusComponents";
import {
  getDocumentStatus,
  getDocumentFeedback,
  getDocumentGevondenIn,
} from "@/utils/box3Utils";
import type { Box3ValidationResult } from "@shared/schema";
import type { LucideIcon } from "lucide-react";

// Document categories with icons (can't be in constants.ts due to JSX)
const documentCategories: {
  key: string;
  label: string;
  description: string;
  waarom: string;
  icon: LucideIcon;
}[] = [
  {
    key: "aangifte_ib",
    label: "Aangifte inkomstenbelasting",
    description:
      "De PDF van de ingediende aangifte van het betreffende jaar.",
    waarom:
      "Dit is ons startpunt om te zien hoe de Belastingdienst uw vermogen nu heeft berekend.",
    icon: FileText,
  },
  {
    key: "bankrekeningen",
    label: "Bankrekeningen (Rente & Valuta)",
    description:
      "Een overzicht van de daadwerkelijk ontvangen rente en eventuele valutaresultaten.",
    waarom:
      "Wij moeten aantonen dat uw werkelijk ontvangen spaarrente lager is dan het forfaitaire rendement.",
    icon: Banknote,
  },
  {
    key: "beleggingen",
    label: "Beleggingen",
    description:
      "Overzicht met beginstand (1 jan), eindstand (31 dec), stortingen/onttrekkingen en dividenden.",
    waarom:
      "Door de begin- en eindstand te vergelijken berekenen we uw exacte vermogensgroei.",
    icon: TrendingUp,
  },
  {
    key: "vastgoed",
    label: "Vastgoed & overige bezittingen",
    description:
      "De WOZ-waarde op 1 januari van het jaar én het jaar erna (T+1). Bij verhuur: huuroverzicht.",
    waarom:
      "Voor vastgoed telt waardestijging plus eventuele huurinkomsten als totaalrendement.",
    icon: Building,
  },
  {
    key: "schulden",
    label: "Schulden",
    description: "Een overzicht van de schulden en de betaalde rente.",
    waarom: "Betaalde rente vermindert uw netto rendement.",
    icon: Calculator,
  },
];

interface DocumentChecklistProps {
  validationResult: Box3ValidationResult;
  expandedCategories: Set<string>;
  onToggleCategory: (key: string) => void;
}

export const DocumentChecklist = memo(function DocumentChecklist({
  validationResult,
  expandedCategories,
  onToggleCategory,
}: DocumentChecklistProps) {
  const completedCount = documentCategories.filter((cat) => {
    const status = getDocumentStatus(validationResult, cat.key);
    return status === "compleet";
  }).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center">
            <FileCheck className="h-5 w-5 mr-2 text-primary" />
            Document Checklist
          </span>
          <Badge variant={completedCount === 5 ? "default" : "secondary"}>
            {completedCount}/5 compleet
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {documentCategories.map((cat) => {
          const status = getDocumentStatus(validationResult, cat.key);
          const feedback = getDocumentFeedback(validationResult, cat.key);
          const gevondenIn = getDocumentGevondenIn(validationResult, cat.key);
          const IconComponent = cat.icon;
          const isExpanded = expandedCategories.has(cat.key);

          return (
            <div key={cat.key} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => onToggleCategory(cat.key)}
                className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <StatusIcon status={status} />
                  <div className="flex items-center gap-2">
                    <IconComponent className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{cat.label}</span>
                  </div>
                  <StatusBadge status={status} />
                </div>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {isExpanded && (
                <div className="p-3 pt-0 border-t bg-muted/30 space-y-2">
                  {/* Description of what we need */}
                  <div className="text-xs text-muted-foreground bg-background/50 rounded p-2">
                    <p className="font-medium mb-1">Wat we nodig hebben:</p>
                    <p>{cat.description}</p>
                    <p className="mt-1 italic">Waarom: {cat.waarom}</p>
                  </div>

                  {/* AI Feedback */}
                  {feedback && (
                    <div className="text-sm">
                      <p className="font-medium text-xs text-muted-foreground mb-1">
                        AI Analyse:
                      </p>
                      <p className="whitespace-pre-wrap">{feedback}</p>
                    </div>
                  )}

                  {/* Found in documents */}
                  {gevondenIn && gevondenIn.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      <span className="text-xs text-muted-foreground">
                        Gevonden in:
                      </span>
                      {gevondenIn.map((doc: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {doc}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* No feedback available */}
                  {!feedback && status === "ontbreekt" && (
                    <p className="text-sm text-muted-foreground italic">
                      Dit document is niet gevonden in de aangeleverde
                      bestanden.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
});
