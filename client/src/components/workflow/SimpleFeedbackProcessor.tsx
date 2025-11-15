import { useState, useMemo, useEffect, useCallback, memo } from "react";
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
  AlertTriangle,
  Sparkles,
  ExternalLink,
  Activity,
  Check
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { ProcessFeedbackRequest, ProcessFeedbackResponse } from '@shared/types/api';
import { ChangeProposalCard, ChangeProposalBulkActions, type ChangeProposal } from './ChangeProposalCard';
import { parseFeedbackToProposals, serializeProposals, serializeProposalsToJSON } from '@/lib/parse-feedback';

interface SimpleFeedbackProcessorProps {
  reportId: string;
  stageId: string;
  stageName: string;
  rawFeedback: string;
  onProcessingComplete?: (result: ProcessFeedbackResponse) => void;
  // Manual mode support
  manualMode?: 'ai' | 'manual';
  onToggleManualMode?: (mode: 'ai' | 'manual') => void;
  manualContent?: string;
  onManualContentChange?: (content: string) => void;
  onManualExecute?: () => void;
}

interface PromptPreviewResponse {
  stageId: string;
  userInstructions: string;
  combinedPrompt: string;
  fullPrompt: string;
  promptLength: number;
  rawFeedback: string;
}

export const SimpleFeedbackProcessor = memo(function SimpleFeedbackProcessor({
  reportId,
  stageId,
  stageName,
  rawFeedback,
  onProcessingComplete,
  manualMode = 'ai',
  onToggleManualMode,
  manualContent = '',
  onManualContentChange,
  onManualExecute
}: SimpleFeedbackProcessorProps) {
  const [userInstructions, setUserInstructions] = useState("");
  const [hasProcessed, setHasProcessed] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [viewMode, setViewMode] = useState<'structured' | 'text'>('structured');
  const [copied, setCopied] = useState(false);
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

  // Sync proposals when rawFeedback changes
  useEffect(() => {
    const newProposals = parseFeedbackToProposals(rawFeedback, stageName, stageId);
    setProposals(newProposals);
  }, [rawFeedback, stageName, stageId]);

  // Track if any decisions have been made
  // Fixed: Use a more stable dependency check to ensure re-render
  const hasDecisions = proposals.some(p => p.userDecision);

  // Generate instructions from decisions
  const generatedInstructions = useMemo(() => {
    if (!hasDecisions) return '';
    return serializeProposals(proposals);
  }, [proposals, hasDecisions]);

  // ✅ FIX #6: Retry function with exponential backoff + jitter (prevent thundering herd)
  const retryWithBackoff = async <T,>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelay: number = 1000
  ): Promise<T> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: unknown) {
        // Type-safe error checking
        const isRetryableError = (err: unknown): boolean => {
          if (err && typeof err === 'object') {
            const errorObj = err as { status?: number; code?: string };
            return (
              errorObj.status === 503 || // Service Unavailable
              errorObj.status === 429 || // Rate Limited
              errorObj.code === 'AI_SERVICE_UNAVAILABLE' ||
              errorObj.code === 'AI_RATE_LIMITED'
            );
          }
          return false;
        };

        // Check if we should retry based on error type
        if (isRetryableError(error)) {
          if (attempt === maxAttempts) {
            throw error; // Last attempt failed
          }

          // Calculate delay with exponential backoff: 1s, 2s, 4s
          const delay = baseDelay * Math.pow(2, attempt - 1);

          // Add jitter (0-30% random variation) to prevent thundering herd problem
          // If multiple users retry at the same time, jitter spreads out the retries
          const jitter = Math.random() * delay * 0.3; // 0-30% of delay
          const finalDelay = Math.round(delay + jitter);

          console.log(`🔄 Retry attempt ${attempt}/${maxAttempts} after ${finalDelay}ms delay (base: ${delay}ms + jitter: ${Math.round(jitter)}ms)`);
          await new Promise(resolve => setTimeout(resolve, finalDelay));
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
          const error = new Error(responseData.error?.userMessage || responseData.error?.message || 'Feedback processing failed') as Error & { code?: string; status?: number };
          error.code = responseData.error?.code;
          error.status = response.status;
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
    onError: (error: unknown) => {
      console.error(`❌ Failed to process feedback:`, error);

      // Type-safe error handling
      const errorObj = error && typeof error === 'object' ? error as { code?: string; message?: string } : {};
      const errorCode = errorObj.code;

      // Bepaal het type error en geef een gerichte melding
      let title = "Feedback verwerking gefaald";
      let description = "Er ging iets mis bij het verwerken van je instructies.";
      let action = null;

      if (errorCode === 'AI_SERVICE_UNAVAILABLE') {
        title = "AI Service niet beschikbaar";
        description = "De AI service is momenteel niet beschikbaar. Het systeem heeft het maximaal aantal pogingen gedaan om je verzoek te verwerken.";
        action = "Wacht een paar minuten en probeer het opnieuw. Als het probleem aanhoudt, neem dan contact op met support.";
      }
      else if (errorCode === 'AI_RATE_LIMITED') {
        title = "Snelheidslimiet bereikt";
        description = "Je hebt teveel verzoeken gedaan in korte tijd. Het systeem heeft geprobeerd je verzoek opnieuw te verwerken.";
        action = "Wacht ongeveer 1 minuut voordat je het opnieuw probeert.";
      }
      else if (errorCode === 'AI_AUTHENTICATION_FAILED') {
        title = "AI authenticatie probleem";
        description = "Er is een probleem met de authenticatie van de AI service.";
        action = "Dit is een configuratie probleem. Neem contact op met support.";
      }
      else if (errorCode === 'VALIDATION_FAILED') {
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
        // Try to extract error details from response
        let errorMessage = 'Failed to fetch prompt preview';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error?.userMessage || errorData.error?.message || errorMessage;
        } catch (e) {
          // If parsing fails, use default message
        }
        throw new Error(errorMessage);
      }
      const data = await response.json();
      return data.data; // Assuming the API returns { success: true, data: PromptPreviewResponse }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Er ging iets mis bij het laden van de prompt preview";
      console.error(`❌ Failed to fetch prompt preview:`, error);
      toast({
        title: "Preview laden gefaald",
        description: message,
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
  const handleShowPreview = useCallback(() => {
    // Use the SAME logic as handleProcess to determine instructions
    const instructionsToUse = viewMode === 'structured' && hasDecisions
      ? generatedInstructions
      : userInstructions.trim();

    const instructions = instructionsToUse || "Pas alle feedback toe om het concept rapport te verbeteren. Neem alle suggesties over die de kwaliteit, accuratesse en leesbaarheid van het rapport verbeteren.";
    promptPreviewMutation.mutate(instructions);
    setShowPromptPreview(true);
  }, [viewMode, hasDecisions, generatedInstructions, userInstructions, promptPreviewMutation]);

  // Handle decision on a proposal
  const handleProposalDecision = useCallback((proposalId: string, decision: 'accept' | 'reject' | 'modify', note?: string) => {
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
  }, [toast]);

  // Handle bulk actions
  const handleBulkAccept = useCallback((severity: 'critical' | 'important' | 'suggestion' | 'all') => {
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
  }, [toast]);

  const handleBulkReject = useCallback((severity: 'critical' | 'important' | 'suggestion' | 'all') => {
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
  }, [toast]);

  const handleProcess = useCallback(() => {
    // In structured mode with decisions, send filtered JSON
    // In text mode, send user instructions
    if (viewMode === 'structured') {
      if (!hasDecisions) {
        toast({
          title: "Instructies vereist",
          description: "Neem beslissingen over de voorstellen of schakel over naar tekst modus",
          variant: "destructive",
          duration: 3000,
        });
        return;
      }

      const filteredJSON = serializeProposalsToJSON(proposals);

      console.log(`🔧 Processing feedback for ${stageId} with filtered JSON:`, {
        acceptedCount: proposals.filter(p => p.userDecision === 'accept').length,
        modifiedCount: proposals.filter(p => p.userDecision === 'modify').length,
        rejectedCount: proposals.filter(p => p.userDecision === 'reject').length
      });

      processFeedbackMutation.mutate({
        userInstructions: "Verwerk wijzigingen", // Minimal - Editor prompt has the real instructions
        processingStrategy: 'merge',
        filteredChanges: filteredJSON
      });
    } else {
      // Text mode - use user's free-form instructions
      const instructionsToUse = userInstructions.trim();

      if (!instructionsToUse) {
        toast({
          title: "Instructies vereist",
          description: "Geef aan welke feedback je wilt verwerken en welke niet",
          variant: "destructive",
          duration: 3000,
        });
        return;
      }

      console.log(`🔧 Processing feedback for ${stageId} with text instructions:`, instructionsToUse);

      processFeedbackMutation.mutate({
        userInstructions: instructionsToUse,
        processingStrategy: 'merge'
        // No filteredChanges - will use raw feedback from backend
      });
    }
  }, [viewMode, hasDecisions, toast, proposals, stageId, processFeedbackMutation, userInstructions]);

  const copyFeedback = useCallback(() => {
    navigator.clipboard.writeText(rawFeedback);
    toast({
      title: "Feedback gekopieerd",
      duration: 2000,
    });
  }, [rawFeedback, toast]);

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
        {/* Manual Mode Toggle - Similar to Stage 3 */}
        {onToggleManualMode && (
          <div className="bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-3">
                <div>
                  <h4 className="font-semibold text-sm text-amber-900 dark:text-amber-100">Deep Research Mode</h4>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    Deze stap vereist diepgaand onderzoek. Kies hoe je deze stap wilt uitvoeren:
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => onToggleManualMode('ai')}
                    variant={manualMode === 'ai' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                  >
                    <Activity className="w-4 h-4 mr-2" />
                    AI Automatisch
                  </Button>
                  <Button
                    onClick={() => onToggleManualMode('manual')}
                    variant={manualMode === 'manual' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Handmatig (Gemini Deep Research)
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Manual Mode Interface */}
        {manualMode === 'manual' && onManualContentChange && onManualExecute && (
          <div className="bg-blue-50 dark:bg-blue-950/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-4">
            {/* Step 1: Show prompt preview */}
            <div className="flex items-start gap-3">
              <ExternalLink className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-100">Stap 1: Kopieer de prompt</h4>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Klik op "Preview Prompt" om de volledige prompt te zien en te kopiëren
                </p>
              </div>
            </div>

            {promptPreviewMutation.data && (
              <div className="bg-white dark:bg-gray-900 rounded-lg border-2 border-blue-300 dark:border-blue-700">
                <div className="p-3 border-b border-blue-200 dark:border-blue-800 flex items-center justify-between">
                  <span className="text-xs font-medium text-blue-900 dark:text-blue-100">
                    Prompt voor Gemini Deep Research ({promptPreviewMutation.data.promptLength.toLocaleString()} karakters)
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(promptPreviewMutation.data?.fullPrompt || '');
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                      toast({ title: "Gekopieerd!", description: "Prompt gekopieerd naar klembord" });
                    }}
                    className="h-8"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Gekopieerd!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Kopieer Prompt
                      </>
                    )}
                  </Button>
                </div>
                <div className="p-4 max-h-[400px] overflow-auto">
                  <pre className="text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-all" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
                    {promptPreviewMutation.data.fullPrompt}
                  </pre>
                </div>
              </div>
            )}

            {/* Step 2: Paste result */}
            <div className="flex items-start gap-3 pt-2">
              <ExternalLink className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-3">
                <div>
                  <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-100">Stap 2: Plak het resultaat van Gemini Deep Research</h4>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    Nadat je de prompt in Gemini Deep Research hebt gebruikt, plak het resultaat hieronder
                  </p>
                </div>
                <Textarea
                  value={manualContent}
                  onChange={(e) => onManualContentChange(e.target.value)}
                  placeholder="Plak hier het resultaat van Gemini Deep Research..."
                  className="min-h-[200px] font-mono text-sm"
                />
                <Button
                  onClick={onManualExecute}
                  disabled={!manualContent.trim()}
                  className="w-full"
                  size="lg"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Verwerk Handmatig Resultaat
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Only show AI mode when in AI mode */}
        {manualMode === 'ai' && (
          <>
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
                <pre className="text-sm whitespace-pre-wrap break-all font-mono" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }} data-testid="text-raw-feedback">
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
                  {userInstructions.length}/50000 karakters
                </p>
                {userInstructions.length > 50000 && (
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
              (viewMode === 'text' && (userInstructions.length > 50000 || !userInstructions.trim())) ||
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
              (viewMode === 'text' && (!userInstructions.trim() || userInstructions.length > 50000)) ||
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
          </>
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
                    <pre className="text-xs whitespace-pre-wrap break-all font-mono" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
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
});