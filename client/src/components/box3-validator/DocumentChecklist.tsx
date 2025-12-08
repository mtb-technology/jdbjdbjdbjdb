/**
 * DocumentChecklist Component
 *
 * Displays the 5 document categories with their status and feedback.
 * Now supports manual overrides (n.v.t., manual values).
 */

import { memo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileCheck,
  ChevronDown,
  ChevronUp,
  FileText,
  Banknote,
  TrendingUp,
  Building,
  Calculator,
  Ban,
  Edit3,
  Check,
} from "lucide-react";
import { StatusIcon, StatusBadge } from "./StatusComponents";
import {
  getDocumentStatus,
  getDocumentFeedback,
  getDocumentGevondenIn,
  getEffectiveDocumentStatus,
  hasManualOverride,
  getOverrideNote,
} from "@/utils/box3Utils";
import type { Box3ValidationResult, Box3ManualOverrides } from "@shared/schema";
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
  manualOverrides?: Box3ManualOverrides | null;
  onUpdateOverrides?: (overrides: Partial<Box3ManualOverrides>) => Promise<void>;
}

export const DocumentChecklist = memo(function DocumentChecklist({
  validationResult,
  expandedCategories,
  onToggleCategory,
  manualOverrides,
  onUpdateOverrides,
}: DocumentChecklistProps) {
  const [updatingCategory, setUpdatingCategory] = useState<string | null>(null);

  // Count completed using effective status (includes overrides)
  const completedCount = documentCategories.filter((cat) => {
    const status = getEffectiveDocumentStatus(validationResult, cat.key, manualOverrides);
    return status === "compleet" || status === "nvt";
  }).length;

  // Handle marking category as n.v.t.
  const handleMarkNvt = async (categoryKey: string) => {
    if (!onUpdateOverrides) return;
    setUpdatingCategory(categoryKey);
    try {
      await onUpdateOverrides({
        [categoryKey]: {
          status: "nvt",
          note: "Handmatig als n.v.t. gemarkeerd",
          updatedAt: new Date().toISOString(),
        },
      });
    } finally {
      setUpdatingCategory(null);
    }
  };

  // Handle removing override
  const handleRemoveOverride = async (categoryKey: string) => {
    if (!onUpdateOverrides) return;
    setUpdatingCategory(categoryKey);
    try {
      await onUpdateOverrides({
        [categoryKey]: undefined,
      });
    } finally {
      setUpdatingCategory(null);
    }
  };

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
          const aiStatus = getDocumentStatus(validationResult, cat.key);
          const effectiveStatus = getEffectiveDocumentStatus(validationResult, cat.key, manualOverrides);
          const hasOverride = hasManualOverride(cat.key, manualOverrides);
          const overrideNote = getOverrideNote(cat.key, manualOverrides);
          const feedback = getDocumentFeedback(validationResult, cat.key);
          const gevondenIn = getDocumentGevondenIn(validationResult, cat.key);
          const IconComponent = cat.icon;
          const isExpanded = expandedCategories.has(cat.key);
          const isUpdating = updatingCategory === cat.key;

          return (
            <div key={cat.key} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => onToggleCategory(cat.key)}
                className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <StatusIcon status={effectiveStatus} />
                  <div className="flex items-center gap-2">
                    <IconComponent className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{cat.label}</span>
                  </div>
                  <StatusBadge status={effectiveStatus} />
                  {hasOverride && (
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                      <Edit3 className="h-3 w-3 mr-1" />
                      Handmatig
                    </Badge>
                  )}
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
                  {!feedback && aiStatus === "ontbreekt" && !hasOverride && (
                    <p className="text-sm text-muted-foreground italic">
                      Dit document is niet gevonden in de aangeleverde
                      bestanden.
                    </p>
                  )}

                  {/* Override note */}
                  {hasOverride && overrideNote && (
                    <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded p-2">
                      <Edit3 className="h-3 w-3" />
                      <span>{overrideNote}</span>
                    </div>
                  )}

                  {/* Override actions - always show when onUpdateOverrides is available */}
                  {onUpdateOverrides && (
                    <div className="flex items-center gap-2 pt-2 border-t mt-2">
                      {/* Show n.v.t. button when no override and not already complete */}
                      {!hasOverride && effectiveStatus !== "compleet" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkNvt(cat.key);
                          }}
                          disabled={isUpdating}
                          className="text-xs"
                        >
                          {isUpdating ? (
                            <span className="animate-pulse">...</span>
                          ) : (
                            <>
                              <Ban className="h-3 w-3 mr-1" />
                              Markeer als n.v.t.
                            </>
                          )}
                        </Button>
                      )}
                      {/* Show remove button when there's an override */}
                      {hasOverride && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveOverride(cat.key);
                          }}
                          disabled={isUpdating}
                          className="text-xs text-muted-foreground"
                        >
                          {isUpdating ? (
                            <span className="animate-pulse">...</span>
                          ) : (
                            "Override verwijderen"
                          )}
                        </Button>
                      )}
                      {/* Info when status is already complete */}
                      {!hasOverride && effectiveStatus === "compleet" && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Check className="h-3 w-3 text-green-500" />
                          Document is compleet
                        </span>
                      )}
                    </div>
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
