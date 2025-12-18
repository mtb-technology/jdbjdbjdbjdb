import type {
  StreamingSession,
  StreamingEvent,
  StageProgress,
  SubstepProgress,
  SubstepDefinition
} from "@shared/streaming-types";
import { EventEmitter } from "events";
import { logger } from "../logger";

export class StreamingSessionManager {
  private sessions: Map<string, StreamingSession> = new Map();
  private eventEmitter = new EventEmitter();
  private static instance: StreamingSessionManager;

  static getInstance(): StreamingSessionManager {
    if (!StreamingSessionManager.instance) {
      StreamingSessionManager.instance = new StreamingSessionManager();
    }
    return StreamingSessionManager.instance;
  }

  // Create new streaming session
  createSession(
    reportId: string, 
    stageId: string, 
    substeps: SubstepDefinition[]
  ): StreamingSession {
    const sessionId = `${reportId}-${stageId}`;
    
    // Initialize substep progress
    const substepProgress: SubstepProgress[] = substeps.map(substep => ({
      substepId: substep.substepId,
      name: substep.name,
      status: 'pending',
      percentage: 0
    }));

    const session: StreamingSession = {
      reportId,
      stageId,
      status: 'active',
      startTime: new Date().toISOString(),
      progress: {
        stageId,
        status: 'running',
        percentage: 0,
        substeps: substepProgress
      }
    };

    this.sessions.set(sessionId, session);
    logger.info(sessionId, `Streaming session created with ${substeps.length} substeps`);
    
    return session;
  }

  // Get session
  getSession(reportId: string, stageId: string): StreamingSession | undefined {
    const sessionId = `${reportId}-${stageId}`;
    return this.sessions.get(sessionId);
  }

  // Update substep progress
  updateSubstepProgress(
    reportId: string,
    stageId: string,
    substepId: string,
    percentage: number,
    message?: string,
    output?: string
  ): void {
    const session = this.getSession(reportId, stageId);
    if (!session) return;

    const substep = session.progress.substeps.find(s => s.substepId === substepId);
    if (!substep) return;

    substep.percentage = percentage;
    substep.status = percentage === 100 ? 'completed' : 'running';
    if (message) substep.message = message;
    if (output) substep.output = output;
    if (!substep.startTime && percentage > 0) {
      substep.startTime = new Date().toISOString();
    }
    if (percentage === 100) {
      substep.endTime = new Date().toISOString();
    }

    // Update overall progress
    const completedSubsteps = session.progress.substeps.filter(s => s.status === 'completed').length;
    const totalSubsteps = session.progress.substeps.length;
    session.progress.percentage = Math.round((completedSubsteps / totalSubsteps) * 100);
    session.progress.currentSubstep = substepId;

    this.emitEvent(reportId, stageId, {
      type: 'step_progress',
      stageId,
      substepId,
      percentage,
      message: message || `${substep.name} - ${percentage}%`,
      timestamp: new Date().toISOString()
    });

    logger.debug(`${reportId}-${stageId}`, `Substep ${substepId}: ${percentage}% - ${message || 'Progress update'}`);
  }

  // Mark substep as started
  startSubstep(reportId: string, stageId: string, substepId: string): void {
    const session = this.getSession(reportId, stageId);
    if (!session) return;

    const substep = session.progress.substeps.find(s => s.substepId === substepId);
    if (!substep) return;

    substep.status = 'running';
    substep.startTime = new Date().toISOString();
    session.progress.currentSubstep = substepId;

    this.emitEvent(reportId, stageId, {
      type: 'step_start',
      stageId,
      substepId,
      percentage: 0,
      message: `Started ${substep.name}`,
      timestamp: new Date().toISOString()
    });

    logger.debug(`${reportId}-${stageId}`, `Started substep: ${substepId} - ${substep.name}`);
  }

