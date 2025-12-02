import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Settings, RefreshCw, Loader2, FileText, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import ReactMarkdown from "react-markdown";

interface DossierContextPanelProps {
  reportId: string;
  summary?: string;
  rawText: string;
}

const DEFAULT_PROMPT = `Je bent een fiscaal assistent. Maak een compacte samenvatting van deze casus voor snelle referentie.

Geef alleen de essentie:
- Klant naam/type
- Kern van de vraag (1 zin)
- Belangrijkste bedragen/feiten
- Status (COMPLEET of INCOMPLEET + wat ontbreekt)

Gebruik bullet points. Max 150 woorden.

{stage1Output}RAW INPUT:
{rawText}`;

export function DossierContextPanel({ reportId, summary, rawText }: DossierContextPanelProps) {
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [customPrompt, setCustomPrompt] = useState(() => {
    // Load from localStorage or use default
    const saved = localStorage.getItem('dossier-context-prompt');
    return saved || DEFAULT_PROMPT;
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleCopyContext = () => {
    const contextText = `# Dossier Context

${summary || 'Geen samenvatting beschikbaar'}

---

## Volledige Conversatie

${rawText}

---

Je kunt nu vragen stellen over deze casus.`;
    navigator.clipboard.writeText(contextText);
    toast({
      title: "Gekopieerd!",
      description: "Volledige dossier context (samenvatting + ruwe tekst) is gekopieerd naar clipboard."
    });
  };

  const generateMutation = useMutation({
    mutationFn: async (prompt?: string) => {
      const response = await apiRequest("POST", `/api/reports/${reportId}/dossier-context`, {
        customPrompt: prompt
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Samenvatting gegenereerd",
        description: "Dossier context is bijgewerkt"
      });
      // Refresh report data
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${reportId}`] });
    },
    onError: (error: any) => {
      toast({
        title: "Fout bij genereren",
        description: error.message || "Er ging iets mis",
        variant: "destructive"
      });
    }
  });

  const handleSavePrompt = () => {
    // Save to localStorage
    localStorage.setItem('dossier-context-prompt', customPrompt);

    // Generate with new prompt (server will handle placeholder replacement)
    generateMutation.mutate(customPrompt);

    setShowPromptEditor(false);
  };

  const handleResetPrompt = () => {
    setCustomPrompt(DEFAULT_PROMPT);
    localStorage.removeItem('dossier-context-prompt');
  };

  return (
    <>
      <Card className="mb-4 dark:bg-slate-800/50">
        <CardHeader className="pb-2 pt-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Dossier Context
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyContext}
                disabled={!summary}
                title="Kopieer context voor externe AI chat"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPromptEditor(true)}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {summary ? (
            <div className="prose prose-xs dark:prose-invert max-w-none text-xs leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">
              <ReactMarkdown>{summary}</ReactMarkdown>
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Geen dossier context beschikbaar</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Genereren...</>
                ) : (
                  "Genereer samenvatting"
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showPromptEditor} onOpenChange={setShowPromptEditor}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Dossier Context Prompt</DialogTitle>
            <DialogDescription>
              Pas de prompt aan om de samenvatting te personaliseren. Gebruik {'{stage1Output}'} voor de Stap 1 analyse en {'{rawText}'} voor de originele conversatie.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="min-h-[300px] font-mono text-sm dark:bg-slate-800"
              placeholder="Voer je prompt in..."
            />

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>Tip: Gebruik {'{stage1Output}'} voor Stap 1 analyse, {'{rawText}'} voor originele conversatie</span>
            </div>
          </div>

          <DialogFooter className="flex justify-between">
            <Button
              variant="ghost"
              onClick={handleResetPrompt}
            >
              Reset naar standaard
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowPromptEditor(false)}>
                Annuleren
              </Button>
              <Button onClick={handleSavePrompt}>
                Opslaan en genereren
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
