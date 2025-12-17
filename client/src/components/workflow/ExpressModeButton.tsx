import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Zap, Loader2, CheckCircle, XCircle, AlertCircle, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ExpressModeResults } from "./ExpressModeResults";
import { useCreateJob, useJobPolling, type JobProgress } from "@/hooks/useJobPolling";
import type { ExpressModeSummary } from "@shared/types/api";

interface ExpressModeButtonProps {
  reportId: string;
  onComplete?: () => void;
  disabled?: boolean;
  includeGeneration?: boolean; // Start from stage 3 (after stage 2 completion)
  hasStage3?: boolean; // Whether stage 3 is already completed
  reportDepth?: "concise" | "balanced" | "comprehensive"; // Depth for report generation (only used when includeGeneration is true)
  reportLanguage?: "nl" | "en"; // Language for report generation (only used when includeGeneration is true)
  variant?: "button" | "menuItem"; // How to render: as button or dropdown menu item
}

interface StageProgress {
  stageId: string;
  stageNumber: number;
  totalStages: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  substep?: 'generate' | 'review' | 'process_feedback';
  percentage: number;
  message?: string;
  error?: string;
}

export function ExpressModeButton({
  reportId,
  onComplete,
  disabled,
  includeGeneration = false,
  hasStage3 = true,
  reportDepth,
  reportLanguage,
  variant = "button"
}: ExpressModeButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [stages, setStages] = useState<StageProgress[]>([]);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [summary, setSummary] = useState<ExpressModeSummary | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const { toast } = useToast();
  const { createExpressModeJob } = useCreateJob();

  // Use ref to track summary across async operations (state updates are async)
  const summaryRef = useRef<ExpressModeSummary | null>(null);

  // Poll for job progress when we have an active job
  const { job, progress } = useJobPolling({
    jobId: currentJobId,
    reportId,
    onComplete: (completedJob) => {
      console.log('[ExpressMode] Job completed:', completedJob);
      setIsRunning(false);

      // Build summary from job result
      if (completedJob.result) {
        const summaryData: ExpressModeSummary = {
          stages: completedJob.result.stages || [],
          totalChanges: completedJob.result.totalChanges || 0,
          finalVersion: completedJob.result.finalVersion || 1,
          totalProcessingTimeMs: 0, // Not tracked in job
          finalContent: completedJob.result.finalContent || '',
          fiscaleBriefing: completedJob.result.fiscaleBriefing || undefined,
        };
        summaryRef.current = summaryData;
        setSummary(summaryData);
        setIsOpen(false);
        setShowResults(true);
      } else {
        toast({
          title: "Express Mode Voltooid",
          description: "Alle review stages zijn succesvol verwerkt",
        });
        setTimeout(() => {
          setIsOpen(false);
          onComplete?.();
        }, 2000);
      }

      setCurrentJobId(null);
    },
    onError: (failedJob) => {
      console.error('[ExpressMode] Job failed:', failedJob);
      setIsRunning(false);
      setCurrentJobId(null);
      toast({
        title: "Express Mode Gefaald",
        description: failedJob.error || "Er is een fout opgetreden",
        variant: "destructive",
      });
    },
    enabled: !!currentJobId,
  });

  // Update UI stages from job progress
  useEffect(() => {
    if (progress?.stages) {
      const mappedStages: StageProgress[] = progress.stages.map((s, index) => ({
        stageId: s.stageId,
        stageNumber: index + 1,
        totalStages: progress.stages.length,
        status: s.status === 'processing' ? 'running' : s.status === 'completed' ? 'completed' : s.status === 'failed' ? 'error' : 'pending',
        percentage: s.percentage,
        message: progress.currentStage === s.stageId ? progress.message : undefined,
        error: s.error,
      }));
      setStages(mappedStages);

      // Update current stage index
      const currentIdx = progress.stages.findIndex(s => s.status === 'processing');
      if (currentIdx >= 0) {
        setCurrentStageIndex(currentIdx);
      }
    }
  }, [progress]);

  const handleCloseResults = useCallback(() => {
    setShowResults(false);
    setSummary(null);
    summaryRef.current = null;
    onComplete?.();
  }, [onComplete]);

  const startExpressMode = async () => {
    setIsOpen(true);
    setIsRunning(true);
    setStages([]);
    setCurrentStageIndex(0);
    setSummary(null);
    summaryRef.current = null;
    setShowResults(false);

    try {
      console.log(`[ExpressMode] Starting background job for report ${reportId}...`, {
        includeGeneration,
        reportDepth,
        reportLanguage,
        willSendDepth: includeGeneration ? reportDepth : undefined,
        willSendLanguage: includeGeneration ? reportLanguage : undefined
      });

      // Create background job instead of SSE stream
      const jobId = await createExpressModeJob(reportId, {
        includeGeneration,
        autoAccept: true,
        reportDepth: includeGeneration ? reportDepth : undefined,
        reportLanguage: includeGeneration ? reportLanguage : undefined,
      });

      if (!jobId) {
        throw new Error('Failed to create Express Mode job');
      }

      console.log(`[ExpressMode] Job created: ${jobId}`);
      setCurrentJobId(jobId);

      // Initialize default stages for UI
      const defaultStages = includeGeneration
        ? ['3_generatie', '4a_BronnenSpecialist', '4b_FiscaalTechnischSpecialist', '4c_ScenarioGatenAnalist', '4e_DeAdvocaat', '4f_HoofdCommunicatie']
        : ['4a_BronnenSpecialist', '4b_FiscaalTechnischSpecialist', '4c_ScenarioGatenAnalist', '4e_DeAdvocaat', '4f_HoofdCommunicatie'];

      setStages(defaultStages.map((stageId, index) => ({
        stageId,
        stageNumber: index + 1,
        totalStages: defaultStages.length,
        status: 'pending',
        percentage: 0,
      })));

      toast({
        title: "Express Mode Gestart",
        description: "Je kunt dit venster sluiten - de verwerking loopt door op de achtergrond",
      });

    } catch (error: any) {
      console.error('Express Mode error:', error);
      setIsRunning(false);
      setCurrentJobId(null);

      toast({
        title: "Express Mode Gefaald",
        description: error.message || "Er is een fout opgetreden",
        variant: "destructive",
      });
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
      '3_generatie': '3. Rapport Generatie',
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
      case 'generate':
        return 'Rapport genereren...';
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

  const buttonLabel = includeGeneration
    ? 'Express Mode (vanaf Generatie)'
    : 'Express Mode';

  const dialogDescription = includeGeneration
    ? 'Generatie (stap 3) en alle review stages (4a-4f) worden automatisch uitgevoerd'
    : 'Alle review stages (4a-4f) worden automatisch uitgevoerd met auto-accept van alle feedback';

  // Menu item variant - renders as a clickable div for use in DropdownMenu
  const menuItemContent = (
    <div
      onClick={disabled || isRunning ? undefined : startExpressMode}
      className={`flex items-center gap-2 w-full cursor-pointer ${disabled || isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {isRunning ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Express Mode Actief...</span>
        </>
      ) : (
        <>
          <Zap className="h-4 w-4" />
          <span>{buttonLabel}</span>
        </>
      )}
    </div>
  );

  // Button variant - renders as a standard button
  const buttonContent = (
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
          {buttonLabel}
        </>
      )}
    </Button>
  );

  return (
    <>
      {variant === "menuItem" ? menuItemContent : buttonContent}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Express Mode
            </DialogTitle>
            <DialogDescription>
              {dialogDescription}
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
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-blue-700">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="font-medium">Express Mode actief op de achtergrond</span>
                </div>
                <p className="text-xs text-blue-600 mt-1">
                  Je kunt dit venster sluiten en later terugkomen - de verwerking loopt door.
                </p>
              </div>
            )}

            {/* Close button when running */}
            {isRunning && (
              <div className="flex justify-end pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                >
                  Sluiten (verwerking loopt door)
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Results View - shown after completion */}
      {showResults && summary && (
        <ExpressModeResults
          reportId={reportId}
          summary={summary}
          fiscaleBriefing={summary.fiscaleBriefing}
          onClose={handleCloseResults}
          onSaveComplete={onComplete}
        />
      )}
    </>
  );
}
