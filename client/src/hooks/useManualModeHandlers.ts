/**
 * useManualModeHandlers Hook
 *
 * Consolidates manual mode handler functions from WorkflowView.tsx:
 * - handleToggleManualMode (lines 174-205)
 * - handleToggleStageManualMode (lines 207-239)
 * - handleManualContentChange (lines 241-244)
 * - handleStageManualContentChange (lines 246-249)
 * - handleManualExecute (lines 252-303)
 * - handleStageManualExecute (lines 306-364)
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { useToast } from "@/hooks/use-toast";
import type { WorkflowState, WorkflowAction } from "@/components/workflow/WorkflowContext";

interface UseManualModeHandlersProps {
  state: WorkflowState;
  dispatch: React.Dispatch<WorkflowAction>;
}

interface UseManualModeHandlersReturn {
  handleToggleManualMode: (mode: "ai" | "manual") => Promise<void>;
  handleToggleStageManualMode: (stageKey: string) => (mode: "ai" | "manual") => Promise<void>;
  handleManualContentChange: (content: string) => void;
  handleStageManualContentChange: (stageKey: string) => (content: string) => void;
  handleManualExecute: () => Promise<void>;
  handleStageManualExecute: (stageKey: string) => () => Promise<void>;
}

export function useManualModeHandlers({
  state,
  dispatch,
}: UseManualModeHandlersProps): UseManualModeHandlersReturn {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /**
   * Toggle manual mode for stage 3 (generatie)
   */
  const handleToggleManualMode = useCallback(
    async (mode: "ai" | "manual") => {
      dispatch({ type: "SET_MANUAL_MODE", mode });

      // If switching to manual mode and no prompt exists, fetch it from backend
      if (mode === "manual" && !state.stagePrompts["3_generatie"] && state.currentReport) {
        try {
          const response = await apiRequest(
            "GET",
            `/api/reports/${state.currentReport.id}/stage/3_generatie/prompt`
          );

          if (!response.ok) {
            throw new Error("Failed to generate prompt");
          }

          const data = await response.json();

          if (data.data?.prompt) {
            dispatch({
              type: "SET_STAGE_PROMPT",
              stage: "3_generatie",
              prompt: data.data.prompt,
            });
          }
        } catch (error) {
          console.error("Failed to generate prompt:", error);
          toast({
            title: "Fout bij prompt genereren",
            description: "De prompt kon niet worden gegenereerd. Probeer het opnieuw.",
            variant: "destructive",
          });
        }
      }
    },
    [dispatch, state.stagePrompts, state.currentReport, toast]
  );

  /**
   * Toggle manual mode for reviewer stages (4A, 4B, etc.)
   */
  const handleToggleStageManualMode = useCallback(
    (stageKey: string) => async (mode: "ai" | "manual") => {
      dispatch({ type: "SET_STAGE_MANUAL_MODE", stage: stageKey, mode });

      // If switching to manual mode and no prompt exists, fetch it from backend
      if (mode === "manual" && !state.stagePrompts[stageKey] && state.currentReport) {
        try {
          const response = await apiRequest(
            "GET",
            `/api/reports/${state.currentReport.id}/stage/${stageKey}/prompt`
          );

          if (!response.ok) {
            throw new Error("Failed to generate prompt");
          }

          const data = await response.json();

          if (data.data?.prompt) {
            dispatch({
              type: "SET_STAGE_PROMPT",
              stage: stageKey,
              prompt: data.data.prompt,
            });
          }
        } catch (error) {
          console.error("Failed to generate prompt:", error);
          toast({
            title: "Fout bij prompt genereren",
            description: "De prompt kon niet worden gegenereerd. Probeer het opnieuw.",
            variant: "destructive",
          });
        }
      }
    },
    [dispatch, state.stagePrompts, state.currentReport, toast]
  );

  /**
   * Handle manual content change for stage 3
   */
  const handleManualContentChange = useCallback(
    (content: string) => {
      dispatch({ type: "SET_MANUAL_CONTENT", content });
    },
    [dispatch]
  );

  /**
   * Handle manual content change for reviewer stages
   */
  const handleStageManualContentChange = useCallback(
    (stageKey: string) => (content: string) => {
      dispatch({ type: "SET_STAGE_MANUAL_CONTENT", stage: stageKey, content });
    },
    [dispatch]
  );

  /**
   * Execute manual content as result for stage 3
   */
  const handleManualExecute = useCallback(async () => {
    if (!state.currentReport || !state.manualContent.trim()) return;

    const stageKey = "3_generatie";

    try {
      // Save to server using override-concept endpoint
      const response = await apiRequest(
        "POST",
        `/api/reports/${state.currentReport.id}/stage/${stageKey}/override-concept`,
        {
          content: state.manualContent,
          source: "manual_gemini_deep_research",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to save manual content");
      }

      const data = await response.json();

      // Store the manual content as the stage result
      dispatch({
        type: "SET_STAGE_RESULT",
        stage: stageKey,
        result: state.manualContent,
      });

      // Also store in concept versions
      dispatch({
        type: "SET_CONCEPT_VERSION",
        stage: stageKey,
        content: state.manualContent,
      });

      // Clear manual content
      dispatch({ type: "SET_MANUAL_CONTENT", content: "" });

      toast({
        title: "Stap 3 voltooid",
        description: `Het handmatige resultaat is opgeslagen als concept rapport v${data.version || 1}. Je kunt nu verder naar stap 4.`,
      });

      // Invalidate query to trigger reload
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports.detail(state.currentReport.id) });
    } catch (error) {
      console.error("Failed to save manual content:", error);
      toast({
        title: "Fout bij opslaan",
        description: "Het handmatige resultaat kon niet worden opgeslagen. Probeer het opnieuw.",
        variant: "destructive",
      });
    }
  }, [state.currentReport, state.manualContent, dispatch, toast, queryClient]);

  /**
   * Execute manual content as result for reviewer stages
   */
  const handleStageManualExecute = useCallback(
    (stageKey: string) => async () => {
      if (!state.currentReport) return;

      const manualContent = state.manualContents[stageKey];
      if (!manualContent?.trim()) return;

      try {
        // Save to server using manual-stage endpoint
        const response = await apiRequest(
          "POST",
          `/api/reports/${state.currentReport.id}/manual-stage`,
          {
            stage: stageKey,
            content: manualContent,
            isManual: true,
          }
        );

        if (!response.ok) {
          throw new Error("Failed to save manual content");
        }

        // Store the manual content as the stage result
        dispatch({
          type: "SET_STAGE_RESULT",
          stage: stageKey,
          result: manualContent,
        });

        // Clear manual content for this stage
        dispatch({ type: "SET_STAGE_MANUAL_CONTENT", stage: stageKey, content: "" });

        toast({
          title: `${stageKey} voltooid`,
          description: "✅ Stap 1 voltooid. Nu: Verwerk de feedback om het concept bij te werken.",
        });

        // Invalidate query to trigger reload
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports.detail(state.currentReport.id) });

        // Auto-scroll to feedback processor after a short delay
        setTimeout(() => {
          const feedbackSection = document.querySelector(
            `[data-stage="${stageKey}"] [data-feedback-processor]`
          );
          if (feedbackSection) {
            feedbackSection.scrollIntoView({
              behavior: "smooth",
              block: "start",
              inline: "nearest",
            });
          }
        }, 500);
      } catch (error) {
        console.error("Failed to save manual content:", error);
        toast({
          title: "Fout bij opslaan",
          description: "Het handmatige resultaat kon niet worden opgeslagen. Probeer het opnieuw.",
          variant: "destructive",
        });
      }
    },
    [state.currentReport, state.manualContents, dispatch, toast, queryClient]
  );

  return {
    handleToggleManualMode,
    handleToggleStageManualMode,
    handleManualContentChange,
    handleStageManualContentChange,
    handleManualExecute,
    handleStageManualExecute,
  };
}
