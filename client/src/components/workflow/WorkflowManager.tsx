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
import { WorkflowView } from "./WorkflowView";
import { WORKFLOW_STAGES } from "./constants";
import { cleanStageResults } from "@/lib/stageResultsHelper";
import { isInformatieCheckComplete } from "@/lib/workflowParsers";
import type { Report, DossierData, BouwplanData } from "@shared/schema";
import type { Attachment } from "@/types/caseDetail.types";
import { isOcrPending } from "@/components/case-detail/AttachmentsTab";
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
  autoStart?: boolean; // Auto-start the first stage on mount
}

function WorkflowManagerContent({
  dossier,
  bouwplan,
  clientName,
  rawText,
  existingReport,
  onComplete,
  autoStart = false
}: WorkflowManagerProps) {
  const { state, dispatch } = useWorkflow();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const timerInterval = useRef<NodeJS.Timeout | null>(null);

  // Query attachments to check OCR status
  const reportId = existingReport?.id || state.currentReport?.id;
  const { data: attachmentsData } = useQuery<Attachment[]>({
    queryKey: [`/api/upload/attachments/${reportId}`],
    enabled: !!reportId,
    refetchInterval: 5000, // Poll every 5 seconds to check OCR status
  });

  // Check if any attachments have OCR pending
  const hasOcrPending = attachmentsData?.some(att => isOcrPending(att)) ?? false;

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

  // ✅ File size validation constants
  const MAX_FILE_SIZE_MB = 50;
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

  // Execute stage mutation
  const executeStageM = useMutation({
    mutationFn: async ({ reportId, stage, customInput, reportDepth, pendingAttachments }: { reportId: string; stage: string; customInput?: string; reportDepth?: string; pendingAttachments?: Array<{ file: File; name: string }> }) => {
      // Upload attachments first if present (only for Stage 1a re-run)
      if (pendingAttachments && pendingAttachments.length > 0 && stage === "1a_informatiecheck") {
        // ✅ Client-side file size validation
        const oversizedFiles = pendingAttachments.filter(pf => pf.file.size > MAX_FILE_SIZE_BYTES);
        if (oversizedFiles.length > 0) {
          const names = oversizedFiles
            .map(f => `${f.name} (${(f.file.size / 1024 / 1024).toFixed(1)}MB)`)
            .join(', ');
          throw new Error(`Bestand(en) te groot (max ${MAX_FILE_SIZE_MB}MB): ${names}`);
        }

        console.log(`📎 Uploading ${pendingAttachments.length} attachment(s) before Stage 1a re-run...`);

        const formData = new FormData();
        pendingAttachments.forEach((pf) => {
          formData.append('files', pf.file, pf.name);
        });

        const uploadResponse = await fetch(`/api/upload/attachments/${reportId}/batch`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          throw new Error(`Bijlage upload mislukt: ${errorText}`);
        }

        const uploadResult = await uploadResponse.json();
        console.log(`📎 Upload complete: ${uploadResult.data?.successful || 0} file(s) uploaded`);

        // Invalidate attachments query so the bijlage-tab updates
        queryClient.invalidateQueries({ queryKey: [`/api/upload/attachments/${reportId}`] });

        // Wait for OCR to complete on newly uploaded files before proceeding
        // This prevents the race condition where stage execution fails because OCR is still pending
        console.log(`⏳ Waiting for OCR to complete on uploaded files...`);
        const maxWaitMs = 120000; // 2 minutes max wait
        const pollIntervalMs = 2000; // Check every 2 seconds
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
          const attachmentsResponse = await fetch(`/api/upload/attachments/${reportId}`, {
            credentials: 'include',
          });
          if (attachmentsResponse.ok) {
            const attachmentsResult = await attachmentsResponse.json();
            const attachments = attachmentsResult.success ? attachmentsResult.data : attachmentsResult;
            const pendingOcr = attachments?.filter((att: any) => isOcrPending(att)) || [];

            if (pendingOcr.length === 0) {
              console.log(`✅ OCR complete for all attachments`);
              break;
            }

            console.log(`⏳ Still waiting for OCR: ${pendingOcr.length} file(s) pending...`);
          }

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }

        // Re-check one final time and throw if still pending
        const finalCheck = await fetch(`/api/upload/attachments/${reportId}`, { credentials: 'include' });
        if (finalCheck.ok) {
          const finalResult = await finalCheck.json();
          const finalAttachments = finalResult.success ? finalResult.data : finalResult;
          const stillPending = finalAttachments?.filter((att: any) => isOcrPending(att)) || [];
          if (stillPending.length > 0) {
            throw new Error(`OCR verwerking duurt te lang. ${stillPending.length} bijlage(n) worden nog verwerkt. Probeer later opnieuw.`);
          }
        }
      }

      const response = await apiRequest("POST", `/api/reports/${reportId}/stage/${stage}`, {
        customInput,
        reportDepth,
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
    onSuccess: async (data: any, variables) => {
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

      // Auto-trigger dossier context generation after Stage 1a completes
      if (variables.stage === "1a_informatiecheck" && updatedReport?.id) {
        // Check completion status FIRST, before any async operations
        const isComplete = isInformatieCheckComplete(stageResult);

        // Auto-trigger stage 1b (email generation) IMMEDIATELY if 1a is INCOMPLEET
        if (!isComplete) {
          console.log('📧 Stage 1a is INCOMPLEET - auto-triggering stage 1b (email generation)');
          dispatch({ type: "SET_STAGE_PROCESSING", stage: "1b_informatiecheck_email", isProcessing: true });

          // Execute 1b in background - don't wait
          executeStageM.mutate({
            reportId: updatedReport.id,
            stage: "1b_informatiecheck_email",
            customInput: undefined,
          });
        }

        // Trigger dossier context in background (don't block with await)
        console.log('📋 Stage 1a completed - triggering dossier context generation');
        apiRequest("POST", `/api/reports/${updatedReport.id}/dossier-context`, {})
          .then(() => {
            queryClient.invalidateQueries({ queryKey: [`/api/reports/${updatedReport.id}`] });
          })
          .catch((error) => {
            console.error('Failed to generate dossier context:', error);
          });
      }
      
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
        if (tempCurrentStage.key === "1a_informatiecheck") {
          // Stage 1a completes - check if COMPLEET or INCOMPLEET
          // Note: 1b email generation is auto-triggered in background, no UI stage change needed
          const isComplete = isInformatieCheckComplete(stageResult);
          if (isComplete) {
            // COMPLEET: Go to stage 2
            nextIndex = WORKFLOW_STAGES.findIndex(s => s.key === "2_complexiteitscheck");
            console.log(`✅ Stage 1a is COMPLEET - advancing to stage 2 (index ${nextIndex})`);
          } else {
            // INCOMPLEET: Stay at stage 1a, 1b runs in background and shows inline
            nextIndex = tempCurrentIndex;
            console.log(`📧 Stage 1a is INCOMPLEET - staying at 1a, email generates in background`);
          }
        }
        else if (variables.stage === "1b_informatiecheck_email") {
          // 1b completed in background - no stage change needed, result shows inline in 1a
          nextIndex = state.currentStageIndex;
          console.log(`📧 Stage 1b email generated - displayed inline in stage 1a`);
        }
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
    if (currentStage.key === "1a_informatiecheck") {
      // Check if stage 1a is complete to determine next stage
      const stage1aResult = state.stageResults["1a_informatiecheck"];
      const isComplete = isInformatieCheckComplete(stage1aResult);
      if (isComplete) {
        // COMPLEET: go to stage 2
        return WORKFLOW_STAGES.findIndex(s => s.key === "2_complexiteitscheck");
      }
      // INCOMPLEET: stay at 1a (1b runs in background and shows inline)
      return currentIndex;
    }
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
    // Only load if we don't have a current report OR if the report ID changed
    const shouldLoad = existingReport && (!state.currentReport || state.currentReport.id !== existingReport.id);

    if (shouldLoad) {
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

      // Check if stage 1 is INCOMPLEET - if so, stay at stage 1a
      let newStageIndex = Math.min(lastCompletedIndex + 1, WORKFLOW_STAGES.length - 1);

      const stageResults = existingReport.stageResults as Record<string, string> || {};
      const stage1aResult = stageResults["1a_informatiecheck"];

      // If stage 1a exists and is INCOMPLEET, stay at stage 1a (email shows inline)
      if (stage1aResult && !isInformatieCheckComplete(stage1aResult)) {
        console.log(`⚠️ Stage 1a is INCOMPLEET - staying at stage 1a (email shown inline)`);
        newStageIndex = 0; // Stay at stage 1a

        // Auto-trigger 1b if it hasn't been run yet
        const stage1bResult = stageResults["1b_informatiecheck_email"];
        if (!stage1bResult) {
          console.log('📧 Stage 1b not yet run - auto-triggering email generation');
          dispatch({ type: "SET_STAGE_PROCESSING", stage: "1b_informatiecheck_email", isProcessing: true });

          // Execute 1b in background
          executeStageM.mutate({
            reportId: existingReport.id,
            stage: "1b_informatiecheck_email",
            customInput: undefined,
          });
        }
      }

      console.log(`🔄 Stage index calculation:`, {
        completedStages,
        lastCompletedIndex,
        newStageIndex,
        stage1aComplete: stage1aResult ? isInformatieCheckComplete(stage1aResult) : 'N/A',
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
  }, [existingReport, state.currentReport, createReportMutation, dispatch, executeStageM]);

  // Auto-start first stage if autoStart is true (but NOT if OCR is pending)
  useEffect(() => {
    const isAnyStageProcessing = Object.values(state.stageProcessing).some(v => v);

    // Block auto-start if OCR is still pending
    if (hasOcrPending) {
      console.log('⏳ Auto-start blocked: OCR still pending for attachments');
      return;
    }

    if (autoStart && state.currentReport && state.currentStageIndex === 0 && !isAnyStageProcessing) {
      const stageResults = state.currentReport.stageResults as Record<string, string> || {};
      const firstStageKey = WORKFLOW_STAGES[0].key;

      // Only auto-start if stage 1 hasn't been executed yet
      if (!stageResults[firstStageKey]) {
        console.log('🚀 Auto-starting first stage:', firstStageKey);
        executeStageM.mutate({
          reportId: state.currentReport.id,
          stage: firstStageKey,
          customInput: undefined,
        });
      }
    }
  }, [autoStart, state.currentReport, state.currentStageIndex, state.stageProcessing, hasOcrPending, executeStageM]);

  const currentStage = WORKFLOW_STAGES[state.currentStageIndex];
  const progressPercentage = Math.round((Object.keys(state.stageResults).length / WORKFLOW_STAGES.length) * 100);
  const isWorkflowComplete = Object.keys(state.stageResults).length === WORKFLOW_STAGES.length;

  return (
    <WorkflowView
      state={state}
      dispatch={dispatch}
      executeStageM={executeStageM as any}
      executeSubstepM={executeSubstepM}
      isCreatingCase={createReportMutation.isPending}
      rawText={rawText}
      clientName={clientName}
      getStageStatus={getStageStatus}
      hasOcrPending={hasOcrPending}
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