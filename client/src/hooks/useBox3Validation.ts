/**
 * useBox3Validation Hook - V2
 *
 * Validation logic for Box 3 Validator.
 * Uses the new V2 Blueprint data model.
 *
 * Supports both SSE (deprecated) and job-based revalidation.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Box3Blueprint } from "@shared/schema";
import type { PendingFile } from "@/types/box3Validator.types";
import type { Box3DossierFull } from "./useBox3Sessions";
import { BOX3_CONSTANTS } from "@shared/constants";

// Debug info from API response
interface DebugInfo {
  fullPrompt?: string;
  rawAiResponse?: string;
  model?: string;
  modelUsed?: string; // Legacy alias for model
  timestamp?: string;
  pipelineSteps?: any;
  pipelineErrors?: string[];
}

// Pipeline progress state
export interface PipelineProgress {
  step: number;
  totalSteps: number;
  message: string;
  phase: string;
}

// Job state for background revalidation
export interface Box3Job {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: {
    currentStage: string;
    percentage: number;
    message: string;
  } | null;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: {
    success: boolean;
    blueprintVersion: number;
    taxYears: string[];
  };
}

interface ValidationState {
  isValidating: boolean;
  blueprint: Box3Blueprint | null;
  currentDossierId: string | null;
  blueprintVersion: number;
  taxYears: string[];
  debugInfo: DebugInfo | null;
  pipelineProgress: PipelineProgress | null;
  // Job-based revalidation state
  activeJobId: string | null;
  activeJob: Box3Job | null;
}

interface UseBox3ValidationProps {
  refetchSessions: () => void;
}

interface UseBox3ValidationReturn extends ValidationState {
  validate: (
    clientName: string,
    inputText: string,
    pendingFiles: PendingFile[]
  ) => Promise<Box3DossierFull | null>;
  /** @deprecated Use startRevalidationJob instead */
  revalidate: (dossierId: string) => Promise<Box3Blueprint | null>;
  /** Start background revalidation job - returns jobId */
  startRevalidationJob: (dossierId: string) => Promise<string | null>;
  /** Cancel active revalidation job */
  cancelRevalidationJob: () => Promise<boolean>;
  setBlueprint: (blueprint: Box3Blueprint | null) => void;
  setCurrentDossierId: (id: string | null) => void;
  handleReset: () => void;
  loadFromDossier: (dossierFull: Box3DossierFull) => void;
  pipelineProgress: PipelineProgress | null;
  /** Check for and resume any active job for a dossier */
  checkForActiveJob: (dossierId: string) => Promise<void>;
}

