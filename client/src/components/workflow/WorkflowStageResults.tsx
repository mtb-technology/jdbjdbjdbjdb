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
  const currentStageResult = stageResults[currentStage.key];

  // Debug logging
  console.log("🔍 StageResults Debug:", {
    currentStageKey: currentStage.key,
    hasResult: !!currentStageResult,
    resultLength: currentStageResult?.length,
    resultPreview: currentStageResult?.slice(0, 100)
  });

  if (!currentStageResult) return null;

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
      : (conceptReportVersions[currentStage.key] || "");
    setEditingContent(content);
    dispatch({ type: "SET_EDITING_STAGE", stage: currentStage.key });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h4 className="font-medium text-foreground">Resultaat:</h4>
          
          {/* View Mode Toggle */}
          {conceptReportVersions[currentStage.key] && (
            <div className="flex bg-muted rounded-lg p-1">
              <Button
                variant={viewMode === "stage" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => dispatch({ type: "SET_VIEW_MODE", mode: "stage" })}
                className="text-xs px-3 py-1 h-7"
                data-testid="button-view-stage"
              >
                Specialist Output
              </Button>
              <Button
                variant={viewMode === "concept" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => dispatch({ type: "SET_VIEW_MODE", mode: "concept" })}
                className="text-xs px-3 py-1 h-7"
                data-testid="button-view-concept"
              >
                Concept Rapport
              </Button>
            </div>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          {editingStage === currentStage.key ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveEdit}
                disabled={!editingContent}
                data-testid="button-save-edit"
              >
                <Save className="mr-1 h-3 w-3" />
                Opslaan
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelEdit}
                data-testid="button-cancel-edit"
              >
                <X className="mr-1 h-3 w-3" />
                Annuleren
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleStartEdit}
                data-testid="button-edit-result"
              >
                <Edit3 className="mr-1 h-3 w-3" />
                Bewerken
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={executeCurrentStage}
                disabled={executeStageM.isPending || isCreatingCase}
                data-testid="button-rerun-stage"
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                Opnieuw
              </Button>
            </>
          )}
        </div>
      </div>
      
      {editingStage === currentStage.key ? (
        <div className="space-y-2">
          <Textarea
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            className="min-h-[400px] font-mono text-sm"
            placeholder="Bewerk het resultaat hier..."
          />
          <p className="text-xs text-muted-foreground">
            Tip: Je kunt het resultaat handmatig aanpassen voordat je verder gaat.
          </p>
        </div>
      ) : (
        <>
          {viewMode === "concept" && conceptReportVersions[currentStage.key] ? (
            <div 
              className="p-6 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg shadow-sm max-h-[600px] overflow-y-auto"
              dangerouslySetInnerHTML={{ 
                __html: formatReportContent(conceptReportVersions[currentStage.key] || "") 
              }}
              data-testid="div-concept-report"
            />
          ) : (
            <div className="p-4 bg-muted/50 rounded-lg max-h-[600px] overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm font-mono" data-testid="pre-stage-result">
                {currentStageResult || "Geen resultaat beschikbaar"}
              </pre>
            </div>
          )}
        </>
      )}

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