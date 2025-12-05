/**
 * useExternalReportSession Hook
 *
 * Manages state and API calls for the external report adjustment feature.
 *
 * Two-step flow:
 * 1. paste report → instruction → AI generates JSON adjustments
 * 2. review each adjustment (accept/edit/reject) → AI applies accepted changes
 */

import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ExternalReportSession, ExternalReportAdjustment } from "@shared/schema";
import type { AdjustmentItem } from "@shared/types/api";
import type { AdjustmentStatus, ReviewableAdjustment, DebugInfo } from "@/types/adjustment.types";

// Re-export for backward compatibility
export type { AdjustmentStatus, ReviewableAdjustment, DebugInfo } from "@/types/adjustment.types";

export type ExternalReportStage =
  | "input"      // Initial: paste report + instruction
  | "analyzing"  // AI is generating JSON adjustments
  | "review"     // User reviews each adjustment
  | "applying"   // AI is applying accepted adjustments
  | "complete";  // Adjustments applied, show result

interface UseExternalReportSessionReturn {
  // Session list
  sessions: ExternalReportSession[];
  isLoadingSessions: boolean;

  // Current session state
  currentSession: (ExternalReportSession & { adjustments: ExternalReportAdjustment[] }) | null;
  isLoadingSession: boolean;
  stage: ExternalReportStage;

  // Input state
  title: string;
  setTitle: (title: string) => void;
  originalContent: string;
  setOriginalContent: (content: string) => void;

  // Instruction state
  instruction: string;
  setInstruction: (instruction: string) => void;

  // Review state (new two-step flow)
  proposedAdjustments: ReviewableAdjustment[];
  setAdjustmentStatus: (id: string, status: AdjustmentStatus, modifiedNieuw?: string) => void;
  acceptAll: () => void;
  rejectAll: () => void;

  // Result state
  resultContent: string | null;
  appliedCount: number;

  // Debug info
  analyzeDebugInfo: DebugInfo | null;
  applyDebugInfo: DebugInfo | null;

  // Status
  error: string | null;
  isCreating: boolean;
  isAnalyzing: boolean;
  isApplying: boolean;

  // Actions
  createSession: () => Promise<void>;
  createAndAnalyze: () => Promise<void>;  // Combined: create session + analyze
  loadSession: (id: string) => void;
  analyzeReport: () => Promise<void>;     // Step 1: Generate JSON adjustments
  applyAdjustments: () => Promise<void>;  // Step 2: Apply accepted adjustments
  deleteSession: (id: string) => Promise<void>;
  reset: () => void;
  startNewAdjustment: () => void;         // After completion, start new adjustment on same session
}

