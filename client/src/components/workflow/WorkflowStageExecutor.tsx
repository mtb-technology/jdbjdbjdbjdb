import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Play,
  CheckCircle,
  Copy,
  Wand2,
  PenTool
} from "lucide-react";
import { WORKFLOW_STAGES } from "./constants";
import { useWorkflow } from "./WorkflowContext";

interface WorkflowStageExecutorProps {
  executeStageM: any;
  executeSubstepM: any;
  isCreatingCase: boolean;
  onManualExecute: () => void;
  onCopyPrompt: () => void;
}

export function WorkflowStageExecutor({
  executeStageM,
  executeSubstepM,
  isCreatingCase,
  onManualExecute,
  onCopyPrompt
}: WorkflowStageExecutorProps) {
  const { state, dispatch } = useWorkflow();
  const {
    currentStageIndex,
    currentReport,
    stageResults,
    substepResults,
    customInput,
    manualMode,
    manualContent,
    copiedPrompt
  } = state;

  const currentStage = WORKFLOW_STAGES[currentStageIndex];
  const currentStageResult = stageResults[currentStage.key];
  const isReviewerStage = currentStage.type === "reviewer";

  const executeCurrentStage = () => {
    if (!currentReport) return;
    
    executeStageM.mutate({
      reportId: currentReport.id,
      stage: currentStage.key,
      customInput: customInput || undefined,
    });
  };

  if (!currentReport) {
    return (
      <div className="text-center text-muted-foreground">
        Bezig met case aanmaken...
      </div>
    );
  }

  if (isReviewerStage) {
    const substepResultsForStage = substepResults[currentStage.key] || {};
    const hasReviewResult = !!substepResultsForStage.review;
    const hasProcessingResult = !!substepResultsForStage.processing;
    const substeps = (currentStage as any).substeps || [];

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-medium flex items-center gap-2">
            Reviewer Substappen
            <Badge variant="outline">
              {hasReviewResult && hasProcessingResult ? '2/2' : hasReviewResult ? '1/2' : '0/2'}
            </Badge>
          </h3>
          {hasReviewResult && hasProcessingResult && (
            <Badge className="bg-green-600">
              <CheckCircle className="w-3 h-3 mr-1" />
              Voltooid
            </Badge>
          )}
        </div>
        
        <div className="grid gap-2">
          {substeps.map((substep: any) => {
            const isReviewSubstep = substep.type === "review";
            const isProcessingSubstep = substep.type === "processing";
            const isCompleted = isReviewSubstep ? hasReviewResult : hasProcessingResult;
            const canExecute = isReviewSubstep || (isProcessingSubstep && hasReviewResult);
            const isExecuting = executeSubstepM.isPending && 
                             executeSubstepM.variables?.substepType === substep.type;
            
            return (
              <Button
                key={`${substep.key}-${substep.type}`}
                onClick={() => canExecute && currentReport && executeSubstepM.mutate({
                  substepKey: isReviewSubstep ? currentStage.key : "5_feedback_verwerker",
                  substepType: substep.type,
                  reportId: currentReport.id
                })}
                disabled={!canExecute || isExecuting}
                className={`w-full ${
                  isCompleted ? "bg-green-600 hover:bg-green-700" : 
                  canExecute ? "bg-primary" : "bg-gray-400"
                }`}
                data-testid={`button-substep-${substep.type}`}
              >
                {isExecuting ? (
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>AI bezig...</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    {isCompleted ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    <span>
                      {isCompleted ? "✓" : ""} {substep.label}
                    </span>
                  </div>
                )}
              </Button>
            );
          })}
          
          {/* Show progress indicator */}
          <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded text-sm">
            {!substepResultsForStage.review && (
              <span className="text-blue-700 dark:text-blue-400">👆 Klik eerst op "Review & JSON feedback" om te starten</span>
            )}
            {substepResultsForStage.review && !substepResultsForStage.processing && (
              <span className="text-orange-700 dark:text-orange-400">👆 JSON feedback klaar! Klik nu op "Rapport update" om feedback te verwerken</span>
            )}
            {substepResultsForStage.review && substepResultsForStage.processing && (
              <span className="text-green-700 dark:text-green-400">✅ Beide substappen voltooid! Je kunt nu naar de volgende reviewer</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Non-reviewer stage execution
  if (!currentStageResult) {
    return (
      <div className="space-y-3">
        {/* Custom input area */}
        {currentStage.key === "3_generatie" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="custom-input" className="text-sm font-medium">
                Optionele Aanvullende Instructies
              </Label>
              <Badge variant="outline">Optioneel</Badge>
            </div>
            <Textarea
              id="custom-input"
              placeholder="Voeg hier aanvullende instructies toe voor de AI (bijv. 'Focus extra op de btw-aspecten' of 'Maak de conclusie uitgebreider')"
              value={customInput}
              onChange={(e) => dispatch({ type: "SET_CUSTOM_INPUT", input: e.target.value })}
              className="min-h-[100px]"
              data-testid="textarea-custom-input"
            />
            
            {/* Execution mode selector */}
            <div className="flex items-center gap-4 p-3 border rounded-lg bg-muted/50">
              <RadioGroup 
                value={manualMode}
                onValueChange={(value) => dispatch({ type: "SET_MANUAL_MODE", mode: value as "ai" | "manual" })}
                className="flex items-center gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="ai" id="mode-ai" />
                  <Label htmlFor="mode-ai" className="flex items-center gap-2 cursor-pointer">
                    <Wand2 className="h-4 w-4" />
                    AI Uitvoering
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="manual" id="mode-manual" />
                  <Label htmlFor="mode-manual" className="flex items-center gap-2 cursor-pointer">
                    <PenTool className="h-4 w-4" />
                    Handmatig (ChatGPT)
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Manual mode controls */}
            {manualMode === "manual" && (
              <div className="space-y-3 p-4 border-2 border-primary/20 rounded-lg bg-primary/5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">
                    ChatGPT Prompt
                  </Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCopyPrompt}
                    className="gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    {copiedPrompt ? "Gekopieerd!" : "Kopieer Prompt"}
                  </Button>
                </div>
                <Textarea
                  placeholder="Plak hier het resultaat van ChatGPT..."
                  value={manualContent}
                  onChange={(e) => dispatch({ type: "SET_MANUAL_CONTENT", content: e.target.value })}
                  className="min-h-[150px] font-mono text-sm"
                />
              </div>
            )}
          </div>
        )}
        
        <Button
          onClick={manualMode === "manual" ? onManualExecute : executeCurrentStage}
          disabled={executeStageM.isPending || isCreatingCase || (manualMode === "manual" && !manualContent)}
          className="w-full bg-primary"
          data-testid="button-execute-stage"
        >
          {executeStageM.isPending ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
              AI bezig...
            </>
          ) : isCreatingCase ? (
            <>
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2"></div>
              Case wordt aangemaakt...
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              {manualMode === "manual" ? "Verwerk ChatGPT Resultaat" : `Voer ${currentStage.label} Uit`}
            </>
          )}
        </Button>
        
        <p className="text-xs text-muted-foreground text-center">
          {manualMode === "manual" 
            ? "Kopieer de prompt, plak in ChatGPT, en plak het resultaat terug"
            : "Elke stap wordt handmatig uitgevoerd voor volledige controle"}
        </p>
      </div>
    );
  }

  return null;
}