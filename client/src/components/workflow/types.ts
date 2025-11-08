/**
 * Workflow Component Types
 *
 * Centralized TypeScript type definitions for workflow components.
 * Provides type safety for props, mutations, and state management.
 */

import type { UseMutationResult } from "@tanstack/react-query";
import type { WorkflowState, WorkflowAction } from "./WorkflowContext";

/**
 * Response data structure for stage execution mutations.
 */
export interface StageExecutionResponse {
  report: any;
  stageResult?: string;
  stageOutput?: string;
  conceptReport?: string;
  prompt?: string;
}

/**
 * Variables for executing a stage mutation.
 */
export interface ExecuteStageVariables {
  stage: string;
  reportId?: string;
  customInput?: string;
}

/**
 * Variables for executing a substep mutation (review or processing).
 */
export interface ExecuteSubstepVariables {
  substepKey: string;
  substepType: "review" | "processing";
  reportId: string;
  customInput?: string;
}

/**
 * Response data structure for substep execution mutations.
 */
export interface SubstepExecutionResponse {
  type: "review" | "processing";
  data: any;
}

/**
 * Type-safe mutation for executing a workflow stage.
 */
export type ExecuteStageMutation = UseMutationResult<
  StageExecutionResponse,
  Error,
  ExecuteStageVariables,
  unknown
>;

/**
 * Type-safe mutation for executing a workflow substep.
 */
export type ExecuteSubstepMutation = UseMutationResult<
  SubstepExecutionResponse,
  Error,
  ExecuteSubstepVariables,
  unknown
>;

/**
 * Function signature for getting stage status.
 */
export type GetStageStatus = (index: number) => "completed" | "current" | "pending";

/**
 * Props for WorkflowView component.
 */
export interface SimplifiedWorkflowViewProps {
  /** Workflow state from WorkflowContext */
  state: WorkflowState;

  /** Dispatch function for workflow actions */
  dispatch: React.Dispatch<WorkflowAction>;

  /** Mutation for executing a stage */
  executeStageM: ExecuteStageMutation;

  /** Mutation for executing a substep */
  executeSubstepM: ExecuteSubstepMutation;

  /** Whether a new case is being created */
  isCreatingCase: boolean;

  /** Raw text input for the workflow (optional) */
  rawText?: string;

  /** Client name for the report (optional) */
  clientName?: string;

  /** Function to determine stage status based on index */
  getStageStatus: GetStageStatus;
}
