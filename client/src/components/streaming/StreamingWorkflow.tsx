import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Play, Square, RotateCcw, CheckCircle2, XCircle, Clock } from "lucide-react";
import type { 
  StreamingSession, 
  StreamingEvent, 
  SubstepProgress 
} from "@shared/streaming-types";

interface StreamingWorkflowProps {
  reportId: string;
  stageId: string;
  stageName: string;
  onComplete?: (result: any) => void;
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

  // Start streaming execution
  const startExecution = useCallback(async () => {
    try {
      console.log(`🌊 [${reportId}-${stageId}] Starting streaming execution`);
      
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
      console.log(`✅ [${reportId}-${stageId}] Streaming started:`, result);

      // Connect to SSE stream
      connectToStream();
    } catch (error: any) {
      console.error(`❌ [${reportId}-${stageId}] Failed to start streaming:`, error);
      onError?.(error.message);
    }
  }, [reportId, stageId, onError]);

  // Connect to Server-Sent Events stream
  const connectToStream = useCallback(() => {
    if (eventSource) {
      eventSource.close();
    }

    const url = `/api/reports/${reportId}/stage/${stageId}/stream`;
    console.log(`📡 [${reportId}-${stageId}] Connecting to SSE: ${url}`);
    
    const source = new EventSource(url);
    
    source.onopen = () => {
      console.log(`🔗 [${reportId}-${stageId}] SSE connection opened`);
      setIsConnected(true);
    };

    source.onmessage = (event) => {
      try {
        const streamingEvent: StreamingEvent = JSON.parse(event.data);
        console.log(`📨 [${reportId}-${stageId}] SSE event:`, streamingEvent.type);
        handleStreamingEvent(streamingEvent);
      } catch (error) {
        console.warn(`⚠️ [${reportId}-${stageId}] Failed to parse SSE event:`, error);
      }
    };

    source.onerror = (error) => {
      console.error(`💥 [${reportId}-${stageId}] SSE connection error:`, error);
      setIsConnected(false);
      
      // Retry connection after 5 seconds
      setTimeout(() => {
        if (!source.CLOSED) {
          console.log(`🔄 [${reportId}-${stageId}] Retrying SSE connection`);
          connectToStream();
        }
      }, 5000);
    };

    setEventSource(source);
  }, [reportId, stageId]);

  // Handle streaming events
  const handleStreamingEvent = useCallback((event: StreamingEvent) => {
    switch (event.type) {
      case 'progress':
        console.log(`📊 [${reportId}-${stageId}] Progress event`);
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
        console.log(`▶️ [${reportId}-${stageId}] Step started: ${event.substepId}`);
        setSession(prev => prev ? { 
          ...prev, 
          progress: { ...prev.progress, currentSubstep: event.substepId }
        } : null);
        break;

      case 'step_progress':
        console.log(`📈 [${reportId}-${stageId}] Step progress: ${event.substepId}`);
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
        console.log(`✅ [${reportId}-${stageId}] Step completed: ${event.substepId}`);
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
        console.error(`❌ [${reportId}-${stageId}] Step error: ${event.substepId}`);
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

      case 'token':
        // Accumulate streaming content
        setStreamingContent(prev => prev + (event.token || ""));
        break;

      case 'stage_complete':
        console.log(`🎉 [${reportId}-${stageId}] Stage completed`);
        setSession(prev => prev ? { 
          ...prev, 
          status: 'completed',
          endTime: new Date().toISOString()
        } : null);
        onComplete?.(event);
        break;

      case 'stage_error':
        console.error(`💥 [${reportId}-${stageId}] Stage error:`, event.error);
        setSession(prev => prev ? { 
          ...prev, 
          status: 'error',
          endTime: new Date().toISOString()
        } : null);
        onError?.(event.error);
        break;

      case 'cancelled':
        console.log(`🛑 [${reportId}-${stageId}] Stage cancelled`);
        setSession(prev => prev ? { 
          ...prev, 
          status: 'cancelled',
          endTime: new Date().toISOString()
        } : null);
        break;

      default:
        console.warn(`❓ [${reportId}-${stageId}] Unknown event type:`, (event as any).type);
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

      console.log(`🛑 [${reportId}-${stageId}] Execution cancelled`);
    } catch (error: any) {
      console.error(`❌ [${reportId}-${stageId}] Failed to cancel:`, error);
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

      console.log(`🔄 [${reportId}-${stageId}] Substep ${substepId} retry initiated`);
    } catch (error: any) {
      console.error(`❌ [${reportId}-${stageId}] Failed to retry substep:`, error);
    }
  }, [reportId, stageId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSource) {
        eventSource.close();
        console.log(`🔌 [${reportId}-${stageId}] SSE connection closed`);
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
            {session.progress.currentSubstep && (
              <p className="text-sm text-muted-foreground">
                Current: {session.progress.currentSubstep}
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

        {/* Streaming content preview */}
        {streamingContent && (
          <div className="space-y-2">
            <h4 className="font-medium">Live Output</h4>
            <div 
              className="p-3 bg-muted rounded-lg text-sm font-mono max-h-40 overflow-y-auto"
              data-testid={`streaming-content-${stageId}`}
            >
              {streamingContent}
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