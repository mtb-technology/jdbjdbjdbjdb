/**
 * Mutation Helpers
 *
 * Centralized utilities for handling React Query mutation callbacks.
 * Reduces duplication in mutation success/error handlers.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { ToastFunction } from '@/hooks/use-toast';

export interface StageCompletionData {
  stage: string;
  stageResult?: string;
  stageOutput?: string;
  conceptReport?: string;
  report?: any;
  prompt?: string;
}

export interface StageCompletionCallbacks {
  dispatch: (action: any) => void;
  queryClient: QueryClient;
  toast: any;
  currentReport?: { id: string } | null;
  stageStartTime?: Date | null;
}

/**
 * Handles the common logic when a stage completes successfully.
 *
 * @param data - The response data from the stage execution
 * @param variables - The variables passed to the mutation
 * @param callbacks - Required callbacks and state
 */
export function handleStageCompletion(
  data: StageCompletionData,
  variables: { stage: string; reportId?: string },
  callbacks: StageCompletionCallbacks
): void {
  const { dispatch, queryClient, toast, currentReport, stageStartTime } = callbacks;

  // Extract data from response (handles both old and new formats)
  const stageResult = data.stageResult || data.stageOutput || "";
  const conceptReport = data.conceptReport;
  const updatedReport = data.report;
  const prompt = data.prompt || "";

  console.log("✅ Stage Completion:", {
    stage: variables.stage,
    hasResult: !!stageResult,
    hasConceptReport: !!conceptReport,
    hasReport: !!updatedReport,
    hasPrompt: !!prompt
  });

  // Store the prompt that was sent to AI
  if (prompt) {
    dispatch({ type: "SET_STAGE_PROMPT", stage: variables.stage, prompt });
  }

  // Update report if provided
  if (updatedReport) {
    dispatch({ type: "SET_REPORT", payload: updatedReport });
    dispatch({ type: "LOAD_EXISTING_REPORT", report: updatedReport });
  }

  // Save the time this stage took
  if (stageStartTime) {
    const elapsed = Math.floor((Date.now() - stageStartTime.getTime()) / 1000);
    dispatch({ type: "SET_STAGE_TIME", stage: variables.stage, time: elapsed });
  }

  // Mark stage as no longer processing
  dispatch({ type: "SET_STAGE_PROCESSING", stage: variables.stage, isProcessing: false });

  // Update the result for the executed stage
  if (stageResult) {
    dispatch({ type: "SET_STAGE_RESULT", stage: variables.stage, result: stageResult });
  }

  // Update concept report versions if provided
  if (conceptReport) {
    dispatch({ type: "SET_CONCEPT_VERSION", stage: variables.stage, content: conceptReport });
  }

  // Invalidate queries to refresh UI
  queryClient.invalidateQueries({ queryKey: ['/api/reports'] });
  if (currentReport?.id) {
    queryClient.invalidateQueries({ queryKey: ['/api/reports', currentReport.id] });
  }

  // Show completion toast
  toast({
    title: "Stap voltooid",
    description: `${variables.stage} is succesvol uitgevoerd.`,
  });
}

/**
 * Handles the common logic when a substep completes successfully.
 *
 * @param data - The response data from the substep execution
 * @param variables - The variables passed to the mutation
 * @param callbacks - Required callbacks and state
 */
export function handleSubstepCompletion(
  data: any,
  variables: { reportId: string; stageId: string; substepId: string },
  callbacks: StageCompletionCallbacks
): void {
  const { dispatch, queryClient, toast, currentReport, stageStartTime } = callbacks;

  const { stageId, substepId } = variables;
  const result = data.result || data.output || "";

  console.log("✅ Substep Completion:", {
    stageId,
    substepId,
    hasResult: !!result
  });

  // Save the time this substep took
  if (stageStartTime) {
    const elapsed = Math.floor((Date.now() - stageStartTime.getTime()) / 1000);
    dispatch({
      type: "SET_SUBSTEP_TIME",
      stageId,
      substepId,
      time: elapsed
    });
  }

  // Mark substep as no longer processing
  dispatch({
    type: "SET_SUBSTEP_PROCESSING",
    stageId,
    substepId,
    isProcessing: false
  });

  // Update the result
  if (result) {
    dispatch({
      type: "SET_SUBSTEP_RESULT",
      stageId,
      substepId,
      result
    });
  }

  // Invalidate queries
  queryClient.invalidateQueries({ queryKey: ['/api/reports'] });
  if (currentReport?.id) {
    queryClient.invalidateQueries({ queryKey: ['/api/reports', currentReport.id] });
  }

  // Show completion toast
  toast({
    title: "Substap voltooid",
    description: `${substepId} is succesvol uitgevoerd.`,
  });
}

/**
 * Handles mutation errors consistently.
 *
 * @param error - The error that occurred
 * @param context - Context about what was being executed
 * @param callbacks - Required callbacks
 */
export function handleMutationError(
  error: Error,
  context: { stage?: string; stageId?: string; substepId?: string },
  callbacks: { dispatch: (action: any) => void; toast: any }
): void {
  const { dispatch, toast } = callbacks;

  // Mark as no longer processing
  if (context.stage) {
    dispatch({ type: "SET_STAGE_PROCESSING", stage: context.stage, isProcessing: false });
  }

  if (context.stageId && context.substepId) {
    dispatch({
      type: "SET_SUBSTEP_PROCESSING",
      stageId: context.stageId,
      substepId: context.substepId,
      isProcessing: false
    });
  }

  // Check for NO_PROMPT_CONFIGURED error
  if (error.message.includes("NO_PROMPT_CONFIGURED")) {
    const [, userMessage] = error.message.split("|");
    toast({
      title: "Prompt Configuratie Vereist",
      description: `${userMessage || error.message} Ga naar Instellingen om prompts te configureren.`,
      variant: "destructive",
    });
  } else {
    // Show standard error toast
    const description = error.message || "Er is een onbekende fout opgetreden";
    toast({
      title: "Fout",
      description,
      variant: "destructive",
    });
  }

  console.error("❌ Mutation Error:", { context, error });
}

/**
 * Marks a stage as started (processing).
 *
 * @param stage - The stage being started
 * @param callbacks - Required callbacks
 */
export function handleStageStart(
  stage: string,
  callbacks: { dispatch: (action: any) => void }
): void {
  const { dispatch } = callbacks;

  dispatch({ type: "SET_STAGE_PROCESSING", stage, isProcessing: true });
  dispatch({ type: "SET_STAGE_START_TIME", time: new Date() });
  dispatch({ type: "UPDATE_TIMER", time: 0 });
}

/**
 * Marks a substep as started (processing).
 *
 * @param stageId - The stage ID
 * @param substepId - The substep ID
 * @param callbacks - Required callbacks
 */
export function handleSubstepStart(
  stageId: string,
  substepId: string,
  callbacks: { dispatch: (action: any) => void }
): void {
  const { dispatch } = callbacks;

  dispatch({
    type: "SET_SUBSTEP_PROCESSING",
    stageId,
    substepId,
    isProcessing: true
  });
  dispatch({ type: "SET_STAGE_START_TIME", time: new Date() });
  dispatch({ type: "UPDATE_TIMER", time: 0 });
}