export function useBox3Validation({
  refetchSessions,
}: UseBox3ValidationProps): UseBox3ValidationReturn {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isValidating, setIsValidating] = useState(false);
  const [blueprint, setBlueprint] = useState<Box3Blueprint | null>(null);
  const [currentDossierId, setCurrentDossierId] = useState<string | null>(null);
  const [blueprintVersion, setBlueprintVersion] = useState(0);
  const [taxYears, setTaxYears] = useState<string[]>([]);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [pipelineProgress, setPipelineProgress] = useState<PipelineProgress | null>(null);

  // Job-based revalidation state
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const jobCompletedRef = useRef(false);

  // Poll for job status when we have an active job
  const { data: jobData } = useQuery({
    queryKey: ["box3-job", activeJobId],
    queryFn: async () => {
      if (!activeJobId) return null;
      const response = await apiRequest("GET", `/api/jobs/${activeJobId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch job");
      }
      const result = await response.json();
      const data = result.success ? result.data : result;
      // Parse progress if it's a string
      if (data.progress && typeof data.progress === "string") {
        try {
          data.progress = JSON.parse(data.progress);
        } catch {
          data.progress = null;
        }
      }
      return data as Box3Job;
    },
    enabled: !!activeJobId && !jobCompletedRef.current,
    refetchInterval: (query) => {
      const job = query.state.data as Box3Job | null;
      if (job?.status === "completed" || job?.status === "failed") {
        return false;
      }
      return 3000; // Poll every 3 seconds
    },
    staleTime: 1000,
  });

  const activeJob = jobData || null;

  // Handle job completion/failure
  useEffect(() => {
    if (!activeJob || jobCompletedRef.current) return;

    // Update pipeline progress from job
    if (activeJob.progress) {
      setPipelineProgress({
        step: Math.round((activeJob.progress.percentage / 100) * 5),
        totalSteps: 5,
        message: activeJob.progress.message,
        phase: activeJob.progress.currentStage,
      });
    }

    if (activeJob.status === "completed") {
      jobCompletedRef.current = true;
      setIsValidating(false);
      setPipelineProgress(null);
      setActiveJobId(null);

      // Update state from result
      if (activeJob.result) {
        setBlueprintVersion(activeJob.result.blueprintVersion);
        setTaxYears(activeJob.result.taxYears);
      }

      toast({
        title: "Opnieuw gevalideerd",
        description: `Blueprint v${activeJob.result?.blueprintVersion || "?"} aangemaakt.`,
      });

      refetchSessions();
      // Invalidate dossier query to refresh data
      if (currentDossierId) {
        queryClient.invalidateQueries({ queryKey: ["box3-dossier", currentDossierId] });
      }
    }

    if (activeJob.status === "failed") {
      jobCompletedRef.current = true;
      setIsValidating(false);
      setPipelineProgress(null);
      setActiveJobId(null);

      toast({
        title: "Hervalidatie mislukt",
        description: activeJob.error || "Er is een fout opgetreden",
        variant: "destructive",
      });
    }
  }, [activeJob, currentDossierId, queryClient, toast, refetchSessions]);

  // Reset completed ref when job ID changes
  useEffect(() => {
    if (activeJobId) {
      jobCompletedRef.current = false;
    }
  }, [activeJobId]);

  // Load state from a loaded dossier
  const loadFromDossier = (dossierFull: Box3DossierFull) => {
    setBlueprint(dossierFull.blueprint);
    setCurrentDossierId(dossierFull.dossier.id);
    setBlueprintVersion(dossierFull.blueprintVersion);
    setTaxYears(dossierFull.dossier.taxYears || []);
  };

  // Check for active job when loading a dossier
  const checkForActiveJob = useCallback(async (dossierId: string) => {
    try {
      const response = await apiRequest("GET", `/api/box3-validator/dossiers/${dossierId}/job`);
      if (!response.ok) return;

      const result = await response.json();
      const data = result.success ? result.data : result;

      if (data.hasActiveJob && data.job) {
        setActiveJobId(data.job.id);
        setIsValidating(true);
        if (data.job.progress) {
          setPipelineProgress({
            step: Math.round((data.job.progress.percentage / 100) * 5),
            totalSteps: 5,
            message: data.job.progress.message,
            phase: data.job.progress.currentStage,
          });
        }
      }
    } catch {
      // Ignore errors - just means no active job
    }
  }, []);

  // Start background revalidation job
  const startRevalidationJob = useCallback(async (dossierId: string): Promise<string | null> => {
    if (!dossierId) {
      toast({
        title: "Geen dossier",
        description: "Laad eerst een dossier om opnieuw te valideren.",
        variant: "destructive",
      });
      return null;
    }

    setIsValidating(true);
    setPipelineProgress({ step: 0, totalSteps: 5, message: 'Job starten...', phase: 'starting' });

    try {
      const response = await apiRequest("POST", `/api/box3-validator/dossiers/${dossierId}/revalidate-job`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      const data = result.success ? result.data : result;

      setActiveJobId(data.jobId);

      if (data.existing) {
        toast({
          title: "Actieve job gevonden",
          description: "Er loopt al een revalidatie voor dit dossier.",
        });
      } else {
        toast({
          title: "Revalidatie gestart",
          description: "Je kan de browser sluiten, de verwerking gaat door.",
        });
      }

      return data.jobId;
    } catch (error: unknown) {
      setIsValidating(false);
      setPipelineProgress(null);

      const message = error instanceof Error ? error.message : "Kon revalidatie niet starten.";
      toast({
        title: "Start mislukt",
        description: message,
        variant: "destructive",
      });
      return null;
    }
  }, [toast]);

  // Cancel active revalidation job
  const cancelRevalidationJob = useCallback(async (): Promise<boolean> => {
    if (!activeJobId) return false;

    try {
      const response = await apiRequest("POST", `/api/jobs/${activeJobId}/cancel`);

      if (!response.ok) {
        throw new Error("Failed to cancel job");
      }

      setActiveJobId(null);
      setIsValidating(false);
      setPipelineProgress(null);
      jobCompletedRef.current = true;

      toast({
        title: "Geannuleerd",
        description: "Revalidatie is gestopt.",
      });

      return true;
    } catch {
      toast({
        title: "Annuleren mislukt",
        description: "Kon de job niet annuleren.",
        variant: "destructive",
      });
      return false;
    }
  }, [activeJobId, toast]);

  // Validate new documents - creates a new dossier
  const validate = async (
    clientName: string,
    inputText: string,
    pendingFiles: PendingFile[]
  ): Promise<Box3DossierFull | null> => {
    if (!clientName.trim()) {
      toast({
        title: "Klantnaam vereist",
        description: "Vul een klantnaam in.",
        variant: "destructive",
      });
      return null;
    }

    if (!inputText.trim() && pendingFiles.length === 0) {
      toast({
        title: "Geen input",
        description: "Voer mail tekst in of upload documenten.",
        variant: "destructive",
      });
      return null;
    }

    // ✅ Client-side file size validation
    const oversizedFiles = pendingFiles.filter(pf => pf.file.size > BOX3_CONSTANTS.MAX_FILE_SIZE_BYTES);
    if (oversizedFiles.length > 0) {
      const names = oversizedFiles
        .map(f => `${f.name} (${(f.file.size / 1024 / 1024).toFixed(1)}MB)`)
        .join(', ');
      toast({
        title: "Bestand(en) te groot",
        description: `Maximum grootte is ${BOX3_CONSTANTS.MAX_FILE_SIZE_MB}MB per bestand. Geweigerd: ${names}`,
        variant: "destructive",
      });
      return null;
    }

    setIsValidating(true);

    try {
      const formData = new FormData();
      formData.append("clientName", clientName.trim());
      formData.append("inputText", inputText.trim() || "(geen mail tekst)");

      for (const pf of pendingFiles) {
        formData.append("files", pf.file, pf.name);
      }

      // Timeout for AI processing with multiple images
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), BOX3_CONSTANTS.AI_TIMEOUT_MS);

      let response;
      try {
        response = await fetch("/api/box3-validator/validate", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const result = data.success ? data.data : data;

      // Validate response BEFORE updating state
      if (!result.dossier?.id) {
        throw new Error("Server gaf geen dossier terug");
      }

      // Now safe to update state
      setBlueprint(result.blueprint);
      setCurrentDossierId(result.dossier.id);
      setBlueprintVersion(result.blueprintVersion || 1);
      setTaxYears(result.taxYears || []);

      // Store debug info
      if (result._debug) {
        setDebugInfo(result._debug);
        localStorage.setItem('box3_last_debug_info', JSON.stringify(result._debug));
      }

      toast({
        title: "Validatie voltooid",
        description: `Dossier aangemaakt met ${result.taxYears?.length || 0} belastingjaar(en).`,
      });

      refetchSessions();

      // Return full dossier data for navigation (including documents with classification)
      return {
        dossier: result.dossier,
        blueprint: result.blueprint,
        blueprintVersion: result.blueprintVersion || 1,
        generatedEmail: result.generatedEmail || null,
        documents: result.documents || [],
      };
    } catch (error: unknown) {
      let message = "Kon documenten niet valideren.";
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          message = "Verzoek duurde te lang (timeout na 5 minuten). Probeer met minder bestanden.";
        } else {
          message = error.message;
        }
      }
      toast({
        title: "Validatie mislukt",
        description: message,
        variant: "destructive",
      });
      return null;
    } finally {
      setIsValidating(false);
    }
  };

  // Revalidate existing dossier using SSE for real-time progress
  const revalidate = async (dossierId: string): Promise<Box3Blueprint | null> => {
    if (!dossierId) {
      toast({
        title: "Geen dossier",
        description: "Laad eerst een dossier om opnieuw te valideren.",
        variant: "destructive",
      });
      return null;
    }

    setIsValidating(true);
    setPipelineProgress({ step: 0, totalSteps: 5, message: 'Verbinding maken...', phase: 'connecting' });

    return new Promise((resolve) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        setPipelineProgress(null);
        setIsValidating(false);
        toast({
          title: "Timeout",
          description: "Verzoek duurde te lang (timeout na 5 minuten).",
          variant: "destructive",
        });
        resolve(null);
      }, BOX3_CONSTANTS.AI_TIMEOUT_MS);

      // Use fetch with SSE parsing
      fetch(`/api/box3-validator/dossiers/${dossierId}/revalidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const reader = response.body?.getReader();
          if (!reader) throw new Error('No response body');

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE events from buffer
            // SSE events are separated by double newlines (\n\n)
            let eventEnd = buffer.indexOf('\n\n');
            while (eventEnd !== -1) {
              const eventBlock = buffer.slice(0, eventEnd);
              buffer = buffer.slice(eventEnd + 2);

              // Parse the event block
              let eventType = 'message';
              let eventData = '';

              for (const line of eventBlock.split('\n')) {
                if (line.startsWith('event:')) {
                  eventType = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                  eventData = line.slice(5).trim();
                }
              }

              if (eventData) {
                try {
                  const data = JSON.parse(eventData);

                  if (eventType === 'progress') {
                    setPipelineProgress({
                      step: data.step,
                      totalSteps: data.totalSteps,
                      message: data.message,
                      phase: data.phase,
                    });
                  } else if (eventType === 'result') {
                    clearTimeout(timeoutId);
                    setPipelineProgress(null);
                    setIsValidating(false);

                    // Update state with result
                    setBlueprint(data.blueprint);
                    setBlueprintVersion(data.blueprintVersion || 1);
                    setTaxYears(data.taxYears || []);

                    if (data._debug) {
                      setDebugInfo(data._debug);
                      localStorage.setItem('box3_last_debug_info', JSON.stringify(data._debug));
                    }

                    toast({
                      title: "Opnieuw gevalideerd",
                      description: data.message || `Blueprint v${data.blueprintVersion} aangemaakt.`,
                    });

                    refetchSessions();
                    resolve(data.blueprint);
                    return;
                  } else if (eventType === 'error') {
                    throw new Error(data.message || 'Onbekende fout');
                  }
                } catch (parseError) {
                  // Skip parse errors for incomplete JSON
                  console.warn('[SSE] Parse error:', parseError, 'Data:', eventData);
                }
              }

              eventEnd = buffer.indexOf('\n\n');
            }
          }

          // Stream ended without result
          clearTimeout(timeoutId);
          setPipelineProgress(null);
          setIsValidating(false);
          resolve(null);
        })
        .catch((error: unknown) => {
          clearTimeout(timeoutId);
          setPipelineProgress(null);
          setIsValidating(false);

          let message = "Kon dossier niet opnieuw valideren.";
          if (error instanceof Error) {
            if (error.name === 'AbortError') {
              message = "Verzoek geannuleerd.";
            } else {
              message = error.message;
            }
          }
          toast({
            title: "Hervalidatie mislukt",
            description: message,
            variant: "destructive",
          });
          resolve(null);
        });
    });
  };

  // Reset all validation state
  const handleReset = () => {
    setBlueprint(null);
    setCurrentDossierId(null);
    setBlueprintVersion(0);
    setTaxYears([]);
    setDebugInfo(null);
    setPipelineProgress(null);
    setActiveJobId(null);
    jobCompletedRef.current = false;
  };

  return {
    isValidating,
    blueprint,
    currentDossierId,
    blueprintVersion,
    taxYears,
    debugInfo,
    pipelineProgress,
    activeJobId,
    activeJob,
    validate,
    revalidate,
    startRevalidationJob,
    cancelRevalidationJob,
    setBlueprint,
    setCurrentDossierId,
    handleReset,
    loadFromDossier,
    checkForActiveJob,
  };
}

// Export DebugInfo type for use in components
export type { DebugInfo };
