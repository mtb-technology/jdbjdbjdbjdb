/**
 * ExternalReportTab Component
 *
 * Tab for pasting external reports and getting AI-assisted adjustments.
 * Shows diff preview and allows accept/reject of proposed changes.
 * Sessions are managed via the shared SessionSidebar in the parent page.
 */

import { memo, Suspense, lazy, useEffect } from "react";
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
  History,
  Eye,
  Copy,
} from "lucide-react";
import { useExternalReportSession } from "@/hooks/useExternalReportSession";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Lazy load diff viewer
const ReactDiffViewer = lazy(() => import("react-diff-viewer-continued"));

interface ExternalReportTabProps {
  /** Session ID to load from sidebar */
  sessionIdToLoad?: string;
  /** Callback when current session changes (for sidebar sync) */
  onSessionChange?: (sessionId: string | undefined) => void;
}

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
    proposal,
    error,
    isCreating,
    isGenerating,
    isAccepting,
    createAndGenerate,
    loadSession,
    generateAdjustment,
    acceptAdjustment,
    rejectAdjustment,
    reset,
  } = useExternalReportSession();

  // Combined loading state for the single-step flow
  const isProcessing = isCreating || isGenerating;

  // Load session when sessionIdToLoad changes (from sidebar click)
  useEffect(() => {
    if (sessionIdToLoad && sessionIdToLoad !== currentSession?.id) {
      loadSession(sessionIdToLoad);
    }
  }, [sessionIdToLoad, currentSession?.id, loadSession]);

  // Notify parent when current session changes
  useEffect(() => {
    onSessionChange?.(currentSession?.id);
  }, [currentSession?.id, onSessionChange]);

  // Format date for display
  const formatDate = (dateStr: string | Date | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    toast({
      title: "Gekopieerd",
      description: "Tekst is naar het klembord gekopieerd.",
    });
  };

  return (
    <div className="space-y-6">
      {/* Info about settings */}
      <div className="bg-muted/50 border rounded-lg p-4 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-muted-foreground">
            Deze functie gebruikt de <strong>"Rapport Aanpassen"</strong> prompt uit de centrale instellingen.
            Gebruik de knop "Centrale Instellingen" hierboven om de AI configuratie aan te passen.
          </p>
        </div>
      </div>

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

      {/* Stage: Input - Simplified single-step flow */}
      {(stage === "input" || stage === "processing") && !currentSession && (
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
                  placeholder="Bijv. Voeg een paragraaf toe over de rechtspraak van de Hoge Raad inzake box 3, maak de conclusie korter, pas de toon aan..."
                  className="mt-1 min-h-[120px]"
                  disabled={isProcessing}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Minimaal 10 karakters ({instruction.length}/10)
                </p>
              </div>
              <Button
                onClick={createAndGenerate}
                disabled={isProcessing || originalContent.length < 10 || instruction.length < 10}
                size="lg"
                className="w-full"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {isCreating ? "Sessie aanmaken..." : "AI genereert aanpassing..."}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Genereer Aangepast Rapport
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {/* Stage: Adjust - Enter instruction */}
      {(stage === "adjust" || stage === "processing") && currentSession && (
        <>
          {/* Session Header */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">{currentSession.title}</h3>
              <p className="text-sm text-muted-foreground">
                {currentSession.adjustmentCount || 0} aanpassing(en) • Aangemaakt {formatDate(currentSession.createdAt)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={reset}>
              Nieuwe Sessie
            </Button>
          </div>

          {/* Current Report Preview */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Huidige Versie
                </span>
                <Badge variant="outline">
                  v{(currentSession.adjustmentCount || 0) + 1}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[250px] border rounded-md p-4">
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {currentSession.currentContent || currentSession.originalContent}
                  </ReactMarkdown>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Adjustment Input */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Aanpassing Instructie
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="adjustment-instruction">
                  Wat wil je aanpassen?
                </Label>
                <Textarea
                  id="adjustment-instruction"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Bijv. Voeg een paragraaf toe over de rechtspraak van de Hoge Raad inzake box 3..."
                  className="mt-1 min-h-[120px]"
                  disabled={stage === "processing"}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Minimaal 10 karakters ({instruction.length}/10)
                </p>
              </div>
              <Button
                onClick={generateAdjustment}
                disabled={stage === "processing" || instruction.length < 10}
              >
                {stage === "processing" ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    AI genereert aanpassing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Genereer Aanpassing
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Adjustment History */}
          {currentSession.adjustments && currentSession.adjustments.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Aanpassingsgeschiedenis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {currentSession.adjustments.map((adj) => (
                    <div
                      key={adj.id}
                      className="flex items-start gap-3 p-3 bg-muted/50 rounded-md"
                    >
                      <Badge variant="secondary" className="shrink-0">
                        v{adj.version}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{adj.instruction}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDate(adj.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Final Report Preview with Copy */}
          {currentSession.adjustmentCount && currentSession.adjustmentCount > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Finale Versie
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(currentSession.currentContent || "")}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Kopieer
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px] border rounded-md p-6">
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {currentSession.currentContent || ""}
                    </ReactMarkdown>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Stage: Preview - Show diff and accept/reject */}
      {stage === "preview" && proposal && currentSession && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Voorgestelde Aanpassing
              </span>
              <Badge>v{proposal.version}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Diff Viewer */}
            <div className="border rounded-md overflow-hidden">
              <Suspense
                fallback={
                  <div className="p-8 text-center text-muted-foreground">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                    Diff laden...
                  </div>
                }
              >
                <ReactDiffViewer
                  oldValue={proposal.previousContent}
                  newValue={proposal.proposedContent}
                  splitView={false}
                  useDarkTheme={document.documentElement.classList.contains("dark")}
                  hideLineNumbers={false}
                  showDiffOnly={false}
                  styles={{
                    contentText: {
                      fontSize: "13px",
                      lineHeight: "1.5",
                      fontFamily: "ui-monospace, monospace",
                    },
                  }}
                />
              </Suspense>
            </div>

            {/* Accept/Reject buttons */}
            <div className="flex gap-3 pt-2">
              <Button
                onClick={acceptAdjustment}
                disabled={isAccepting}
                className="bg-green-600 hover:bg-green-700"
              >
                {isAccepting ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Accepteren...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Accepteren
                  </>
                )}
              </Button>
              <Button
                onClick={rejectAdjustment}
                variant="outline"
                disabled={isAccepting}
              >
                <X className="h-4 w-4 mr-2" />
                Afwijzen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
});
