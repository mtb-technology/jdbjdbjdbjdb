/**
 * FiscaleBriefingViewer Component
 *
 * Displays the Fiscale Briefing (Stage 7) - an executive summary for fiscalists.
 * Focus on reasoning transparency: WHY the AI made certain choices.
 *
 * Design:
 * - Case at a glance (30 sec read)
 * - AI reasoning chain (step-by-step)
 * - Confidence per section
 * - Check list for fiscalist
 */

import { memo, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  User,
  Calendar,
  Target,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Lightbulb,
  RefreshCw,
  AlertCircle,
  Brain,
  ListChecks,
  HelpCircle,
  MessageSquare,
  Clock,
  Sparkles,
  Eye,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FiscaleBriefing } from "@shared/schema";

interface FiscaleBriefingViewerProps {
  briefingJson: string;
  isLoading?: boolean;
  onRegenerate?: () => void;
  className?: string;
}

/**
 * Parse the briefing JSON safely - handles both old and new schema
 */
function parseBriefing(json: string): FiscaleBriefing | null {
  try {
    let cleanJson = json.trim();
    const markdownMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (markdownMatch) {
      cleanJson = markdownMatch[1].trim();
    }

    const parsed = JSON.parse(cleanJson);

    if (parsed.error) {
      return null;
    }

    return parsed as FiscaleBriefing;
  } catch {
    return null;
  }
}

/**
 * Get confidence styling
 */
function getConfidenceStyle(level: string) {
  switch (level) {
    case "hoog":
      return {
        bg: "bg-green-100 dark:bg-green-900/30",
        text: "text-green-700 dark:text-green-300",
        border: "border-green-300 dark:border-green-700",
        icon: CheckCircle,
        label: "Hoog",
      };
    case "medium":
      return {
        bg: "bg-yellow-100 dark:bg-yellow-900/30",
        text: "text-yellow-700 dark:text-yellow-300",
        border: "border-yellow-300 dark:border-yellow-700",
        icon: AlertCircle,
        label: "Medium",
      };
    case "laag":
      return {
        bg: "bg-red-100 dark:bg-red-900/30",
        text: "text-red-700 dark:text-red-300",
        border: "border-red-300 dark:border-red-700",
        icon: AlertTriangle,
        label: "Laag",
      };
    default:
      return {
        bg: "bg-gray-100 dark:bg-gray-800",
        text: "text-gray-700 dark:text-gray-300",
        border: "border-gray-300 dark:border-gray-700",
        icon: AlertCircle,
        label: "Onbekend",
      };
  }
}

/**
 * Get priority badge
 */
function getPriorityBadge(priority: string) {
  switch (priority) {
    case "must_check":
      return <Badge variant="destructive" className="text-xs">Must Check</Badge>;
    case "should_check":
      return <Badge variant="default" className="text-xs bg-amber-500">Should Check</Badge>;
    case "nice_to_check":
      return <Badge variant="secondary" className="text-xs">Nice to Check</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{priority}</Badge>;
  }
}

/**
 * Get complexity badge
 */
function getComplexityBadge(complexity: string) {
  switch (complexity) {
    case "eenvoudig":
      return <Badge variant="secondary" className="text-xs">Eenvoudig</Badge>;
    case "gemiddeld":
      return <Badge variant="default" className="text-xs bg-blue-500">Gemiddeld</Badge>;
    case "complex":
      return <Badge variant="destructive" className="text-xs">Complex</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{complexity}</Badge>;
  }
}

/**
 * Get review depth badge
 */
function getReviewDepthBadge(depth: string) {
  switch (depth) {
    case "vluchtig":
      return <Badge className="bg-green-500 text-white text-xs">Vluchtige review</Badge>;
    case "normaal":
      return <Badge className="bg-blue-500 text-white text-xs">Normale review</Badge>;
    case "grondig":
      return <Badge className="bg-red-500 text-white text-xs">Grondige review</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{depth}</Badge>;
  }
}

