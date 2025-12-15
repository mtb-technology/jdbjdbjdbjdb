/**
 * useVersionManagement Hook
 *
 * Handles version restore and delete operations for case reports.
 * Extracted from case-detail.tsx lines 296-394.
 */

import { useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { useToast } from "@/hooks/use-toast";
import { STAGE_NAMES, getLatestConceptText } from "@shared/constants";
import type { VersionCheckpoint } from "@/types/caseDetail.types";
import type { Report } from "@shared/schema";

interface ConceptReportVersions {
  latest?: {
    pointer?: string;
    v?: number;
  };
  history?: Array<{
    stageId: string;
    v: number;
    timestamp?: string;
  }>;
  [key: string]: unknown;
}

interface UseVersionManagementProps {
  reportId: string | undefined;
  report: Report | undefined;
}

interface UseVersionManagementReturn {
  versionCheckpoints: VersionCheckpoint[];
  currentVersion: number;
  currentContent: string;
  latestChanges: number;
  handleVersionRestore: (version: number) => Promise<void>;
  handleVersionDelete: (stageKey: string) => Promise<void>;
}

/**
 * Build version checkpoints from history array (preferred)
 */
function buildCheckpointsFromHistory(
  history: NonNullable<ConceptReportVersions["history"]>,
  latest: ConceptReportVersions["latest"]
): VersionCheckpoint[] {
  const latestPointer = latest?.pointer;
  const latestVersion = latest?.v;

  // Filter out stage 7 entries (Fiscale Briefing is not a concept version)
  return history.filter((entry) => !entry.stageId.startsWith("7")).map((entry) => {
    const isLatest =
      entry.stageId === latestPointer && entry.v === latestVersion;
    return {
      version: entry.v,
      stageKey: entry.stageId,
      stageName: `${STAGE_NAMES[entry.stageId] || entry.stageId} v${entry.v}`,
      changeCount: undefined,
      timestamp: entry.timestamp,
      isCurrent: isLatest,
    };
  });
}

/**
 * Build version checkpoints from stage keys (fallback/legacy)
 */
function buildCheckpointsFromStageKeys(
  versions: ConceptReportVersions
): VersionCheckpoint[] {
  return Object.keys(versions)
    .filter((key) => key !== "latest" && key !== "history" && !key.startsWith("7"))
    .map((stageKey) => {
      const versionData = versions[stageKey] as {
        v?: number;
        changeCount?: number;
        createdAt?: string;
        timestamp?: string;
      };
      const v = versionData?.v || 1;
      return {
        version: v,
        stageKey,
        stageName: `${STAGE_NAMES[stageKey] || stageKey} v${v}`,
        changeCount: versionData?.changeCount,
        timestamp: versionData?.createdAt || versionData?.timestamp,
        isCurrent: versions.latest?.pointer === stageKey,
      };
    })
    .sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        return (
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      }
      return a.version - b.version;
    });
}

export function useVersionManagement({
  reportId,
  report,
}: UseVersionManagementProps): UseVersionManagementReturn {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const versionCheckpoints = useMemo(() => {
    if (!report?.conceptReportVersions) return [];

    const versions = report.conceptReportVersions as ConceptReportVersions;
    const history = versions?.history || [];

    if (history.length > 0) {
      return buildCheckpointsFromHistory(history, versions.latest);
    }

    return buildCheckpointsFromStageKeys(versions);
  }, [report?.conceptReportVersions]);

  const currentVersion = useMemo(() => {
    const versions = report?.conceptReportVersions as ConceptReportVersions;
    if (!versions?.latest) return versionCheckpoints.length;
    // Use latest.v directly instead of searching, since there can be multiple
    // entries with the same stageKey but different versions
    return versions.latest.v || versionCheckpoints.length;
  }, [report?.conceptReportVersions, versionCheckpoints]);

  const currentContent = useMemo(() => {
    return getLatestConceptText(
      report?.conceptReportVersions as Record<string, unknown>
    );
  }, [report?.conceptReportVersions]);

  const latestChanges = useMemo(() => {
    if (!versionCheckpoints.length) return 0;
    const latestCheckpoint = versionCheckpoints[versionCheckpoints.length - 1];
    return latestCheckpoint.changeCount || 0;
  }, [versionCheckpoints]);

  const handleVersionRestore = useCallback(
    async (version: number) => {
      if (!reportId) return;

      const checkpoint = versionCheckpoints.find((v) => v.version === version);
      if (!checkpoint) return;

      try {
        const response = await apiRequest(
          "POST",
          `/api/reports/${reportId}/restore-version`,
          { stageKey: checkpoint.stageKey }
        );

        if (!response.ok) {
          throw new Error("Failed to restore version");
        }

        const result = await response.json();
        const data = result.success ? result.data : result;

        toast({
          title: "Versie Hersteld",
          description: `Versie ${version} (${checkpoint.stageName}) is nu de actieve versie`,
          duration: 3000,
        });

        if (data.report) {
          queryClient.setQueryData(
            QUERY_KEYS.reports.detail(reportId),
            data.report
          );
        }

        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.cases.all(),
          exact: false,
        });
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.reports.detail(reportId),
        });
      } catch (error: unknown) {
        console.error("Failed to restore version:", error);
        toast({
          title: "Fout bij herstellen",
          description: "Er ging iets mis bij het herstellen van de versie",
          variant: "destructive",
          duration: 5000,
        });
      }
    },
    [reportId, versionCheckpoints, toast, queryClient]
  );

  const handleVersionDelete = useCallback(
    async (stageKey: string) => {
      if (!reportId) return;

      try {
        const response = await apiRequest(
          "DELETE",
          `/api/reports/${reportId}/stage/${stageKey}`
        );

        if (!response.ok) {
          throw new Error("Failed to delete stage");
        }

        const result = await response.json();
        const data = result.success ? result.data : result;
        const cascadeDeleted = data.cascadeDeleted || [];

        const newLatest = data.report?.conceptReportVersions?.latest;
        const newActiveStage = newLatest?.pointer || "vorige versie";

        const cascadeMessage =
          cascadeDeleted.length > 0
            ? ` en ${cascadeDeleted.length} volgende stage${cascadeDeleted.length > 1 ? "s" : ""}`
            : "";

        toast({
          title: "Versie Verwijderd",
          description: `${stageKey}${cascadeMessage} verwijderd. Actieve versie: ${newActiveStage}`,
          duration: 4000,
        });

        if (data.report) {
          queryClient.setQueryData(
            QUERY_KEYS.reports.detail(reportId),
            data.report
          );
        }

        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.cases.all(),
          exact: false,
        });
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.reports.detail(reportId),
        });
      } catch (error: unknown) {
        console.error("Failed to delete version:", error);
        toast({
          title: "Fout bij verwijderen",
          description: "Er ging iets mis bij het verwijderen van de versie",
          variant: "destructive",
          duration: 5000,
        });
      }
    },
    [reportId, toast, queryClient]
  );

  return {
    versionCheckpoints,
    currentVersion,
    currentContent,
    latestChanges,
    handleVersionRestore,
    handleVersionDelete,
  };
}
