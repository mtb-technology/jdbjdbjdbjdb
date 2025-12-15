import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Target,
  Info
} from "lucide-react";
import type { StageDenkwijze } from "@shared/schema";

interface DenkwijzeSummaryProps {
  /** Stage name for display */
  stageName: string;
  /** The reasoning/denkwijze data from AI */
  denkwijze?: StageDenkwijze | null;
  /** High-level summary text (alternative to full denkwijze object) */
  samenvatting?: string | null;
  /** Whether this is legacy data without reasoning */
  isLegacyData?: boolean;
  /** Compact mode - shows less detail by default */
  compact?: boolean;
}

/**
 * DenkwijzeSummary - Shows AI reasoning/thinking for a stage
 *
 * This component displays the AI's decision-making process in a collapsible card.
 * It helps fiscal reviewers quickly understand WHY certain decisions were made.
 *
 * Supports both:
 * - Full StageDenkwijze object (for reviewer stages 4a-4f)
 * - Simple samenvatting string (for Stage 2 bouwplan)
 */
export function DenkwijzeSummary({
  stageName,
  denkwijze,
  samenvatting,
  isLegacyData = false,
  compact = false
}: DenkwijzeSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(!compact);

  // Check if we have any reasoning content
  const hasContent = !!(
    samenvatting ||
    denkwijze?.analyse_aanpak ||
    denkwijze?.belangrijkste_conclusie ||
    (denkwijze?.focus_punten && denkwijze.focus_punten.length > 0)
  );

  // If legacy data or no content, show info message
  if (isLegacyData || !hasContent) {
    return (
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Info className="h-4 w-4" />
            <span className="text-sm">
              Dit rapport bevat geen AI-redenering (ouder formaat of niet beschikbaar)
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Extract display content
  const displaySummary = samenvatting || denkwijze?.analyse_aanpak || denkwijze?.belangrijkste_conclusie;
  const focusPunten = denkwijze?.focus_punten || [];
  const overwegingen = denkwijze?.overwegingen || [];
  const conclusie = denkwijze?.belangrijkste_conclusie;

  return (
    <Card className="bg-gradient-to-r from-purple-50/50 to-blue-50/50 dark:from-purple-950/20 dark:to-blue-950/20 border-purple-200/50 dark:border-purple-800/50">
      <CardContent className="py-3 px-4">
        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            <span className="font-medium text-sm text-purple-900 dark:text-purple-100">
              Denkwijze AI
            </span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
              {stageName}
            </Badge>
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </button>

        {/* Content */}
        {isExpanded && (
          <div className="mt-3 space-y-3">
            {/* Main Summary */}
            {displaySummary && (
              <div className="text-sm text-foreground/80 leading-relaxed">
                {displaySummary}
              </div>
            )}

            {/* Focus Points */}
            {focusPunten.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Target className="h-3 w-3" />
                  <span>Focus punten</span>
                </div>
                <ul className="space-y-1 ml-5">
                  {focusPunten.map((punt, idx) => (
                    <li key={idx} className="text-xs text-foreground/70 list-disc">
                      {punt}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Detailed Considerations */}
            {overwegingen.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Lightbulb className="h-3 w-3" />
                  <span>Overwegingen</span>
                </div>
                <div className="space-y-2 ml-5">
                  {overwegingen.map((item, idx) => (
                    <div key={idx} className="text-xs">
                      <span className="font-medium text-foreground/80">{item.punt}:</span>
                      <span className="text-foreground/70 ml-1">{item.conclusie}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Final Conclusion (if separate from summary) */}
            {conclusie && conclusie !== displaySummary && (
              <div className="pt-2 border-t border-purple-200/30 dark:border-purple-700/30">
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 shrink-0 mt-0.5">
                    Conclusie
                  </Badge>
                  <span className="text-xs text-foreground/80 italic">
                    {conclusie}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Collapsed preview */}
        {!isExpanded && displaySummary && (
          <p className="mt-2 text-xs text-muted-foreground truncate">
            {displaySummary.substring(0, 100)}...
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Helper to extract denkwijze from raw feedback JSON
 * Used by ReviewerFeedbackViewer to parse reviewer output
 */
export function extractDenkwijzeFromRaw(rawOutput: string): StageDenkwijze | null {
  if (!rawOutput?.trim()) return null;

  try {
    // Try direct JSON parse
    let parsed: any;

    // Try extracting from markdown code blocks first
    const markdownMatch = rawOutput.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (markdownMatch) {
      parsed = JSON.parse(markdownMatch[1]);
    } else if (rawOutput.trim().startsWith('{')) {
      parsed = JSON.parse(rawOutput);
    } else {
      // Try to find JSON object in text
      const jsonMatch = rawOutput.match(/\{[\s\S]*"denkwijze"[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    }

    if (!parsed) return null;

    // Extract denkwijze from various possible locations
    const denkwijze = parsed.denkwijze || parsed;

    // Validate it looks like a denkwijze object
    if (denkwijze.analyse_aanpak || denkwijze.focus_punten || denkwijze.belangrijkste_conclusie) {
      return {
        analyse_aanpak: denkwijze.analyse_aanpak,
        focus_punten: Array.isArray(denkwijze.focus_punten) ? denkwijze.focus_punten : undefined,
        belangrijkste_conclusie: denkwijze.belangrijkste_conclusie,
        overwegingen: Array.isArray(denkwijze.overwegingen) ? denkwijze.overwegingen : undefined
      };
    }

    return null;
  } catch {
    return null;
  }
}