export const FiscaleBriefingViewer = memo(function FiscaleBriefingViewer({
  briefingJson,
  isLoading,
  onRegenerate,
  className,
}: FiscaleBriefingViewerProps) {
  const [isReasoningOpen, setIsReasoningOpen] = useState(true);
  const [isTwijfelOpen, setIsTwijfelOpen] = useState(false);
  const [isChecklistOpen, setIsChecklistOpen] = useState(true);
  const [isReviewerOpen, setIsReviewerOpen] = useState(false);
  const [isAlternativesOpen, setIsAlternativesOpen] = useState(false);

  const briefing = useMemo(() => parseBriefing(briefingJson), [briefingJson]);

  // Loading state
  if (isLoading) {
    return (
      <Card className={cn("border-purple-200 dark:border-purple-800", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <RefreshCw className="h-5 w-5 text-purple-600 animate-spin" />
            Executive Summary wordt gegenereerd...
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-32 flex items-center justify-center text-muted-foreground">
            <p>De AI analyseert de complete case en redeneringen...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Parse error state
  if (!briefing) {
    return (
      <Card className={cn("border-red-200 dark:border-red-800", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg text-red-700 dark:text-red-300">
            <AlertTriangle className="h-5 w-5" />
            Briefing kon niet worden geladen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            De fiscale briefing kon niet worden geparsed. Dit kan aan een oud format liggen.
          </p>
          {onRegenerate && (
            <Button onClick={onRegenerate} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Opnieuw genereren
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const totalConfidence = getConfidenceStyle(briefing.totaal_confidence);
  const TotalConfidenceIcon = totalConfidence.icon;

  return (
    <Card className={cn("border-purple-200 dark:border-purple-800 bg-purple-50/30 dark:bg-purple-950/20", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5 text-purple-600" />
            Executive Summary
          </CardTitle>
          <div className="flex items-center gap-2">
            {getReviewDepthBadge(briefing.aanbeveling_review_diepte)}
            <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", totalConfidence.bg, totalConfidence.text)}>
              <TotalConfidenceIcon className="h-3.5 w-3.5" />
              {totalConfidence.label}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* === DEEL 1: CASE IN EEN OOGOPSLAG === */}
        <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center shrink-0">
              <Eye className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <Badge variant="outline" className="text-xs">
                  {briefing.case_in_een_oogopslag.client_type}
                </Badge>
                {getComplexityBadge(briefing.case_in_een_oogopslag.complexiteit)}
                {briefing.case_in_een_oogopslag.belastingjaren.length > 0 && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {briefing.case_in_een_oogopslag.belastingjaren.join(", ")}
                  </div>
                )}
              </div>
              <p className="text-sm font-medium">
                {briefing.case_in_een_oogopslag.kernvraag}
              </p>
              {briefing.case_in_een_oogopslag.geschatte_financiele_impact && (
                <div className="flex items-center gap-1 mt-2 text-xs text-green-700 dark:text-green-400">
                  <TrendingUp className="h-3 w-3" />
                  Geschat belang: {briefing.case_in_een_oogopslag.geschatte_financiele_impact}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* === DEEL 2: MIJN ADVIES & CONCLUSIE === */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-sm font-semibold">Mijn Advies</h4>
                <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-xs", getConfidenceStyle(briefing.mijn_advies.confidence).bg, getConfidenceStyle(briefing.mijn_advies.confidence).text)}>
                  {getConfidenceStyle(briefing.mijn_advies.confidence).label} confidence
                </div>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {briefing.mijn_advies.conclusie}
              </p>
            </div>
          </div>
        </div>

        {/* === DEEL 2b: REASONING CHAIN === */}
        <Collapsible open={isReasoningOpen} onOpenChange={setIsReasoningOpen}>
          <div className="bg-white dark:bg-gray-900 rounded-lg border">
            <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg transition-colors">
              <div className="flex items-center gap-3">
                <Brain className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                <div className="text-left">
                  <h4 className="text-sm font-semibold">Mijn Redenering</h4>
                  <p className="text-xs text-muted-foreground">{briefing.mijn_advies.redenering.length} stappen - bekijk hoe ik tot dit advies kwam</p>
                </div>
              </div>
              {isReasoningOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 space-y-3">
                {briefing.mijn_advies.redenering.map((stap, idx) => {
                  const stepConfidence = getConfidenceStyle(stap.confidence);
                  return (
                    <div key={idx} className="relative pl-6 pb-3 last:pb-0">
                      {/* Vertical line connector */}
                      {idx < briefing.mijn_advies.redenering.length - 1 && (
                        <div className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-indigo-200 dark:bg-indigo-800" />
                      )}
                      {/* Step number */}
                      <div className="absolute left-0 top-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                        {stap.stap}
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 ml-2">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                            {stap.vraag}
                          </p>
                          <div className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs shrink-0", stepConfidence.bg, stepConfidence.text)}>
                            {stepConfidence.label}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">{stap.analyse}</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          → {stap.conclusie}
                        </p>
                        {stap.bronnen && stap.bronnen.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {stap.bronnen.map((bron, bidx) => (
                              <Badge key={bidx} variant="outline" className="text-xs font-normal">
                                {bron}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        {/* === DEEL 2c: OVERWOGEN ALTERNATIEVEN === */}
        {briefing.mijn_advies.overwogen_alternatieven && briefing.mijn_advies.overwogen_alternatieven.length > 0 && (
          <Collapsible open={isAlternativesOpen} onOpenChange={setIsAlternativesOpen}>
            <div className="bg-white dark:bg-gray-900 rounded-lg border">
              <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg transition-colors">
                <div className="flex items-center gap-3">
                  <HelpCircle className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                  <div className="text-left">
                    <h4 className="text-sm font-semibold">Overwogen Alternatieven</h4>
                    <p className="text-xs text-muted-foreground">{briefing.mijn_advies.overwogen_alternatieven.length} andere opties bekeken</p>
                  </div>
                </div>
                {isAlternativesOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 space-y-2">
                  {briefing.mijn_advies.overwogen_alternatieven.map((alt, idx) => (
                    <div key={idx} className="p-3 rounded bg-gray-50 dark:bg-gray-800/50">
                      <p className="text-sm font-medium">{alt.optie}</p>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                        ✗ Niet gekozen: {alt.waarom_niet}
                      </p>
                      {alt.wanneer_wel && (
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                          ✓ Zou gelden als: {alt.wanneer_wel}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}

        {/* === DEEL 3: TWIJFELPUNTEN === */}
        {briefing.twijfelpunten && briefing.twijfelpunten.length > 0 && (
          <Collapsible open={isTwijfelOpen} onOpenChange={setIsTwijfelOpen}>
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-amber-200 dark:border-amber-800">
              <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-lg transition-colors">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <div className="text-left">
                    <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-300">Waar Ik Twijfelde</h4>
                    <p className="text-xs text-muted-foreground">{briefing.twijfelpunten.length} punt(en) met meerdere interpretaties</p>
                  </div>
                </div>
                {isTwijfelOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 space-y-3">
                  {briefing.twijfelpunten.map((twijfel, idx) => (
                    <div key={idx} className="p-3 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{twijfel.onderwerp}</p>
                      <div className="mt-2 text-xs space-y-1">
                        <p className="text-muted-foreground">
                          <span className="font-medium">Opties:</span> {twijfel.opties.join(" | ")}
                        </p>
                        <p className="text-green-700 dark:text-green-400">
                          <span className="font-medium">Gekozen:</span> {twijfel.gekozen}
                        </p>
                        <p className="text-red-700 dark:text-red-400">
                          <span className="font-medium">Risico:</span> {twijfel.risico}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}

        {/* === DEEL 4: CHECK VOOR VERZENDING === */}
        <Collapsible open={isChecklistOpen} onOpenChange={setIsChecklistOpen}>
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-green-200 dark:border-green-800">
            <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-green-50 dark:hover:bg-green-950/30 rounded-lg transition-colors">
              <div className="flex items-center gap-3">
                <ListChecks className="h-5 w-5 text-green-600 dark:text-green-400" />
                <div className="text-left">
                  <h4 className="text-sm font-semibold text-green-700 dark:text-green-300">Check Voor Verzending</h4>
                  <p className="text-xs text-muted-foreground">{briefing.check_voor_verzending.length} item(s) om te checken</p>
                </div>
              </div>
              {isChecklistOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 space-y-2">
                {briefing.check_voor_verzending.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-3 rounded bg-green-50 dark:bg-green-950/30">
                    <div className="shrink-0 mt-0.5">
                      {getPriorityBadge(item.prioriteit)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{item.wat}</p>
                      <p className="text-xs text-muted-foreground mt-1">{item.waarom}</p>
                    </div>
                    {item.geschatte_tijd && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                        <Clock className="h-3 w-3" />
                        {item.geschatte_tijd}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        {/* === DEEL 5: REVIEWER HIGHLIGHTS === */}
        {briefing.reviewer_highlights && briefing.reviewer_highlights.length > 0 && (
          <Collapsible open={isReviewerOpen} onOpenChange={setIsReviewerOpen}>
            <div className="bg-white dark:bg-gray-900 rounded-lg border">
              <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg transition-colors">
                <div className="flex items-center gap-3">
                  <MessageSquare className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <div className="text-left">
                    <h4 className="text-sm font-semibold">AI Reviewer Highlights</h4>
                    <p className="text-xs text-muted-foreground">{briefing.reviewer_highlights.length} reviewer(s) met feedback</p>
                  </div>
                </div>
                {isReviewerOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 space-y-2">
                  {briefing.reviewer_highlights.map((highlight, idx) => {
                    const impactStyle = getConfidenceStyle(highlight.impact === "hoog" ? "laag" : highlight.impact === "laag" ? "hoog" : "medium");
                    return (
                      <div key={idx} className="p-3 rounded bg-blue-50 dark:bg-blue-950/30">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium">{highlight.reviewer}</p>
                          <Badge variant={highlight.impact === "hoog" ? "destructive" : highlight.impact === "medium" ? "default" : "secondary"} className="text-xs">
                            {highlight.impact} impact
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{highlight.belangrijkste_feedback}</p>
                        <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                          → {highlight.actie_genomen}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}

        {/* === CONFIDENCE TOELICHTING === */}
        <div className="text-xs text-muted-foreground italic px-1 pt-2 border-t">
          💡 {briefing.confidence_toelichting}
        </div>
      </CardContent>
    </Card>
  );
});
