/**
 * useFeedbackMutations Hook
 *
 * Mutations for processing feedback and fetching prompt previews.
 */

import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { retryWithBackoff, getErrorMessage } from "@/utils/retryUtils";
import type { ProcessFeedbackRequest, ProcessFeedbackResponse } from "@shared/types/api";
import type {
  PromptPreviewResponse,
  AIServiceStatus,
} from "@/types/feedbackProcessor.types";

interface UseFeedbackMutationsProps {
  reportId: string;
  stageId: string;
  onProcessingComplete?: (result: ProcessFeedbackResponse) => void;
  onProcessed: () => void;
  onClearInstructions: () => void;
}

export function useFeedbackMutations({
  reportId,
  stageId,
  onProcessingComplete,
  onProcessed,
  onClearInstructions,
}: UseFeedbackMutationsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch AI service status
  const { data: aiStatus } = useQuery<AIServiceStatus>({
    queryKey: ["ai-status"],
    queryFn: async () => {
      const response = await fetch("/api/health/ai");
      if (!response.ok) throw new Error("Failed to fetch AI status");
      const data = await response.json();
      return data.data;
    },
    refetchInterval: 30000,
    staleTime: 25000,
  });

  // Mutation for processing feedback
  const processFeedbackMutation = useMutation({
    mutationFn: async (
      payload: ProcessFeedbackRequest
    ): Promise<ProcessFeedbackResponse> => {
      return retryWithBackoff(async () => {
        const response = await apiRequest(
          "POST",
          `/api/reports/${reportId}/stage/${stageId}/process-feedback`,
          payload
        );
        const responseData = await response.json();

        if (responseData.success) {
          return responseData.data;
        } else {
          const error = new Error(
            responseData.error?.userMessage ||
              responseData.error?.message ||
              "Feedback processing failed"
          ) as Error & { code?: string; status?: number };
          error.code = responseData.error?.code;
          error.status = response.status;
          throw error;
        }
      });
    },
    onSuccess: (response: ProcessFeedbackResponse) => {
      console.log(`✅ Feedback processed successfully - v${response.newVersion}`);

      onProcessed();
      onClearInstructions();

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/reports", reportId] });

      toast({
        title: "Feedback verwerkt",
        description: `Concept rapport bijgewerkt naar versie ${response.newVersion}`,
        duration: 4000,
      });

      onProcessingComplete?.(response);
    },
    onError: (error: unknown) => {
      console.error(`❌ Failed to process feedback:`, error);

      const errorObj =
        error && typeof error === "object"
          ? (error as { code?: string })
          : {};
      const { title, description, action } = getErrorMessage(errorObj.code);

      toast({
        title,
        description: action ? `${description}\n\n${action}` : description,
        variant: "destructive",
        duration: 7000,
      });
    },
  });

  // Mutation for fetching prompt preview
  const promptPreviewMutation = useMutation({
    mutationFn: async (instructions: string): Promise<PromptPreviewResponse> => {
      const response = await fetch(
        `/api/reports/${reportId}/stage/${stageId}/prompt-preview`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userInstructions: instructions.trim() || undefined,
          }),
        }
      );

      if (!response.ok) {
        let errorMessage = "Failed to fetch prompt preview";
        try {
          const errorData = await response.json();
          errorMessage =
            errorData.error?.userMessage ||
            errorData.error?.message ||
            errorMessage;
        } catch {
          // If parsing fails, use default message
        }
        throw new Error(errorMessage);
      }
      const data = await response.json();
      return data.data;
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "Er ging iets mis bij het laden van de prompt preview";
      console.error(`❌ Failed to fetch prompt preview:`, error);
      toast({
        title: "Preview laden gefaald",
        description: message,
        variant: "destructive",
        duration: 3000,
      });
    },
  });

  return {
    aiStatus,
    processFeedbackMutation,
    promptPreviewMutation,
  };
}
