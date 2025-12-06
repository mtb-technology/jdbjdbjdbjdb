/**
 * Type definitions for the living document system
 */

export type ChangeType = 'insert' | 'delete' | 'replace' | 'comment';

export type ChangeStatus = 'pending' | 'accepted' | 'rejected' | 'applied';

export interface DocumentChange {
  id: string;
  type: ChangeType;
  position: number; // Character position in document
  oldText?: string; // For replace/delete operations
  newText?: string; // For replace/insert operations
  comment: string; // Reasoning/explanation for the change
  specialist: string; // Which specialist proposed this (e.g., "4a_bronnen")
  createdAt: string;
  status: ChangeStatus;
  appliedAt?: string;
}

export interface SpecialistChanges {
  specialist: string;
  stageId: string;
  changes: DocumentChange[];
  status: 'pending' | 'reviewing' | 'applied' | 'rejected';
  reviewedAt?: string;
}

export interface PendingChanges {
  [specialistId: string]: SpecialistChanges;
}

export interface DocumentSnapshot {
  stageId: string;
  content: any; // TipTap JSON content
  timestamp: string;
  appliedChanges: string[]; // IDs of changes applied in this version
  specialist?: string; // Which specialist created this snapshot
}

export interface DocumentSnapshots {
  [stageId: string]: DocumentSnapshot;
}

// TipTap document structure (simplified)
export interface TipTapContent {
  type: 'doc';
  content: TipTapNode[];
}

export interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  attrs?: Record<string, any>;
  marks?: Array<{
    type: string;
    attrs?: Record<string, any>;
  }>;
}

// API types for change management
export interface CreateChangeProposalRequest {
  reportId: string;
  specialistId: string;
  changes: Omit<DocumentChange, 'id' | 'createdAt' | 'status'>[];
}

export interface ReviewChangeRequest {
  reportId: string;
  changeId: string;
  action: 'accept' | 'reject';
  comment?: string;
}

export interface ApplyChangesRequest {
  reportId: string;
  changeIds: string[];
}

// Helper type for change proposals in specialist output
export interface SpecialistChangeProposal {
  changes: Array<{
    type: ChangeType;
    position: number;
    oldText?: string;
    newText?: string;
    reasoning: string;
  }>;
  summary: string;
  totalChanges: number;
}

/**
 * Type-safe update payload for document-related fields.
 * Use this instead of `as any` casts in document routes.
 */
export interface DocumentFieldsUpdate {
  pendingChanges?: PendingChanges;
  documentSnapshots?: DocumentSnapshots;
  documentState?: TipTapContent;
  updatedAt?: Date;
}
