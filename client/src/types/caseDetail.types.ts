/**
 * Case Detail Type Definitions
 *
 * Type definitions for the case detail page and related components.
 */

import type { Report } from "@shared/schema";

/**
 * Version checkpoint for timeline display
 */
export interface VersionCheckpoint {
  version: number;
  stageKey: string;
  stageName: string;
  changeCount?: number;
  timestamp?: string;
  isCurrent: boolean;
}

/**
 * Attachment data from API
 */
export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  fileSize: string;
  pageCount?: number;
  extractedText?: string;
  needsVisionOCR?: boolean;
  usedInStages?: string[];
}

/**
 * Case metadata update payload
 */
export interface CaseMetadataUpdate {
  title?: string;
  clientName?: string;
}

/**
 * Edit state for inline editing
 */
export interface EditState {
  isEditingTitle: boolean;
  isEditingClient: boolean;
  editedTitle: string;
  editedClient: string;
}

/**
 * Props for CaseHeader component
 */
export interface CaseHeaderProps {
  report: Report;
  isEditingTitle: boolean;
  isEditingClient: boolean;
  editedTitle: string;
  editedClient: string;
  isPending: boolean;
  onEditTitle: () => void;
  onEditClient: () => void;
  onSaveTitle: () => void;
  onSaveClient: () => void;
  onCancelEdit: (type: "title" | "client") => void;
  onTitleChange: (value: string) => void;
  onClientChange: (value: string) => void;
  versionCheckpoints: VersionCheckpoint[];
  currentVersion: number;
}

/**
 * Props for CasePageHeader component (top navigation bar)
 */
export interface CasePageHeaderProps {
  report: Report;
  reportId: string;
}

/**
 * Props for AttachmentsTab component
 */
export interface AttachmentsTabProps {
  attachments: Attachment[] | undefined;
  expandedAttachments: Set<string>;
  onToggleExpand: (id: string) => void;
}

/**
 * Props for TimelineTab component
 */
export interface TimelineTabProps {
  versionCheckpoints: VersionCheckpoint[];
  currentVersion: number;
  onRestore: (version: number) => Promise<void>;
  onDelete: (stageKey: string) => Promise<void>;
}

/**
 * Props for DiffTab component
 */
export interface DiffTabProps {
  conceptReportVersions: Record<string, unknown> | null;
}

/**
 * Props for WorkflowTab component
 */
export interface WorkflowTabProps {
  report: Report;
  autoStart: boolean;
}

/**
 * Status color mapping return type
 */
export type StatusColorClass = string;

/**
 * Report status types
 */
export type ReportStatus = "draft" | "processing" | "generated" | "exported" | "archived";
