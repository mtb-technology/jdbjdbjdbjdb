/**
 * FiscaleBriefingPanel Component
 *
 * Displays the Fiscale Briefing (Stage 7) in the sidebar with fullscreen support.
 * Shows an executive summary for fiscalists with reasoning transparency.
 *
 * Uses the NEW schema with:
 * - case_in_een_oogopslag
 * - mijn_advies (with redenering chain)
 * - twijfelpunten
 * - check_voor_verzending
 * - reviewer_highlights
 */

import { useState, memo, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  BookOpen,
  Maximize2,
  Calendar,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Loader2,
  Sparkles,
  Brain,
  ListChecks,
  Eye,
  Clock,
  MessageSquare,
  HelpCircle,
  RefreshCw,
  Code,
  User,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { FiscaleBriefing } from "@shared/schema";

interface FiscaleBriefingPanelProps {
  reportId: string;
  stageResults: Record<string, string> | null;
  className?: string;
}

/**
 * Parse the briefing JSON safely
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
 * Get confidence level styling
 */
function getConfidenceStyle(level: string) {
  switch (level) {
    case "hoog":
      return {
        bg: "bg-green-100 dark:bg-green-900/30",
        text: "text-green-700 dark:text-green-300",
        icon: CheckCircle,
        label: "Hoog",
      };
    case "medium":
      return {
        bg: "bg-yellow-100 dark:bg-yellow-900/30",
        text: "text-yellow-700 dark:text-yellow-300",
        icon: AlertCircle,
        label: "Medium",
      };
    case "laag":
      return {
        bg: "bg-red-100 dark:bg-red-900/30",
        text: "text-red-700 dark:text-red-300",
        icon: AlertTriangle,
        label: "Laag",
      };
    default:
      return {
        bg: "bg-gray-100 dark:bg-gray-800",
        text: "text-gray-700 dark:text-gray-300",
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
      return <Badge className="bg-green-500 text-white text-xs">Vluchtig</Badge>;
    case "normaal":
      return <Badge className="bg-blue-500 text-white text-xs">Normaal</Badge>;
    case "grondig":
      return <Badge className="bg-red-500 text-white text-xs">Grondig</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{depth}</Badge>;
  }
}

/**
 * Compact view for sidebar - now with situatieschets directly visible
 */
const CompactBriefingView = memo(function CompactBriefingView({
  briefing,
  onExpand,
  onRegenerate,
  isRegenerating,
}: {
  briefing: FiscaleBriefing;
  onExpand: () => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
}) {
  return (
    <Card className="border-purple-200 dark:border-purple-800 bg-purple-50/30 dark:bg-purple-950/20">
      <CardHeader className="pb-2 pt-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-purple-600" />
            Executive Summary
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onRegenerate}
              disabled={isRegenerating}
              title="Opnieuw genereren"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isRegenerating && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onExpand}
              title="Fullscreen weergave"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs pt-0">
        {/* Situatieschets - Direct visible */}
        {briefing.situatie_schets && (
          <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-slate-500" />
                <span className="text-muted-foreground">{briefing.situatie_schets.client_profiel}</span>
              </div>
              <div className="text-muted-foreground">
                <span className="font-medium text-foreground">Vermogen: </span>
                {briefing.situatie_schets.vermogenssituatie}
              </div>
              <div className="text-muted-foreground">
                <span className="font-medium text-foreground">Aanleiding: </span>
                {briefing.situatie_schets.aanleiding}
              </div>
              {briefing.situatie_schets.tijdsdruk && (
                <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <Clock className="h-3.5 w-3.5" />
                  <span className="font-medium">{briefing.situatie_schets.tijdsdruk}</span>
                </div>
              )}
              {/* Kernfeiten */}
              {briefing.situatie_schets.kernfeiten && briefing.situatie_schets.kernfeiten.length > 0 && (
                <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700">
                  <p className="font-medium text-foreground mb-1">Kernfeiten:</p>
                  <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                    {briefing.situatie_schets.kernfeiten.map((feit, idx) => (
                      <li key={idx}>{feit}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Case badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {briefing.case_in_een_oogopslag.client_type}
          </Badge>
          {getComplexityBadge(briefing.case_in_een_oogopslag.complexiteit)}
          {briefing.case_in_een_oogopslag.belastingjaren.length > 0 && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {briefing.case_in_een_oogopslag.belastingjaren.join(", ")}
            </div>
          )}
          {briefing.case_in_een_oogopslag.geschatte_financiele_impact && (
            <span className="text-green-600 dark:text-green-400 font-medium">
              {briefing.case_in_een_oogopslag.geschatte_financiele_impact}
            </span>
          )}
        </div>

        {/* Kernvraag */}
        <p className="text-muted-foreground font-medium">
          {briefing.case_in_een_oogopslag.kernvraag}
        </p>

        {/* Mijn Advies - Compact */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 rounded p-2.5 border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-xs">{briefing.mijn_advies.conclusie}</p>
              <div className="flex items-center gap-3 mt-1.5 text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Brain className="h-3 w-3 text-indigo-500" />
                  <span>{briefing.mijn_advies.redenering.length} stappen</span>
                </div>
                <div className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs", getConfidenceStyle(briefing.mijn_advies.confidence).bg, getConfidenceStyle(briefing.mijn_advies.confidence).text)}>
                  {getConfidenceStyle(briefing.mijn_advies.confidence).label}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Expand button */}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onExpand}
        >
          <Maximize2 className="h-3.5 w-3.5 mr-2" />
          Bekijk volledige briefing
        </Button>

        {/* AI Assessment - onderaan met uitleg */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">AI Inschatting</p>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Zekerheid:</span>
              <span className={cn(
                "font-medium",
                briefing.totaal_confidence === "hoog" && "text-green-600",
                briefing.totaal_confidence === "medium" && "text-amber-600",
                briefing.totaal_confidence === "laag" && "text-red-600"
              )}>
                {briefing.totaal_confidence === "hoog" ? "Hoog" : briefing.totaal_confidence === "medium" ? "Medium" : "Laag"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Review nodig:</span>
              <span className={cn(
                "font-medium",
                briefing.aanbeveling_review_diepte === "vluchtig" && "text-green-600",
                briefing.aanbeveling_review_diepte === "normaal" && "text-blue-600",
                briefing.aanbeveling_review_diepte === "grondig" && "text-red-600"
              )}>
                {briefing.aanbeveling_review_diepte === "vluchtig" ? "Vluchtig" : briefing.aanbeveling_review_diepte === "normaal" ? "Normaal" : "Grondig"}
              </span>
            </div>
            {briefing.check_voor_verzending.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Te checken:</span>
                <span className="font-medium">{briefing.check_voor_verzending.length} punten</span>
              </div>
            )}
            {briefing.twijfelpunten && briefing.twijfelpunten.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Twijfelpunten:</span>
                <span className="font-medium text-amber-600">{briefing.twijfelpunten.length}</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

/**
 * Full screen detailed view
 */
const FullScreenBriefingView = memo(function FullScreenBriefingView({
  briefing,
  rawJson,
  onClose,
}: {
  briefing: FiscaleBriefing;
  rawJson: string;
  onClose: () => void;
}) {
  const [isReasoningOpen, setIsReasoningOpen] = useState(true);
  const [isChecklistOpen, setIsChecklistOpen] = useState(true);
  const [isTwijfelOpen, setIsTwijfelOpen] = useState(true);
  const [isAlternativesOpen, setIsAlternativesOpen] = useState(true);
  const [isReviewerOpen, setIsReviewerOpen] = useState(true);
  const [isDebugOpen, setIsDebugOpen] = useState(false);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <BookOpen className="h-6 w-6 text-purple-600" />
            Executive Summary
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Situatie Schets - First thing a new fiscalist sees */}
          {briefing.situatie_schets && (
            <div className="bg-slate-50 dark:bg-slate-950/30 rounded-lg p-5 border border-slate-200 dark:border-slate-800">
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center shrink-0">
                  <User className="h-6 w-6 text-slate-600 dark:text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold mb-3">Situatieschets</h3>

                  <div className="grid gap-3 text-sm">
                    <div>
                      <span className="font-medium text-slate-700 dark:text-slate-300">Klant: </span>
                      <span className="text-muted-foreground">{briefing.situatie_schets.client_profiel}</span>
                    </div>
                    <div>
                      <span className="font-medium text-slate-700 dark:text-slate-300">Vermogen: </span>
                      <span className="text-muted-foreground">{briefing.situatie_schets.vermogenssituatie}</span>
                    </div>
                    <div>
                      <span className="font-medium text-slate-700 dark:text-slate-300">Aanleiding: </span>
                      <span className="text-muted-foreground">{briefing.situatie_schets.aanleiding}</span>
                    </div>
                    {briefing.situatie_schets.tijdsdruk && (
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-amber-500" />
                        <span className="font-medium text-amber-700 dark:text-amber-300">{briefing.situatie_schets.tijdsdruk}</span>
                      </div>
                    )}
                  </div>

                  {/* Kernfeiten als bullets */}
                  {briefing.situatie_schets.kernfeiten && briefing.situatie_schets.kernfeiten.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                      <p className="font-medium text-slate-700 dark:text-slate-300 text-sm mb-2">Kernfeiten:</p>
                      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                        {briefing.situatie_schets.kernfeiten.map((feit, idx) => (
                          <li key={idx}>{feit}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Case at a glance */}
          <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-5 border border-purple-200 dark:border-purple-800">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center shrink-0">
                <Eye className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <Badge variant="outline" className="text-sm">
                    {briefing.case_in_een_oogopslag.client_type}
                  </Badge>
                  {getComplexityBadge(briefing.case_in_een_oogopslag.complexiteit)}
                  {briefing.case_in_een_oogopslag.belastingjaren.length > 0 && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      {briefing.case_in_een_oogopslag.belastingjaren.join(", ")}
                    </div>
                  )}
                </div>
                <p className="text-base font-medium">
                  {briefing.case_in_een_oogopslag.kernvraag}
                </p>
                {briefing.case_in_een_oogopslag.geschatte_financiele_impact && (
                  <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                    Geschat belang: {briefing.case_in_een_oogopslag.geschatte_financiele_impact}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Mijn Advies */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 rounded-lg p-5 border border-blue-200 dark:border-blue-800">
            <div className="flex items-start gap-4">
              <Sparkles className="h-6 w-6 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-base font-semibold">Mijn Advies</h3>
                  <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-xs", getConfidenceStyle(briefing.mijn_advies.confidence).bg, getConfidenceStyle(briefing.mijn_advies.confidence).text)}>
                    {getConfidenceStyle(briefing.mijn_advies.confidence).label} confidence
                  </div>
                </div>
                <p className="text-muted-foreground">
                  {briefing.mijn_advies.conclusie}
                </p>
              </div>
            </div>
          </div>

          {/* Reasoning Chain - Collapsible */}
          <Collapsible open={isReasoningOpen} onOpenChange={setIsReasoningOpen}>
            <div className="bg-white dark:bg-gray-900 rounded-lg border">
              <CollapsibleTrigger className="w-full p-5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg transition-colors">
                <div className="flex items-center gap-4">
                  <Brain className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                  <div className="text-left">
                    <h3 className="text-base font-semibold">Mijn Redenering</h3>
                    <p className="text-sm text-muted-foreground">{briefing.mijn_advies.redenering.length} stappen - bekijk hoe ik tot dit advies kwam</p>
                  </div>
                </div>
                {isReasoningOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-5 pb-5 space-y-4">
                  {briefing.mijn_advies.redenering.map((stap, idx) => {
                    const stepConfidence = getConfidenceStyle(stap.confidence);
                    return (
                      <div key={idx} className="relative pl-8 pb-4 last:pb-0">
                        {idx < briefing.mijn_advies.redenering.length - 1 && (
                          <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-indigo-200 dark:bg-indigo-800" />
                        )}
                        <div className="absolute left-0 top-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                          {stap.stap}
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 ml-2">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <p className="font-medium text-indigo-700 dark:text-indigo-300">
                              {stap.vraag}
                            </p>
                            <div className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs shrink-0", stepConfidence.bg, stepConfidence.text)}>
                              {stepConfidence.label}
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">{stap.analyse}</p>
                          <p className="font-medium">
                            → {stap.conclusie}
                          </p>
                          {stap.bronnen && stap.bronnen.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
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

          {/* Alternatives - Collapsible */}
          {briefing.mijn_advies.overwogen_alternatieven && briefing.mijn_advies.overwogen_alternatieven.length > 0 && (
            <Collapsible open={isAlternativesOpen} onOpenChange={setIsAlternativesOpen}>
              <div className="bg-white dark:bg-gray-900 rounded-lg border">
                <CollapsibleTrigger className="w-full p-5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg transition-colors">
                  <div className="flex items-center gap-4">
                    <HelpCircle className="h-6 w-6 text-gray-600 dark:text-gray-400" />
                    <div className="text-left">
                      <h3 className="text-base font-semibold">Overwogen Alternatieven</h3>
                      <p className="text-sm text-muted-foreground">{briefing.mijn_advies.overwogen_alternatieven.length} andere opties bekeken</p>
                    </div>
                  </div>
                  {isAlternativesOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-5 pb-5 space-y-3">
                    {briefing.mijn_advies.overwogen_alternatieven.map((alt, idx) => (
                      <div key={idx} className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                        <p className="font-medium">{alt.optie}</p>
                        <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                          ✗ Niet gekozen: {alt.waarom_niet}
                        </p>
                        {alt.wanneer_wel && (
                          <p className="text-sm text-green-600 dark:text-green-400 mt-1">
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

          {/* Twijfelpunten - Collapsible */}
          {briefing.twijfelpunten && briefing.twijfelpunten.length > 0 && (
            <Collapsible open={isTwijfelOpen} onOpenChange={setIsTwijfelOpen}>
              <div className="bg-white dark:bg-gray-900 rounded-lg border border-amber-200 dark:border-amber-800">
                <CollapsibleTrigger className="w-full p-5 flex items-center justify-between hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-lg transition-colors">
                  <div className="flex items-center gap-4">
                    <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                    <div className="text-left">
                      <h3 className="text-base font-semibold text-amber-700 dark:text-amber-300">Waar Ik Twijfelde</h3>
                      <p className="text-sm text-muted-foreground">{briefing.twijfelpunten.length} punt(en) met meerdere interpretaties</p>
                    </div>
                  </div>
                  {isTwijfelOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-5 pb-5 space-y-3">
                    {briefing.twijfelpunten.map((twijfel, idx) => (
                      <div key={idx} className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                        <p className="font-medium text-amber-800 dark:text-amber-200">{twijfel.onderwerp}</p>
                        <div className="mt-2 text-sm space-y-1">
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

          {/* Check voor verzending - Collapsible */}
          <Collapsible open={isChecklistOpen} onOpenChange={setIsChecklistOpen}>
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-green-200 dark:border-green-800">
              <CollapsibleTrigger className="w-full p-5 flex items-center justify-between hover:bg-green-50 dark:hover:bg-green-950/30 rounded-lg transition-colors">
                <div className="flex items-center gap-4">
                  <ListChecks className="h-6 w-6 text-green-600 dark:text-green-400" />
                  <div className="text-left">
                    <h3 className="text-base font-semibold text-green-700 dark:text-green-300">Check Voor Verzending</h3>
                    <p className="text-sm text-muted-foreground">{briefing.check_voor_verzending.length} item(s) om te checken</p>
                  </div>
                </div>
                {isChecklistOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-5 pb-5 space-y-3">
                  {briefing.check_voor_verzending.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-950/30">
                      <div className="shrink-0 mt-0.5">
                        {getPriorityBadge(item.prioriteit)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{item.wat}</p>
                        <p className="text-sm text-muted-foreground mt-1">{item.waarom}</p>
                      </div>
                      {item.geschatte_tijd && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
                          <Clock className="h-4 w-4" />
                          {item.geschatte_tijd}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          {/* Reviewer Highlights - Collapsible */}
          {briefing.reviewer_highlights && briefing.reviewer_highlights.length > 0 && (
            <Collapsible open={isReviewerOpen} onOpenChange={setIsReviewerOpen}>
              <div className="bg-white dark:bg-gray-900 rounded-lg border">
                <CollapsibleTrigger className="w-full p-5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg transition-colors">
                  <div className="flex items-center gap-4">
                    <MessageSquare className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                    <div className="text-left">
                      <h3 className="text-base font-semibold">AI Reviewer Highlights</h3>
                      <p className="text-sm text-muted-foreground">{briefing.reviewer_highlights.length} reviewer(s) met feedback</p>
                    </div>
                  </div>
                  {isReviewerOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-5 pb-5 space-y-3">
                    {briefing.reviewer_highlights.map((highlight, idx) => (
                      <div key={idx} className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium">{highlight.reviewer}</p>
                          <Badge variant={highlight.impact === "hoog" ? "destructive" : highlight.impact === "medium" ? "default" : "secondary"} className="text-xs">
                            {highlight.impact} impact
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{highlight.belangrijkste_feedback}</p>
                        <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                          → {highlight.actie_genomen}
                        </p>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {/* AI Assessment - onderaan met uitleg */}
          <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold mb-3">AI Inschatting</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Zekerheid AI</p>
                <p className={cn(
                  "font-medium",
                  briefing.totaal_confidence === "hoog" && "text-green-600",
                  briefing.totaal_confidence === "medium" && "text-amber-600",
                  briefing.totaal_confidence === "laag" && "text-red-600"
                )}>
                  {briefing.totaal_confidence === "hoog" ? "Hoog" : briefing.totaal_confidence === "medium" ? "Medium" : "Laag"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Review diepte</p>
                <p className={cn(
                  "font-medium",
                  briefing.aanbeveling_review_diepte === "vluchtig" && "text-green-600",
                  briefing.aanbeveling_review_diepte === "normaal" && "text-blue-600",
                  briefing.aanbeveling_review_diepte === "grondig" && "text-red-600"
                )}>
                  {briefing.aanbeveling_review_diepte === "vluchtig" ? "Vluchtig" : briefing.aanbeveling_review_diepte === "normaal" ? "Normaal" : "Grondig"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Te checken</p>
                <p className="font-medium">{briefing.check_voor_verzending.length} punten</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Twijfelpunten</p>
                <p className={cn("font-medium", (briefing.twijfelpunten?.length || 0) > 0 && "text-amber-600")}>
                  {briefing.twijfelpunten?.length || 0}
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground italic mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
              {briefing.confidence_toelichting}
            </p>
          </div>

          {/* Debug / Developer Tools */}
          <Collapsible open={isDebugOpen} onOpenChange={setIsDebugOpen}>
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-300 dark:border-gray-700">
              <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg transition-colors">
                <div className="flex items-center gap-3">
                  <Code className="h-5 w-5 text-gray-500" />
                  <div className="text-left">
                    <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">Developer Tools</h3>
                    <p className="text-xs text-muted-foreground">Bekijk ruwe JSON output</p>
                  </div>
                </div>
                {isDebugOpen ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4">
                  <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs overflow-x-auto max-h-96 overflow-y-auto font-mono">
                    {rawJson}
                  </pre>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>
      </DialogContent>
    </Dialog>
  );
});

/**
 * Empty state with generate button
 */
const EmptyBriefingState = memo(function EmptyBriefingState({
  onGenerate,
  isGenerating,
}: {
  onGenerate: () => void;
  isGenerating: boolean;
}) {
  return (
    <Card className="border-purple-200 dark:border-purple-800 bg-purple-50/30 dark:bg-purple-950/20">
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-purple-600" />
          Executive Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-4">
          <Sparkles className="h-8 w-8 mx-auto mb-3 text-purple-400 opacity-60" />
          <p className="text-sm text-muted-foreground mb-3">
            Genereer een executive summary voor snelle review
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onGenerate}
            disabled={isGenerating}
            className="gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Genereren...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Genereer Briefing
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});

/**
 * Main Panel Component
 */
export const FiscaleBriefingPanel = memo(function FiscaleBriefingPanel({
  reportId,
  stageResults,
  className,
}: FiscaleBriefingPanelProps) {
  const [showFullScreen, setShowFullScreen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const briefingJson = stageResults?.["7_fiscale_briefing"];

  const briefing = useMemo(
    () => (briefingJson ? parseBriefing(briefingJson) : null),
    [briefingJson]
  );

  // Mutation for generating briefing
  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/reports/${reportId}/fiscale-briefing`);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Briefing gegenereerd",
        description: "De executive summary is succesvol aangemaakt",
      });
      // Refresh report data to get the new briefing
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${reportId}`] });
    },
    onError: (error: Error) => {
      toast({
        title: "Fout bij genereren",
        description: error.message || "Er ging iets mis bij het genereren van de briefing",
        variant: "destructive",
      });
    },
  });

  // Show empty state with generate button if no briefing
  if (!briefing) {
    return (
      <div className={className}>
        <EmptyBriefingState
          onGenerate={() => generateMutation.mutate()}
          isGenerating={generateMutation.isPending}
        />
      </div>
    );
  }

  return (
    <>
      <div className={className}>
        <CompactBriefingView
          briefing={briefing}
          onExpand={() => setShowFullScreen(true)}
          onRegenerate={() => generateMutation.mutate()}
          isRegenerating={generateMutation.isPending}
        />
      </div>

      {showFullScreen && (
        <FullScreenBriefingView
          briefing={briefing}
          rawJson={briefingJson || ""}
          onClose={() => setShowFullScreen(false)}
        />
      )}
    </>
  );
});
