/**
 * Case Detail Utility Functions
 *
 * Pure utility functions for case detail page.
 * Extracted from case-detail.tsx lines 261-294.
 */

import { WORKFLOW_STAGES } from "@/components/workflow/constants";
import type { ReportStatus, StatusColorClass } from "@/types/caseDetail.types";

/**
 * Get status color class for a report status
 */
export function getStatusColor(status: string): StatusColorClass {
  const colorMap: Record<ReportStatus, StatusColorClass> = {
    draft: "bg-gray-100 text-gray-800",
    processing: "bg-blue-100 text-blue-800",
    generated: "bg-green-100 text-green-800",
    exported: "bg-purple-100 text-purple-800",
    archived: "bg-yellow-100 text-yellow-800",
  };
  return colorMap[status as ReportStatus] || "bg-gray-100 text-gray-800";
}

/**
 * Get human-readable status label
 */
export function getStatusLabel(
  status: string,
  stageResults?: Record<string, unknown>
): string {
  switch (status) {
    case "draft":
      return "Concept";
    case "processing":
      return "In Behandeling";
    case "generated": {
      if (stageResults) {
        const completedStages = Object.keys(stageResults).length;
        const totalStages = WORKFLOW_STAGES.length;
        const percentage = Math.round((completedStages / totalStages) * 100);

        if (completedStages >= 3) {
          return `Stap ${completedStages}/${totalStages} (${percentage}%)`;
        }
        return `Wordt gegenereerd... ${completedStages}/${totalStages}`;
      }
      return "Gegenereerd";
    }
    case "exported":
      return "Geëxporteerd";
    case "archived":
      return "Gearchiveerd";
    default:
      return status;
  }
}

/**
 * Check if workflow should be editable based on status
 */
export function isWorkflowEditable(status: string): boolean {
  return status !== "exported" && status !== "archived";
}

/**
 * Format date for display in Dutch locale
 */
export function formatDateNL(date: string | Date | null | undefined): string {
  if (!date) return "Onbekend";
  return new Date(date).toLocaleDateString("nl-NL");
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: string | number): string {
  const numBytes = typeof bytes === "string" ? parseInt(bytes) : bytes;
  return `${Math.round(numBytes / 1024)} KB`;
}
