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
import { motion, AnimatePresence } from 'framer-motion';
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

// Stage icon mapping
const getStageIcon = (stageKey: string) => {
  const icons: Record<string, JSX.Element> = {
    '1_informatiecheck': <FileText className="h-5 w-5 text-blue-600" />,
    '2_complexiteitscheck': <Activity className="h-5 w-5 text-purple-600" />,
    '3_generatie': <Wand2 className="h-5 w-5 text-green-600" />,
    '4a_BronnenSpecialist': <Users className="h-5 w-5 text-orange-600" />,
    '4b_FiscaalTechnischSpecialist': <Zap className="h-5 w-5 text-red-600" />,
    '4c_ScenarioGatenAnalist': <Activity className="h-5 w-5 text-indigo-600" />,
    '4d_DeVertaler': <PenTool className="h-5 w-5 text-pink-600" />,
    '4e_DeAdvocaat': <Users className="h-5 w-5 text-yellow-600" />,
    '4f_DeKlantpsycholoog': <Users className="h-5 w-5 text-teal-600" />,
    '6_change_summary': <GitCompare className="h-5 w-5 text-gray-600" />
  };
  return icons[stageKey] || <Play className="h-5 w-5" />;
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
  const handleExecuteStage = (stageKey: string) => {
    if (!state.currentReport) return;

    executeStageM.mutate({
      reportId: state.currentReport.id,
      stage: stageKey,
      customInput: state.customInput || undefined,
    });
  };

  // Feedback processed handler
  const handleFeedbackProcessed = (stageKey: string) => {
    toast({
      title: "Feedback verwerkt",
      description: `Feedback voor ${stageKey} is succesvol verwerkt`,
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
        {/* Modern Progress Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-blue-900/20 dark:to-purple-900/20 border-0 shadow-xl">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-pink-600/10" />
            <div className="absolute inset-0 backdrop-blur-3xl bg-white/40 dark:bg-gray-900/40" />
            <CardContent className="relative p-6 md:p-8">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <motion.div
                  className="flex items-center gap-4"
                  whileHover={{ scale: 1.02 }}
                  transition={{ type: "spring", stiffness: 400, damping: 17 }}
                >
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
                    <Workflow className="h-6 w-6 md:h-7 md:w-7 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                      Fiscale Rapport Workflow
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                      AI-gedreven fiscale analyse systeem
                    </p>
                  </div>
                </motion.div>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
                  <motion.div whileHover={{ scale: 1.05 }} className="inline-flex">
                    <Badge
                      variant="outline"
                      className="text-sm font-semibold px-4 py-2 bg-white/80 dark:bg-gray-800/80 backdrop-blur border-gray-200/50 dark:border-gray-700/50 shadow-sm"
                    >
                      <CheckCircle className="h-4 w-4 mr-2 text-green-500" />
                      {Object.keys(state.stageResults).length}/{WORKFLOW_STAGES.length} Stappen
                    </Badge>
                  </motion.div>
                  {totalProcessingTime > 0 && (
                    <motion.div
                      className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 font-medium"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.3 }}
                    >
                      <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                        <Clock className="h-4 w-4 text-blue-600" />
                      </div>
                      {totalProcessingTime}s totale tijd
                    </motion.div>
                  )}
                </div>
              </div>

              <motion.div
                className="mt-6 space-y-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Voortgang: {progressPercentage}%
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {currentStage.label}
                  </span>
                </div>
                <div className="relative">
                  <Progress
                    value={progressPercentage}
                    className="h-3 bg-gray-200/50 dark:bg-gray-700/50 rounded-full overflow-hidden"
                  />
                  <div
                    className="absolute top-0 left-0 h-3 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-full transition-all duration-1000 ease-out shadow-lg"
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Workflow Stages */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl border border-white/20 dark:border-gray-700/30 shadow-2xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg">
                  <Eye className="h-5 w-5 text-white" />
                </div>
                <div>
                  <span className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                    AI Workflow - Volledige Transparantie
                  </span>
                  <p className="text-sm text-gray-600 dark:text-gray-400 font-normal mt-1">
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

                // Can execute logic
                const canExecute = index === 0 || !!state.stageResults[WORKFLOW_STAGES[index - 1].key];

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
                    canExecute={canExecute}
                    isProcessing={isProcessing}
                    onExecute={() => handleExecuteStage(stage.key)}
                    isInputCollapsed={isSectionCollapsed(stage.key, 'input')}
                    isOutputCollapsed={isSectionCollapsed(stage.key, 'output')}
                    isPromptCollapsed={isSectionCollapsed(stage.key, 'prompt')}
                    onToggleInput={() => toggleSectionCollapse(stage.key, 'input')}
                    onToggleOutput={() => toggleSectionCollapse(stage.key, 'output')}
                    onTogglePrompt={() => toggleSectionCollapse(stage.key, 'prompt')}
                    showFeedbackProcessor={showFeedbackProcessor}
                    onFeedbackProcessed={() => handleFeedbackProcessed(stage.key)}
                    blockReason={blockReason}
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
