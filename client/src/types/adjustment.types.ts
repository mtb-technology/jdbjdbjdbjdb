/**
 * Adjustment Types - Centralized type definitions
 *
 * Used by:
 * - useReportAdjustment hook (Rapport Aanpassen dialog)
 * - useExternalReportSession hook (External Report tab)
 * - ReportAdjustmentDialog component
 * - ExternalReportTab component
 */

import type { AdjustmentItem } from "@shared/types/api";

/**
 * Status of an individual adjustment during review
 */
export type AdjustmentStatus = "pending" | "accepted" | "modified" | "rejected";

/**
 * An adjustment item with review status
 */
export interface ReviewableAdjustment extends AdjustmentItem {
  status: AdjustmentStatus;
  modifiedNieuw?: string; // User-modified value for "nieuw"
}

/**
 * Debug information returned from AI adjustment endpoints
 */
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
