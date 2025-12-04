/**
 * useReportAdjustment Hook
 *
 * Manages the state and API calls for the "Rapport Aanpassen" feature.
 * Handles the flow: input → processing → preview → accept/reject
 */

import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { AdjustReportResponse, AcceptAdjustmentResponse } from "@shared/types/api";

export type AdjustmentStage = "input" | "processing" | "preview";

interface AdjustmentProposal {
  adjustmentId: string;
  proposedContent: string;
  previousContent: string;
  instruction: string;
  createdAt: string;
}

interface UseReportAdjustmentReturn {
  // State
  isOpen: boolean;
  stage: AdjustmentStage;
  instruction: string;
  proposal: AdjustmentProposal | null;
  error: string | null;
  isProcessing: boolean;
  isAccepting: boolean;

  // Actions
  openDialog: () => void;
  closeDialog: () => void;
  setInstruction: (text: string) => void;
  generateProposal: () => Promise<void>;
  acceptProposal: () => Promise<void>;
  rejectProposal: () => void;
}

export function useReportAdjustment(reportId: string): UseReportAdjustmentReturn {
  const queryClient = useQueryClient();

  // Local state
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<AdjustmentStage>("input");
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<AdjustmentProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Generate adjustment mutation
  const generateMutation = useMutation({
    mutationFn: async (instructionText: string) => {
      const response = await apiRequest(
        "POST",
        `/api/reports/${reportId}/adjust`,
        { instruction: instructionText }
      );
      const json = await response.json();
      // API returns { success: true, data: {...} } format
      const data = json.data as AdjustReportResponse;
      return data;
    },
    onSuccess: (data) => {
      setProposal({
        adjustmentId: data.adjustmentId,
        proposedContent: data.proposedContent,
        previousContent: data.previousContent,
        instruction: data.metadata.instruction,
        createdAt: data.metadata.createdAt,
      });
      setStage("preview");
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message || "Er is een fout opgetreden bij het genereren van de aanpassing");
      setStage("input");
    },
  });

  // Accept adjustment mutation
  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("Geen voorstel om te accepteren");

      const response = await apiRequest(
        "POST",
        `/api/reports/${reportId}/adjust/accept`,
        {
          adjustmentId: proposal.adjustmentId,
          proposedContent: proposal.proposedContent,
          instruction: proposal.instruction,
        }
      );
      const json = await response.json();
      // API returns { success: true, data: {...} } format
      const data = json.data as AcceptAdjustmentResponse;
      return data;
    },
    onSuccess: () => {
      // Invalidate report query to refresh data
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${reportId}`] });

      // Reset state and close dialog
      resetState();
    },
    onError: (err: Error) => {
      setError(err.message || "Er is een fout opgetreden bij het accepteren van de aanpassing");
    },
  });

  // Reset all state
  const resetState = useCallback(() => {
    setIsOpen(false);
    setStage("input");
    setInstruction("");
    setProposal(null);
    setError(null);
  }, []);

  // Open dialog
  const openDialog = useCallback(() => {
    setIsOpen(true);
    setStage("input");
    setError(null);
  }, []);

  // Close dialog
  const closeDialog = useCallback(() => {
    resetState();
  }, [resetState]);

  // Generate proposal
  const generateProposal = useCallback(async () => {
    if (!instruction.trim() || instruction.length < 10) {
      setError("Instructie moet minimaal 10 karakters bevatten");
      return;
    }

    setStage("processing");
    setError(null);
    await generateMutation.mutateAsync(instruction);
  }, [instruction, generateMutation]);

  // Accept proposal
  const acceptProposal = useCallback(async () => {
    await acceptMutation.mutateAsync();
  }, [acceptMutation]);

  // Reject proposal (go back to input)
  const rejectProposal = useCallback(() => {
    setStage("input");
    setProposal(null);
    setError(null);
    // Keep instruction so user can modify it
  }, []);

  return {
    // State
    isOpen,
    stage,
    instruction,
    proposal,
    error,
    isProcessing: generateMutation.isPending,
    isAccepting: acceptMutation.isPending,

    // Actions
    openDialog,
    closeDialog,
    setInstruction,
    generateProposal,
    acceptProposal,
    rejectProposal,
  };
}
