/**
 * Centralized Query Key Constants
 *
 * All React Query cache keys in one place to prevent:
 * - Cache splits from duplicate keys (e.g., ["report", id] vs ["/api/reports/${id}"])
 * - Typos in query key strings
 * - Inconsistent invalidation patterns
 *
 * Usage:
 *   import { QUERY_KEYS } from '@/lib/queryKeys';
 *   queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports.detail(id) });
 */

export const QUERY_KEYS = {
  // Reports / Cases
  reports: {
    all: () => ['reports'] as const,
    lists: () => [...QUERY_KEYS.reports.all(), 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      filters
        ? ([...QUERY_KEYS.reports.lists(), filters] as const)
        : QUERY_KEYS.reports.lists(),
    details: () => [...QUERY_KEYS.reports.all(), 'detail'] as const,
    detail: (id: string) => [...QUERY_KEYS.reports.details(), id] as const,
  },

  // Cases (alias for reports in list context)
  cases: {
    all: () => ['cases'] as const,
    list: (filters?: { page?: number; search?: string; status?: string }) =>
      filters
        ? ([...QUERY_KEYS.cases.all(), filters] as const)
        : QUERY_KEYS.cases.all(),
    detail: (id: string) => [...QUERY_KEYS.cases.all(), id] as const,
  },

  // Prompt configuration
  // NOTE: These use API paths because the default queryFn uses queryKey.join("/") as URL
  prompts: {
    all: () => ['/api/prompts'] as const,
    active: () => ['/api/prompts/active'] as const,
    detail: (id: string) => ['/api/prompts', id] as const,
  },

  // Follow-up sessions
  followUp: {
    all: () => ['follow-up'] as const,
    sessions: () => [...QUERY_KEYS.followUp.all(), 'sessions'] as const,
    session: (id: string) => [...QUERY_KEYS.followUp.sessions(), id] as const,
  },

  // External reports
  externalReports: {
    all: () => ['external-reports'] as const,
    list: () => [...QUERY_KEYS.externalReports.all(), 'list'] as const,
    detail: (id: string) => [...QUERY_KEYS.externalReports.all(), id] as const,
  },

  // Box3 validator sessions
  box3: {
    all: () => ['box3'] as const,
    sessions: () => [...QUERY_KEYS.box3.all(), 'sessions'] as const,
    session: (id: string) => [...QUERY_KEYS.box3.sessions(), id] as const,
  },

  // Attachments
  attachments: {
    all: () => ['attachments'] as const,
    forReport: (reportId: string) => [...QUERY_KEYS.attachments.all(), reportId] as const,
  },

  // AI status
  ai: {
    status: () => ['ai-status'] as const,
  },
} as const;

// Type helper for query keys
export type QueryKeys = typeof QUERY_KEYS;
