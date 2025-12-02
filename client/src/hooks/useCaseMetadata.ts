/**
 * useCaseMetadata Hook
 *
 * Handles case metadata editing (title, client name) with optimistic updates.
 * Extracted from case-detail.tsx lines 52-150.
 */

import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { CaseMetadataUpdate, EditState } from "@/types/caseDetail.types";
import type { Report } from "@shared/schema";

interface UseCaseMetadataProps {
  reportId: string | undefined;
  report: Report | undefined;
}

interface UseCaseMetadataReturn extends EditState {
  isPending: boolean;
  handleEditTitle: () => void;
  handleEditClient: () => void;
  handleSaveTitle: () => void;
  handleSaveClient: () => void;
  handleCancelEdit: (type: "title" | "client") => void;
  setEditedTitle: (value: string) => void;
  setEditedClient: (value: string) => void;
}

export function useCaseMetadata({
  reportId,
  report,
}: UseCaseMetadataProps): UseCaseMetadataReturn {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingClient, setIsEditingClient] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedClient, setEditedClient] = useState("");

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateCaseMutation = useMutation({
    mutationFn: async (updates: CaseMetadataUpdate) => {
      const response = await fetch(`/api/cases/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Fout bij updaten");
      }

      const data = await response.json();
      return data.data || data;
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({
        queryKey: [`/api/reports/${reportId}`],
      });

      const previousReport = queryClient.getQueryData([
        `/api/reports/${reportId}`,
      ]);

      queryClient.setQueryData(
        [`/api/reports/${reportId}`],
        (old: Report | undefined) => {
          if (!old) return old;
          return {
            ...old,
            ...updates,
            updatedAt: new Date().toISOString(),
          };
        }
      );

      return { previousReport };
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previousReport) {
        queryClient.setQueryData(
          [`/api/reports/${reportId}`],
          context.previousReport
        );
      }
      toast({
        title: "Fout bij opslaan",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: (updatedReport) => {
      setIsEditingTitle(false);
      setIsEditingClient(false);

      if (updatedReport) {
        queryClient.setQueryData(
          [`/api/reports/${reportId}`],
          (old: Report | undefined) => ({
            ...old,
            ...updatedReport,
          })
        );
      }

      queryClient.invalidateQueries({
        queryKey: ["/api/cases"],
        exact: false,
      });

      toast({
        title: "Succesvol bijgewerkt",
        description: "De wijzigingen zijn opgeslagen.",
      });
    },
  });

  const handleEditTitle = useCallback(() => {
    setEditedTitle(report?.title || "");
    setIsEditingTitle(true);
  }, [report?.title]);

  const handleEditClient = useCallback(() => {
    setEditedClient(report?.clientName || "");
    setIsEditingClient(true);
  }, [report?.clientName]);

  const handleSaveTitle = useCallback(() => {
    if (editedTitle.trim() && editedTitle !== report?.title) {
      updateCaseMutation.mutate({ title: editedTitle.trim() });
    } else {
      setIsEditingTitle(false);
    }
  }, [editedTitle, report?.title, updateCaseMutation]);

  const handleSaveClient = useCallback(() => {
    if (editedClient.trim() && editedClient !== report?.clientName) {
      updateCaseMutation.mutate({ clientName: editedClient.trim() });
    } else {
      setIsEditingClient(false);
    }
  }, [editedClient, report?.clientName, updateCaseMutation]);

  const handleCancelEdit = useCallback(
    (type: "title" | "client") => {
      if (type === "title") {
        setIsEditingTitle(false);
        setEditedTitle(report?.title || "");
      } else {
        setIsEditingClient(false);
        setEditedClient(report?.clientName || "");
      }
    },
    [report?.title, report?.clientName]
  );

  return {
    isEditingTitle,
    isEditingClient,
    editedTitle,
    editedClient,
    isPending: updateCaseMutation.isPending,
    handleEditTitle,
    handleEditClient,
    handleSaveTitle,
    handleSaveClient,
    handleCancelEdit,
    setEditedTitle,
    setEditedClient,
  };
}
