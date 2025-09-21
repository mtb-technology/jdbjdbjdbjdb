import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  MessageSquare, 
  Bot, 
  User, 
  Merge, 
  Play,
  CheckCircle,
  Edit3,
  Plus,
  Copy,
  Eye,
  Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from '@tanstack/react-query';

interface ReviewFeedbackEditorProps {
  stageName: string;
  stageId: string;
  reportId: string;
  aiReviewOutput: string;
  onProcessFeedback: (mergedFeedback: string) => void;
  isProcessing: boolean;
  hasProcessingResult: boolean;
}

interface PromptPreviewResponse {
  stageId: string;
  userInstructions: string;
  combinedPrompt: string;
  fullPrompt: string;
  promptLength: number;
  rawFeedback: string;
}

export function ReviewFeedbackEditor({
  stageName,
  stageId,
  reportId,
  aiReviewOutput,
  onProcessFeedback,
  isProcessing,
  hasProcessingResult
}: ReviewFeedbackEditorProps) {
  const [manualFeedback, setManualFeedback] = useState("");
  const [mergeStrategy, setMergeStrategy] = useState<"append" | "replace" | "merge">("merge");
  const [showEditor, setShowEditor] = useState(false);
  const [finalFeedback, setFinalFeedback] = useState(aiReviewOutput);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const { toast } = useToast();

  // Mutation for fetching prompt preview
  const promptPreviewMutation = useMutation({
    mutationFn: async (instructions: string): Promise<PromptPreviewResponse> => {
      const params = new URLSearchParams();
      if (instructions.trim()) {
        params.append('userInstructions', instructions);
      }
      
      const response = await fetch(`/api/reports/${reportId}/stage/${stageId}/prompt-preview?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch prompt preview');
      }
      const data = await response.json();
      return data.data; // Assuming the API returns { success: true, data: PromptPreviewResponse }
    },
    onError: (error: any) => {
      console.error(`❌ Failed to fetch prompt preview:`, error);
      toast({
        title: "Preview laden gefaald",
        description: error.message || "Er ging iets mis bij het laden van de prompt preview",
        variant: "destructive",
        duration: 3000,
      });
    }
  });

  useEffect(() => {
    // When AI review completes, show the editor
    if (aiReviewOutput && !hasProcessingResult) {
      setShowEditor(true);
      setFinalFeedback(aiReviewOutput);
    }
  }, [aiReviewOutput, hasProcessingResult]);

  const mergeFeedback = () => {
    let merged = "";
    
    switch (mergeStrategy) {
      case "replace":
        // Volledig vervangen met handmatige feedback
        merged = manualFeedback || aiReviewOutput;
        break;
        
      case "append":
        // AI feedback + handmatige toevoegingen
        merged = aiReviewOutput + (manualFeedback ? `\n\n=== AANVULLENDE FEEDBACK ===\n${manualFeedback}` : "");
        break;
        
      case "merge":
        // Intelligent samenvoegen
        if (manualFeedback) {
          merged = `=== AI REVIEW FEEDBACK ===\n${aiReviewOutput}\n\n=== HANDMATIGE AANVULLINGEN ===\n${manualFeedback}\n\n=== INSTRUCTIE VOOR VERWERKING ===\nVerwerk beide feedbackpunten in het rapport. Prioriteit aan handmatige aanvullingen waar deze conflicteren met AI feedback.`;
        } else {
          merged = aiReviewOutput;
        }
        break;
    }
    
    setFinalFeedback(merged);
    return merged;
  };

  const handleProcess = () => {
    // Show prompt preview before processing
    const instructions = manualFeedback.trim() || "Pas alle feedback toe om het concept rapport te verbeteren. Neem alle suggesties over die de kwaliteit, accuratesse en leesbaarheid van het rapport verbeteren.";
    promptPreviewMutation.mutate(instructions);
    setShowPromptPreview(true);
  };

  // Handle showing prompt preview
  const handleShowPreview = () => {
    // Only send manual instructions to preview, not the full merged feedback
    const instructions = manualFeedback.trim() || "Pas alle feedback toe om het concept rapport te verbeteren. Neem alle suggesties over die de kwaliteit, accuratesse en leesbaarheid van het rapport verbeteren.";
    promptPreviewMutation.mutate(instructions);
    setShowPromptPreview(true);
  };

  const copyFeedback = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: `${type} gekopieerd`,
      duration: 2000,
    });
  };

  if (!aiReviewOutput) {
    return (
      <div className="text-sm text-muted-foreground italic p-4 border rounded-lg bg-muted/20">
        Wachtend op AI review resultaat...
      </div>
    );
  }

  if (hasProcessingResult) {
    return (
      <div className="p-4 border-2 border-green-500/30 rounded-lg bg-green-50/50 dark:bg-green-950/20">
        <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
          <CheckCircle className="h-5 w-5" />
          <span className="font-medium">Feedback verwerkt in rapport</span>
        </div>
      </div>
    );
  }

  return (
    <Card className="border-2 border-primary/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Feedback Controle & Aanpassing
          </CardTitle>
          <Badge variant={showEditor ? "default" : "outline"}>
            {showEditor ? "Editor Actief" : "Review Klaar"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue="ai" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="ai" className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              AI Feedback
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Jouw Input
            </TabsTrigger>
            <TabsTrigger value="merged" className="flex items-center gap-2">
              <Merge className="h-4 w-4" />
              Gecombineerd
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="ai" className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">AI Review Feedback</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyFeedback(aiReviewOutput, "AI feedback")}
              >
                <Copy className="h-4 w-4 mr-2" />
                Kopieer
              </Button>
            </div>
            <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
              <pre className="whitespace-pre-wrap text-xs font-mono">
                {aiReviewOutput}
              </pre>
            </div>
          </TabsContent>
          
          <TabsContent value="manual" className="space-y-3">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Jouw Aanvullingen / Correcties
                </Label>
                <select 
                  value={mergeStrategy}
                  onChange={(e) => setMergeStrategy(e.target.value as any)}
                  className="text-xs border rounded px-2 py-1"
                >
                  <option value="merge">Slim Samenvoegen</option>
                  <option value="append">Toevoegen aan AI</option>
                  <option value="replace">Vervang AI Volledig</option>
                </select>
              </div>
              
              <Textarea
                placeholder="Voeg hier je eigen feedback toe of pas de AI feedback aan...
Bijvoorbeeld:
- Extra aandachtspunt voor btw-aspecten
- Scenario 3 moet uitgebreider
- Bronnen voor artikel 23 toevoegen"
                value={manualFeedback}
                onChange={(e) => setManualFeedback(e.target.value)}
                className="min-h-[150px] font-mono text-sm"
              />
              
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Edit3 className="h-3 w-3" />
                <span>
                  {mergeStrategy === "merge" && "Jouw feedback wordt intelligent samengevoegd met AI feedback"}
                  {mergeStrategy === "append" && "Jouw feedback wordt toegevoegd aan de AI feedback"}
                  {mergeStrategy === "replace" && "Jouw feedback vervangt de AI feedback volledig"}
                </span>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="merged" className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Finale Feedback (Dit gaat naar de verwerker)</Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFinalFeedback(mergeFeedback())}
                >
                  <Merge className="h-4 w-4 mr-2" />
                  Preview Update
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyFeedback(finalFeedback, "Finale feedback")}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Kopieer
                </Button>
              </div>
            </div>
            <div className="bg-green-50 dark:bg-green-950/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
              <pre className="whitespace-pre-wrap text-xs font-mono">
                {finalFeedback}
              </pre>
            </div>
          </TabsContent>
        </Tabs>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            {manualFeedback ? 
              <span className="text-orange-600 dark:text-orange-400 font-medium">
                ✏️ Handmatige aanpassingen toegevoegd
              </span> : 
              <span>💡 Tip: Voeg eigen feedback toe in de "Jouw Input" tab</span>
            }
          </div>
          
          <div className="flex gap-3">
            {!showEditor && (
              <Button
                variant="outline"
                onClick={() => setShowEditor(true)}
              >
                <Edit3 className="h-4 w-4 mr-2" />
                Feedback Aanpassen
              </Button>
            )}
            
            <Button 
              variant="outline"
              onClick={handleShowPreview}
              disabled={promptPreviewMutation.isPending || !reportId}
              className="min-w-[140px]"
              data-testid="button-preview-prompt"
            >
              {promptPreviewMutation.isPending ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Laden...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  <span>Preview Prompt</span>
                </div>
              )}
            </Button>
            
            <Button
              onClick={handleProcess}
              disabled={isProcessing || !reportId}
              className="bg-primary"
            >
              {isProcessing ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Verwerken...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Play className="h-4 w-4" />
                  <span>Verwerk {manualFeedback ? "Gecombineerde" : "AI"} Feedback</span>
                </div>
              )}
            </Button>
          </div>
        </div>

        {/* Prompt Preview Modal */}
        <Dialog open={showPromptPreview} onOpenChange={setShowPromptPreview}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle>Prompt Preview - {stageName}</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Bekijk exact wat naar de AI wordt gestuurd voordat je doorgaat
              </p>
            </DialogHeader>
            
            <div className="space-y-4">
              {promptPreviewMutation.isError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                  <p className="text-sm text-red-700 dark:text-red-300">
                    ❌ Fout bij het laden van de prompt preview
                  </p>
                </div>
              )}

              {promptPreviewMutation.data && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">
                      Volledige Prompt ({promptPreviewMutation.data.promptLength.toLocaleString()} karakters)
                    </Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(promptPreviewMutation.data?.fullPrompt || '');
                        toast({ title: "Gekopieerd!", description: "Prompt gekopieerd naar klembord" });
                      }}
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      Kopieer
                    </Button>
                  </div>

                  <ScrollArea className="h-96 w-full border rounded-md p-4 bg-gray-50 dark:bg-gray-800">
                    <pre className="text-xs whitespace-pre-wrap font-mono">
                      {promptPreviewMutation.data.fullPrompt}
                    </pre>
                  </ScrollArea>

                  {/* Action buttons in preview modal */}
                  <div className="flex items-center justify-between pt-4 border-t">
                    <div className="text-sm text-muted-foreground">
                      {manualFeedback ? 
                        <span className="text-orange-600 dark:text-orange-400 font-medium">
                          ✏️ Met jouw aanpassingen
                        </span> : 
                        <span>🤖 Alleen AI feedback</span>
                      }
                    </div>
                    
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        onClick={() => setShowPromptPreview(false)}
                      >
                        Annuleer
                      </Button>
                      
                      <Button
                        onClick={() => {
                          const merged = mergeFeedback();
                          onProcessFeedback(merged);
                          setShowEditor(false);
                          setShowPromptPreview(false);
                        }}
                        disabled={isProcessing || !reportId}
                        className="bg-primary"
                      >
                        {isProcessing ? (
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Verwerken...</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Play className="h-4 w-4" />
                            <span>Ja, Verwerk Nu</span>
                          </div>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {promptPreviewMutation.isPending && (
                <div className="flex items-center justify-center py-8">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Laden van prompt preview...</span>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}