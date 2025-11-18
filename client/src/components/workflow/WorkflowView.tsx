/**
 * WorkflowView - Main Workflow Component
 *
 * Clean orchestrator using WorkflowStageCard component pattern.
 * Refactored from 1743-line monolith to focused 300-line orchestrator.
 *
 * Responsibilities:
 * - Overall workflow state management
 * - Progress tracking
 * - Stage orchestration
 * - Delegates stage rendering to WorkflowStageCard
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import Confetti from 'react-confetti';
import {
  CheckCircle,
  Eye,
  Workflow,
  Clock,
  Play,
  FileText,
  Zap,
  Activity,
  Wand2,
  PenTool,
  Users,
  GitCompare,
  RefreshCw
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { WORKFLOW_STAGES } from "./constants";
import { WorkflowStageCard } from "./WorkflowStageCard";
import { OverrideConceptDialog } from "./OverrideConceptDialog";
import { ExpressModeButton } from "./ExpressModeButton";
import { useToast } from "@/hooks/use-toast";
import { debug } from "@/lib/debug";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { isInformatieCheckComplete, getStage2BlockReason } from "@/lib/workflowParsers";
import { useCollapsibleSections } from "@/hooks/useCollapsibleSections";
import type { SimplifiedWorkflowViewProps } from "./types";

// Stage icon mapping - Using JdB brand colors
const getStageIcon = (stageKey: string) => {
  const icons: Record<string, JSX.Element> = {
    '1_informatiecheck': <FileText className="h-5 w-5 text-jdb-blue-primary" />,
    '2_complexiteitscheck': <Activity className="h-5 w-5 text-purple-600" />,
    '3_generatie': <Wand2 className="h-5 w-5 text-jdb-success" />,
    '4a_BronnenSpecialist': <Users className="h-5 w-5 text-jdb-gold" />,
    '4b_FiscaalTechnischSpecialist': <Zap className="h-5 w-5 text-jdb-danger" />,
    '4c_ScenarioGatenAnalist': <Activity className="h-5 w-5 text-indigo-600" />,
    '4d_DeVertaler': <PenTool className="h-5 w-5 text-pink-600" />,
    '4e_DeAdvocaat': <Users className="h-5 w-5 text-jdb-gold" />,
    '4f_DeKlantpsycholoog': <Users className="h-5 w-5 text-teal-600" />,
    '6_change_summary': <GitCompare className="h-5 w-5 text-jdb-text-subtle" />
  };
  return icons[stageKey] || <Play className="h-5 w-5 text-jdb-blue-primary" />;
};

export const WorkflowView = memo(function WorkflowView({
  state,
  dispatch,
  executeStageM,
  executeSubstepM,
  isCreatingCase,
  rawText,
  clientName,
  getStageStatus
}: SimplifiedWorkflowViewProps) {
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const {
    toggleSection: toggleSectionCollapse,
    isSectionCollapsed
  } = useCollapsibleSections();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Detect user's motion preference - disables animations for better performance
  const shouldReduceMotion = useReducedMotion();

  // Calculate totals
  const currentStage = WORKFLOW_STAGES[state.currentStageIndex];
  const progressPercentage = Math.round((Object.keys(state.stageResults).length / WORKFLOW_STAGES.length) * 100);
  const totalProcessingTime = Object.values(state.stageTimes).reduce((sum, time) => sum + (time || 0), 0);

  // Auto-collapse stage 3 when completed and moved to next stage
  useEffect(() => {
    const stage3Result = state.stageResults["3_generatie"];
    if (stage3Result && expandedStages.has("3_generatie") && currentStage.key !== "3_generatie") {
      // Collapse stage 3 when we move away from it
      setExpandedStages(prev => {
        const newExpanded = new Set(prev);
        newExpanded.delete("3_generatie");
        return newExpanded;
      });
    }
  }, [currentStage.key, state.stageResults["3_generatie"]]);

  // Toggle stage expansion
  const toggleStageExpansion = useCallback((stageKey: string) => {
    const newExpanded = new Set(expandedStages);
    if (newExpanded.has(stageKey)) {
      newExpanded.delete(stageKey);
    } else {
      newExpanded.add(stageKey);
    }
    setExpandedStages(newExpanded);
  }, [expandedStages]);

  // Execute stage handler
  const handleExecuteStage = useCallback((stageKey: string, customContext?: string) => {
    if (!state.currentReport) return;

    executeStageM.mutate({
      reportId: state.currentReport.id,
      stage: stageKey,
      customInput: customContext || state.customInput || undefined,
    });
  }, [state.currentReport, state.customInput, executeStageM]);

  // Reset/clear stage handler
  const handleResetStage = useCallback(async (stageKey: string) => {
    if (!state.currentReport) return;

    const confirmed = window.confirm(
      `Weet je zeker dat je stage "${stageKey}" wilt wissen? Dit kan niet ongedaan worden gemaakt.`
    );

    if (!confirmed) return;

    try {
      const response = await apiRequest(
        'DELETE',
        `/api/reports/${state.currentReport.id}/stage/${stageKey}`
      );

      if (!response.ok) {
        throw new Error('Failed to reset stage');
      }

      const result = await response.json();
      const data = result.success ? result.data : result;
      const cascadeDeleted = data.cascadeDeleted || [];

      const cascadeMessage = cascadeDeleted.length > 0
        ? ` (+ ${cascadeDeleted.length} volgende stages)`
        : '';

      toast({
        title: "Stage gewist",
        description: `Stage ${stageKey}${cascadeMessage} is gewist en kan nu opnieuw worden uitgevoerd`,
        duration: 3000,
      });

      // Refresh the report to update the UI
      window.location.reload();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to reset stage:', error);
      toast({
        title: "Fout bij wissen",
        description: "Er ging iets mis bij het wissen van de stage",
        variant: "destructive",
        duration: 5000,
      });
    }
  }, [state.currentReport, toast]);

  // Manual mode toggle handler (for stage 3)
  const handleToggleManualMode = useCallback(async (mode: 'ai' | 'manual') => {
    dispatch({ type: "SET_MANUAL_MODE", mode });

    // If switching to manual mode and no prompt exists, fetch it from backend
    if (mode === 'manual' && !state.stagePrompts['3_generatie'] && state.currentReport) {
      try {
        // Use the same endpoint that executeStage would use to get the prompt
        const response = await apiRequest("GET", `/api/reports/${state.currentReport.id}/stage/3_generatie/prompt`);

        if (!response.ok) {
          throw new Error('Failed to generate prompt');
        }

        const data = await response.json();

        if (data.data?.prompt) {
          dispatch({
            type: "SET_STAGE_PROMPT",
            stage: '3_generatie',
            prompt: data.data.prompt
          });
        }
      } catch (error) {
        console.error('Failed to generate prompt:', error);
        toast({
          title: "Fout bij prompt genereren",
          description: "De prompt kon niet worden gegenereerd. Probeer het opnieuw.",
          variant: "destructive"
        });
      }
    }
  }, [dispatch, state.stagePrompts, state.currentReport, toast]);

  // Per-stage manual mode toggle handler (for 4A, 4B, etc.)
  const handleToggleStageManualMode = useCallback((stageKey: string) => async (mode: 'ai' | 'manual') => {
    dispatch({ type: "SET_STAGE_MANUAL_MODE", stage: stageKey, mode });

    // If switching to manual mode and no prompt exists, fetch it from backend
    if (mode === 'manual' && !state.stagePrompts[stageKey] && state.currentReport) {
      try {
        // Use the same endpoint that executeStage would use to get the prompt
        const response = await apiRequest("GET", `/api/reports/${state.currentReport.id}/stage/${stageKey}/prompt`);

        if (!response.ok) {
          throw new Error('Failed to generate prompt');
        }

        const data = await response.json();

        if (data.data?.prompt) {
          dispatch({
            type: "SET_STAGE_PROMPT",
            stage: stageKey,
            prompt: data.data.prompt
          });
        }
      } catch (error) {
        console.error('Failed to generate prompt:', error);
        toast({
          title: "Fout bij prompt genereren",
          description: "De prompt kon niet worden gegenereerd. Probeer het opnieuw.",
          variant: "destructive"
        });
      }
    }
  }, [dispatch, state.stagePrompts, state.currentReport, toast]);

  // Manual content change handler
  const handleManualContentChange = useCallback((content: string) => {
    dispatch({ type: "SET_MANUAL_CONTENT", content });
  }, [dispatch]);

  // Per-stage manual content change handler (for 4A, 4B, etc.)
  const handleStageManualContentChange = useCallback((stageKey: string) => (content: string) => {
    dispatch({ type: "SET_STAGE_MANUAL_CONTENT", stage: stageKey, content });
  }, [dispatch]);

  // Manual execute handler (use manual content as result)
  const handleManualExecute = async () => {
    if (!state.currentReport || !state.manualContent.trim()) return;

    const stageKey = '3_generatie';

    try {
      // Save to server using override-concept endpoint
      const response = await apiRequest("POST", `/api/reports/${state.currentReport.id}/stage/${stageKey}/override-concept`, {
        content: state.manualContent,
        source: 'manual_gemini_deep_research'
      });

      if (!response.ok) {
        throw new Error('Failed to save manual content');
      }

      const data = await response.json();

      // Store the manual content as the stage result
      dispatch({
        type: "SET_STAGE_RESULT",
        stage: stageKey,
        result: state.manualContent
      });

      // Also store in concept versions
      dispatch({
        type: "SET_CONCEPT_VERSION",
        stage: stageKey,
        content: state.manualContent
      });

      // Clear manual content
      dispatch({ type: "SET_MANUAL_CONTENT", content: "" });

      toast({
        title: "Stap 3 voltooid",
        description: `Het handmatige resultaat is opgeslagen als concept rapport v${data.version || 1}. Je kunt nu verder naar stap 4.`,
      });

      // Invalidate query to trigger reload
      queryClient.invalidateQueries({ queryKey: ['report', state.currentReport.id] });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${state.currentReport.id}`] });
    } catch (error) {
      console.error('Failed to save manual content:', error);
      toast({
        title: "Fout bij opslaan",
        description: "Het handmatige resultaat kon niet worden opgeslagen. Probeer het opnieuw.",
        variant: "destructive"
      });
    }
  };

  // Per-stage manual execute handler (for 4A, 4B, etc.)
  const handleStageManualExecute = (stageKey: string) => async () => {
    if (!state.currentReport) return;

    const manualContent = state.manualContents[stageKey];
    if (!manualContent?.trim()) return;

    try {
      // Save to server using manual-stage endpoint
      const response = await apiRequest("POST", `/api/reports/${state.currentReport.id}/manual-stage`, {
        stage: stageKey,
        content: manualContent,
        isManual: true
      });

      if (!response.ok) {
        throw new Error('Failed to save manual content');
      }

      const data = await response.json();

      // Store the manual content as the stage result
      dispatch({
        type: "SET_STAGE_RESULT",
        stage: stageKey,
        result: manualContent
      });

      // Clear manual content for this stage
      dispatch({ type: "SET_STAGE_MANUAL_CONTENT", stage: stageKey, content: "" });

      toast({
        title: `${stageKey} voltooid`,
        description: "✅ Stap 1 voltooid. Nu: Verwerk de feedback om het concept bij te werken.",
      });

      // Invalidate query to trigger reload
      queryClient.invalidateQueries({ queryKey: ['report', state.currentReport.id] });
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${state.currentReport.id}`] });

      // Auto-scroll to feedback processor after a short delay (let UI update first)
      setTimeout(() => {
        const feedbackSection = document.querySelector(`[data-stage="${stageKey}"] [data-feedback-processor]`);
        if (feedbackSection) {
          feedbackSection.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
            inline: 'nearest'
          });
        }
      }, 500);
    } catch (error) {
      console.error('Failed to save manual content:', error);
      toast({
        title: "Fout bij opslaan",
        description: "Het handmatige resultaat kon niet worden opgeslagen. Probeer het opnieuw.",
        variant: "destructive"
      });
    }
  };

  // Feedback processed handler
  const handleFeedbackProcessed = (stageKey: string, response: any) => {
    console.log(`🔄 WorkflowView: Feedback processed for ${stageKey}`, {
      newVersion: response?.newVersion,
      hasConceptContent: !!response?.conceptContent,
      conceptContentLength: response?.conceptContent?.length
    });

    // Update the concept version in state with the new content
    if (response?.conceptContent) {
      dispatch({
        type: "SET_CONCEPT_VERSION",
        stage: stageKey,
        content: response.conceptContent
      });
    }

    toast({
      title: "Feedback verwerkt",
      description: `Feedback voor ${stageKey} is succesvol verwerkt - versie ${response?.newVersion || 'onbekend'}`,
    });
    queryClient.invalidateQueries({ queryKey: ['report', state.currentReport?.id] });
  };

  // Reload prompts handler - Fetches fresh prompts from database
  const [isReloadingPrompts, setIsReloadingPrompts] = useState(false);

  const handleReloadPrompts = async () => {
    if (!state.currentReport) return;

    setIsReloadingPrompts(true);
    try {
      // Clear all cached prompts in state
      dispatch({ type: "CLEAR_STAGE_PROMPTS" });

      // Invalidate prompt settings cache
      queryClient.invalidateQueries({ queryKey: ['prompt-settings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/settings/prompts'] });

      toast({
        title: "Prompts herladen",
        description: "Alle prompts zijn ververst vanuit de database. Bij de volgende uitvoering worden de nieuwe prompts gebruikt.",
      });
    } catch (error) {
      console.error('Failed to reload prompts:', error);
      toast({
        title: "Fout bij herladen",
        description: "De prompts konden niet worden herladen. Probeer het opnieuw.",
        variant: "destructive"
      });
    } finally {
      setIsReloadingPrompts(false);
    }
  };

  return (
    <>
      {/* Celebration Confetti */}
      <AnimatePresence>
        {Object.keys(state.stageResults).length >= WORKFLOW_STAGES.length && (
          <Confetti
            width={typeof window !== 'undefined' ? window.innerWidth : 1200}
            height={typeof window !== 'undefined' ? window.innerHeight : 800}
            recycle={false}
            numberOfPieces={200}
            gravity={0.3}
          />
        )}
      </AnimatePresence>

      <div className="space-y-6 max-w-full overflow-hidden">
        {/* Modern Progress Header - JdB Professional Style */}
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
          animate={shouldReduceMotion ? false : { opacity: 1, y: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.5 }}
        >
          <Card className="bg-white dark:bg-jdb-panel border-jdb-border">
            <CardContent className="p-6 md:p-8">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <motion.div
                  className="flex items-center gap-4"
                  whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
                  transition={shouldReduceMotion ? {} : { type: "spring", stiffness: 400, damping: 17 }}
                >
                  <div className="p-4 rounded-xl bg-jdb-blue-primary shadow-sm">
                    <Workflow className="h-6 w-6 md:h-7 md:w-7 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl md:text-2xl font-semibold text-jdb-text-heading">
                      Fiscale Rapport Workflow
                    </h2>
                    <p className="text-sm text-jdb-text-subtle font-medium">
                      AI-gedreven fiscale analyse systeem
                    </p>
                  </div>
                </motion.div>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
                  <motion.div whileHover={shouldReduceMotion ? {} : { scale: 1.05 }} className="inline-flex">
                    <Badge
                      variant="outline"
                      className="text-sm font-semibold px-4 py-2 bg-white dark:bg-jdb-panel"
                    >
                      <CheckCircle className="h-4 w-4 mr-2 text-jdb-success" />
                      {(() => {
                        // Count completed stages by checking which workflow stages have results
                        const stageResultKeys = Object.keys(state.stageResults);
                        const conceptVersions = (state.currentReport?.conceptReportVersions as any) || {};

                        // Count stages that actually exist in WORKFLOW_STAGES
                        const completedStageKeys = stageResultKeys.filter(key =>
                          WORKFLOW_STAGES.some(stage => stage.key === key)
                        );

                        // Check if stage 3 concept exists
                        const hasStage3 = conceptVersions['3_generatie'] || conceptVersions['latest'];

                        // Count how many of stages 1-3 are NOT yet in stageResults but should be counted
                        let extraStages = 0;
                        if (hasStage3) {
                          // Only count stages 1-3 that are NOT already in completedStageKeys
                          ['1_informatiecheck', '2_complexiteitscheck', '3_generatie'].forEach(stageKey => {
                            if (!completedStageKeys.includes(stageKey)) {
                              extraStages++;
                            }
                          });
                        }

                        const completedCount = completedStageKeys.length + extraStages;

                        return `${completedCount}/${WORKFLOW_STAGES.length}`;
                      })()}  Stappen
                    </Badge>
                  </motion.div>
                  {totalProcessingTime > 0 && (
                    <motion.div
                      className="flex items-center gap-2 text-sm text-jdb-text-body font-medium"
                      initial={shouldReduceMotion ? false : { opacity: 0 }}
                      animate={shouldReduceMotion ? false : { opacity: 1 }}
                      transition={shouldReduceMotion ? {} : { delay: 0.3 }}
                    >
                      <div className="p-2 rounded-lg bg-jdb-blue-light dark:bg-jdb-blue-primary/20">
                        <Clock className="h-4 w-4 text-jdb-blue-primary" />
                      </div>
                      {totalProcessingTime}s totale tijd
                    </motion.div>
                  )}
                  <motion.div whileHover={shouldReduceMotion ? {} : { scale: 1.05 }} className="inline-flex">
                    <Button
                      onClick={handleReloadPrompts}
                      disabled={isReloadingPrompts}
                      variant="outline"
                      size="sm"
                      className="text-sm font-medium"
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${isReloadingPrompts ? 'animate-spin' : ''}`} />
                      Herlaad Prompts
                    </Button>
                  </motion.div>
                  {state.currentReport && (() => {
                    // Check if stage 3 is completed by looking at conceptReportVersions
                    const conceptVersions = state.currentReport.conceptReportVersions as any || {};
                    const hasStage3 = conceptVersions['3_generatie'] || conceptVersions['latest'];

                    return (
                      <motion.div whileHover={shouldReduceMotion ? {} : { scale: 1.05 }} className="inline-flex">
                        <ExpressModeButton
                          reportId={state.currentReport.id}
                          onComplete={() => {
                            queryClient.invalidateQueries({ queryKey: [`/api/reports/${state.currentReport!.id}`] });
                            window.location.reload();
                          }}
                          disabled={!hasStage3}
                        />
                      </motion.div>
                    );
                  })()}
                </div>
              </div>

              <motion.div
                className="mt-6 space-y-3"
                initial={shouldReduceMotion ? false : { opacity: 0 }}
                animate={shouldReduceMotion ? false : { opacity: 1 }}
                transition={shouldReduceMotion ? {} : { delay: 0.2 }}
              >
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-jdb-text-heading">
                    Voortgang: {progressPercentage}%
                  </span>
                  <span className="text-sm text-jdb-text-subtle">
                    {currentStage.label}
                  </span>
                </div>
                <div className="relative">
                  <div className="h-3 bg-jdb-border dark:bg-jdb-border/30 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-jdb-blue-primary rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${progressPercentage}%` }}
                    />
                  </div>
                </div>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Workflow Stages */}
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
          animate={shouldReduceMotion ? false : { opacity: 1, y: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.5, delay: 0.1 }}
        >
          <Card className="bg-white dark:bg-jdb-panel">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-jdb-blue-primary shadow-sm">
                  <Eye className="h-5 w-5 text-white" />
                </div>
                <div>
                  <span className="text-xl font-semibold text-jdb-text-heading">
                    AI Workflow - Volledige Transparantie
                  </span>
                  <p className="text-sm text-jdb-text-subtle font-normal mt-1">
                    Bekijk en bewerk exact wat naar de AI wordt gestuurd en wat terugkomt
                  </p>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 md:p-6 space-y-4">
              {/* ✅ REFACTORED: Use WorkflowStageCard for each stage */}
              {WORKFLOW_STAGES.map((stage, index) => {
                const stageResult = state.stageResults[stage.key] || "";
                const stagePrompt = state.stagePrompts[stage.key] || "";
                const conceptVersion = state.conceptReportVersions[stage.key];

                const isActive = index === state.currentStageIndex;
                const rawStageStatus = getStageStatus(index);
                const isCompleted = rawStageStatus === "completed";
                const isProcessing = state.stageProcessing[stage.key];

                // Check if this is a reviewer stage with feedback but not yet processed
                const isReviewerStage = stage.key.startsWith('4') && stage.key !== '4_change_summary';
                const hasFeedback = !!state.stageResults[stage.key];
                // A reviewer stage is "processed" if it has a concept version (means feedback was merged into concept)
                const hasConceptVersion = !!conceptVersion;
                const isFeedbackReady = isReviewerStage && hasFeedback && !hasConceptVersion;

                // Map status to WorkflowStageCard expected type
                const stageStatus: "error" | "processing" | "completed" | "idle" | "blocked" | "feedback_ready" =
                  isFeedbackReady ? "feedback_ready" :
                  rawStageStatus === "completed" ? "completed" :
                  isProcessing ? "processing" :
                  rawStageStatus === "current" ? "idle" :
                  "idle";

                // Warning logic for Stage 2
                let blockReason: string | undefined | null;
                if (stage.key === "2_complexiteitscheck") {
                  const stage1Result = state.stageResults["1_informatiecheck"];
                  if (!isInformatieCheckComplete(stage1Result)) {
                    blockReason = getStage2BlockReason(stage1Result);
                  }
                }

                // Can execute logic - must match getStageStatus logic
                // A stage can execute if it's the first stage OR the previous stage is completed
                // A stage is considered completed if it has stageResults OR (for stage 3) conceptReportVersions
                const canExecute = index === 0 || (() => {
                  const prevStage = WORKFLOW_STAGES[index - 1];
                  if (!prevStage) return false;

                  const hasPrevStageResult = !!state.stageResults[prevStage.key];
                  const hasPrevConceptReport = !!state.conceptReportVersions[prevStage.key];

                  // Special case: Stage 3 (generatie) is completed if it has conceptReport OR stageResult
                  if (prevStage.key === "3_generatie") {
                    return hasPrevStageResult || hasPrevConceptReport;
                  }

                  return hasPrevStageResult;
                })();

                // Show feedback processor for reviewer stages
                const isReviewer = stage.type === "reviewer";
                const substepResults = state.substepResults[stage.key] || {};
                const hasRawFeedback = !!substepResults.review || !!stageResult;
                const hasProcessing = !!substepResults.processing;
                // Always show processor if there's raw feedback, even if already processed (allow re-processing)
                const showFeedbackProcessor = isReviewer && hasRawFeedback;

                return (
                  <WorkflowStageCard
                    key={stage.key}
                    stageKey={stage.key}
                    stageName={stage.label}
                    stageIcon={getStageIcon(stage.key)}
                    stageStatus={stageStatus}
                    isExpanded={expandedStages.has(stage.key) || isActive}
                    onToggleExpand={() => toggleStageExpansion(stage.key)}
                    stageResult={stageResult}
                    stagePrompt={stagePrompt}
                    conceptVersion={conceptVersion}
                    reportId={state.currentReport?.id}
                    stage1Result={state.stageResults["1_informatiecheck"]}
                    canExecute={canExecute}
                    isProcessing={isProcessing}
                    onExecute={(customContext) => handleExecuteStage(stage.key, customContext)}
                    onResetStage={() => handleResetStage(stage.key)}
                    isInputCollapsed={isSectionCollapsed(stage.key, 'input')}
                    isOutputCollapsed={isSectionCollapsed(stage.key, 'output')}
                    isPromptCollapsed={isSectionCollapsed(stage.key, 'prompt')}
                    onToggleInput={() => toggleSectionCollapse(stage.key, 'input')}
                    onToggleOutput={() => toggleSectionCollapse(stage.key, 'output')}
                    onTogglePrompt={() => toggleSectionCollapse(stage.key, 'prompt')}
                    showFeedbackProcessor={showFeedbackProcessor}
                    onFeedbackProcessed={(response) => handleFeedbackProcessed(stage.key, response)}
                    blockReason={blockReason || undefined}
                    onForceContinue={stage.key === '1_informatiecheck' ? () => {
                      // Force continue by advancing to next stage despite incomplete status
                      dispatch({ type: "SET_CURRENT_STAGE_INDEX", index: index + 1 });
                      toggleStageExpansion('2_complexiteitscheck');
                    } : undefined}
                    // Manual mode props for stage 3
                    {...(stage.key === '3_generatie' ? {
                      manualMode: state.manualMode,
                      onToggleManualMode: handleToggleManualMode,
                      manualContent: state.manualContent,
                      onManualContentChange: handleManualContentChange,
                      onManualExecute: handleManualExecute
                    } : {})}
                    // Manual mode props for reviewer stages (4A, 4B, etc.)
                    {...(isReviewer ? {
                      manualMode: state.manualModes[stage.key] || 'ai',
                      onToggleManualMode: handleToggleStageManualMode(stage.key),
                      manualContent: state.manualContents[stage.key] || '',
                      onManualContentChange: handleStageManualContentChange(stage.key),
                      onManualExecute: handleStageManualExecute(stage.key)
                    } : {})}
                  />
                );
              })}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </>
  );
});
