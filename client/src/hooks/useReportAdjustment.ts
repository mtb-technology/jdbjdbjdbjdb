/**
 * useReportAdjustment Hook
 *
 * Manages the state and API calls for the "Rapport Aanpassen" feature.
 * Two-step flow (same as External Report tab):
 * 1. Input instruction → AI generates JSON adjustments
 * 2. Review each adjustment (accept/edit/reject) → AI applies accepted changes
 */

import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type AdjustmentStage = "input" | "analyzing" | "review" | "applying" | "complete";
export type AdjustmentStatus = "pending" | "accepted" | "modified" | "rejected";

export interface AdjustmentItem {
  id: string;
  context: string;
  oud: string;
  nieuw: string;
  reden: string;
}

export interface ReviewableAdjustment extends AdjustmentItem {
  status: AdjustmentStatus;
  modifiedNieuw?: string;
}

export interface DebugInfo {
  promptUsed: string;
  promptLength: number;
  aiConfig: {
    provider: string;
    model: string;
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
  };
  stage: string;
}

interface AdjustmentProposal {
  adjustmentId: string;
  adjustments: AdjustmentItem[];
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
  proposedAdjustments: ReviewableAdjustment[];
  resultContent: string | null;
  appliedCount: number;
  error: string | null;
  isAnalyzing: boolean;
  isApplying: boolean;

  // Debug info
  analyzeDebugInfo: DebugInfo | null;
  applyDebugInfo: DebugInfo | null;

  // Actions
  openDialog: () => void;
  closeDialog: () => void;
  setInstruction: (text: string) => void;
  generateProposal: () => Promise<void>;
  setAdjustmentStatus: (id: string, status: AdjustmentStatus, modifiedNieuw?: string) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  applyAdjustments: () => Promise<void>;
  goBackToInput: () => void;
}

