/**
 * useJobPolling Hook
 *
 * Polls for job progress and handles job completion.
 * Used for background stage execution that survives browser disconnects.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { useToast } from "@/hooks/use-toast";
import { useCallback, useEffect, useRef } from "react";

// Job progress structure from backend
export interface JobStageProgress {
  stageId: string;
  status: "pending" | "processing" | "completed" | "failed";
  percentage: number;
  changesCount?: number;
  error?: string;
}

export interface JobProgress {
  currentStage: string;
  percentage: number;
  message: string;
  stages: JobStageProgress[];
}

export interface Job {
  id: string;
  type: "single_stage" | "express_mode";
  status: "queued" | "processing" | "completed" | "failed";
  reportId: string;
  progress: JobProgress | null;
  result?: any;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface UseJobPollingOptions {
  jobId: string | null;
  reportId: string;
  onComplete?: (job: Job) => void;
  onError?: (job: Job) => void;
  enabled?: boolean;
  pollInterval?: number;
}

interface UseJobPollingReturn {
  job: Job | null;
  isLoading: boolean;
  isPolling: boolean;
  progress: JobProgress | null;
  stopPolling: () => void;
}

/**
 * Poll for a specific job's progress
 */
export function useJobPolling({
  jobId,
  reportId,
  onComplete,
  onError,
  enabled = true,
  pollInterval = 5000, // Default 5s instead of 3s to reduce network requests
}: UseJobPollingOptions): UseJobPollingReturn {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const completedRef = useRef(false);

  // Query for job status
  const {
    data: jobData,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["job", jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const response = await apiRequest("GET", `/api/jobs/${jobId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch job");
      }
      const result = await response.json();
      return (result.success ? result.data : result) as Job;
    },
    enabled: enabled && !!jobId && !completedRef.current,
    refetchInterval: (query) => {
      const job = query.state.data as Job | null;
      // Stop polling when job is done
      if (job?.status === "completed" || job?.status === "failed") {
        return false;
      }
      return pollInterval;
    },
    staleTime: 1000,
  });

  const job = jobData || null;

  // Handle job completion
  useEffect(() => {
    if (!job || completedRef.current) return;

    if (job.status === "completed") {
      completedRef.current = true;

      // Invalidate report queries to refresh data
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports.detail(reportId) });

      toast({
        title: job.type === "express_mode" ? "Express Mode voltooid" : "Stage voltooid",
        description: job.progress?.message || "De verwerking is succesvol afgerond",
      });

      onComplete?.(job);
    }

    if (job.status === "failed") {
      completedRef.current = true;

      toast({
        title: "Verwerking mislukt",
        description: job.error || "Er is een fout opgetreden",
        variant: "destructive",
      });

      onError?.(job);
    }
  }, [job, reportId, queryClient, toast, onComplete, onError]);

  // Reset completed ref when jobId changes
  useEffect(() => {
    completedRef.current = false;
  }, [jobId]);

  const stopPolling = useCallback(() => {
    completedRef.current = true;
  }, []);

  return {
    job,
    isLoading,
    isPolling: isFetching && !completedRef.current,
    progress: job?.progress || null,
    stopPolling,
  };
}

/**
 * Check for active jobs for a report
 */
export function useActiveJobs(reportId: string | null) {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["activeJobs", reportId],
    queryFn: async () => {
      if (!reportId) return { hasActiveJobs: false, jobs: [] };
      const response = await apiRequest("GET", `/api/reports/${reportId}/jobs/active`);
      if (!response.ok) {
        throw new Error("Failed to fetch active jobs");
      }
      const result = await response.json();
      return (result.success ? result.data : result) as {
        hasActiveJobs: boolean;
        jobs: Job[];
      };
    },
    enabled: !!reportId,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Poll more frequently when there are active jobs (5s), otherwise very slowly (60s)
      return data?.hasActiveJobs ? 5000 : 60000;
    },
    // High staleTime to prevent re-fetching when multiple components use this hook
    staleTime: 4000,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["activeJobs", reportId] });
  }, [queryClient, reportId]);

  return {
    hasActiveJobs: data?.hasActiveJobs || false,
    activeJobs: data?.jobs || [],
    isLoading,
    refetch,
    invalidate,
  };
}

/**
 * Get all active jobs across all reports
 * Used by cases list to show which cases have active background jobs
 */
export function useAllActiveJobs() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["allActiveJobs"],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/jobs/active`);
      if (!response.ok) {
        throw new Error("Failed to fetch active jobs");
      }
      const result = await response.json();
      return (result.success ? result.data : result) as {
        totalActiveJobs: number;
        reportIds: string[];
        byReport: Record<string, { reportId: string; count: number; types: string[] }>;
      };
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      // Poll more frequently when there are active jobs (10s), otherwise slowly (60s)
      return data?.totalActiveJobs ? 10000 : 60000;
    },
    staleTime: 5000,
  });

  return {
    totalActiveJobs: data?.totalActiveJobs || 0,
    reportIds: data?.reportIds || [],
    byReport: data?.byReport || {},
    isLoading,
    refetch,
    hasActiveJobForReport: (reportId: string) => data?.reportIds?.includes(reportId) || false,
  };
}

