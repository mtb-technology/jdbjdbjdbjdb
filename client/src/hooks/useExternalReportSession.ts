/**
 * useExternalReportSession Hook
 *
 * Manages state and API calls for the external report adjustment feature.
 * Flow: paste report → instruction → AI adjustment → diff preview → accept/reject
 */

import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ExternalReportSession, ExternalReportAdjustment } from "@shared/schema";

export type ExternalReportStage = "input" | "adjust" | "processing" | "preview";

interface AdjustmentProposal {
  proposedContent: string;
  previousContent: string;
  version: number;
}

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

  // Adjustment state
  instruction: string;
  setInstruction: (instruction: string) => void;
  proposal: AdjustmentProposal | null;

  // Status
  error: string | null;
  isCreating: boolean;
  isGenerating: boolean;
  isAccepting: boolean;

  // Actions
  createSession: () => Promise<void>;
  createAndGenerate: () => Promise<void>;  // Combined: create session + generate adjustment
  loadSession: (id: string) => void;
  generateAdjustment: () => Promise<void>;
  acceptAdjustment: () => Promise<void>;
  rejectAdjustment: () => void;
  deleteSession: (id: string) => Promise<void>;
  reset: () => void;
}

export function useExternalReportSession(): UseExternalReportSessionReturn {
  const queryClient = useQueryClient();

  // Local state
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [stage, setStage] = useState<ExternalReportStage>("input");
  const [title, setTitle] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<AdjustmentProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setStage("adjust");
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message || "Kon sessie niet aanmaken");
    },
  });

  // Generate adjustment mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!currentSessionId) throw new Error("Geen actieve sessie");

      const response = await apiRequest(
        "POST",
        `/api/external-reports/${currentSessionId}/adjust`,
        { instruction }
      );
      const json = await response.json();
      return json.data as AdjustmentProposal;
    },
    onSuccess: (data) => {
      setProposal(data);
      setStage("preview");
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message || "Kon aanpassing niet genereren");
      setStage("adjust");
    },
  });

  // Accept adjustment mutation
  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!currentSessionId || !proposal) {
        throw new Error("Geen voorstel om te accepteren");
      }

      const response = await apiRequest(
        "POST",
        `/api/external-reports/${currentSessionId}/accept`,
        {
          proposedContent: proposal.proposedContent,
          instruction,
        }
      );
      const json = await response.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/external-reports"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/external-reports", currentSessionId],
      });
      setProposal(null);
      setInstruction("");
      setStage("adjust");
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message || "Kon aanpassing niet accepteren");
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

  // Combined action: create session then immediately generate adjustment
  const createAndGenerate = useCallback(async () => {
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

    setStage("processing");
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

      // Step 2: Generate adjustment immediately
      const adjustResponse = await apiRequest(
        "POST",
        `/api/external-reports/${session.id}/adjust`,
        { instruction }
      );
      const adjustJson = await adjustResponse.json();
      const adjustmentProposal = adjustJson.data as AdjustmentProposal;

      setProposal(adjustmentProposal);
      setStage("preview");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Er ging iets mis";
      setError(errorMessage);
      setStage("input");
    }
  }, [originalContent, instruction, queryClient]);

  const loadSession = useCallback((id: string) => {
    setCurrentSessionId(id);
    setStage("adjust");
    setProposal(null);
    setInstruction("");
    setError(null);
  }, []);

  const generateAdjustment = useCallback(async () => {
    if (!instruction.trim() || instruction.length < 10) {
      setError("Instructie moet minimaal 10 karakters bevatten");
      return;
    }
    setStage("processing");
    setError(null);
    await generateMutation.mutateAsync();
  }, [instruction, generateMutation]);

  const acceptAdjustment = useCallback(async () => {
    await acceptMutation.mutateAsync();
  }, [acceptMutation]);

  const rejectAdjustment = useCallback(() => {
    setStage("adjust");
    setProposal(null);
    setError(null);
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
    setProposal(null);
    setError(null);
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

    // Adjustment state
    instruction,
    setInstruction,
    proposal,

    // Status
    error,
    isCreating: createMutation.isPending,
    isGenerating: generateMutation.isPending,
    isAccepting: acceptMutation.isPending,

    // Actions
    createSession,
    createAndGenerate,
    loadSession,
    generateAdjustment,
    acceptAdjustment,
    rejectAdjustment,
    deleteSession,
    reset,
  };
}
