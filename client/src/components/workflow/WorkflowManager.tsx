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
import type { Report, DossierData, BouwplanData } from "@shared/schema";

// Format plain text/markdown to professional fiscal report HTML - ONLY styling, no structure changes
function formatReportContent(content: string): string {
  if (!content) return "";
  
  // Just apply styling to whatever content comes from AI - no structural changes
  return content
    // Headers - professional styling without changing structure
    .replace(/^#{3}\s+(.+)$/gm, '<h3 class="text-lg font-bold text-gray-900 mt-8 mb-3 border-b border-gray-300 pb-2">$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2 class="text-xl font-bold text-gray-900 mt-10 mb-4 border-b-2 border-blue-600 pb-3">$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1 class="text-2xl font-bold text-gray-900 mt-10 mb-6">$1</h1>')
    
    // Special title patterns from PDF
    .replace(/^(Fiscale Analyse.*?)$/m, '<h1 class="text-3xl font-bold text-gray-900 mb-4 text-center">$1</h1>')
    .replace(/^(Uw vraag beantwoord)$/gm, '<h2 class="text-xl font-bold text-gray-900 mt-10 mb-4 text-blue-700">$1</h2>')
    
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-gray-900">$1</strong>')
    .replace(/\*([^\*]+?)\*/g, '<em class="italic text-gray-700">$1</em>')
    
    // Bullet lists - professional indentation
    .replace(/^[\*\-•]\s+(.+)$/gm, '<li class="ml-8 mb-2 text-gray-700 leading-relaxed">$1</li>')
    .replace(/(<li class="ml-8.*?<\/li>\s*)+/g, '<ul class="mb-6 list-disc list-outside pl-2">$&</ul>')
    
    // Numbered lists  
    .replace(/^\d+\.\s+(.+)$/gm, '<li class="ml-8 mb-2 text-gray-700 leading-relaxed">$1</li>')
    .replace(/(<li class="ml-8 mb-2 text-gray-700.*?<\/li>\s*)+/g, '<ol class="mb-6 list-decimal list-outside pl-2">$&</ol>')
    
    // Quotes and special sections
    .replace(/^>\s+(.+)$/gm, '<blockquote class="border-l-4 border-blue-500 pl-4 py-2 my-4 bg-blue-50 dark:bg-blue-950/20 italic text-gray-700">$1</blockquote>')
    
    // Professional line breaks
    .replace(/\n\n/g, '</p><p class="mb-4 text-gray-700 leading-relaxed">')
    .replace(/^(.+)$/gm, (match) => {
      if (!match.includes('<')) {
        return `<p class="mb-4 text-gray-700 leading-relaxed">${match}</p>`;
      }
      return match;
    });
}

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
      const data = await apiRequest("POST", "/api/reports/create", {
        dossier,
        bouwplan,
        clientName,
        rawText,
      }) as unknown as Report;
      return data;
    },
    onMutate: () => {
      dispatch({ type: "SET_STAGE_PROCESSING", stage: "validation", isProcessing: true });
      dispatch({ type: "SET_STAGE_START_TIME", time: new Date() });
      dispatch({ type: "UPDATE_TIMER", time: 0 });
    },
    onSuccess: (report: Report) => {
      // Save report ID in session FIRST to prevent race conditions
      sessionStorage.setItem('current-workflow-report-id', report.id);
      
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
      const data = await apiRequest("POST", `/api/reports/${reportId}/stage/${stage}`, {
        customInput,
      });
      return data;
    },
    onMutate: ({ stage }) => {
      dispatch({ type: "SET_STAGE_PROCESSING", stage, isProcessing: true });
      dispatch({ type: "SET_STAGE_START_TIME", time: new Date() });
      dispatch({ type: "UPDATE_TIMER", time: 0 });
    },
    onSuccess: (data: any, variables) => {
      // Handle both old and new API response formats
      const stageResult = data.stageResult || data.stageOutput || "";
      const conceptReport = data.conceptReport;
      const updatedReport = data.report;
      const prompt = data.prompt || "";
      
      console.log("✅ ExecuteStage Success:", { 
        stage: variables.stage, 
        stageResult: stageResult?.slice(0, 100) + "...",
        hasConceptReport: !!conceptReport,
        hasReport: !!updatedReport,
        hasPrompt: !!prompt
      });
      
      // Store the prompt that was sent to AI
      if (prompt) {
        dispatch({ type: "SET_STAGE_PROMPT", stage: variables.stage, prompt });
      }
      
      if (updatedReport) {
        dispatch({ type: "SET_REPORT", payload: updatedReport });
        // Refresh stage results from the updated report
        dispatch({ type: "LOAD_EXISTING_REPORT", report: updatedReport });
      }
      
      const currentStage = WORKFLOW_STAGES[state.currentStageIndex];
      
      // Save the time this stage took
      if (state.stageStartTime) {
        const elapsed = Math.floor((Date.now() - state.stageStartTime.getTime()) / 1000);
        dispatch({ type: "SET_STAGE_TIME", stage: variables.stage, time: elapsed });
      }
      
      dispatch({ type: "SET_STAGE_PROCESSING", stage: variables.stage, isProcessing: false });
      
      // Always update the result for the executed stage
      if (stageResult) {
        dispatch({ type: "SET_STAGE_RESULT", stage: variables.stage, result: stageResult });
      }
      
      // Update concept report versions if provided
      if (conceptReport) {
        dispatch({ type: "SET_CONCEPT_VERSION", stage: variables.stage, content: conceptReport });
      }
      
      // Show completion toast
      const stageInfo = WORKFLOW_STAGES.find(s => s.key === variables.stage);
      toast({
        title: "Stap voltooid",
        description: `${stageInfo?.label || variables.stage} is succesvol uitgevoerd.`,
      });
      
      // Only auto-advance if we're still on the same stage that was executed
      if (variables.stage === currentStage.key) {
        const nextIndex = getNextStageIndex();
        console.log(`🎯 Auto-advance check: current=${state.currentStageIndex}, next=${nextIndex}, stage=${variables.stage}`);
        if (nextIndex !== state.currentStageIndex) {
          console.log(`✅ Auto-advancing from stage ${state.currentStageIndex} to ${nextIndex}`);
          dispatch({ type: "SET_STAGE_INDEX", payload: nextIndex });
        }
      }
    },
    onError: (error: Error, variables) => {
      dispatch({ type: "SET_STAGE_PROCESSING", stage: variables.stage, isProcessing: false });
      toast({
        title: "Fout bij uitvoeren stap",
        description: error.message,
        variant: "destructive",
      });
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
      
      if (substepResults.review && substepResults.processing) {
        const nextIndex = getNextStageIndex();
        if (nextIndex !== state.currentStageIndex) {
          dispatch({ type: "SET_STAGE_INDEX", payload: nextIndex });
        }
      }
    },
    onError: (error: Error, variables) => {
      const trackingKey = `${variables.substepType === "review" ? variables.substepKey : "5_feedback_verwerker"}_${variables.substepType}`;
      dispatch({ type: "SET_STAGE_PROCESSING", stage: trackingKey, isProcessing: false });
      toast({
        title: "Fout bij uitvoeren substap",
        description: error.message,
        variant: "destructive",
      });
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
    if (index < state.currentStageIndex) return "completed";
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
      
      dispatch({ type: "LOAD_EXISTING_REPORT", report: reportWithCleanedResults });
      
      // Set current stage index based on completed stages
      const completedStages = Object.keys(existingReport.stageResults as Record<string, string> || {});
      const lastCompletedIndex = completedStages.length > 0 
        ? Math.max(...completedStages.map(stage => WORKFLOW_STAGES.findIndex(s => s.key === stage)))
        : -1;
      dispatch({ type: "SET_STAGE_INDEX", payload: Math.min(lastCompletedIndex + 1, WORKFLOW_STAGES.length - 1) });
      
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
    />
  );
}

// Main export with provider wrapper
export default memo(function WorkflowManager(props: WorkflowManagerProps) {
  return (
    <WorkflowProvider>
      <WorkflowManagerContent {...props} />
    </WorkflowProvider>
  );
});