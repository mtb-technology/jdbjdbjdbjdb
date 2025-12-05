/**
 * ReportAdjustmentDialog Component
 *
 * Modal dialog for the "Rapport Aanpassen" feature.
 * Two-step flow:
 * 1. Input instruction → AI generates JSON adjustments
 * 2. Review each adjustment (accept/edit/reject) → AI applies accepted changes
 */

import { memo, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Pencil,
  AlertCircle,
  Check,
  X,
  Edit3,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Code2,
  Copy,
  Sparkles,
} from "lucide-react";
import {
  useReportAdjustment,
  type ReviewableAdjustment,
  type AdjustmentStatus,
  type DebugInfo,
} from "@/hooks/useReportAdjustment";

interface ReportAdjustmentDialogProps {
  reportId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Callback when adjustments are successfully applied - use to refresh editor content */
  onAdjustmentApplied?: () => void;
}

// Developer Tools Panel for debugging prompts
const DevToolsPanel = memo(function DevToolsPanel({
  debugInfo,
  title,
}: {
  debugInfo: DebugInfo | null;
  title: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  // Always show the panel - even when no debug info (shows "no data" message)
  const hasDebugInfo = debugInfo !== null;

  return (
    <div className="border border-dashed border-border/50 rounded-lg overflow-hidden mt-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-muted/30 transition-colors text-muted-foreground"
      >
        <span className="text-xs flex items-center gap-2">
          <Code2 className="w-3 h-3" />
          Developer Tools - {title}
        </span>
        {isExpanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
      </button>

      {isExpanded && (
        <div className="p-4 border-t border-dashed border-border/50 space-y-3">
          {!hasDebugInfo ? (
            <div className="text-center py-4">
              <p className="text-xs text-muted-foreground">
                Geen debug informatie beschikbaar. Dit kan betekenen:
              </p>
              <ul className="text-xs text-muted-foreground mt-2 space-y-1">
                <li>• De server is niet herstart na code wijzigingen</li>
                <li>• De API call heeft geen _debug object geretourneerd</li>
                <li>• Er was een error voordat de AI werd aangeroepen</li>
              </ul>
            </div>
          ) : (
            <>
              {/* AI Config Summary */}
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs">
                  Stage: {debugInfo.stage}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  Provider: {debugInfo.aiConfig.provider}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  Model: {debugInfo.aiConfig.model}
                </Badge>
                {debugInfo.aiConfig.temperature !== undefined && (
                  <Badge variant="outline" className="text-xs">
                    Temp: {debugInfo.aiConfig.temperature}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  Prompt: {debugInfo.promptLength.toLocaleString()} chars
                </Badge>
              </div>

              {/* Parse Error Alert */}
              {(debugInfo as DebugInfo & { parseError?: string; rawResponse?: string }).parseError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">Parse Error:</p>
                  <p className="text-xs text-red-500">{(debugInfo as DebugInfo & { parseError?: string }).parseError}</p>
                </div>
              )}

              {/* Raw AI Response (when parse failed) */}
              {(debugInfo as DebugInfo & { rawResponse?: string }).rawResponse && (
                <div className="border border-orange-500/30 rounded-lg bg-orange-50/50 dark:bg-orange-950/20 p-3">
                  <p className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-2">Raw AI Response (first 2000 chars):</p>
                  <div className="bg-gray-50 dark:bg-gray-900 p-2 rounded border border-gray-300 dark:border-gray-700 font-mono text-xs overflow-auto max-h-48">
                    <pre className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200">
                      {(debugInfo as DebugInfo & { rawResponse?: string }).rawResponse}
                    </pre>
                  </div>
                </div>
              )}

              {/* Prompt content */}
              <div className="border border-blue-500/30 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 overflow-hidden">
                <button
                  onClick={() => setIsPromptExpanded(!isPromptExpanded)}
                  className="w-full px-3 py-2 flex items-center justify-between hover:bg-blue-100/50 dark:hover:bg-blue-950/30 transition-colors"
                >
                  <span className="font-medium text-xs flex items-center gap-2 text-blue-600 dark:text-blue-400">
                    <Code2 className="w-3 h-3" />
                    Raw LLM Input
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs bg-white dark:bg-background">
                      {debugInfo.promptLength.toLocaleString()} chars
                    </Badge>
                    {isPromptExpanded ? (
                      <ChevronDown className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                    )}
                  </div>
                </button>
                {isPromptExpanded && (
                  <div className="px-3 py-3 bg-white dark:bg-background border-t border-blue-500/30">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Exacte prompt naar LLM</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopy(debugInfo.promptUsed)}
                        className="h-6 w-6 p-0"
                      >
                        {copied ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </Button>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded border border-gray-300 dark:border-gray-700 font-mono text-xs overflow-auto max-h-64">
                      <pre
                        className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200"
                        style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
                      >
                        {debugInfo.promptUsed}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
});

// Individual adjustment review card
const AdjustmentCard = memo(function AdjustmentCard({
  adjustment,
  index,
  onStatusChange,
}: {
  adjustment: ReviewableAdjustment;
  index: number;
  onStatusChange: (id: string, status: AdjustmentStatus, modifiedNieuw?: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedNieuw, setEditedNieuw] = useState(adjustment.nieuw);

  const handleAccept = () => {
    onStatusChange(adjustment.id, "accepted");
  };

  const handleReject = () => {
    onStatusChange(adjustment.id, "rejected");
  };

  const handleEdit = () => {
    setIsEditing(true);
    setEditedNieuw(adjustment.modifiedNieuw || adjustment.nieuw);
  };

  const handleSaveEdit = () => {
    onStatusChange(adjustment.id, "modified", editedNieuw);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedNieuw(adjustment.nieuw);
  };

  const getStatusColor = () => {
    switch (adjustment.status) {
      case "accepted": return "bg-green-500/10 border-green-500/30";
      case "modified": return "bg-blue-500/10 border-blue-500/30";
      case "rejected": return "bg-red-500/10 border-red-500/30";
      default: return "bg-muted/50 border-border";
    }
  };

  const getStatusBadge = () => {
    switch (adjustment.status) {
      case "accepted": return <Badge className="bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30">Geaccepteerd</Badge>;
      case "modified": return <Badge className="bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30">Aangepast</Badge>;
      case "rejected": return <Badge className="bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30">Afgewezen</Badge>;
      default: return <Badge variant="outline">Te beoordelen</Badge>;
    }
  };

  return (
    <div className={`border rounded-lg p-4 transition-colors ${getStatusColor()}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-mono text-sm text-muted-foreground">#{index + 1}</span>
          <span className="font-medium truncate">{adjustment.context}</span>
          {getStatusBadge()}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {isExpanded && (
        <>
          {/* Reason */}
          <p className="text-sm text-muted-foreground mb-4 italic">
            {adjustment.reden}
          </p>

          {/* Old vs New comparison */}
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-red-600 dark:text-red-400 uppercase tracking-wide font-medium">Oud</label>
              <div className="mt-1 p-3 bg-red-500/5 border border-red-500/20 rounded text-sm font-mono whitespace-pre-wrap">
                {adjustment.oud}
              </div>
            </div>
            <div>
              <label className="text-xs text-green-600 dark:text-green-400 uppercase tracking-wide font-medium">Nieuw</label>
              {isEditing ? (
                <Textarea
                  value={editedNieuw}
                  onChange={(e) => setEditedNieuw(e.target.value)}
                  className="mt-1 font-mono text-sm min-h-[100px]"
                />
              ) : (
                <div className="mt-1 p-3 bg-green-500/5 border border-green-500/20 rounded text-sm font-mono whitespace-pre-wrap">
                  {adjustment.status === "modified" && adjustment.modifiedNieuw
                    ? adjustment.modifiedNieuw
                    : adjustment.nieuw}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Button size="sm" onClick={handleSaveEdit}>
                  <Check className="h-3 w-3 mr-1" />
                  Opslaan
                </Button>
                <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                  Annuleren
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant={adjustment.status === "accepted" ? "default" : "outline"}
                  className={adjustment.status === "accepted" ? "bg-green-600 hover:bg-green-700" : ""}
                  onClick={handleAccept}
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Accepteer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleEdit}
                >
                  <Edit3 className="h-3 w-3 mr-1" />
                  Bewerk
                </Button>
                <Button
                  size="sm"
                  variant={adjustment.status === "rejected" ? "destructive" : "outline"}
                  onClick={handleReject}
                >
                  <XCircle className="h-3 w-3 mr-1" />
                  Afwijzen
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
});

export const ReportAdjustmentDialog = memo(function ReportAdjustmentDialog({
  reportId,
  isOpen,
  onOpenChange,
  onAdjustmentApplied,
}: ReportAdjustmentDialogProps) {
  const {
    stage,
    instruction,
    proposedAdjustments,
    resultContent,
    appliedCount,
    error,
    isAnalyzing,
    isApplying,
    analyzeDebugInfo,
    applyDebugInfo,
    setInstruction,
    generateProposal,
    setAdjustmentStatus,
    acceptAll,
    rejectAll,
    applyAdjustments,
    goBackToInput,
    closeDialog,
  } = useReportAdjustment(reportId);

  // Sync external open state with hook
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // If dialog is closing after successful application, trigger refresh callback
      if (stage === "complete" && onAdjustmentApplied) {
        onAdjustmentApplied();
      }
      closeDialog();
    }
    onOpenChange(open);
  };

  const acceptedCount = proposedAdjustments.filter(
    adj => adj.status === "accepted" || adj.status === "modified"
  ).length;

  // Determine dialog size based on stage
  const dialogSize = stage === "review" || stage === "complete"
    ? "max-w-4xl h-[85vh]"
    : "max-w-xl";

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className={`${dialogSize} flex flex-col`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            Rapport Aanpassen
          </DialogTitle>
          <DialogDescription>
            {stage === "input" &&
              "Geef een instructie voor de aanpassing die je wilt doorvoeren."}
            {stage === "analyzing" &&
              "De AI analyseert je instructie en genereert voorgestelde aanpassingen..."}
            {stage === "review" &&
              "Beoordeel elke aanpassing hieronder en pas toe."}
            {stage === "applying" &&
              "De AI past de geselecteerde aanpassingen toe..."}
            {stage === "complete" &&
              "Aanpassingen zijn succesvol toegepast!"}
          </DialogDescription>
        </DialogHeader>

        {/* Error display */}
        {error && (
          <Alert variant="destructive" className="mx-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Stage: Input */}
        {stage === "input" && (
          <div className="flex flex-col gap-4 p-4 pt-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Wat wil je aanpassen?
              </label>
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Bijv: Voeg een paragraaf toe over de fiscale implicaties van de bedrijfsoverdracht. Of: Verwijder de sectie over box 3 vermogen."
                className="min-h-[150px] resize-none"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Minimaal 10 karakters. Wees zo specifiek mogelijk.
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Annuleren
              </Button>
              <Button
                onClick={generateProposal}
                disabled={instruction.length < 10 || isAnalyzing}
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Analyseren...
                  </>
                ) : (
                  "Aanpassing Genereren"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Stage: Analyzing */}
        {stage === "analyzing" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              De AI analyseert je instructie en genereert voorgestelde aanpassingen...
            </p>
            <p className="text-xs text-muted-foreground">
              Dit kan enkele seconden duren.
            </p>
          </div>
        )}

        {/* Stage: Review */}
        {stage === "review" && (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {/* Review Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <span className="font-medium">
                {proposedAdjustments.length} voorgestelde aanpassingen
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={acceptAll}>
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Accepteer Alle
                </Button>
                <Button variant="outline" size="sm" onClick={rejectAll}>
                  <XCircle className="h-4 w-4 mr-1" />
                  Wijs Alle Af
                </Button>
              </div>
            </div>

            {/* Adjustment Cards */}
            <ScrollArea className="flex-1 p-4">
              {proposedAdjustments.length === 0 ? (
                <div className="text-center py-8">
                  <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-semibold mb-2">Geen aanpassingen gevonden</h3>
                  <p className="text-muted-foreground mb-4">
                    De AI heeft geen specifieke aanpassingen kunnen identificeren.
                    Probeer je instructie specifieker te maken.
                  </p>
                  <Button onClick={goBackToInput}>
                    Opnieuw proberen
                  </Button>
                  {/* Developer Tools - show even when no adjustments */}
                  <DevToolsPanel
                    debugInfo={analyzeDebugInfo}
                    title="Analyse (Rapport Aanpassen)"
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  {proposedAdjustments.map((adj, index) => (
                    <AdjustmentCard
                      key={adj.id}
                      adjustment={adj}
                      index={index}
                      onStatusChange={setAdjustmentStatus}
                    />
                  ))}
                </div>
              )}

              {/* Developer Tools */}
              <DevToolsPanel
                debugInfo={analyzeDebugInfo}
                title="Analyse (Rapport Aanpassen)"
              />
            </ScrollArea>

            {/* Apply Footer */}
            {proposedAdjustments.length > 0 && (
              <div className="border-t p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {acceptedCount} van {proposedAdjustments.length} aanpassingen geselecteerd
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Klik op "Toepassen" om de geselecteerde aanpassingen te verwerken.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={goBackToInput}>
                    <X className="h-4 w-4 mr-2" />
                    Terug
                  </Button>
                  <Button
                    onClick={applyAdjustments}
                    disabled={isApplying || acceptedCount === 0}
                  >
                    {isApplying ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Toepassen...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Toepassen ({acceptedCount})
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stage: Applying */}
        {stage === "applying" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              De AI past de geselecteerde aanpassingen toe op het rapport...
            </p>
            <p className="text-xs text-muted-foreground">
              Dit kan enkele seconden duren.
            </p>
          </div>
        )}

        {/* Stage: Complete */}
        {stage === "complete" && (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <div className="flex items-center gap-4 p-4 bg-green-500/10 border-b border-green-500/20">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <div>
                <h3 className="font-semibold text-green-700 dark:text-green-400">
                  Aanpassingen Toegepast
                </h3>
                <p className="text-sm text-green-600 dark:text-green-500">
                  {appliedCount} aanpassing{appliedCount !== 1 ? "en" : ""} succesvol verwerkt.
                  Het rapport is bijgewerkt - sluit dit venster om de nieuwe versie te zien.
                </p>
              </div>
            </div>

            <ScrollArea className="flex-1 p-4">
              {/* Result Content Preview */}
              {resultContent && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium mb-2">Aangepast Rapport (preview):</h4>
                  <div className="border rounded-lg p-4 bg-muted/30 max-h-[300px] overflow-auto">
                    <pre className="whitespace-pre-wrap text-sm font-mono">
                      {resultContent.substring(0, 3000)}
                      {resultContent.length > 3000 && "..."}
                    </pre>
                  </div>
                </div>
              )}

              {/* Developer Tools */}
              <DevToolsPanel
                debugInfo={applyDebugInfo}
                title="Toepassen (Editor)"
              />
              <DevToolsPanel
                debugInfo={analyzeDebugInfo}
                title="Analyse (Rapport Aanpassen)"
              />
            </ScrollArea>

            <div className="border-t p-4 flex justify-end gap-3">
              <Button onClick={() => handleOpenChange(false)}>
                Sluiten
              </Button>
              <Button variant="outline" onClick={goBackToInput}>
                <Sparkles className="h-4 w-4 mr-2" />
                Nieuwe Aanpassing
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});
