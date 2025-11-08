import React, { useState, useEffect, useCallback, memo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Clock, Workflow, AlertCircle, FileText, CheckCircle } from "lucide-react";
import { WorkflowProvider, useWorkflow } from "./WorkflowContext";
import { SimplifiedWorkflowView } from "./SimplifiedWorkflowView";
import { WORKFLOW_STAGES } from "./constants";
import { cleanStageResults } from "@/lib/stageResultsHelper";
import { isInformatieCheckComplete } from "@/lib/workflowParsers";
import type { Report, DossierData, BouwplanData } from "@shared/schema";
import {
  handleStageCompletion,
  handleSubstepCompletion,
  handleMutationError,
  handleStageStart,
  handleSubstepStart
} from "@/lib/mutationHelpers";
import { ErrorBoundary, WorkflowErrorFallback } from "@/components/ErrorBoundary";

interface WorkflowManagerProps {
  dossier: DossierData;
  bouwplan: BouwplanData;
  clientName: string;
  rawText: string;
  existingReport?: Report;
  onComplete: (report: Report) => void;
}

function WorkflowManagerContent({
  dossier,
  bouwplan,
  clientName,
  rawText,
  existingReport,
  onComplete
}: WorkflowManagerProps) {
  const { state, dispatch } = useWorkflow();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const timerInterval = useRef<NodeJS.Timeout | null>(null);

  // Timer effect
  useEffect(() => {
    if (state.stageStartTime) {
      timerInterval.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - state.stageStartTime!.getTime()) / 1000);
        dispatch({ type: "UPDATE_TIMER", time: elapsed });
      }, 1000);
    } else {
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
        timerInterval.current = null;
      }
    }
    
    return () => {
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
      }
    };
  }, [state.stageStartTime, dispatch]);

  // Create report mutation
  const createReportMutation = useMutation({
    mutationFn: async () => {
      console.log("📤 Sending create report request:", {
        hasClientName: !!clientName,
        clientName,
        hasRawText: !!rawText,
        rawTextLength: rawText?.length,
        hasDossier: !!dossier,
        hasBouwplan: !!bouwplan
      });

      const response = await apiRequest("POST", "/api/reports/create", {
        clientName,
        rawText,
      });
      const data = await response.json();
      console.log("📥 Create report response:", { success: data.success, hasData: !!data.data });

      // Handle API response format - extract report from success response or use data directly
      const report = (data && typeof data === 'object' && 'success' in data && data.success === true) ? data.data : data;
      return report as Report;
    },
    onMutate: () => {
      dispatch({ type: "SET_STAGE_PROCESSING", stage: "validation", isProcessing: true });
      dispatch({ type: "SET_STAGE_START_TIME", time: new Date() });
      dispatch({ type: "UPDATE_TIMER", time: 0 });
    },
    onSuccess: (report: Report) => {
      console.log("🎯 Report created successfully:", { reportId: report.id, hasId: !!report.id, report });

      // Save report ID in session FIRST to prevent race conditions
      if (report.id) {
        sessionStorage.setItem('current-workflow-report-id', report.id);
      } else {
        console.error("❌ Report created without ID!", report);
      }

      // Save validation time
      if (state.stageStartTime) {
        const elapsed = Math.floor((Date.now() - state.stageStartTime.getTime()) / 1000);
        dispatch({ type: "SET_STAGE_TIME", stage: "validation", time: elapsed });
      }
      dispatch({ type: "SET_STAGE_PROCESSING", stage: "validation", isProcessing: false });
      dispatch({ type: "SET_REPORT", payload: report });

      // Clean stage results to ensure we only have the latest for each stage
      const cleanedStageResults = cleanStageResults(report.stageResults as Record<string, string> || {});
      const reportWithCleanedResults = {
        ...report,
        stageResults: cleanedStageResults
      };

      console.log("🔄 Dispatching LOAD_EXISTING_REPORT with:", {
        reportId: reportWithCleanedResults.id,
        hasId: !!reportWithCleanedResults.id
      });
      dispatch({ type: "LOAD_EXISTING_REPORT", report: reportWithCleanedResults });
      
      // Auto-start first step
      setTimeout(() => {
        dispatch({ type: "SET_STAGE_START_TIME", time: new Date() });
        dispatch({ type: "UPDATE_TIMER", time: 0 });
        
        const firstStage = WORKFLOW_STAGES[0];
        executeStageM.mutate({
          reportId: report.id,
          stage: firstStage.key,
          customInput: undefined,
        });
      }, 100);
    },
    onError: (error: Error) => {
      dispatch({ type: "SET_STAGE_PROCESSING", stage: "validation", isProcessing: false });
      toast({
        title: "Fout bij aanmaken",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Execute stage mutation
  const executeStageM = useMutation({
    mutationFn: async ({ reportId, stage, customInput }: { reportId: string; stage: string; customInput?: string }) => {
      const response = await apiRequest("POST", `/api/reports/${reportId}/stage/${stage}`, {
        customInput,
      });
      const data = await response.json();

      // Handle new API response format (wrapped in createApiSuccessResponse)
      if (data && typeof data === 'object' && 'success' in data && data.success === true) {
        return data.data;
      }
      return data;
    },
    onMutate: ({ stage }) => {
      handleStageStart(stage, { dispatch });
    },
    onSuccess: (data: any, variables) => {
      // Use centralized handler
      handleStageCompletion(data, variables, {
        dispatch,
        queryClient,
        toast,
        currentReport: state.currentReport,
        stageStartTime: state.stageStartTime
      });

      const currentStage = WORKFLOW_STAGES[state.currentStageIndex];
      const stageResult = data.stageResult || data.stageOutput || "";
      const updatedReport = data.report;
      
      // Only auto-advance if we're still on the same stage that was executed
      console.log(`🎯 Auto-advance evaluation: executedStage="${variables.stage}", currentStageKey="${currentStage.key}", currentIndex=${state.currentStageIndex}`);
      if (variables.stage === currentStage.key) {
        // Compute next index based on updated state that includes the new result
        const updatedStageResults = {
          ...state.stageResults,
          [variables.stage]: stageResult,
          ...((updatedReport?.stageResults as Record<string, string>) || {})
        };
        
        // Calculate next index using a temporary state with updated results
        const tempCurrentIndex = state.currentStageIndex;
        const tempCurrentStage = WORKFLOW_STAGES[tempCurrentIndex];
        
        let nextIndex = tempCurrentIndex;
        if (tempCurrentStage.key === "1_informatiecheck") nextIndex = tempCurrentIndex + 1;
        else if (tempCurrentStage.key === "2_complexiteitscheck") nextIndex = tempCurrentIndex + 1;
        else if (tempCurrentStage.key === "3_generatie") {
          nextIndex = WORKFLOW_STAGES.findIndex(s => s.key === "4a_BronnenSpecialist");
        }
        
        console.log(`🎯 Auto-advance check: current=${state.currentStageIndex}, next=${nextIndex}, stage=${variables.stage}`);
        console.log(`🎯 Stage results after completion:`, Object.keys(updatedStageResults));
        // AUTO-ADVANCE DISABLED: User moet zelf op "Volgende Stap" klikken om output te kunnen bekijken
        // if (nextIndex !== state.currentStageIndex) {
        //   console.log(`✅ Auto-advancing from stage ${state.currentStageIndex} to ${nextIndex}`);
        //   dispatch({ type: "SET_STAGE_INDEX", payload: nextIndex });
        // } else {
        //   console.log(`⏸️ No auto-advance: already at target index ${nextIndex}`);
        // }
      } else {
        console.log(`⚠️ No auto-advance: executed stage "${variables.stage}" != current stage "${currentStage.key}"`);
      }
    },
    onError: (error: Error, variables) => {
      handleMutationError(error, { stage: variables.stage }, { dispatch, toast });
    },
  });

  // Execute substep mutation
  const executeSubstepM = useMutation({
    mutationFn: async ({ substepKey, substepType, reportId, customInput }: { substepKey: string; substepType: "review" | "processing"; reportId: string; customInput?: string }) => {
      const endpoint = substepType === "review" ? substepKey : "5_feedback_verwerker";
      const response = await apiRequest("POST", `/api/reports/${reportId}/stage/${endpoint}`, {
        customInput: customInput || state.customInput,
      });
      const data = await response.json();
      // Handle new API response format
      const responseData = data && typeof data === 'object' && 'success' in data && data.success === true ? data.data : data;
      return { type: substepType, data: responseData };
    },
    onMutate: ({ substepKey, substepType }) => {
      const trackingKey = `${substepType === "review" ? substepKey : "5_feedback_verwerker"}_${substepType}`;
      dispatch({ type: "SET_STAGE_PROCESSING", stage: trackingKey, isProcessing: true });
      dispatch({ type: "SET_STAGE_START_TIME", time: new Date() });
      dispatch({ type: "UPDATE_TIMER", time: 0 });
    },
    onSuccess: async (result, variables) => {
      const trackingKey = `${variables.substepType === "review" ? variables.substepKey : "5_feedback_verwerker"}_${variables.substepType}`;
      
      // Save time for this substep
      if (state.stageStartTime) {
        const elapsed = Math.floor((Date.now() - state.stageStartTime.getTime()) / 1000);
        dispatch({ type: "SET_STAGE_TIME", stage: trackingKey, time: elapsed });
      }
      
      dispatch({ type: "SET_STAGE_PROCESSING", stage: trackingKey, isProcessing: false });
      const data = result.data;
      
      if (result.type === "review") {
        dispatch({ type: "SET_SUBSTEP_RESULT", stage: variables.substepKey, substepType: "review", result: data.stageResult });
      } else {
        const currentStage = WORKFLOW_STAGES[state.currentStageIndex];
        dispatch({ type: "SET_SUBSTEP_RESULT", stage: currentStage.key, substepType: "processing", result: data.stageResult });
        if (data.conceptReport) {
          dispatch({ type: "SET_CONCEPT_VERSION", stage: currentStage.key, content: data.conceptReport });
        }
      }
      
      toast({
        title: "Substap voltooid",
        description: result.type === "review" ? "Review voltooid" : "Feedback verwerkt",
      });
      
      // Check if both substeps are done and auto-advance
      const currentStage = WORKFLOW_STAGES[state.currentStageIndex];
      const substepResults = { ...state.substepResults[currentStage.key] };
      if (result.type === "review") {
        substepResults.review = data.stageResult;
      } else {
        substepResults.processing = data.stageResult;
      }
      
      // AUTO-ADVANCE DISABLED: User moet zelf op "Volgende Stap" klikken
      // if (substepResults.review && substepResults.processing) {
      //   const nextIndex = getNextStageIndex();
      //   if (nextIndex !== state.currentStageIndex) {
      //     dispatch({ type: "SET_STAGE_INDEX", payload: nextIndex });
      //   }
      // }
    },
    onError: (error: Error, variables) => {
      const trackingKey = `${variables.substepType === "review" ? variables.substepKey : "5_feedback_verwerker"}_${variables.substepType}`;
      handleMutationError(error, { stage: trackingKey }, { dispatch, toast });
    },
  });

  // Finalize report mutation
  const finalizeReportMutation = useMutation({
    mutationFn: async (reportId: string) => {
      const response = await apiRequest("POST", `/api/reports/${reportId}/finalize`);
      const data = await response.json();
      // Handle new API response format
      if (data && typeof data === 'object' && 'success' in data && data.success === true) {
        return data.data;
      }
      return data;
    },
    onSuccess: (report: Report) => {
      dispatch({ type: "SET_REPORT", payload: report });
      onComplete(report);
      toast({
        title: "Rapport voltooid",
        description: "Het fiscaal duidingsrapport is succesvol gegenereerd.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Fout bij finaliseren",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Helper functions
  const getStageStatus = (index: number): "completed" | "current" | "pending" => {
    const stage = WORKFLOW_STAGES[index];
    if (!stage) return "pending";
    
    // Check if this stage has results (completed)
    const hasStageResult = !!state.stageResults[stage.key];
    const hasConceptReport = !!state.conceptReportVersions[stage.key];
    const isCompleted = hasStageResult || (stage.key === "3_generatie" && hasConceptReport);
    
    if (isCompleted) return "completed";
    if (index === state.currentStageIndex) return "current";
    return "pending";
  };

  const getNextStageIndex = (): number => {
    const currentStage = WORKFLOW_STAGES[state.currentStageIndex];
    const currentIndex = state.currentStageIndex;
    const reviewerStages = WORKFLOW_STAGES
      .filter(s => s.type === "reviewer")
      .map(s => s.key);
    
    // Linear flow for initial stages
    if (currentStage.key === "1_informatiecheck") return currentIndex + 1;
    if (currentStage.key === "2_complexiteitscheck") return currentIndex + 1;
    if (currentStage.key === "3_generatie") {
      return WORKFLOW_STAGES.findIndex(s => s.key === "4a_BronnenSpecialist");
    }
    
    // For reviewer stages, only go to next if both substeps are completed
    if (currentStage.type === "reviewer") {
      const substepResultsForStage = state.substepResults[currentStage.key] || {};
      const bothSubstepsCompleted = substepResultsForStage.review && substepResultsForStage.processing;
      
      if (!bothSubstepsCompleted) {
        return currentIndex;
      }
      
      const currentReviewerIndex = reviewerStages.indexOf(currentStage.key);
      
      if (currentReviewerIndex < reviewerStages.length - 1) {
        const nextReviewerStage = reviewerStages[currentReviewerIndex + 1];
        return WORKFLOW_STAGES.findIndex(s => s.key === nextReviewerStage);
      } else {
        return WORKFLOW_STAGES.findIndex(s => s.key === "final_check");
      }
    }
    
    // Final check is last stage
    if (currentStage.key === "final_check") {
      return currentIndex;
    }
    
    return currentIndex + 1;
  };

  // Initialize with existing report
  useEffect(() => {
    if (existingReport && !state.currentReport) {
      // Clean stage results to ensure we only have the latest for each stage
      const cleanedStageResults = cleanStageResults(existingReport.stageResults as Record<string, string> || {});
      const reportWithCleanedResults = {
        ...existingReport,
        stageResults: cleanedStageResults
      };
      
      console.log(`🔄 Loading existing report:`, { 
        reportId: existingReport.id, 
        hasStageResults: !!existingReport.stageResults,
        stageResultKeys: Object.keys(existingReport.stageResults as Record<string, string> || {})
      });
      
      dispatch({ type: "LOAD_EXISTING_REPORT", report: reportWithCleanedResults });
      
      // Set current stage index based on completed stages
      const completedStages = Object.keys(existingReport.stageResults as Record<string, string> || {});
      const lastCompletedIndex = completedStages.length > 0
        ? Math.max(...completedStages.map(stage => WORKFLOW_STAGES.findIndex(s => s.key === stage)))
        : -1;

      // Check if stage 1 is INCOMPLEET - if so, stay at stage 1
      let newStageIndex = Math.min(lastCompletedIndex + 1, WORKFLOW_STAGES.length - 1);

      const stageResults = existingReport.stageResults as Record<string, string> || {};
      const stage1Result = stageResults["1_informatiecheck"];

      // If stage 1 exists and is INCOMPLEET, stay at stage 1 (index 0)
      if (stage1Result && !isInformatieCheckComplete(stage1Result)) {
        console.log(`⚠️ Stage 1 is INCOMPLEET - staying at stage 1`);
        newStageIndex = 0; // Force to stage 1
      }

      console.log(`🔄 Stage index calculation:`, {
        completedStages,
        lastCompletedIndex,
        newStageIndex,
        stage1Complete: stage1Result ? isInformatieCheckComplete(stage1Result) : 'N/A',
        workflowStages: WORKFLOW_STAGES.map(s => s.key)
      });

      dispatch({ type: "SET_STAGE_INDEX", payload: newStageIndex });
      
      sessionStorage.setItem('current-workflow-report-id', existingReport.id);
    } else if (!existingReport && !state.currentReport && !createReportMutation.isPending) {
      // Auto-start workflow for new reports
      const sessionReportId = sessionStorage.getItem('current-workflow-report-id');
      if (!sessionReportId) {
        setTimeout(() => {
          if (!state.currentReport && !createReportMutation.isPending) {
            createReportMutation.mutate();
          }
        }, 100);
      }
    }
  }, [existingReport, state.currentReport, createReportMutation, dispatch]);

  const currentStage = WORKFLOW_STAGES[state.currentStageIndex];
  const progressPercentage = Math.round((Object.keys(state.stageResults).length / WORKFLOW_STAGES.length) * 100);
  const isWorkflowComplete = Object.keys(state.stageResults).length === WORKFLOW_STAGES.length;

  return (
    <SimplifiedWorkflowView
      state={state}
      dispatch={dispatch}
      executeStageM={executeStageM}
      executeSubstepM={executeSubstepM}
      isCreatingCase={createReportMutation.isPending}
      rawText={rawText}
      clientName={clientName}
      getStageStatus={getStageStatus}
    />
  );
}

// Main export with provider wrapper and error boundary
export default memo(function WorkflowManager(props: WorkflowManagerProps) {
  return (
    <ErrorBoundary
      fallback={(error) => (
        <WorkflowErrorFallback
          error={error}
          onReset={() => window.location.reload()}
        />
      )}
      onError={(error, errorInfo) => {
        console.error("🛡️ Error Boundary caught workflow error:", {
          error,
          errorInfo,
          componentStack: errorInfo.componentStack
        });
      }}
    >
      <WorkflowProvider>
        <WorkflowManagerContent {...props} />
      </WorkflowProvider>
    </ErrorBoundary>
  );
});