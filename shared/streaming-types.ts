// Streaming and progress types for real-time workflow updates

export interface ProgressEvent {
  type: 'progress';
  stageId: string;
  substepId?: string;
  percentage: number;
  message: string;
  timestamp: string;
}

export interface StreamingStepEvent {
  type: 'step_start' | 'step_progress' | 'step_complete' | 'step_error';
  stageId: string;
  substepId: string;
  percentage: number;
  message: string;
  data?: any;
  timestamp: string;
}

export interface TokenStreamEvent {
  type: 'token';
  stageId: string;
  token: string;
  accumulated: string;
  timestamp: string;
}

export interface StageCompleteEvent {
  type: 'stage_complete';
  stageId: string;
  substepId?: string;
  percentage?: number;
  result?: string;
  conceptReport?: string;
  prompt?: string;
  message?: string;
  data?: any; // Additional event data (rawFeedback, requiresUserAction, actionType, etc.)
  timestamp: string;
}

export interface StageErrorEvent {
  type: 'stage_error';
  stageId: string;
  error: string;
  canRetry: boolean;
  timestamp: string;
}

export interface CancelEvent {
  type: 'cancelled';
  stageId: string;
  timestamp: string;
}

export type StreamingEvent = 
  | ProgressEvent 
  | StreamingStepEvent 
  | TokenStreamEvent 
  | StageCompleteEvent 
  | StageErrorEvent 
  | CancelEvent;

export interface StageProgress {
  stageId: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
  percentage: number;
  currentSubstep?: string;
  substeps: SubstepProgress[];
  startTime?: string;
  endTime?: string;
  error?: string;
}

export interface SubstepProgress {
  substepId: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
  percentage: number;
  message?: string;
  startTime?: string;
  endTime?: string;
  output?: string;
}

export interface StreamingSession {
  reportId: string;
  stageId: string;
  status: 'active' | 'completed' | 'cancelled' | 'error' | 'awaiting_user_action';
  progress: StageProgress;
  startTime: string;
  endTime?: string;
  checkpoint?: any;
  userActionData?: {
    actionType: string;
    rawFeedback?: string;
    message?: string;
  };
}

// Stage decomposition definitions
export interface StageDefinition {
  stageId: string;
  name: string;
  substeps: SubstepDefinition[];
  supportsStreaming: boolean;
  timeoutMs: number;
}

export interface SubstepDefinition {
  substepId: string;
  name: string;
  estimatedDuration: number; // seconds
  isStreamable: boolean;
  canRetry: boolean;
}

// 4a_BronnenSpecialist decomposition
export const BRONNEN_SPECIALIST_SUBSTEPS: SubstepDefinition[] = [
  {
    substepId: 'plan_queries',
    name: 'Query Planning',
    estimatedDuration: 15,
    isStreamable: true,
    canRetry: true
  },
  {
    substepId: 'fetch_sources', 
    name: 'Source Fetching',
    estimatedDuration: 30,
    isStreamable: false,
    canRetry: true
  },
  {
    substepId: 'validate_sources',
    name: 'Source Validation', 
    estimatedDuration: 45,
    isStreamable: true,
    canRetry: true
  },
  {
    substepId: 'extract_evidence',
    name: 'Evidence Extraction',
    estimatedDuration: 60,
    isStreamable: true, 
    canRetry: true
  },
  {
    substepId: 'synthesize_review',
    name: 'Review Synthesis',
    estimatedDuration: 45,
    isStreamable: true,
    canRetry: true
  }
];

// Helper functions
export function createProgressEvent(
  stageId: string, 
  percentage: number, 
  message: string,
  substepId?: string
): ProgressEvent {
  return {
    type: 'progress',
    stageId,
    substepId,
    percentage,
    message,
    timestamp: new Date().toISOString()
  };
}

export function createTokenEvent(
  stageId: string,
  token: string, 
  accumulated: string
): TokenStreamEvent {
  return {
    type: 'token',
    stageId,
    token,
    accumulated,
    timestamp: new Date().toISOString()
  };
}

export function createStepEvent(
  type: StreamingStepEvent['type'],
  stageId: string,
  substepId: string,
  percentage: number,
  message: string,
  data?: any
): StreamingStepEvent {
  return {
    type,
    stageId,
    substepId,
    percentage,
    message,
    data,
    timestamp: new Date().toISOString()
  };
}

export function calculateOverallProgress(substeps: SubstepProgress[]): number {
  if (substeps.length === 0) return 0;
  
  const totalProgress = substeps.reduce((sum, substep) => sum + substep.percentage, 0);
  return Math.round(totalProgress / substeps.length);
}