  // Mark substep as completed
  completeSubstep(reportId: string, stageId: string, substepId: string, output?: string): void {
    const session = this.getSession(reportId, stageId);
    if (!session) return;

    const substep = session.progress.substeps.find(s => s.substepId === substepId);
    if (!substep) return;

    substep.status = 'completed';
    substep.percentage = 100;
    substep.endTime = new Date().toISOString();
    if (output) substep.output = output;

    // Update overall progress
    const completedSubsteps = session.progress.substeps.filter(s => s.status === 'completed').length;
    const totalSubsteps = session.progress.substeps.length;
    session.progress.percentage = Math.round((completedSubsteps / totalSubsteps) * 100);

    this.emitEvent(reportId, stageId, {
      type: 'step_complete',
      stageId,
      substepId,
      percentage: 100,
      message: `Completed ${substep.name}`,
      data: { output },
      timestamp: new Date().toISOString()
    });

    logger.debug(`${reportId}-${stageId}`, `Completed substep: ${substepId} - ${substep.name}`);
  }

  // Mark substep as error
  errorSubstep(reportId: string, stageId: string, substepId: string, error: string): void {
    const session = this.getSession(reportId, stageId);
    if (!session) return;

    const substep = session.progress.substeps.find(s => s.substepId === substepId);
    if (!substep) return;

    substep.status = 'error';
    substep.endTime = new Date().toISOString();
    session.progress.currentSubstep = substepId;

    this.emitEvent(reportId, stageId, {
      type: 'step_error',
      stageId,
      substepId,
      percentage: substep.percentage,
      message: `Error in ${substep.name}: ${error}`,
      timestamp: new Date().toISOString()
    });

    logger.error(`${reportId}-${stageId}`, `Error in substep ${substepId}: ${error}`);
  }

  // Complete entire stage
  completeStage(
    reportId: string, 
    stageId: string, 
    result: string, 
    conceptReport?: string,
    prompt?: string
  ): void {
    const session = this.getSession(reportId, stageId);
    if (!session) return;

    session.status = 'completed';
    session.progress.status = 'completed';
    session.progress.percentage = 100;

    this.emitEvent(reportId, stageId, {
      type: 'stage_complete',
      stageId,
      result,
      conceptReport,
      prompt,
      timestamp: new Date().toISOString()
    });

    logger.info(`${reportId}-${stageId}`, 'Stage completed successfully');
  }

  // Cancel session
  cancelSession(reportId: string, stageId: string): void {
    const session = this.getSession(reportId, stageId);
    if (!session) return;

    session.status = 'cancelled';
    session.progress.status = 'cancelled';

    this.emitEvent(reportId, stageId, {
      type: 'cancelled',
      stageId,
      timestamp: new Date().toISOString()
    });

    logger.info(`${reportId}-${stageId}`, 'Session cancelled');
  }

  // Error entire stage
  errorStage(reportId: string, stageId: string, error: string, canRetry: boolean = true): void {
    const session = this.getSession(reportId, stageId);
    if (!session) return;

    session.status = 'error';
    session.progress.status = 'error';

    this.emitEvent(reportId, stageId, {
      type: 'stage_error',
      stageId,
      error,
      canRetry,
      timestamp: new Date().toISOString()
    });

    logger.error(`${reportId}-${stageId}`, `Stage error: ${error}`);
  }

  // Event emission
  private emitEvent(reportId: string, stageId: string, event: StreamingEvent): void {
    const sessionId = `${reportId}-${stageId}`;
    this.eventEmitter.emit(sessionId, event);
    this.eventEmitter.emit('global', { sessionId, ...event });
  }

  // Subscribe to events
  subscribe(reportId: string, stageId: string, callback: (event: StreamingEvent) => void): () => void {
    const sessionId = `${reportId}-${stageId}`;
    this.eventEmitter.on(sessionId, callback);
    
    return () => {
      this.eventEmitter.off(sessionId, callback);
    };
  }

  // Stream token (for text generation)
  streamToken(reportId: string, stageId: string, token: string, accumulated: string): void {
    this.emitEvent(reportId, stageId, {
      type: 'token',
      stageId,
      token,
      accumulated,
      timestamp: new Date().toISOString()
    });
  }

  // Cleanup old sessions
  cleanup(): void {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    
    const entries = Array.from(this.sessions.entries());
    for (const [sessionId, session] of entries) {
      const sessionTime = new Date(session.startTime).getTime();
      if (sessionTime < cutoff) {
        this.sessions.delete(sessionId);
        logger.debug('session-manager', `Cleaned up old session: ${sessionId}`);
      }
    }
  }

  // Get all active sessions
  getActiveSessions(): StreamingSession[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }
}