/**
 * Cancel a running job
 */
export function useCancelJob() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const cancelJob = useCallback(
    async (jobId: string, reportId?: string): Promise<boolean> => {
      try {
        const response = await apiRequest("POST", `/api/jobs/${jobId}/cancel`);

        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error?.message || "Failed to cancel job");
        }

        toast({
          title: "Job geannuleerd",
          description: "De verwerking is gestopt",
        });

        // Invalidate queries to refresh UI
        queryClient.invalidateQueries({ queryKey: ["job", jobId] });
        if (reportId) {
          queryClient.invalidateQueries({ queryKey: ["activeJobs", reportId] });
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports.detail(reportId) });
        }
        queryClient.invalidateQueries({ queryKey: ["allActiveJobs"] });

        return true;
      } catch (error: any) {
        console.error("Failed to cancel job:", error);
        toast({
          title: "Annuleren mislukt",
          description: error.message || "De job kon niet worden geannuleerd",
          variant: "destructive",
        });
        return false;
      }
    },
    [toast, queryClient]
  );

  return { cancelJob };
}

/**
 * Create and start tracking a new job
 */
export function useCreateJob() {
  const { toast } = useToast();

  const createStageJob = useCallback(
    async (reportId: string, stageId: string, customInput?: string): Promise<string | null> => {
      try {
        const response = await apiRequest("POST", `/api/reports/${reportId}/jobs/stage`, {
          stageId,
          customInput,
        });

        if (!response.ok) {
          throw new Error("Failed to create job");
        }

        const result = await response.json();
        const data = result.success ? result.data : result;

        toast({
          title: "Stage gestart",
          description: `${stageId} wordt op de achtergrond uitgevoerd`,
        });

        return data.jobId;
      } catch (error) {
        console.error("Failed to create stage job:", error);
        toast({
          title: "Fout bij starten",
          description: "De stage kon niet worden gestart",
          variant: "destructive",
        });
        return null;
      }
    },
    [toast]
  );

  const createExpressModeJob = useCallback(
    async (
      reportId: string,
      options: {
        includeGeneration?: boolean;
        autoAccept?: boolean;
        stages?: string[];
      } = {}
    ): Promise<string | null> => {
      try {
        const response = await apiRequest("POST", `/api/reports/${reportId}/jobs/express-mode`, {
          includeGeneration: options.includeGeneration ?? false,
          autoAccept: options.autoAccept ?? true,
          stages: options.stages,
        });

        if (!response.ok) {
          throw new Error("Failed to create express mode job");
        }

        const result = await response.json();
        const data = result.success ? result.data : result;

        toast({
          title: "Express Mode gestart",
          description: "Alle stages worden op de achtergrond uitgevoerd",
        });

        return data.jobId;
      } catch (error) {
        console.error("Failed to create express mode job:", error);
        toast({
          title: "Fout bij starten",
          description: "Express Mode kon niet worden gestart",
          variant: "destructive",
        });
        return null;
      }
    },
    [toast]
  );

  return {
    createStageJob,
    createExpressModeJob,
  };
}
