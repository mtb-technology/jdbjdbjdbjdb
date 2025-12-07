/**
 * SimpleFeedbackProcessor Component
 *
 * Handles feedback review and processing for reviewer stages.
 * Users can accept/reject individual proposals or provide text instructions.
 */

import { useState, useMemo, useEffect, useCallback, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageSquare, CheckCircle, List, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Extracted hooks
import { useFeedbackMutations } from "@/hooks/useFeedbackMutations";

// Extracted components
import {
  AIStatusIndicator,
  FeedbackTextMode,
  PromptPreviewModal,
  ProcessButtons,
} from "./feedback-processor";
import {
  ChangeProposalCard,
  ChangeProposalBulkActions,
  type ChangeProposal,
} from "./ChangeProposalCard";

// Utils
import {
  parseFeedbackToProposals,
  serializeProposals,
  serializeProposalsToJSON,
} from "@/lib/parse-feedback";

// Types
import type { SimpleFeedbackProcessorProps, ViewMode, BulkActionSeverity } from "@/types/feedbackProcessor.types";

// Re-export props type for consumers
export type { SimpleFeedbackProcessorProps } from "@/types/feedbackProcessor.types";

export const SimpleFeedbackProcessor = memo(function SimpleFeedbackProcessor({
  reportId,
  stageId,
  stageName,
  rawFeedback,
  onProcessingComplete,
  savedDecisions,
}: SimpleFeedbackProcessorProps) {
  // Local state - initialize hasProcessed based on savedDecisions
  const [userInstructions, setUserInstructions] = useState("");
  const [hasProcessed, setHasProcessed] = useState(() => !!savedDecisions?.length);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("structured");
  const { toast } = useToast();

  // Parse feedback into structured proposals, merging with saved decisions
  const [proposals, setProposals] = useState<ChangeProposal[]>(() => {
    const parsed = parseFeedbackToProposals(rawFeedback, stageName, stageId);
    if (savedDecisions?.length) {
      return parsed.map(p => {
        const saved = savedDecisions.find(s => s.id === p.id);
        if (saved) {
          return {
            ...p,
            userDecision: saved.userDecision,
            userNote: saved.userModified || saved.userNote,
          };
        }
        return p;
      });
    }
    return parsed;
  });

  // Sync proposals when rawFeedback changes, preserving saved decisions
  useEffect(() => {
    const newProposals = parseFeedbackToProposals(rawFeedback, stageName, stageId);
    if (savedDecisions?.length) {
      setProposals(newProposals.map(p => {
        const saved = savedDecisions.find(s => s.id === p.id);
        if (saved) {
          return {
            ...p,
            userDecision: saved.userDecision,
            userNote: saved.userModified || saved.userNote,
          };
        }
        return p;
      }));
    } else {
      setProposals(newProposals);
    }
  }, [rawFeedback, stageName, stageId, savedDecisions]);

  // Mutations hook
  const { aiStatus, processFeedbackMutation, promptPreviewMutation } =
    useFeedbackMutations({
      reportId,
      stageId,
      onProcessingComplete,
      onProcessed: () => setHasProcessed(true),
      onClearInstructions: () => setUserInstructions(""),
    });

  // Track if any decisions have been made
  const hasDecisions = proposals.some((p) => p.userDecision);

  // Generate instructions from decisions
  const generatedInstructions = useMemo(() => {
    if (!hasDecisions) return "";
    return serializeProposals(proposals);
  }, [proposals, hasDecisions]);

  // Handlers
  const handleShowPreview = useCallback(() => {
    const instructionsToUse =
      viewMode === "structured" && hasDecisions
        ? generatedInstructions
        : userInstructions.trim();

    const instructions =
      instructionsToUse ||
      "Pas alle feedback toe om het concept rapport te verbeteren. Neem alle suggesties over die de kwaliteit, accuratesse en leesbaarheid van het rapport verbeteren.";
    promptPreviewMutation.mutate(instructions);
    setShowPromptPreview(true);
  }, [viewMode, hasDecisions, generatedInstructions, userInstructions, promptPreviewMutation]);

  const handleProposalDecision = useCallback(
    (proposalId: string, decision: "accept" | "reject" | "modify", note?: string) => {
      setProposals((prev) =>
        prev.map((p) =>
          p.id === proposalId ? { ...p, userDecision: decision, userNote: note } : p
        )
      );

      toast({
        title: "Beslissing opgeslagen",
        description: `Voorstel ${
          decision === "accept"
            ? "geaccepteerd"
            : decision === "reject"
              ? "afgewezen"
              : "aangepast"
        }`,
        duration: 2000,
      });
    },
    [toast]
  );

  const handleBulkAccept = useCallback(
    (severity: BulkActionSeverity) => {
      setProposals((prev) =>
        prev.map((p) =>
          (severity === "all" || p.severity === severity) && !p.userDecision
            ? { ...p, userDecision: "accept" }
            : p
        )
      );

      toast({
        title: "Bulk actie uitgevoerd",
        description: `Alle ${severity === "all" ? "" : severity} voorstellen geaccepteerd`,
        duration: 2000,
      });
    },
    [toast]
  );

  const handleBulkReject = useCallback(
    (severity: BulkActionSeverity) => {
      setProposals((prev) =>
        prev.map((p) =>
          (severity === "all" || p.severity === severity) && !p.userDecision
            ? { ...p, userDecision: "reject" }
            : p
        )
      );

      toast({
        title: "Bulk actie uitgevoerd",
        description: `Alle ${severity === "all" ? "" : severity} voorstellen afgewezen`,
        duration: 2000,
      });
    },
    [toast]
  );

  const handleProcess = useCallback(() => {
    if (viewMode === "structured") {
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
        acceptedCount: proposals.filter((p) => p.userDecision === "accept").length,
        modifiedCount: proposals.filter((p) => p.userDecision === "modify").length,
        rejectedCount: proposals.filter((p) => p.userDecision === "reject").length,
      });

      processFeedbackMutation.mutate({
        userInstructions: "Verwerk wijzigingen",
        processingStrategy: "merge",
        filteredChanges: filteredJSON,
      });
    } else {
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
        processingStrategy: "merge",
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

  const handleShowAIDetails = useCallback(
    (message: string) => {
      toast({
        title: "AI Service Status",
        description: message,
        duration: 5000,
      });
    },
    [toast]
  );

  // Calculated values
  const acceptedCount = proposals.filter(
    (p) => p.userDecision === "accept" || p.userDecision === "modify"
  ).length;

  return (
    <Card
      className="w-full max-w-full overflow-hidden border-2 border-blue-500/30 shadow-lg"
      data-testid="feedback-processor"
      data-feedback-processor
    >
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              Feedback Review - {stageName}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Stap 2: Verwerk de feedback en werk het concept bij
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AIStatusIndicator aiStatus={aiStatus} onShowDetails={handleShowAIDetails} />
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

      <CardContent className="space-y-6 overflow-hidden">
        {/* View Mode Tabs */}
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)} className="w-full max-w-full overflow-hidden">
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

              <TabsContent value="structured" className="space-y-6 overflow-hidden">
                <ChangeProposalBulkActions
                  proposals={proposals}
                  onBulkAccept={handleBulkAccept}
                  onBulkReject={handleBulkReject}
                />

                <div className="space-y-4 overflow-hidden">
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
                <FeedbackTextMode
                  rawFeedback={rawFeedback}
                  stageName={stageName}
                  userInstructions={userInstructions}
                  onUserInstructionsChange={setUserInstructions}
                  isDisabled={processFeedbackMutation.isPending || hasProcessed}
                  onCopyFeedback={copyFeedback}
                />
              </TabsContent>
            </Tabs>

            {/* Process Buttons */}
            <ProcessButtons
              viewMode={viewMode}
              hasDecisions={hasDecisions}
              userInstructions={userInstructions}
              isProcessing={processFeedbackMutation.isPending}
              hasProcessed={hasProcessed}
              isPreviewLoading={promptPreviewMutation.isPending}
              acceptedCount={acceptedCount}
              onPreview={handleShowPreview}
              onProcess={handleProcess}
            />

        {/* Success Message */}
        {hasProcessed && (
          <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
            <p className="text-sm text-green-700 dark:text-green-300">
              ✅ Feedback succesvol verwerkt! Het concept rapport is bijgewerkt volgens jouw
              instructies.
            </p>
          </div>
        )}

        {/* Prompt Preview Modal */}
        <PromptPreviewModal
          open={showPromptPreview}
          onOpenChange={setShowPromptPreview}
          stageName={stageName}
          promptData={promptPreviewMutation.data}
          isLoading={promptPreviewMutation.isPending}
          isError={promptPreviewMutation.isError}
        />
      </CardContent>
    </Card>
  );
});
