import { useMutation, useQuery, useQueryClient, QueryKey, MutationFunction, QueryFunction } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import type { ApiSuccessResponse } from "@shared/errors";

// Unified API configuration for consistent cache management
export const API_KEYS = {
  cases: (filters?: Record<string, any>) => ["cases", filters].filter(Boolean),
  case: (id: string) => ["cases", id],
  reports: (filters?: Record<string, any>) => ["reports", filters].filter(Boolean),
  report: (id: string) => ["reports", id],
  settings: () => ["settings"],
  prompts: () => ["prompts"],
  activePrompt: () => ["prompts", "active"],
} as const;

// Enhanced API hook for queries with automatic cache invalidation
export function useApiQuery<TData = unknown>(
  key: QueryKey,
  url: string,
  options: {
    enabled?: boolean;
    staleTime?: number;
    refetchInterval?: number;
    onError?: (error: Error) => void;
  } = {}
) {
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const response = await apiRequest("GET", url);
      const data = await response.json();
      
      if (data && typeof data === 'object' && 'success' in data && data.success === true) {
        return (data as ApiSuccessResponse<TData>).data;
      }
      return data as TData;
    },
    staleTime: options.staleTime ?? 5 * 60 * 1000, // 5 minutes default
    refetchInterval: options.refetchInterval,
    enabled: options.enabled ?? true,
  });
}

// Enhanced API hook for mutations with intelligent cache invalidation
export function useApiMutation<TData = unknown, TVariables = unknown>(
  mutationFn: MutationFunction<TData, TVariables>,
  options: {
    onSuccess?: (data: TData, variables: TVariables) => void;
    onError?: (error: Error, variables: TVariables) => void;
    invalidateKeys?: QueryKey[];
    optimisticUpdate?: {
      queryKey: QueryKey;
      updateFn: (oldData: any, variables: TVariables) => any;
    };
  } = {}
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      // Optimistic update if configured
      if (options.optimisticUpdate) {
        await queryClient.cancelQueries({ queryKey: options.optimisticUpdate.queryKey });
        const previousData = queryClient.getQueryData(options.optimisticUpdate.queryKey);
        
        queryClient.setQueryData(
          options.optimisticUpdate.queryKey, 
          (old: any) => options.optimisticUpdate!.updateFn(old, variables)
        );
        
        return { previousData };
      }
    },
    onSuccess: (data, variables, context) => {
      // Invalidate specified cache keys
      if (options.invalidateKeys) {
        options.invalidateKeys.forEach(key => {
          queryClient.invalidateQueries({ queryKey: key });
        });
      }
      
      options.onSuccess?.(data, variables);
    },
    onError: (error, variables, context) => {
      // Rollback optimistic update on error
      if (options.optimisticUpdate && context?.previousData) {
        queryClient.setQueryData(options.optimisticUpdate.queryKey, context.previousData);
      }
      
      options.onError?.(error, variables);
    },
  });
}

// Specialized hooks for common operations
export function useCases(filters?: { page?: number; search?: string; status?: string }) {
  const params = new URLSearchParams();
  if (filters?.page) params.set("page", filters.page.toString());
  if (filters?.search) params.set("search", filters.search);
  if (filters?.status && filters.status !== "all") params.set("status", filters.status);
  params.set("limit", "10");
  
  return useApiQuery(
    API_KEYS.cases(filters),
    `/api/cases?${params.toString()}`,
    { staleTime: 30 * 1000 } // 30 seconds for list data
  );
}

export function useCase(id: string, enabled: boolean = true) {
  return useApiQuery(
    API_KEYS.case(id),
    `/api/cases/${id}`,
    { enabled: enabled && !!id }
  );
}

export function useUpdateCaseStatus() {
  return useApiMutation(
    async ({ id, status }: { id: string; status: string }) => {
      const response = await apiRequest("PATCH", `/api/cases/${id}/status`, { status });
      return response.json();
    },
    {
      invalidateKeys: [API_KEYS.cases()],
      optimisticUpdate: {
        queryKey: API_KEYS.cases(),
        updateFn: (oldData: any, variables) => {
          if (!oldData?.reports) return oldData;
          return {
            ...oldData,
            reports: oldData.reports.map((case_: any) => 
              case_.id === variables.id ? { ...case_, status: variables.status } : case_
            )
          };
        }
      }
    }
  );
}

export function useDeleteCase() {
  return useApiMutation(
    async (id: string) => {
      const response = await apiRequest("DELETE", `/api/cases/${id}`);
      return response.json();
    },
    {
      invalidateKeys: [API_KEYS.cases()],
      optimisticUpdate: {
        queryKey: API_KEYS.cases(),
        updateFn: (oldData: any, deletedId: string) => {
          if (!oldData?.reports) return oldData;
          const filteredReports = oldData.reports.filter((case_: any) => case_.id !== deletedId);
          return {
            ...oldData,
            reports: filteredReports,
            total: oldData.total - 1,
            totalPages: Math.ceil((oldData.total - 1) / 10)
          };
        }
      }
    }
  );
}

// Real-time updates helper
export function useRealTimeUpdates(reportId?: string) {
  const queryClient = useQueryClient();
  
  return {
    updateStageResult: (stage: string, result: string) => {
      if (!reportId) return;
      
      queryClient.setQueryData(API_KEYS.case(reportId), (oldData: any) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          stageResults: {
            ...(oldData.stageResults || {}),
            [stage]: result
          }
        };
      });
    },
    
    updateProgress: (progress: number) => {
      if (!reportId) return;
      
      queryClient.setQueryData(API_KEYS.case(reportId), (oldData: any) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          progress
        };
      });
    }
  };
}