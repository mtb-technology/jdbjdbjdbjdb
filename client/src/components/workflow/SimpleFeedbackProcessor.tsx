import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  MessageSquare, 
  Play,
  CheckCircle,
  Copy,
  Loader2,
  Eye,
  List,
  FileText,
  AlertCircle,
  AlertTriangle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { ProcessFeedbackRequest, ProcessFeedbackResponse } from '@shared/types/api';
import { ChangeProposalCard, ChangeProposalBulkActions, type ChangeProposal } from './ChangeProposalCard';
import { parseFeedbackToProposals, serializeProposals } from '@/lib/parse-feedback';

interface SimpleFeedbackProcessorProps {
  reportId: string;
  stageId: string;
  stageName: string;
  rawFeedback: string;
  onProcessingComplete?: (result: ProcessFeedbackResponse) => void;
}

interface PromptPreviewResponse {
  stageId: string;
  userInstructions: string;
  combinedPrompt: string;
  fullPrompt: string;
  promptLength: number;
  rawFeedback: string;
}

export function SimpleFeedbackProcessor({
  reportId,
  stageId,
  stageName,
  rawFeedback,
  onProcessingComplete
}: SimpleFeedbackProcessorProps) {
  const [userInstructions, setUserInstructions] = useState("");
  const [hasProcessed, setHasProcessed] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [viewMode, setViewMode] = useState<'structured' | 'text'>('structured');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Fetch AI service status
  const { data: aiStatus } = useQuery({
    queryKey: ['ai-status'],
    queryFn: async () => {
      const response = await fetch('/api/health/ai');
      if (!response.ok) throw new Error('Failed to fetch AI status');
      const data = await response.json();
      return data.data;
    },
    refetchInterval: 30000, // Check every 30 seconds
    staleTime: 25000 // Consider data stale after 25 seconds
  });

  // Parse feedback into structured proposals
  const [proposals, setProposals] = useState<ChangeProposal[]>(() => 
    parseFeedbackToProposals(rawFeedback, stageName, stageId)
  );

  // Track if any decisions have been made
  // Fixed: Use a more stable dependency check to ensure re-render
  const hasDecisions = proposals.some(p => p.userDecision);

  // Generate instructions from decisions
  const generatedInstructions = useMemo(() => {
    if (!hasDecisions) return '';
    return serializeProposals(proposals);
  }, [proposals, hasDecisions]);

  // Retry function with exponential backoff
  const retryWithBackoff = async <T,>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelay: number = 1000
  ): Promise<T> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        // Check if we should retry based on error type
        if (
          error?.status === 503 || // Service Unavailable
          error?.status === 429 || // Rate Limited
          error?.code === 'AI_SERVICE_UNAVAILABLE' ||
          error?.code === 'AI_RATE_LIMITED'
        ) {
          if (attempt === maxAttempts) {
            throw error; // Last attempt failed
          }
          
          // Calculate delay with exponential backoff: 1s, 2s, 4s
          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.log(`🔄 Retry attempt ${attempt}/${maxAttempts} after ${delay}ms delay`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        throw error; // Don't retry other types of errors
      }
    }
    throw new Error('Max retry attempts reached');
  };

  // Mutation for processing feedback
  const processFeedbackMutation = useMutation({
    mutationFn: async (payload: ProcessFeedbackRequest): Promise<ProcessFeedbackResponse> => {
      return retryWithBackoff(async () => {
        const response = await apiRequest('POST', `/api/reports/${reportId}/stage/${stageId}/process-feedback`, payload);
        const responseData = await response.json();
        
        if (responseData.success) {
          return responseData.data;
        } else {
          const error = new Error(responseData.error?.userMessage || responseData.error?.message || 'Feedback processing failed');
          (error as any).code = responseData.error?.code;
          (error as any).status = response.status;
          throw error;
        }
      });
    },
    onSuccess: (response: ProcessFeedbackResponse) => {
      console.log(`✅ Feedback processed successfully - v${response.newVersion}`);
      
      setHasProcessed(true);
      setUserInstructions(""); // Clear input
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/reports', reportId] });
      
      toast({
        title: "Feedback verwerkt",
        description: `Concept rapport bijgewerkt naar versie ${response.newVersion}`,
        duration: 4000,
      });

      onProcessingComplete?.(response);
    },
    onError: (error: any) => {
      console.error(`❌ Failed to process feedback:`, error);
      
      // Bepaal het type error en geef een gerichte melding
      let title = "Feedback verwerking gefaald";
      let description = "Er ging iets mis bij het verwerken van je instructies.";
      let action = null;

      if (error.code === 'AI_SERVICE_UNAVAILABLE') {
        title = "AI Service niet beschikbaar";
        description = "De AI service is momenteel niet beschikbaar. Het systeem heeft het maximaal aantal pogingen gedaan om je verzoek te verwerken.";
        action = "Wacht een paar minuten en probeer het opnieuw. Als het probleem aanhoudt, neem dan contact op met support.";
      } 
      else if (error.code === 'AI_RATE_LIMITED') {
        title = "Snelheidslimiet bereikt";
        description = "Je hebt teveel verzoeken gedaan in korte tijd. Het systeem heeft geprobeerd je verzoek opnieuw te verwerken.";
        action = "Wacht ongeveer 1 minuut voordat je het opnieuw probeert.";
      }
      else if (error.code === 'AI_AUTHENTICATION_FAILED') {
        title = "AI authenticatie probleem";
        description = "Er is een probleem met de authenticatie van de AI service.";
        action = "Dit is een configuratie probleem. Neem contact op met support.";
      }
      else if (error.code === 'VALIDATION_FAILED') {
        title = "Ongeldige invoer";
        description = "Je invoer voldoet niet aan de verwachte criteria.";
        action = "Controleer je instructies en probeer het opnieuw.";
      }
      
      toast({
        title,
        description: action ? `${description}\n\n${action}` : description,
        variant: "destructive",
        duration: 7000,
      });
    }
  });

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

  // Debug logging for button state (after mutations are declared)
  useEffect(() => {
    console.log('🔍 SimpleFeedbackProcessor Debug:', {
      hasDecisions,
      aiStatus,
      openaiAvailable: aiStatus?.openai?.available,
      googleAvailable: aiStatus?.google?.available,
      viewMode,
      isPending: processFeedbackMutation.isPending,
      hasProcessed,
      proposalsWithDecisions: proposals.filter(p => p.userDecision).length
    });
  }, [hasDecisions, aiStatus, viewMode, processFeedbackMutation.isPending, hasProcessed, proposals]);

  // Handle showing prompt preview
  const handleShowPreview = () => {
    const instructions = userInstructions.trim() || "Pas alle feedback toe om het concept rapport te verbeteren. Neem alle suggesties over die de kwaliteit, accuratesse en leesbaarheid van het rapport verbeteren.";
    promptPreviewMutation.mutate(instructions);
    setShowPromptPreview(true);
  };

  // Handle decision on a proposal
  const handleProposalDecision = (proposalId: string, decision: 'accept' | 'reject' | 'modify', note?: string) => {
    setProposals(prev => prev.map(p => 
      p.id === proposalId 
        ? { ...p, userDecision: decision, userNote: note }
        : p
    ));

    toast({
      title: "Beslissing opgeslagen",
      description: `Voorstel ${decision === 'accept' ? 'geaccepteerd' : decision === 'reject' ? 'afgewezen' : 'aangepast'}`,
      duration: 2000,
    });
  };

  // Handle bulk actions
  const handleBulkAccept = (severity: 'critical' | 'important' | 'suggestion' | 'all') => {
    setProposals(prev => prev.map(p => 
      (severity === 'all' || p.severity === severity) && !p.userDecision
        ? { ...p, userDecision: 'accept' }
        : p
    ));

    toast({
      title: "Bulk actie uitgevoerd",
      description: `Alle ${severity === 'all' ? '' : severity} voorstellen geaccepteerd`,
      duration: 2000,
    });
  };

  const handleBulkReject = (severity: 'critical' | 'important' | 'suggestion' | 'all') => {
    setProposals(prev => prev.map(p => 
      (severity === 'all' || p.severity === severity) && !p.userDecision
        ? { ...p, userDecision: 'reject' }
        : p
    ));

    toast({
      title: "Bulk actie uitgevoerd",
      description: `Alle ${severity === 'all' ? '' : severity} voorstellen afgewezen`,
      duration: 2000,
    });
  };

  const handleProcess = () => {
    const instructionsToUse = viewMode === 'structured' && hasDecisions 
      ? generatedInstructions 
      : userInstructions.trim();

    if (!instructionsToUse) {
      toast({
        title: "Instructies vereist",
        description: viewMode === 'structured' 
          ? "Neem beslissingen over de voorstellen of schakel over naar tekst modus"
          : "Geef aan welke feedback je wilt verwerken en welke niet",
        variant: "destructive",
        duration: 3000,
      });
      return;
    }

    console.log(`🔧 Processing feedback for ${stageId} with instructions:`, instructionsToUse);
    
    processFeedbackMutation.mutate({
      userInstructions: instructionsToUse,
      processingStrategy: 'merge'
    });
  };

  const copyFeedback = () => {
    navigator.clipboard.writeText(rawFeedback);
    toast({
      title: "Feedback gekopieerd",
      duration: 2000,
    });
  };

  // AI Status indicator component
  const AIStatusIndicator = () => {
    if (!aiStatus) return null;
    
    const { openai, google } = aiStatus;
    const hasIssues = !openai.available || !google.available;
    
    return (
      <div className="flex items-center gap-2 text-sm">
        {hasIssues ? (
          <AlertTriangle className="w-4 h-4 text-yellow-500" />
        ) : (
          <CheckCircle className="w-4 h-4 text-green-500" />
        )}
        <div className="flex gap-2">
          <Badge 
            variant={openai.available ? "outline" : "destructive"}
            className="text-xs"
          >
            OpenAI {openai.available ? '✓' : '✗'}
          </Badge>
          <Badge 
            variant={google.available ? "outline" : "destructive"}
            className="text-xs"
          >
            Google AI {google.available ? '✓' : '✗'}
          </Badge>
        </div>
        {hasIssues && (
          <Button
            variant="ghost"
            size="sm"
            className="text-yellow-600 dark:text-yellow-400 h-6 px-2"
            onClick={() => {
              toast({
                title: "AI Service Status",
                description: !openai.available && !google.available 
                  ? "Beide AI services zijn momenteel niet beschikbaar. Probeer het later opnieuw."
                  : !openai.available 
                  ? "OpenAI is tijdelijk niet beschikbaar. Het systeem zal automatisch terugvallen op Google AI."
                  : "Google AI is tijdelijk niet beschikbaar. Het systeem zal automatisch terugvallen op OpenAI.",
                duration: 5000
              });
            }}
          >
            <AlertCircle className="w-4 h-4 mr-1" />
            {!openai.available && !google.available ? 'AI services offline' :
             !openai.available ? 'OpenAI offline' : 
             'Google AI offline'}
          </Button>
        )}
      </div>
    );
  };

  return (
    <Card className="w-full" data-testid="feedback-processor">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Feedback Review - {stageName}
          </CardTitle>
          
          <div className="flex items-center gap-2">
            <AIStatusIndicator />
            {hasProcessed ? (
              <Badge variant="outline" className="text-green-600 border-green-300">
                <CheckCircle className="h-3 w-3 mr-1" />
                Verwerkt
              </Badge>
            ) : (
              <Badge variant="outline" className="text-blue-600 border-blue-300">
                <MessageSquare className="h-3 w-3 mr-1" />
                Wacht op instructies
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* View Mode Tabs */}
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'structured' | 'text')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="structured" className="flex items-center gap-2">
              <List className="h-4 w-4" />
              Gestructureerd
            </TabsTrigger>
            <TabsTrigger value="text" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Tekst
            </TabsTrigger>
          </TabsList>

          <TabsContent value="structured" className="space-y-6">
            {/* Structured Change Proposals */}
            <ChangeProposalBulkActions 
              proposals={proposals}
              onBulkAccept={handleBulkAccept}
              onBulkReject={handleBulkReject}
            />

            <div className="space-y-4">
              {proposals.map((proposal) => (
                <ChangeProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  onDecision={handleProposalDecision}
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="text" className="space-y-6">
            {/* Original Raw Feedback */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-sm font-medium">Originele Feedback van {stageName}</Label>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={copyFeedback}
                  data-testid="button-copy-feedback"
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Kopieer
                </Button>
              </div>
              
              <ScrollArea className="h-48 w-full border rounded-md p-3 bg-gray-50 dark:bg-gray-800">
                <pre className="text-sm whitespace-pre-wrap font-mono" data-testid="text-raw-feedback">
                  {rawFeedback}
                </pre>
              </ScrollArea>
            </div>

            {/* Text Instructions Input */}
            <div>
              <Label htmlFor="userInstructions" className="text-sm font-medium">
                Jouw Instructies
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Geef aan wat je wel en niet wilt verwerken. Bijvoorbeeld: "Verwerk alleen de bronverwijzingen, negeer stijlwijzigingen"
              </p>
              
              <Textarea
                id="userInstructions"
                placeholder="Verwerk alleen de punten over bronnen, negeer de stijlwijzigingen..."
                value={userInstructions}
                onChange={(e) => setUserInstructions(e.target.value)}
                disabled={processFeedbackMutation.isPending || hasProcessed}
                rows={4}
                className="resize-none"
                data-testid="input-user-instructions"
              />
              
              <div className="flex justify-between items-center mt-2">
                <p className="text-xs text-muted-foreground">
                  {userInstructions.length}/2000 karakters
                </p>
                {userInstructions.length > 2000 && (
                  <p className="text-xs text-red-500">Te veel karakters</p>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Process Buttons */}
        <div className="flex justify-end gap-3">
          <Button 
            variant="outline"
            onClick={handleShowPreview}
            disabled={
              (viewMode === 'text' && (userInstructions.length > 2000 || !userInstructions.trim())) ||
              (viewMode === 'structured' && !hasDecisions) ||
              promptPreviewMutation.isPending
            }
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
            disabled={
              (viewMode === 'text' && (!userInstructions.trim() || userInstructions.length > 2000)) ||
              (viewMode === 'structured' && !hasDecisions) ||
              processFeedbackMutation.isPending ||
              hasProcessed
            }
            className="min-w-[160px]"
            variant={hasProcessed ? "outline" : "default"}
            data-testid="button-process-feedback"
          >
            {processFeedbackMutation.isPending ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Verwerkt...</span>
              </div>
            ) : hasProcessed ? (
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                <span>Verwerkt</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Play className="h-4 w-4" />
                <span>
                  {viewMode === 'structured' 
                    ? `Verwerk ${proposals.filter(p => p.userDecision === 'accept').length} wijzigingen`
                    : 'Verwerk Feedback'
                  }
                </span>
              </div>
            )}
          </Button>
        </div>

        {/* Success Message */}
        {hasProcessed && (
          <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
            <p className="text-sm text-green-700 dark:text-green-300">
              ✅ Feedback succesvol verwerkt! Het concept rapport is bijgewerkt volgens jouw instructies.
            </p>
          </div>
        )}

        {/* Prompt Preview Modal */}
        <Dialog open={showPromptPreview} onOpenChange={setShowPromptPreview}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle>Prompt Preview - {stageName}</DialogTitle>
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