export function useExternalReportSession(): UseExternalReportSessionReturn {
  const queryClient = useQueryClient();

  // Local state
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [stage, setStage] = useState<ExternalReportStage>("input");
  const [title, setTitle] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [instruction, setInstruction] = useState("");
  const [proposedAdjustments, setProposedAdjustments] = useState<ReviewableAdjustment[]>([]);
  const [resultContent, setResultContent] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [analyzeDebugInfo, setAnalyzeDebugInfo] = useState<DebugInfo | null>(null);
  const [applyDebugInfo, setApplyDebugInfo] = useState<DebugInfo | null>(null);

  // Fetch all sessions
  const { data: sessions = [], isLoading: isLoadingSessions } = useQuery({
    queryKey: ["/api/external-reports"],
    refetchOnWindowFocus: false,
  });

  // Fetch current session details
  const { data: currentSession, isLoading: isLoadingSession } = useQuery({
    queryKey: ["/api/external-reports", currentSessionId],
    enabled: !!currentSessionId,
    refetchOnWindowFocus: false,
  });

  // Create session mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/external-reports", {
        title,
        originalContent,
      });
      const json = await response.json();
      return json.data as ExternalReportSession;
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ["/api/external-reports"] });
      setCurrentSessionId(session.id);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message || "Kon sessie niet aanmaken");
    },
  });

  // Analyze mutation (Step 1)
  const analyzeMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await apiRequest(
        "POST",
        `/api/external-reports/${sessionId}/analyze`,
        { instruction }
      );
      const json = await response.json();
      return json.data as { adjustments: AdjustmentItem[]; instruction: string; version: number; _debug?: DebugInfo };
    },
    onSuccess: (data) => {
      // Convert to reviewable adjustments with pending status
      const reviewable: ReviewableAdjustment[] = data.adjustments.map(adj => ({
        ...adj,
        status: "pending" as AdjustmentStatus
      }));
      setProposedAdjustments(reviewable);
      setStage("review");
      setError(null);
      // Store debug info
      if (data._debug) {
        setAnalyzeDebugInfo(data._debug);
      }
    },
    onError: (err: Error) => {
      setError(err.message || "Kon aanpassingen niet analyseren");
      setStage("input");
    },
  });

  // Apply mutation (Step 2)
  const applyMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      // Only send accepted/modified adjustments
      const toApply = proposedAdjustments
        .filter(adj => adj.status === "accepted" || adj.status === "modified")
        .map(adj => ({
          id: adj.id,
          context: adj.context,
          oud: adj.oud,
          nieuw: adj.status === "modified" && adj.modifiedNieuw ? adj.modifiedNieuw : adj.nieuw,
          reden: adj.reden,
          status: adj.status
        }));

      const response = await apiRequest(
        "POST",
        `/api/external-reports/${sessionId}/apply`,
        { adjustments: toApply, instruction }
      );
      const json = await response.json();
      return json.data as { newContent: string; appliedCount: number; version: number; _debug?: DebugInfo };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/external-reports"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/external-reports", currentSessionId],
      });
      setResultContent(data.newContent);
      setAppliedCount(data.appliedCount);
      setStage("complete");
      setError(null);
      // Store debug info
      if (data._debug) {
        setApplyDebugInfo(data._debug);
      }
    },
    onError: (err: Error) => {
      setError(err.message || "Kon aanpassingen niet toepassen");
      setStage("review");
    },
  });

  // Delete session mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/external-reports/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/external-reports"] });
      if (currentSessionId) {
        setCurrentSessionId(null);
        reset();
      }
    },
    onError: (err: Error) => {
      setError(err.message || "Kon sessie niet verwijderen");
    },
  });

  // Actions
  const createSession = useCallback(async () => {
    if (!title.trim() || !originalContent.trim()) {
      setError("Titel en rapport content zijn verplicht");
      return;
    }
    if (originalContent.length < 10) {
      setError("Rapport moet minimaal 10 karakters bevatten");
      return;
    }
    await createMutation.mutateAsync();
  }, [title, originalContent, createMutation]);

  // Combined action: create session then immediately analyze
  const createAndAnalyze = useCallback(async () => {
    if (!originalContent.trim() || originalContent.length < 10) {
      setError("Rapport moet minimaal 10 karakters bevatten");
      return;
    }
    if (!instruction.trim() || instruction.length < 10) {
      setError("Beschrijf wat je wilt aanpassen (minimaal 10 karakters)");
      return;
    }

    // Auto-generate title from first line or first 50 chars
    const autoTitle = originalContent.split('\n')[0]?.slice(0, 50).trim() ||
                      `Rapport ${new Date().toLocaleDateString('nl-NL')}`;

    setStage("analyzing");
    setError(null);

    try {
      // Step 1: Create session
      const createResponse = await apiRequest("POST", "/api/external-reports", {
        title: autoTitle,
        originalContent,
      });
      const createJson = await createResponse.json();
      const session = createJson.data as ExternalReportSession;

      queryClient.invalidateQueries({ queryKey: ["/api/external-reports"] });
      setCurrentSessionId(session.id);

      // Step 2: Analyze immediately
      const analyzeResponse = await apiRequest(
        "POST",
        `/api/external-reports/${session.id}/analyze`,
        { instruction }
      );
      const analyzeJson = await analyzeResponse.json();
      const data = analyzeJson.data as { adjustments: AdjustmentItem[]; instruction: string; version: number; _debug?: DebugInfo };

      // Convert to reviewable adjustments
      const reviewable: ReviewableAdjustment[] = data.adjustments.map(adj => ({
        ...adj,
        status: "pending" as AdjustmentStatus
      }));
      setProposedAdjustments(reviewable);
      setStage("review");
      // Store debug info
      if (data._debug) {
        setAnalyzeDebugInfo(data._debug);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Er ging iets mis";
      setError(errorMessage);
      setStage("input");
    }
  }, [originalContent, instruction, queryClient]);

  const loadSession = useCallback((id: string) => {
    setCurrentSessionId(id);
    setStage("input");
    setProposedAdjustments([]);
    setInstruction("");
    setResultContent(null);
    setAppliedCount(0);
    setError(null);
  }, []);

  const analyzeReport = useCallback(async () => {
    if (!currentSessionId) {
      setError("Geen actieve sessie");
      return;
    }
    if (!instruction.trim() || instruction.length < 10) {
      setError("Instructie moet minimaal 10 karakters bevatten");
      return;
    }
    setStage("analyzing");
    setError(null);
    await analyzeMutation.mutateAsync(currentSessionId);
  }, [currentSessionId, instruction, analyzeMutation]);

  const applyAdjustments = useCallback(async () => {
    if (!currentSessionId) {
      setError("Geen actieve sessie");
      return;
    }

    const acceptedCount = proposedAdjustments.filter(
      adj => adj.status === "accepted" || adj.status === "modified"
    ).length;

    if (acceptedCount === 0) {
      setError("Selecteer minimaal één aanpassing om toe te passen");
      return;
    }

    setStage("applying");
    setError(null);
    await applyMutation.mutateAsync(currentSessionId);
  }, [currentSessionId, proposedAdjustments, applyMutation]);

  const setAdjustmentStatus = useCallback((id: string, status: AdjustmentStatus, modifiedNieuw?: string) => {
    setProposedAdjustments(prev => prev.map(adj =>
      adj.id === id
        ? { ...adj, status, modifiedNieuw: modifiedNieuw ?? adj.modifiedNieuw }
        : adj
    ));
  }, []);

  const acceptAll = useCallback(() => {
    setProposedAdjustments(prev => prev.map(adj => ({ ...adj, status: "accepted" as AdjustmentStatus })));
  }, []);

  const rejectAll = useCallback(() => {
    setProposedAdjustments(prev => prev.map(adj => ({ ...adj, status: "rejected" as AdjustmentStatus })));
  }, []);

  const deleteSession = useCallback(
    async (id: string) => {
      await deleteMutation.mutateAsync(id);
    },
    [deleteMutation]
  );

  const reset = useCallback(() => {
    setCurrentSessionId(null);
    setStage("input");
    setTitle("");
    setOriginalContent("");
    setInstruction("");
    setProposedAdjustments([]);
    setResultContent(null);
    setAppliedCount(0);
    setError(null);
    setAnalyzeDebugInfo(null);
    setApplyDebugInfo(null);
  }, []);

  const startNewAdjustment = useCallback(() => {
    // Keep session, clear adjustment state
    setStage("input");
    setInstruction("");
    setProposedAdjustments([]);
    setResultContent(null);
    setAppliedCount(0);
    setError(null);
    setAnalyzeDebugInfo(null);
    setApplyDebugInfo(null);
  }, []);

  return {
    // Session list
    sessions: sessions as ExternalReportSession[],
    isLoadingSessions,

    // Current session
    currentSession: currentSession as (ExternalReportSession & { adjustments: ExternalReportAdjustment[] }) | null,
    isLoadingSession,
    stage,

    // Input state
    title,
    setTitle,
    originalContent,
    setOriginalContent,

    // Instruction state
    instruction,
    setInstruction,

    // Review state
    proposedAdjustments,
    setAdjustmentStatus,
    acceptAll,
    rejectAll,

    // Result state
    resultContent,
    appliedCount,

    // Debug info
    analyzeDebugInfo,
    applyDebugInfo,

    // Status
    error,
    isCreating: createMutation.isPending,
    isAnalyzing: analyzeMutation.isPending,
    isApplying: applyMutation.isPending,

    // Actions
    createSession,
    createAndAnalyze,
    loadSession,
    analyzeReport,
    applyAdjustments,
    deleteSession,
    reset,
    startNewAdjustment,
  };
}
