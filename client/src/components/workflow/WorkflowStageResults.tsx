import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Edit3, RotateCcw, Save, X } from "lucide-react";
import { WORKFLOW_STAGES } from "./constants";
import { useWorkflow } from "./WorkflowContext";

interface WorkflowStageResultsProps {
  executeStageM: any;
  isCreatingCase: boolean;
  formatReportContent: (content: string) => string;
}

export function WorkflowStageResults({
  executeStageM,
  isCreatingCase,
  formatReportContent
}: WorkflowStageResultsProps) {
  const { state, dispatch } = useWorkflow();
  const {
    currentStageIndex,
    currentReport,
    stageResults,
    conceptReportVersions,
    viewMode,
    editingStage
  } = state;

  const [editingContent, setEditingContent] = useState("");

  const currentStage = WORKFLOW_STAGES[currentStageIndex];
  const currentStageResult = currentStage ? stageResults[currentStage.key] : undefined;

  // Early return if no stage or result
  if (!currentStage || !currentStageResult) return null;

  const executeCurrentStage = () => {
    if (!currentReport) return;
    
    executeStageM.mutate({
      reportId: currentReport.id,
      stage: currentStage.key,
      customInput: state.customInput || undefined,
    });
  };

  const handleSaveEdit = () => {
    if (editingStage && editingContent) {
      if (viewMode === "stage") {
        dispatch({ type: "SET_STAGE_RESULT", stage: editingStage, result: editingContent });
      } else {
        dispatch({ type: "SET_CONCEPT_VERSION", stage: editingStage, content: editingContent });
      }
      dispatch({ type: "SET_EDITING_STAGE", stage: null });
      setEditingContent("");
    }
  };

  const handleCancelEdit = () => {
    dispatch({ type: "SET_EDITING_STAGE", stage: null });
    setEditingContent("");
  };

  const handleStartEdit = () => {
    const content = viewMode === "stage" 
      ? currentStageResult 
      : (conceptReportVersions?.[currentStage.key] || "");
    setEditingContent(content);
    dispatch({ type: "SET_EDITING_STAGE", stage: currentStage.key });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h4 className="font-medium text-foreground">AI Output (RAW):</h4>
          
        </div>
        
        <Button
          variant="outline" 
          size="sm"
          onClick={executeCurrentStage}
          disabled={executeStageM.isPending || isCreatingCase}
          data-testid="button-rerun-stage"
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          Opnieuw uitvoeren
        </Button>
      </div>
      
      {/* RAW AI OUTPUT - GEEN BEWERKING */}
      <div className="p-4 bg-muted/50 rounded-lg max-h-[600px] overflow-y-auto">
        <pre className="whitespace-pre-wrap text-sm font-mono" data-testid="pre-stage-result">
          {currentStageResult}
        </pre>
      </div>

      {/* Substep Results for Reviewer Stages */}
      {currentStage.type === "reviewer" && state.substepResults[currentStage.key] && (
        <div className="space-y-3 mt-6">
          {state.substepResults[currentStage.key].review && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Review Feedback</Badge>
                {state.stageTimes[`${currentStage.key}_review`] && (
                  <Badge variant="secondary" className="text-xs">
                    {state.stageTimes[`${currentStage.key}_review`]}s
                  </Badge>
                )}
              </div>
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded max-h-[200px] overflow-y-auto">
                <pre className="whitespace-pre-wrap text-xs">
                  {state.substepResults[currentStage.key].review}
                </pre>
              </div>
            </div>
          )}
          
          {state.substepResults[currentStage.key].processing && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Verwerkt Resultaat</Badge>
                {state.stageTimes[`5_feedback_verwerker_processing`] && (
                  <Badge variant="secondary" className="text-xs">
                    {state.stageTimes[`5_feedback_verwerker_processing`]}s
                  </Badge>
                )}
              </div>
              <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded max-h-[200px] overflow-y-auto">
                <pre className="whitespace-pre-wrap text-xs">
                  {state.substepResults[currentStage.key].processing}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}