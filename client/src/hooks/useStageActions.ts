/**
 * useStageActions Hook
 *
 * Consolidates stage action handlers from WorkflowView.tsx:
 * - handleExecuteStage (lines 115-123)
 * - handleResetStage (lines 126-171)
 * - handleFeedbackProcessed (lines 367-388)
 * - handleReloadPrompts (lines 393-418)
 */

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { useToast } from "@/hooks/use-toast";
import type { WorkflowState, WorkflowAction } from "@/components/workflow/WorkflowContext";
import type { ExecuteStageMutation, ReportDepth, PendingFile } from "@/components/workflow/types";
import type { ProcessFeedbackResponse } from "@shared/types/api";

interface UseStageActionsProps {
  state: WorkflowState;
  dispatch: React.Dispatch<WorkflowAction>;
  executeStageM: ExecuteStageMutation;
}

interface UseStageActionsReturn {
  handleExecuteStage: (stageKey: string, customContext?: string, reportDepth?: ReportDepth, pendingAttachments?: PendingFile[]) => void;
  handleResetStage: (stageKey: string) => Promise<void>;
  handleFeedbackProcessed: (stageKey: string, response: ProcessFeedbackResponse) => void;
  handleReloadPrompts: () => Promise<void>;
  isReloadingPrompts: boolean;
}

export function useStageActions({
  state,
  dispatch,
  executeStageM,
}: UseStageActionsProps): UseStageActionsReturn {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isReloadingPrompts, setIsReloadingPrompts] = useState(false);

  /**
   * Execute a workflow stage
   */
  const handleExecuteStage = useCallback(
    (stageKey: string, customContext?: string, reportDepth?: ReportDepth, pendingAttachments?: PendingFile[]) => {
      if (!state.currentReport) return;

      executeStageM.mutate({
        reportId: state.currentReport.id,
        stage: stageKey,
        customInput: customContext || state.customInput || undefined,
        reportDepth,
        pendingAttachments,
      });
    },
    [state.currentReport, state.customInput, executeStageM]
  );

  /**
   * Reset/clear a stage
   */
  const handleResetStage = useCallback(
    async (stageKey: string) => {
      if (!state.currentReport) return;

      const confirmed = window.confirm(
        `Weet je zeker dat je stage "${stageKey}" wilt wissen? Dit kan niet ongedaan worden gemaakt.`
      );

      if (!confirmed) return;

      try {
        const response = await apiRequest(
          "DELETE",
          `/api/reports/${state.currentReport.id}/stage/${stageKey}`
        );

        if (!response.ok) {
          throw new Error("Failed to reset stage");
        }

        const result = await response.json();
        const data = result.success ? result.data : result;
        const cascadeDeleted = data.cascadeDeleted || [];

        const cascadeMessage =
          cascadeDeleted.length > 0 ? ` (+ ${cascadeDeleted.length} volgende stages)` : "";

        // Update local state immediately - this clears the stage result and updates UI
        dispatch({
          type: "CLEAR_STAGE_RESULT",
          stage: stageKey,
          cascadeDeleted,
        });

        // Invalidate the report cache to ensure data stays in sync
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.reports.detail(state.currentReport.id),
        });

        toast({
          title: "Stage gewist",
          description: `Stage ${stageKey}${cascadeMessage} is gewist en kan nu opnieuw worden uitgevoerd`,
          duration: 3000,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Failed to reset stage:", error);
        toast({
          title: "Fout bij wissen",
          description: "Er ging iets mis bij het wissen van de stage",
          variant: "destructive",
          duration: 5000,
        });
      }
    },
    [state.currentReport, toast, dispatch, queryClient]
  );

  /**
   * Handle feedback processed for a stage
   */
  const handleFeedbackProcessed = useCallback(
    (stageKey: string, response: ProcessFeedbackResponse) => {
      console.log(`🔄 WorkflowView: Feedback processed for ${stageKey}`, {
        newVersion: response?.newVersion,
        hasConceptContent: !!response?.conceptContent,
        conceptContentLength: response?.conceptContent?.length,
      });

      // Update the concept version in state with the new content
      if (response?.conceptContent) {
        dispatch({
          type: "SET_CONCEPT_VERSION",
          stage: stageKey,
          content: response.conceptContent,
        });
      }

      toast({
        title: "Feedback verwerkt",
        description: `Feedback voor ${stageKey} is succesvol verwerkt - versie ${response?.newVersion || "onbekend"}`,
      });
      if (state.currentReport?.id) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports.detail(state.currentReport.id) });
      }
    },
    [dispatch, toast, queryClient, state.currentReport?.id]
  );

  /**
   * Reload prompts from database
   */
  const handleReloadPrompts = useCallback(async () => {
    if (!state.currentReport) return;

    setIsReloadingPrompts(true);
    try {
      // Clear all cached prompts in state
      dispatch({ type: "CLEAR_STAGE_PROMPTS" });

      // Invalidate prompt settings cache
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.prompts.all() });

      toast({
        title: "Prompts herladen",
        description:
          "Alle prompts zijn ververst vanuit de database. Bij de volgende uitvoering worden de nieuwe prompts gebruikt.",
      });
    } catch (error) {
      console.error("Failed to reload prompts:", error);
      toast({
        title: "Fout bij herladen",
        description: "De prompts konden niet worden herladen. Probeer het opnieuw.",
        variant: "destructive",
      });
    } finally {
      setIsReloadingPrompts(false);
    }
  }, [state.currentReport, dispatch, queryClient, toast]);

  return {
    handleExecuteStage,
    handleResetStage,
    handleFeedbackProcessed,
    handleReloadPrompts,
    isReloadingPrompts,
  };
}
