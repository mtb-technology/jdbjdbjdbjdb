import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Zap, Loader2, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Report } from "@shared/schema";

interface ExpressModeButtonProps {
  reportId: string;
  onComplete?: () => void;
  disabled?: boolean;
}

interface StageProgress {
  stageId: string;
  stageNumber: number;
  totalStages: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  substep?: 'review' | 'process_feedback';
  percentage: number;
  message?: string;
  error?: string;
}

export function ExpressModeButton({ reportId, onComplete, disabled }: ExpressModeButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [stages, setStages] = useState<StageProgress[]>([]);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const { toast } = useToast();

  const startExpressMode = async () => {
    setIsOpen(true);
    setIsRunning(true);
    setStages([]);
    setCurrentStageIndex(0);

    try {
      console.log(`[ExpressMode] Starting for report ${reportId}...`);

      const response = await fetch(`/api/reports/${reportId}/express-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoAccept: true }),
        credentials: 'include',
      });

      console.log(`[ExpressMode] Response received:`, {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      });

      if (!response.ok) {
        // Try to read error body
        const errorText = await response.text();
        console.error(`[ExpressMode] Error response:`, errorText);
        throw new Error(`Failed to start Express Mode: ${response.status} - ${errorText.substring(0, 200)}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          try {
            const event = JSON.parse(line.substring(6));
            handleSSEEvent(event);
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
          }
        }
      }

      setIsRunning(false);

      toast({
        title: "Express Mode Voltooid",
        description: "Alle review stages zijn succesvol verwerkt",
      });

      setTimeout(() => {
        setIsOpen(false);
        onComplete?.();
      }, 2000);

    } catch (error: any) {
      console.error('Express Mode error:', error);
      setIsRunning(false);

      toast({
        title: "Express Mode Gefaald",
        description: error.message || "Er is een fout opgetreden",
        variant: "destructive",
      });
    }
  };

  const handleSSEEvent = (event: any) => {
    console.log('SSE Event:', event);

    switch (event.type) {
      case 'stage_start':
        setStages(prev => {
          const existingIndex = prev.findIndex(s => s.stageId === event.stageId);
          const newStage: StageProgress = {
            stageId: event.stageId,
            stageNumber: event.stageNumber,
            totalStages: event.totalStages,
            status: 'running',
            percentage: 0,
            message: event.message,
          };

          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = newStage;
            return updated;
          }
          return [...prev, newStage];
        });
        setCurrentStageIndex(event.stageNumber - 1);
        break;

      case 'step_progress':
        setStages(prev =>
          prev.map(stage =>
            stage.stageId === event.stageId
              ? {
                  ...stage,
                  substep: event.substepId,
                  percentage: event.percentage,
                  message: event.message,
                }
              : stage
          )
        );
        break;

      case 'step_complete':
        setStages(prev =>
          prev.map(stage =>
            stage.stageId === event.stageId
              ? {
                  ...stage,
                  substep: event.substepId,
                  percentage: event.percentage,
                  message: event.message,
                }
              : stage
          )
        );
        break;

      case 'stage_complete':
        setStages(prev =>
          prev.map(stage =>
            stage.stageId === event.stageId
              ? {
                  ...stage,
                  status: 'completed',
                  percentage: 100,
                  message: event.message,
                }
              : stage
          )
        );
        break;

      case 'stage_error':
        setStages(prev =>
          prev.map(stage =>
            stage.stageId === event.stageId
              ? {
                  ...stage,
                  status: 'error',
                  error: event.error,
                  message: `Error: ${event.error}`,
                }
              : stage
          )
        );
        setIsRunning(false);
        break;

      case 'express_complete':
        setIsRunning(false);
        break;

      case 'express_error':
        setIsRunning(false);
        toast({
          title: "Express Mode Gefaald",
          description: event.error,
          variant: "destructive",
        });
        break;
    }
  };

  const getStageIcon = (stage: StageProgress) => {
    switch (stage.status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'running':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStageLabel = (stageId: string) => {
    const labels: Record<string, string> = {
      '4a_BronnenSpecialist': '4a. Bronnen Specialist',
      '4b_FiscaalTechnischSpecialist': '4b. Fiscaal Technisch',
      '4c_ScenarioGatenAnalist': '4c. Scenario Gaten',
      '4e_DeAdvocaat': '4e. De Advocaat',
      '4f_HoofdCommunicatie': '4f. Hoofd Communicatie',
    };
    return labels[stageId] || stageId;
  };

  const getSubstepLabel = (substep?: string) => {
    switch (substep) {
      case 'review':
        return 'Review genereren...';
      case 'process_feedback':
        return 'Feedback verwerken...';
      default:
        return '';
    }
  };

  const overallProgress = stages.length > 0
    ? Math.round((stages.filter(s => s.status === 'completed').length / stages.length) * 100)
    : 0;

  return (
    <>
      <Button
        onClick={startExpressMode}
        disabled={disabled || isRunning}
        variant="default"
        size="sm"
        className="gap-2"
      >
        {isRunning ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Express Mode Actief...
          </>
        ) : (
          <>
            <Zap className="h-4 w-4" />
            Express Mode
          </>
        )}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Express Mode
            </DialogTitle>
            <DialogDescription>
              Alle review stages (4a-4f) worden automatisch uitgevoerd met auto-accept van alle feedback
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Overall Progress */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium">Totale Voortgang</span>
                <span className="text-muted-foreground">{overallProgress}%</span>
              </div>
              <Progress value={overallProgress} className="h-2" />
            </div>

            {/* Stage List */}
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {stages.map((stage, index) => (
                <div
                  key={stage.stageId}
                  className={`border rounded-lg p-4 transition-all ${
                    stage.status === 'running' ? 'border-blue-500 bg-blue-50' : ''
                  } ${stage.status === 'completed' ? 'border-green-500 bg-green-50' : ''} ${
                    stage.status === 'error' ? 'border-red-500 bg-red-50' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-3 flex-1">
                      {getStageIcon(stage)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{getStageLabel(stage.stageId)}</h4>
                          <Badge variant={stage.status === 'running' ? 'default' : 'secondary'} className="text-xs">
                            {stage.stageNumber}/{stage.totalStages}
                          </Badge>
                        </div>
                        {stage.substep && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {getSubstepLabel(stage.substep)}
                          </p>
                        )}
                        {stage.message && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {stage.message}
                          </p>
                        )}
                        {stage.error && (
                          <p className="text-xs text-red-600 mt-1">{stage.error}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {stage.status === 'running' && (
                    <Progress value={stage.percentage} className="h-1 mt-2" />
                  )}
                </div>
              ))}
            </div>

            {/* Status Message */}
            {isRunning && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Express Mode actief - dit kan enkele minuten duren...</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
