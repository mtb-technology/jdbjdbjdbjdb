/**
 * Box 3 Validator Types
 *
 * Type definitions extracted from box3-validator.tsx
 */

import type { LucideIcon } from "lucide-react";
import type { Box3ValidationResult } from "@shared/schema";

/**
 * Light-weight session for sidebar list
 */
export interface SessionLight {
  id: string;
  clientName: string;
  belastingjaar: string | null;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

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
 * Rendement berekening result
 */
export interface RendementBerekening {
  // Input data (wat we hebben gevonden)
  bankRente: number | null;
  beleggingenBegin: number | null;
  beleggingenEind: number | null;
  beleggingenDividend: number | null;
  beleggingenMutatiesGevonden: boolean;
  schuldenRente: number | null;
  // Fiscale data uit aangifte
  forfaitairRendement: number | null;
  belastbaarInkomen: number | null;
  // Berekende waarden
  werkelijkRendement: number | null;
  verschil: number | null;
  indicatieveTeruggave: number | null;
  // Kansrijkheid
  isKansrijk: boolean | null;
  missendVoorBerekening: string[];
  // Gebruikte parameters
  gebruiktTarief: number;
  gebruiktJaar: string | null;
}

/**
 * Edited concept mail state
 */
export interface EditedConceptMail {
  onderwerp: string;
  body: string;
}

/**
 * Document checklist props
 */
export interface DocumentChecklistProps {
  validationResult: Box3ValidationResult;
  expandedCategories: Set<string>;
  onToggleCategory: (key: string) => void;
}

/**
 * Kansrijkheid analyse props
 */
export interface KansrijkheidAnalyseProps {
  validationResult: Box3ValidationResult;
  belastingjaar: string | undefined;
}

/**
 * Concept mail editor props
 */
export interface ConceptMailEditorProps {
  editedConceptMail: EditedConceptMail | null;
  mailData: { onderwerp?: string; body?: string } | null;
  onEditConceptMail: (mail: EditedConceptMail) => void;
  onCopyMail: () => void;
}

/**
 * Session sidebar props
 */
export interface SessionSidebarProps {
  sessions: SessionLight[] | undefined;
  currentSessionId: string | null;
  onLoadSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string, e: React.MouseEvent) => void;
}

/**
 * Global status type
 */
export type GlobalStatusType =
  | "REJECTED_LOW_VALUE"
  | "REJECTED_SAVINGS_ONLY"
  | "MISSING_IB_CRITICAL"
  | "ACTION_REQUIRED"
  | "READY_FOR_CALCULATION"
  | string;

/**
 * Document status type
 */
export type DocumentStatus = "compleet" | "onvolledig" | "ontbreekt" | "nvt";
