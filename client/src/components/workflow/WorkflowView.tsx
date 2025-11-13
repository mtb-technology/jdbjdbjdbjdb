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
  GitCompare
} from "lucide-react";
import { useState, useEffect } from "react";
import { WORKFLOW_STAGES } from "./constants";
import { WorkflowStageCard } from "./WorkflowStageCard";
import { OverrideConceptDialog } from "./OverrideConceptDialog";
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

export function WorkflowView({
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

  // Toggle stage expansion
  const toggleStageExpansion = (stageKey: string) => {
    const newExpanded = new Set(expandedStages);
    if (newExpanded.has(stageKey)) {
      newExpanded.delete(stageKey);
    } else {
      newExpanded.add(stageKey);
    }
    setExpandedStages(newExpanded);
  };

  // Execute stage handler
  const handleExecuteStage = (stageKey: string, customContext?: string) => {
    if (!state.currentReport) return;

    executeStageM.mutate({
      reportId: state.currentReport.id,
      stage: stageKey,
      customInput: customContext || state.customInput || undefined,
    });
  };

  // Reset/clear stage handler
  const handleResetStage = async (stageKey: string) => {
    if (!state.currentReport) return;

    const confirmed = window.confirm(
      `Weet je zeker dat je stage "${stageKey}" wilt wissen? Dit kan niet ongedaan worden gemaakt.`
    );

    if (!confirmed) return;

    try {
      const response = await fetch(`/api/reports/${state.currentReport.id}/stage/${stageKey}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to reset stage');
      }

      await response.json();

      toast({
        title: "Stage gewist",
        description: `Stage ${stageKey} is gewist en kan nu opnieuw worden uitgevoerd`,
        duration: 3000,
      });

      // Refresh the report to update the UI
      window.location.reload();
    } catch (error) {
      console.error('Failed to reset stage:', error);
      toast({
        title: "Fout bij wissen",
        description: "Er ging iets mis bij het wissen van de stage",
        variant: "destructive",
        duration: 5000,
      });
    }
  };

  // Manual mode toggle handler (for stage 3)
  const handleToggleManualMode = async (mode: 'ai' | 'manual') => {
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
  };

  // Manual content change handler
  const handleManualContentChange = (content: string) => {
    dispatch({ type: "SET_MANUAL_CONTENT", content });
  };

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
                      {Object.keys(state.stageResults).length}/{WORKFLOW_STAGES.length} Stappen
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
                const stageStatus = getStageStatus(index);
                const isCompleted = stageStatus === "completed";
                const isProcessing = state.stageProcessing[stage.key];

                // Warning logic for Stage 2
                let blockReason: string | undefined;
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
                const showFeedbackProcessor = isReviewer && hasRawFeedback && !hasProcessing;

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
                    blockReason={blockReason}
                    onForceContinue={stage.key === '1_informatiecheck' ? () => {
                      // Force continue by advancing to next stage despite incomplete status
                      dispatch({ type: "SET_CURRENT_STAGE_INDEX", index: index + 1 });
                      toggleStageExpansion('2_complexiteitscheck');
                    } : undefined}
                    // Manual mode props (only for stage 3)
                    {...(stage.key === '3_generatie' ? {
                      manualMode: state.manualMode,
                      onToggleManualMode: handleToggleManualMode,
                      manualContent: state.manualContent,
                      onManualContentChange: handleManualContentChange,
                      onManualExecute: handleManualExecute
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
}
