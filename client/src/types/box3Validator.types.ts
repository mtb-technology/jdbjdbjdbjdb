/**
 * Box 3 Validator Types - V2
 *
 * Type definitions for V2 Blueprint-based data model.
 */

import type { LucideIcon } from "lucide-react";

/**
 * Pending file for upload
 */
export interface PendingFile {
  file: File;
  name: string;
  originalSize?: number; // Original size before compression
  compressed?: boolean;  // Whether the file was compressed
}

/**
 * Document category configuration
 */
export interface DocumentCategoryConfig {
  key: string;
  label: string;
  description: string;
  waarom: string;
  icon: LucideIcon;
}

/**
 * Edited concept mail state
 */
export interface EditedConceptMail {
  onderwerp: string;
  body: string;
}

/**
 * Global status type for dossier
 */
export type DossierStatusType =
  | "intake"
  | "in_behandeling"
  | "wacht_op_klant"
  | "afgerond"
  | string;

/**
 * Document classification confidence
 */
export type ConfidenceLevel = "high" | "medium" | "low";
