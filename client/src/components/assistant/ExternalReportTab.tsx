/**
 * ExternalReportTab Component
 *
 * Tab for pasting external reports and getting AI-assisted adjustments.
 * Two-step flow:
 * 1. Paste report + instruction → AI generates JSON with proposed adjustments
 * 2. Review each adjustment (accept/edit/reject) → AI applies accepted changes
 */

import { memo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  Sparkles,
  Check,
  X,
  RefreshCw,
  AlertCircle,
  Edit3,
  CheckCircle2,
  XCircle,
  Copy,
  ChevronDown,
  ChevronUp,
  Code2,
  ChevronRight,
} from "lucide-react";
import { useExternalReportSession, type ReviewableAdjustment, type AdjustmentStatus, type DebugInfo } from "@/hooks/useExternalReportSession";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Developer Tools Panel for debugging prompts
const ExternalReportDevTools = memo(function ExternalReportDevTools({
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
              {(debugInfo as DebugInfo & { parseError?: string }).parseError && (
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
                    <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded border border-gray-300 dark:border-gray-700 font-mono text-xs overflow-auto max-h-96">
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

interface ExternalReportTabProps {
  /** Session ID to load from sidebar */
  sessionIdToLoad?: string;
  /** Callback when current session changes (for sidebar sync) */
  onSessionChange?: (sessionId: string | undefined) => void;
}

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
      case "accepted": return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Geaccepteerd</Badge>;
      case "modified": return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Aangepast</Badge>;
      case "rejected": return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Afgewezen</Badge>;
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
              <Label className="text-xs text-red-400 uppercase tracking-wide">Oud</Label>
              <div className="mt-1 p-3 bg-red-500/5 border border-red-500/20 rounded text-sm font-mono whitespace-pre-wrap">
                {adjustment.oud}
              </div>
            </div>
            <div>
              <Label className="text-xs text-green-400 uppercase tracking-wide">Nieuw</Label>
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

export const ExternalReportTab = memo(function ExternalReportTab({
  sessionIdToLoad,
  onSessionChange,
}: ExternalReportTabProps) {
  const { toast } = useToast();
  const {
    currentSession,
    stage,
    originalContent,
    setOriginalContent,
    instruction,
    setInstruction,
    proposedAdjustments,
    setAdjustmentStatus,
    acceptAll,
    rejectAll,
    resultContent,
    appliedCount,
    analyzeDebugInfo,
    applyDebugInfo,
    error,
    isCreating,
    isAnalyzing,
    isApplying,
    createAndAnalyze,
    loadSession,
    applyAdjustments,
    reset,
    startNewAdjustment,
  } = useExternalReportSession();

  // Load session when sessionIdToLoad changes
  // useEffect removed - handled by parent

  // Notify parent when current session changes
  // useEffect removed - handled by parent

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    toast({
      title: "Gekopieerd",
      description: "Tekst is naar het klembord gekopieerd.",
    });
  };

  const isProcessing = isCreating || isAnalyzing;
  const acceptedCount = (proposedAdjustments || []).filter(
    adj => adj.status === "accepted" || adj.status === "modified"
  ).length;

  return (
    <div className="space-y-6">
      {/* Error Display */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Fout</p>
            <p className="text-sm text-destructive/80">{error}</p>
          </div>
        </div>
      )}

      {/* Stage: Input */}
      {(stage === "input" || stage === "analyzing") && !currentSession && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Extern Rapport Aanpassen
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="original-content">
                  1. Plak het rapport dat je wilt aanpassen
                </Label>
                <Textarea
                  id="original-content"
                  value={originalContent}
                  onChange={(e) => setOriginalContent(e.target.value)}
                  placeholder="Plak hier de volledige tekst van het rapport..."
                  className="mt-1 min-h-[300px] font-mono text-sm"
                  disabled={isProcessing}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {originalContent.length} karakters
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Gewenste Aanpassing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="adjustment-instruction">
                  2. Beschrijf wat je wilt aanpassen
                </Label>
                <Textarea
                  id="adjustment-instruction"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Bijv. Pas de WOZ-waarde aan naar €450.000 en herbereken alle belastingbedragen..."
                  className="mt-1 min-h-[120px]"
                  disabled={isProcessing}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Minimaal 10 karakters ({instruction.length}/10)
                </p>
              </div>
              <Button
                onClick={createAndAnalyze}
                disabled={isProcessing || originalContent.length < 10 || instruction.length < 10}
                size="lg"
                className="w-full"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {isCreating ? "Sessie aanmaken..." : "Aanpassingen analyseren..."}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Analyseer & Genereer Aanpassingen
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {/* Stage: Review - Show proposed adjustments */}
      {stage === "review" && (proposedAdjustments || []).length > 0 && (
        <>
          {/* Review Header */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Edit3 className="h-5 w-5" />
                  Voorgestelde Aanpassingen ({(proposedAdjustments || []).length})
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
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Beoordeel elke aanpassing hieronder. Je kunt aanpassingen accepteren, bewerken, of afwijzen.
                Alleen geaccepteerde en bewerkte aanpassingen worden toegepast.
              </p>
              {/* Developer Tools - Analyze */}
              <ExternalReportDevTools
                debugInfo={analyzeDebugInfo}
                title="Analyse (Rapport Aanpassen)"
              />
            </CardContent>
          </Card>

          {/* Adjustment Cards */}
          <div className="space-y-4">
            {(proposedAdjustments || []).map((adj, index) => (
              <AdjustmentCard
                key={adj.id}
                adjustment={adj}
                index={index}
                onStatusChange={setAdjustmentStatus}
              />
            ))}
          </div>

          {/* Apply Button */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-medium">
                    {acceptedCount} van {(proposedAdjustments || []).length} aanpassingen geselecteerd
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Klik op "Toepassen" om de geselecteerde aanpassingen te verwerken.
                  </p>
                </div>
                <Badge variant={acceptedCount > 0 ? "default" : "secondary"}>
                  {acceptedCount} geselecteerd
                </Badge>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={applyAdjustments}
                  disabled={isApplying || acceptedCount === 0}
                  className="flex-1"
                >
                  {isApplying ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Aanpassingen toepassen...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Toepassen ({acceptedCount})
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={reset}>
                  <X className="h-4 w-4 mr-2" />
                  Annuleren
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Stage: Review - No adjustments found */}
      {stage === "review" && (proposedAdjustments || []).length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-2">Geen aanpassingen gevonden</h3>
            <p className="text-muted-foreground mb-4">
              De AI heeft geen specifieke aanpassingen kunnen identificeren op basis van je instructie.
              Probeer je instructie specifieker te maken.
            </p>
            <Button onClick={reset}>
              Opnieuw proberen
            </Button>
            {/* Developer Tools - show even when no adjustments */}
            <ExternalReportDevTools
              debugInfo={analyzeDebugInfo}
              title="Analyse (Rapport Aanpassen)"
            />
          </CardContent>
        </Card>
      )}

      {/* Stage: Applying */}
      {stage === "applying" && (
        <Card>
          <CardContent className="pt-6 text-center">
            <RefreshCw className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
            <h3 className="font-semibold mb-2">Aanpassingen worden toegepast...</h3>
            <p className="text-muted-foreground">
              De AI verwerkt de geselecteerde aanpassingen in het rapport.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Stage: Complete - Show result */}
      {stage === "complete" && resultContent && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  Aanpassingen Toegepast
                </span>
                <Badge className="bg-green-500/20 text-green-400">
                  {appliedCount} aanpassing{appliedCount !== 1 ? "en" : ""} verwerkt
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Het rapport is succesvol aangepast. Je kunt de nieuwe versie hieronder bekijken en kopiëren.
              </p>
              <div className="flex gap-2">
                <Button onClick={() => handleCopy(resultContent)}>
                  <Copy className="h-4 w-4 mr-2" />
                  Kopieer Rapport
                </Button>
                <Button variant="outline" onClick={startNewAdjustment}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Nieuwe Aanpassing
                </Button>
                <Button variant="outline" onClick={reset}>
                  Nieuwe Sessie
                </Button>
              </div>
              {/* Developer Tools - Apply */}
              <ExternalReportDevTools
                debugInfo={applyDebugInfo}
                title="Toepassen (Editor)"
              />
              <ExternalReportDevTools
                debugInfo={analyzeDebugInfo}
                title="Analyse (Rapport Aanpassen)"
              />
            </CardContent>
          </Card>

          {/* Result Preview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Aangepast Rapport
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px] border rounded-md p-6">
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {resultContent}
                  </ReactMarkdown>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}

      {/* Existing session loaded - show instruction input */}
      {currentSession && stage === "input" && (
        <>
          {/* Session Header */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">{currentSession.title}</h3>
              <p className="text-sm text-muted-foreground">
                {currentSession.adjustmentCount || 0} aanpassing(en) • Versie {(currentSession.adjustmentCount || 0) + 1}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={reset}>
              Nieuwe Sessie
            </Button>
          </div>

          {/* Current Report Preview */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Huidige Rapport Versie</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px] border rounded-md p-4">
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {currentSession.currentContent || currentSession.originalContent}
                  </ReactMarkdown>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* New Instruction Input */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Nieuwe Aanpassing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="new-instruction">
                  Wat wil je aanpassen?
                </Label>
                <Textarea
                  id="new-instruction"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Bijv. Corrigeer het belastingtarief naar 31%..."
                  className="mt-1 min-h-[120px]"
                  disabled={isAnalyzing}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Minimaal 10 karakters ({instruction.length}/10)
                </p>
              </div>
              <Button
                onClick={() => loadSession(currentSession.id)}
                disabled={isAnalyzing || instruction.length < 10}
              >
                {isAnalyzing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Analyseren...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Analyseer Aanpassingen
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
});
