import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Play, Square, RotateCcw, CheckCircle2, XCircle, Clock } from "lucide-react";
import { SimpleFeedbackProcessor } from "@/components/workflow/SimpleFeedbackProcessor";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/types/api";
import type {
  StreamingSession,
  StreamingEvent,
  SubstepProgress
} from "@shared/streaming-types";

interface StreamingWorkflowProps {
  reportId: string;
  stageId: string;
  stageName: string;
  onComplete?: (result: StreamingEvent) => void;
  onError?: (error: string) => void;
}

export function StreamingWorkflow({
  reportId,
  stageId,
  stageName,
  onComplete,
  onError
}: StreamingWorkflowProps) {
  const [session, setSession] = useState<StreamingSession | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [retryCount, setRetryCount] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);

  // Start streaming execution
  const startExecution = useCallback(async () => {
    try {
      logger.streaming(reportId, stageId, 'Starting streaming execution');

      const response = await fetch(`/api/reports/${reportId}/stage/${stageId}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        throw new Error(`Streaming start failed: ${response.statusText}`);
      }

      const result = await response.json();
      logger.streaming(reportId, stageId, 'Streaming started', result);

      // Connect to SSE stream
      connectToStream();
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.error('Failed to start streaming', error, { context: `${reportId}-${stageId}` });
      onError?.(message);
    }
  }, [reportId, stageId, onError]);

  // Connect to Server-Sent Events stream with exponential backoff
  const connectToStream = useCallback(() => {
    // Prevent concurrent connection attempts
    if (isConnecting) {
      logger.debug('Connection already in progress, skipping', { context: `${reportId}-${stageId}` });
      return;
    }

    setIsConnecting(true);

    // Close existing connection if any
    if (eventSource) {
      logger.debug('Closing existing connection', { context: `${reportId}-${stageId}` });
      eventSource.close();
      setEventSource(null);
    }

    const url = `/api/reports/${reportId}/stage/${stageId}/stream`;
    logger.streaming(reportId, stageId, `Connecting to SSE: ${url}`);

    const source = new EventSource(url);

    source.onopen = () => {
      logger.streaming(reportId, stageId, 'SSE connection opened');
      setIsConnected(true);
      setIsConnecting(false);
      setRetryCount(0); // Reset retry count on successful connection
    };

    source.onmessage = (event) => {
      try {
        const streamingEvent: StreamingEvent = JSON.parse(event.data);
        logger.streaming(reportId, stageId, `SSE event: ${streamingEvent.type}`);
        handleStreamingEvent(streamingEvent);
      } catch (error) {
        logger.warn('Failed to parse SSE event', { context: `${reportId}-${stageId}`, data: error });
      }
    };

    source.onerror = (error) => {
      logger.error('SSE connection error', error, { context: `${reportId}-${stageId}` });
      setIsConnected(false);
      setIsConnecting(false);

      // Exponential backoff with max retries
      const MAX_RETRIES = 5;
      if (retryCount < MAX_RETRIES) {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        const delay = Math.min(1000 * Math.pow(2, retryCount), 16000);
        logger.debug(`Retrying SSE connection in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`, {
          context: `${reportId}-${stageId}`
        });

        setTimeout(() => {
          setRetryCount(prev => prev + 1);
          connectToStream();
        }, delay);
      } else {
        logger.error('Max retries reached, giving up', null, { context: `${reportId}-${stageId}` });
        onError?.('Connection failed after maximum retries');
      }
    };

    setEventSource(source);
  }, [reportId, stageId, retryCount, eventSource, isConnecting, onError]);

  // Handle streaming events
  const handleStreamingEvent = useCallback((event: StreamingEvent) => {
    switch (event.type) {
      case 'progress':
        logger.streaming(reportId, stageId, 'Progress event');
        // Create session from progress event
        const progressSession: StreamingSession = {
          reportId,
          stageId,
          status: 'active',
          progress: {
            stageId,
            status: 'running',
            percentage: event.percentage,
            currentSubstep: event.substepId,
            substeps: []
          },
          startTime: new Date().toISOString()
        };
        setSession(progressSession);
        break;

      case 'step_start':
        logger.streaming(reportId, stageId, `Step started: ${event.substepId}`);
        setSession(prev => prev ? { 
          ...prev, 
          progress: { ...prev.progress, currentSubstep: event.substepId }
        } : null);
        break;

      case 'step_progress':
        logger.streaming(reportId, stageId, `Step progress: ${event.substepId}`);
        setSession(prev => {
          if (!prev) return null;
          const updatedSubsteps = prev.progress.substeps.map(substep =>
            substep.substepId === event.substepId 
              ? { ...substep, percentage: event.percentage, message: event.message }
              : substep
          );
          return {
            ...prev,
            progress: { ...prev.progress, substeps: updatedSubsteps }
          };
        });
        break;

      case 'step_complete':
        logger.streaming(reportId, stageId, `Step completed: ${event.substepId}`);
        setSession(prev => {
          if (!prev) return null;
          const updatedSubsteps = prev.progress.substeps.map(substep =>
            substep.substepId === event.substepId 
              ? { ...substep, status: 'completed' as const, percentage: 100 }
              : substep
          );
          return {
            ...prev,
            progress: { ...prev.progress, substeps: updatedSubsteps }
          };
        });
        break;

      case 'step_error':
        logger.error(`Step error: ${event.substepId}`, null, { context: `${reportId}-${stageId}` });
        setSession(prev => {
          if (!prev) return null;
          const updatedSubsteps = prev.progress.substeps.map(substep =>
            substep.substepId === event.substepId 
              ? { ...substep, status: 'error' as const, message: event.message }
              : substep
          );
          return {
            ...prev,
            progress: { ...prev.progress, substeps: updatedSubsteps }
          };
        });
        break;

      case 'research_progress':
        // Deep research progress update
        logger.streaming(reportId, stageId, `Research progress: ${event.researchStage} - ${event.percentage}%`);
        setSession(prev => prev ? {
          ...prev,
          progress: {
            ...prev.progress,
            percentage: event.percentage,
            currentSubstep: event.researchStage,
            message: event.message
          }
        } : null);
        break;

      case 'token':
        // Accumulate streaming content
        setStreamingContent(prev => prev + (event.token || ""));
        break;

      case 'stage_complete':
        logger.streaming(reportId, stageId, 'Stage completed');

        // Check for user action required (feedback instructions)
        if (event.data?.requiresUserAction && event.data?.actionType === 'feedback_instructions') {
          logger.streaming(reportId, stageId, 'Feedback ready for user instructions');
          setSession(prev => prev ? { 
            ...prev, 
            status: 'awaiting_user_action',
            endTime: new Date().toISOString(),
            userActionData: {
              actionType: 'feedback_instructions',
              rawFeedback: event.data.rawFeedback,
              message: event.message
            }
          } : null);
        } else {
          // Normal completion
          setSession(prev => prev ? { 
            ...prev, 
            status: 'completed',
            endTime: new Date().toISOString()
          } : null);
        }
        
        onComplete?.(event);
        break;

      case 'stage_error':
        logger.error('Stage error', event.error, { context: `${reportId}-${stageId}` });
        setSession(prev => prev ? { 
          ...prev, 
          status: 'error',
          endTime: new Date().toISOString()
        } : null);
        onError?.(event.error);
        break;

      case 'cancelled':
        logger.streaming(reportId, stageId, 'Stage cancelled');
        setSession(prev => prev ? { 
          ...prev, 
          status: 'cancelled',
          endTime: new Date().toISOString()
        } : null);
        break;

      default:
        logger.warn(`Unknown event type: ${(event as StreamingEvent & { type: string }).type}`, {
          context: `${reportId}-${stageId}`
        });
    }
  }, [reportId, stageId, onComplete, onError]);

  // Cancel execution
  const cancelExecution = useCallback(async () => {
    try {
      const response = await fetch(`/api/reports/${reportId}/stage/${stageId}/cancel`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(`Cancel failed: ${response.statusText}`);
      }

      logger.streaming(reportId, stageId, 'Execution cancelled');
    } catch (error: unknown) {
      logger.error('Failed to cancel execution', error, { context: `${reportId}-${stageId}` });
    }
  }, [reportId, stageId]);

  // Retry failed substep
  const retrySubstep = useCallback(async (substepId: string) => {
    try {
      const response = await fetch(`/api/reports/${reportId}/stage/${stageId}/substep/${substepId}/retry`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(`Retry failed: ${response.statusText}`);
      }

      logger.streaming(reportId, stageId, `Substep ${substepId} retry initiated`);
    } catch (error: unknown) {
      logger.error('Failed to retry substep', error, { context: `${reportId}-${stageId}`, data: { substepId } });
    }
  }, [reportId, stageId]);

  // 🔒 SECURITY FIX: Cleanup EventSource on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (eventSource) {
        eventSource.close();
        setEventSource(null); // Clear the reference to prevent memory leaks
        logger.streaming(reportId, stageId, 'SSE connection closed on unmount');
      }
    };
  }, [eventSource, reportId, stageId]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'running':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: "secondary",
      running: "default", 
      completed: "default",
      error: "destructive",
      active: "default",
      cancelled: "secondary"
    } as const;

    return (
      <Badge 
        variant={variants[status as keyof typeof variants] || "secondary"} 
        className="ml-2"
      >
        {status}
      </Badge>
    );
  };

  return (
    <Card className="w-full" data-testid={`streaming-workflow-${stageId}`}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{stageName}</span>
          <div className="flex items-center gap-2">
            {session && getStatusBadge(session.status)}
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} 
                 title={isConnected ? 'Connected' : 'Disconnected'} />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Control buttons */}
        <div className="flex gap-2">
          {!session || session.status === 'completed' || session.status === 'cancelled' ? (
            <Button 
              onClick={startExecution}
              data-testid={`button-start-${stageId}`}
              className="flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              Start Execution
            </Button>
          ) : (
            <Button 
              onClick={cancelExecution}
              variant="destructive"
              data-testid={`button-cancel-${stageId}`}
              className="flex items-center gap-2"
            >
              <Square className="w-4 h-4" />
              Cancel
            </Button>
          )}
        </div>

        {/* Overall progress */}
        {session && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Overall Progress</span>
              <span>{session.progress.percentage}%</span>
            </div>
            <Progress 
              value={session.progress.percentage} 
              className="w-full"
              data-testid={`progress-overall-${stageId}`}
            />
            {(session.progress.currentSubstep || (session.progress as any).message) && (
              <p className="text-sm text-muted-foreground">
                {(session.progress as any).message || `Current: ${session.progress.currentSubstep}`}
              </p>
            )}
          </div>
        )}

        {/* Substeps list */}
        {session && session.progress.substeps.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-medium">Substeps</h4>
            <div className="space-y-2">
              {session.progress.substeps.map((substep: SubstepProgress) => (
                <div 
                  key={substep.substepId}
                  className="flex items-center justify-between p-2 bg-muted rounded-lg"
                  data-testid={`substep-${substep.substepId}`}
                >
                  <div className="flex items-center gap-2">
                    {getStatusIcon(substep.status)}
                    <span className="text-sm font-medium">{substep.substepId}</span>
                    {substep.message && (
                      <span className="text-xs text-muted-foreground">- {substep.message}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {substep.status === 'running' && (
                      <Progress value={substep.percentage} className="w-20" />
                    )}
                    {substep.status === 'error' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => retrySubstep(substep.substepId)}
                        data-testid={`button-retry-${substep.substepId}`}
                      >
                        <RotateCcw className="w-3 h-3" />
                        Retry
                      </Button>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {substep.percentage}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User Action Required - Feedback Instructions */}
        {session?.status === 'awaiting_user_action' && session.userActionData?.actionType === 'feedback_instructions' && (
          <div className="space-y-4">
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
              <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">
                🔍 Feedback Review Vereist
              </h4>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                {session.userActionData.message || `Stage ${stageId} is voltooid. Review de feedback en geef instructies wat je wilt verwerken.`}
              </p>
            </div>
            
            <SimpleFeedbackProcessor
              reportId={reportId}
              stageId={stageId}
              stageName={stageId}
              rawFeedback={session.userActionData.rawFeedback || 'Geen feedback beschikbaar'}
              onProcessingComplete={() => {
                logger.info(`Feedback processing completed for ${stageId}`);
                // Session will update automatically via SSE events
              }}
            />
          </div>
        )}

        {/* Streaming content preview */}
        {streamingContent && (
          <div className="space-y-2">
            <h4 className="font-medium">Live Output</h4>
            <div
              className="p-4 bg-muted rounded-lg text-sm max-h-96 overflow-y-auto border border-border"
              data-testid={`streaming-content-${stageId}`}
            >
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <div className="whitespace-pre-wrap break-words leading-relaxed">
                  {streamingContent}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Session info */}
        {session && (
          <div className="text-xs text-muted-foreground">
            Session started: {new Date(session.startTime).toLocaleTimeString()}
            {session.status === 'completed' && (
              <span> • Completed</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}