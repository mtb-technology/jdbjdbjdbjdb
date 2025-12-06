/**
 * usePromptConfigMutation Hook
 *
 * Encapsulates the TanStack Query mutation logic for saving prompt configurations.
 * Consolidates:
 * - updatePromptMutation (lines 104-175)
 * - handleSave function (lines 348-384)
 */

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { useToast } from "@/hooks/use-toast";
import type { PromptConfig, AiConfig, PromptConfigRecord } from "@shared/schema";
import type { MutationContext } from "@/types/settings.types";

interface UsePromptConfigMutationReturn {
  mutation: ReturnType<typeof useMutation<PromptConfigRecord, Error, { id: string; config: PromptConfig }>>;
  handleSave: () => Promise<void>;
  isSaving: boolean;
}

export function usePromptConfigMutation(
  activeConfig: PromptConfig | null,
  globalAiConfig: AiConfig,
  activePromptConfigId: string | undefined
): UsePromptConfigMutationReturn {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation<PromptConfigRecord, Error, { id: string; config: PromptConfig }, MutationContext>({
    mutationFn: async (data: { id: string; config: PromptConfig }) => {
      try {
        const response = await apiRequest("PUT", `/api/prompts/${data.id}`, {
          config: data.config,
          isActive: true,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();

        // Validate response structure
        if (!responseData || typeof responseData !== "object") {
          throw new Error("Invalid response format");
        }

        if ("error" in responseData) {
          throw new Error(responseData.error?.message || "Failed to update settings");
        }

        if ("success" in responseData && responseData.success === true) {
          return responseData.data;
        }

        return responseData;
      } catch (error) {
        console.error("Settings update failed:", error);
        throw new Error(error instanceof Error ? error.message : "Failed to update settings");
      }
    },
    onMutate: async (newData) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.prompts.active() });
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.prompts.all() });

      // Snapshot previous values
      const previousData = queryClient.getQueryData(QUERY_KEYS.prompts.active());

      // Optimistically update
      queryClient.setQueryData(QUERY_KEYS.prompts.active(), (old: PromptConfigRecord | undefined) => ({
        ...old,
        config: newData.config,
      }));

      return { previousData };
    },
    onError: (err, _newData, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(QUERY_KEYS.prompts.active(), context.previousData);
      }

      toast({
        title: "Instellingen niet opgeslagen",
        description: err.message || "Er ging iets mis bij het opslaan van de instellingen",
        variant: "destructive",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.prompts.all() });
      toast({
        title: "Configuratie opgeslagen",
        description: "Prompt configuratie is succesvol bijgewerkt.",
      });
    },
    retry: 2,
    retryDelay: 1000,
  });

  const handleSave = useCallback(async () => {
    if (!activeConfig || !activePromptConfigId) {
      toast({
        title: "Kan niet opslaan",
        description: "Er is geen actieve configuratie om op te slaan",
        variant: "destructive",
      });
      return;
    }

    try {
      // Add loading state
      toast({
        title: "Bezig met opslaan...",
        description: "Even geduld terwijl we je instellingen opslaan",
      });

      // Make sure we have the latest data before saving
      const currentConfig = queryClient.getQueryData(QUERY_KEYS.prompts.active());
      if (!currentConfig) {
        await queryClient.fetchQuery({ queryKey: QUERY_KEYS.prompts.active() });
      }

      // Save with optimistic updates and error handling
      await mutation.mutateAsync({
        id: activePromptConfigId,
        config: {
          ...activeConfig,
          aiConfig: globalAiConfig, // Make sure we save the current AI config
        },
      });
    } catch (error) {
      console.error("Save failed:", error);
      // Error is already handled by mutation error handler
    }
  }, [activeConfig, mutation, activePromptConfigId, globalAiConfig, queryClient, toast]);

  return {
    mutation,
    handleSave,
    isSaving: mutation.isPending,
  };
}
