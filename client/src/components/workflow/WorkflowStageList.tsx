import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle,
  ArrowRight,
  Clock,
  ChevronRight
} from "lucide-react";
import { WORKFLOW_STAGES, WorkflowStage } from "./constants";
import type { Report } from "@shared/schema";
import type { UseMutationResult } from "@tanstack/react-query";

// Type definitions for mutations
interface ExecuteStageVariables {
  reportId: string;
  stage: string;
  customInput?: string;
}

interface ExecuteSubstepVariables {
  substepKey: string;
  substepType: "review" | "processing";
  reportId: string;
}

interface WorkflowStageListProps {
  currentStageIndex: number;
  stageResults: Record<string, string>;
  substepResults: Record<string, { review?: string; processing?: string }>;
  stageTimes: Record<string, number>;
  stageProcessing: Record<string, boolean>;
  currentStageTimer: number;
  executeStageM: UseMutationResult<any, Error, ExecuteStageVariables, unknown>;
  executeSubstepM: UseMutationResult<any, Error, ExecuteSubstepVariables, unknown>;
  currentReport: Report | null;
  onStageClick: (index: number) => void;
  getStageStatus: (index: number) => "completed" | "current" | "pending";
}

export function WorkflowStageList({
  currentStageIndex,
  stageResults,
  substepResults,
  stageTimes,
  stageProcessing,
  currentStageTimer,
  executeStageM,
  executeSubstepM,
  currentReport,
  onStageClick,
  getStageStatus
}: WorkflowStageListProps) {
  return (
    <div className="relative">
      {/* Progress line */}
      <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary via-primary/50 to-transparent"></div>
      <div className="grid gap-0">
        {WORKFLOW_STAGES.map((stage: WorkflowStage, index: number) => {
          const status = getStageStatus(index);
          
          return (
            <div
              key={stage.key}
              className={`relative flex items-center p-4 cursor-pointer transition-all hover:bg-accent/50 border-l-4 ${
                status === "current" 
                  ? executeStageM.isPending && index === currentStageIndex
                    ? "bg-orange-50 dark:bg-orange-950/20 border-l-orange-500"
                    : "bg-primary/5 border-l-primary" 
                  : status === "completed" 
                  ? "bg-green-50/50 dark:bg-green-950/10 border-l-green-500" 
                  : "bg-background border-l-transparent opacity-60"
              }`}
              onClick={() => status !== "pending" && onStageClick(index)}
              data-testid={`stage-${stage.key}`}
            >
              <div className={`z-10 w-10 h-10 rounded-full flex items-center justify-center mr-3 ring-4 ring-background transition-all ${
                status === "completed" ? "bg-gradient-to-br from-green-500 to-green-600 text-white shadow-green-200 shadow-lg" :
                status === "current" ? 
                  executeStageM.isPending && index === currentStageIndex ?
                    "bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-orange-200 shadow-lg animate-pulse" : 
                    "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-primary/20 shadow-lg" :
                "bg-muted text-muted-foreground"
              }`}>
                {status === "completed" ? (
                  <CheckCircle className="h-5 w-5" />
                ) : status === "current" ? (
                  executeStageM.isPending && index === currentStageIndex ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <ArrowRight className="h-5 w-5" />
                  )
                ) : (
                  <span className="text-xs font-bold">{index + 1}</span>
                )}
              </div>
              
              <div className="flex-1">
                <div className="font-medium flex items-center gap-2">
                  {stage.label}
                  {/* Show timer for completed stages */}
                  {stageTimes[stage.key] && (
                    <Badge variant="secondary" className="text-xs font-normal">
                      <Clock className="h-3 w-3 mr-1" />
                      {stageTimes[stage.key]}s
                    </Badge>
                  )}
                  {/* Show live timer for processing stages */}
                  {stageProcessing[stage.key] && (
                    <Badge variant="default" className="text-xs font-normal animate-pulse">
                      <Clock className="h-3 w-3 mr-1 animate-spin" />
                      {currentStageTimer}s
                    </Badge>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">{stage.description}</div>
                
                {/* Show substeps for reviewer stages */}
                {'substeps' in stage && stage.substeps && status === "current" && (
                  <div className="mt-2 space-y-1">
                    {stage.substeps.map((substep) => {
                      const substepResultsForStage = substepResults[stage.key] || {};
                      const hasReviewResult = !!substepResultsForStage.review;
                      const hasProcessingResult = !!substepResultsForStage.processing;
                      const isReviewSubstep = substep.type === "review";
                      const isProcessingSubstep = substep.type === "processing";
                      
                      const isCompleted = isReviewSubstep ? hasReviewResult : hasProcessingResult;
                      const canExecute = status === "current" && 
                                       (isReviewSubstep || (isProcessingSubstep && hasReviewResult));
                      const trackingKey = `${isReviewSubstep ? stage.key : "5_feedback_verwerker"}_${substep.type}`;
                      const isExecuting = stageProcessing[trackingKey] || (executeSubstepM.isPending && 
                                       executeSubstepM.variables?.substepType === substep.type);
                      const substepTime = stageTimes[trackingKey];
                      
                      return (
                        <div 
                          key={`${substep.key}-${substep.type}`} 
                          className={`flex items-center justify-between text-xs p-2 rounded border transition-all ${
                            canExecute ? "cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/20 border-blue-200" :
                            isCompleted ? "bg-green-50 dark:bg-green-950/20 border-green-200" :
                            "border-gray-200"
                          }`}
                          onClick={() => canExecute && currentReport && executeSubstepM.mutate({
                            substepKey: isReviewSubstep ? stage.key : "5_feedback_verwerker",
                            substepType: substep.type,
                            reportId: currentReport.id
                          })}
                        >
                          <div className="flex items-center flex-1">
                            <div className={`w-3 h-3 rounded-full mr-2 ${
                              isCompleted ? "bg-green-400" :
                              isExecuting ? "bg-orange-400 animate-pulse" :
                              canExecute ? "bg-blue-400" :
                              "bg-gray-300"
                            }`}></div>
                            <span className={`${
                              isCompleted ? "text-green-600 dark:text-green-400" :
                              canExecute || isExecuting ? "text-blue-600 dark:text-blue-400" :
                              "text-muted-foreground"
                            }`}>
                              {substep.label}
                            </span>
                            {/* Show timer for substep */}
                            {substepTime && (
                              <span className="ml-2 text-[10px] text-muted-foreground">
                                ({substepTime}s)
                              </span>
                            )}
                            {isExecuting && (
                              <span className="ml-2 text-[10px] text-orange-500 font-medium">
                                ({currentStageTimer}s)
                              </span>
                            )}
                          </div>
                          
                          {canExecute && (
                            <ChevronRight className="h-3 w-3 text-blue-400" />
                          )}
                          
                          {isExecuting && (
                            <div className="w-3 h-3 border-2 border-orange-400 border-t-transparent rounded-full animate-spin"></div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {status === "current" && executeStageM.isPending && index === currentStageIndex && (
                  <div className="text-xs text-orange-600 dark:text-orange-400 mt-1 font-medium flex items-center gap-1">
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                    AI bezig... {currentStageTimer}s
                  </div>
                )}
              </div>
              
              {/* Status indicator on the right */}
              <div className="ml-auto flex items-center gap-2">
                {status === "current" && !executeStageM.isPending && (
                  <Badge variant="default" className="animate-pulse">
                    Actief
                  </Badge>
                )}
                {status === "completed" && (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}