export function useReportAdjustment(reportId: string): UseReportAdjustmentReturn {
  const queryClient = useQueryClient();

  // Local state
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<AdjustmentStage>("input");
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<AdjustmentProposal | null>(null);
  const [proposedAdjustments, setProposedAdjustments] = useState<ReviewableAdjustment[]>([]);
  const [resultContent, setResultContent] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [analyzeDebugInfo, setAnalyzeDebugInfo] = useState<DebugInfo | null>(null);
  const [applyDebugInfo, setApplyDebugInfo] = useState<DebugInfo | null>(null);

  // Generate adjustment mutation (Step 1: Analyze)
  const analyzeMutation = useMutation({
    mutationFn: async (instructionText: string) => {
      const response = await apiRequest(
        "POST",
        `/api/reports/${reportId}/adjust`,
        { instruction: instructionText }
      );
      const json = await response.json();
      return json.data as {
        adjustmentId: string;
        adjustments: AdjustmentItem[];
        previousContent: string;
        metadata: { instruction: string; createdAt: string; version: number };
        _debug?: DebugInfo;
      };
    },
    onSuccess: (data) => {
      // Convert to reviewable adjustments with pending status
      const adjustments = data.adjustments || [];
      const reviewable: ReviewableAdjustment[] = adjustments.map(adj => ({
        ...adj,
        status: "pending" as AdjustmentStatus
      }));
      setProposedAdjustments(reviewable);
      setProposal({
        adjustmentId: data.adjustmentId,
        adjustments: adjustments,
        previousContent: data.previousContent,
        instruction: data.metadata?.instruction || "",
        createdAt: data.metadata?.createdAt || new Date().toISOString(),
      });
      setStage("review");
      setError(null);
      if (data._debug) {
        setAnalyzeDebugInfo(data._debug);
      }
    },
    onError: (err: Error) => {
      setError(err.message || "Er is een fout opgetreden bij het analyseren");
      setStage("input");
    },
  });

  // Apply adjustment mutation (Step 2: Apply via Editor)
  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("Geen voorstel om toe te passen");

      // Only send accepted/modified adjustments
      const toApply = proposedAdjustments
        .filter(adj => adj.status === "accepted" || adj.status === "modified")
        .map(adj => ({
          id: adj.id,
          context: adj.context,
          oud: adj.oud,
          nieuw: adj.status === "modified" && adj.modifiedNieuw ? adj.modifiedNieuw : adj.nieuw,
          reden: adj.reden
        }));

      const response = await apiRequest(
        "POST",
        `/api/reports/${reportId}/adjust/apply`,
        {
          adjustments: toApply,
          instruction: proposal.instruction,
          adjustmentId: proposal.adjustmentId
        }
      );
      const json = await response.json();
      return json.data as {
        newContent: string;
        appliedCount: number;
        newVersion: number;
        _debug?: DebugInfo;
      };
    },
    onSuccess: (data) => {
      // Invalidate report query to refresh data
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${reportId}`] });

      setResultContent(data.newContent);
      setAppliedCount(data.appliedCount);
      setStage("complete");
      setError(null);
      if (data._debug) {
        setApplyDebugInfo(data._debug);
      }
    },
    onError: (err: Error) => {
      setError(err.message || "Er is een fout opgetreden bij het toepassen");
      setStage("review");
    },
  });

  // Reset all state
  const resetState = useCallback(() => {
    setIsOpen(false);
    setStage("input");
    setInstruction("");
    setProposal(null);
    setProposedAdjustments([]);
    setResultContent(null);
    setAppliedCount(0);
    setError(null);
    setAnalyzeDebugInfo(null);
    setApplyDebugInfo(null);
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

  // Generate proposal (Step 1)
  const generateProposal = useCallback(async () => {
    if (!instruction.trim() || instruction.length < 10) {
      setError("Instructie moet minimaal 10 karakters bevatten");
      return;
    }

    setStage("analyzing");
    setError(null);
    await analyzeMutation.mutateAsync(instruction);
  }, [instruction, analyzeMutation]);

  // Set adjustment status
  const setAdjustmentStatus = useCallback((id: string, status: AdjustmentStatus, modifiedNieuw?: string) => {
    setProposedAdjustments(prev => prev.map(adj =>
      adj.id === id
        ? { ...adj, status, modifiedNieuw: modifiedNieuw ?? adj.modifiedNieuw }
        : adj
    ));
  }, []);

  // Accept all adjustments
  const acceptAll = useCallback(() => {
    setProposedAdjustments(prev => prev.map(adj => ({ ...adj, status: "accepted" as AdjustmentStatus })));
  }, []);

  // Reject all adjustments
  const rejectAll = useCallback(() => {
    setProposedAdjustments(prev => prev.map(adj => ({ ...adj, status: "rejected" as AdjustmentStatus })));
  }, []);

  // Apply adjustments (Step 2)
  const applyAdjustments = useCallback(async () => {
    const acceptedCount = proposedAdjustments.filter(
      adj => adj.status === "accepted" || adj.status === "modified"
    ).length;

    if (acceptedCount === 0) {
      setError("Selecteer minimaal één aanpassing om toe te passen");
      return;
    }

    setStage("applying");
    setError(null);
    await applyMutation.mutateAsync();
  }, [proposedAdjustments, applyMutation]);

  // Go back to input (from review)
  const goBackToInput = useCallback(() => {
    setStage("input");
    setProposal(null);
    setProposedAdjustments([]);
    setError(null);
    // Keep instruction so user can modify it
  }, []);

  return {
    // State
    isOpen,
    stage,
    instruction,
    proposal,
    proposedAdjustments,
    resultContent,
    appliedCount,
    error,
    isAnalyzing: analyzeMutation.isPending,
    isApplying: applyMutation.isPending,

    // Debug info
    analyzeDebugInfo,
    applyDebugInfo,

    // Actions
    openDialog,
    closeDialog,
    setInstruction,
    generateProposal,
    setAdjustmentStatus,
    acceptAll,
    rejectAll,
    applyAdjustments,
    goBackToInput,
  };
}
