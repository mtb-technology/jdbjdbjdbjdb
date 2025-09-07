import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from 'framer-motion';
import Confetti from 'react-confetti';
import toast from 'react-hot-toast';
import { 
  Play, 
  CheckCircle, 
  Eye, 
  EyeOff, 
  ChevronRight,
  ChevronDown,
  Copy,
  MessageSquare,
  Clock,
  Workflow,
  ArrowRight,
  Send,
  FileText,
  Zap,
  RefreshCw,
  Info,
  Plus,
  Edit3,
  Activity
} from "lucide-react";
import { useState, useEffect } from "react";
import { WORKFLOW_STAGES } from "./constants";
import { ReviewFeedbackEditor } from "./ReviewFeedbackEditor";
import { useToast } from "@/hooks/use-toast";

interface SimplifiedWorkflowViewProps {
  state: any;
  dispatch: any;
  executeStageM: any;
  executeSubstepM: any;
  isCreatingCase: boolean;
  rawText?: string;
  clientName?: string;
}

export function SimplifiedWorkflowView({
  state,
  dispatch,
  executeStageM,
  executeSubstepM,
  isCreatingCase,
  rawText,
  clientName
}: SimplifiedWorkflowViewProps) {
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [viewMode] = useState<"detailed">("detailed");
  const [promptPreviews, setPromptPreviews] = useState<Record<string, string>>({});
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [showCustomInput, setShowCustomInput] = useState<Record<string, boolean>>({});
  const [editingPrompts, setEditingPrompts] = useState<Record<string, string>>({});
  const [showPromptEditor, setShowPromptEditor] = useState<Record<string, boolean>>({});
  const [stageProgress, setStageProgress] = useState<Record<string, { progress: number; status: string; startTime?: number; estimatedTime?: number }>>({});
  const [heartbeat, setHeartbeat] = useState<Record<string, number>>({});
  const { toast } = useToast();
  
  const currentStage = WORKFLOW_STAGES[state.currentStageIndex];
  const progressPercentage = Math.round((Object.keys(state.stageResults).length / WORKFLOW_STAGES.length) * 100);
  
  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Succesvol gekopieerd",
      description: `${type} gekopieerd naar klembord`
    });
  };

  const toggleStageExpansion = (stageKey: string) => {
    const newExpanded = new Set(expandedStages);
    if (newExpanded.has(stageKey)) {
      newExpanded.delete(stageKey);
    } else {
      newExpanded.add(stageKey);
      // Fetch prompt preview when expanding a stage in detailed view
      if (viewMode === "detailed") {
        fetchPromptPreview(stageKey);
      }
    }
    setExpandedStages(newExpanded);
  };

  const executeCurrentStage = () => {
    if (!state.currentReport) return;
    
    executeStageM.mutate({
      reportId: state.currentReport.id,
      stage: currentStage.key,
      customInput: state.customInput || undefined,
    });
  };

  const executeStage = (stageKey: string) => {
    if (!state.currentReport) return;
    
    const customInput = customInputs[stageKey] || state.customInput || undefined;
    
    executeStageM.mutate({
      reportId: state.currentReport.id,
      stage: stageKey,
      customInput,
    });
  };

  const toggleCustomInput = (stageKey: string) => {
    setShowCustomInput(prev => ({
      ...prev,
      [stageKey]: !prev[stageKey]
    }));
  };

  const updateCustomInput = (stageKey: string, value: string) => {
    setCustomInputs(prev => ({
      ...prev,
      [stageKey]: value
    }));
  };

  const togglePromptEditor = (stageKey: string) => {
    setShowPromptEditor(prev => {
      const newState = {
        ...prev,
        [stageKey]: !prev[stageKey]
      };
      
      // Load current prompt into editor when opening
      if (!prev[stageKey]) {
        const currentPrompt = state.stagePrompts[stageKey] || promptPreviews[stageKey] || '';
        if (currentPrompt) {
          setEditingPrompts(prevPrompts => ({
            ...prevPrompts,
            [stageKey]: currentPrompt
          }));
        } else {
          // Fetch prompt if not available
          fetchPromptPreview(stageKey);
        }
      }
      
      return newState;
    });
  };

  const updateEditingPrompt = (stageKey: string, value: string) => {
    setEditingPrompts(prev => ({
      ...prev,
      [stageKey]: value
    }));
  };

  const executeWithCustomPrompt = (stageKey: string) => {
    if (!state.currentReport) return;
    
    const customPrompt = editingPrompts[stageKey];
    if (!customPrompt) {
      toast({
        title: "Geen prompt",
        description: "Er is geen prompt om uit te voeren",
        variant: "destructive"
      });
      return;
    }
    
    executeStageM.mutate({
      reportId: state.currentReport.id,
      stage: stageKey,
      customInput: customPrompt,
    });
  };

  // Fetch prompt preview for a stage
  const fetchPromptPreview = async (stageKey: string) => {
    if (promptPreviews[stageKey]) return;
    
    setLoadingPreview(stageKey);
    try {
      if (state.currentReport) {
        // For existing reports, use the specific report preview
        const response = await fetch(`/api/reports/${state.currentReport.id}/stage/${stageKey}/preview`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data?.prompt) {
            setPromptPreviews(prev => ({ ...prev, [stageKey]: data.data.prompt }));
          }
        }
      } else {
        // For new cases without a report, fetch the default template prompt with user data
        const queryParams = new URLSearchParams();
        if (rawText) queryParams.append('rawText', rawText);
        if (clientName) queryParams.append('clientName', clientName);
        
        const url = `/api/prompt-templates/${stageKey}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data?.prompt) {
            setPromptPreviews(prev => ({ ...prev, [stageKey]: data.data.prompt }));
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch prompt preview:', error);
    } finally {
      setLoadingPreview(null);
    }
  };

  const handleStageClick = (stageKey: string, index: number) => {
    // Navigate to stage if already completed
    if (state.stageResults[stageKey]) {
      dispatch({ type: "SET_STAGE_INDEX", payload: index });
    }
  };

  const totalProcessingTime = Object.values(state.stageTimes).reduce((a: number, b: any) => a + (Number(b) || 0), 0);

  // Calculate estimated time remaining for active processes
  const calculateEstimatedTime = (stageKey: string) => {
    const progress = stageProgress[stageKey];
    if (!progress || !progress.startTime) return null;
    
    const elapsed = Date.now() - progress.startTime;
    const historicalTime = state.stageTimes[stageKey] || 60; // Default to 60 seconds
    
    if (progress.progress > 0) {
      const estimatedTotal = elapsed / (progress.progress / 100);
      return Math.max(0, estimatedTotal - elapsed);
    }
    
    return Math.max(0, (historicalTime * 1000) - elapsed);
  };

  const formatTimeRemaining = (ms: number | null) => {
    if (!ms) return 'Onbekend';
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  // Auto-fetch prompt preview for current stage and completed stages in detailed view
  useEffect(() => {
    if (state.currentReport) {
      // Fetch for current stage if not completed
      if (currentStage && !state.stageResults[currentStage.key]) {
        fetchPromptPreview(currentStage.key);
      }
      
      // Fetch prompts for completed stages that don't have stored prompts
      WORKFLOW_STAGES.forEach(stage => {
        const hasResult = !!state.stageResults[stage.key];
        const hasStoredPrompt = !!state.stagePrompts[stage.key];
        
        if (hasResult && !hasStoredPrompt && !promptPreviews[stage.key]) {
          fetchPromptPreview(stage.key);
        }
      });
    } else {
      // For new cases without a report, fetch template for current stage
      if (currentStage && !promptPreviews[currentStage.key]) {
        fetchPromptPreview(currentStage.key);
      }
    }
  }, [state.currentStageIndex, state.currentReport, state.stageResults, state.stagePrompts]);

  // Load prompt into editor when preview becomes available
  useEffect(() => {
    Object.entries(showPromptEditor).forEach(([stageKey, isShowing]) => {
      if (isShowing && !editingPrompts[stageKey]) {
        const availablePrompt = state.stagePrompts[stageKey] || promptPreviews[stageKey];
        if (availablePrompt) {
          setEditingPrompts(prev => ({
            ...prev,
            [stageKey]: availablePrompt
          }));
        }
      }
    });
  }, [showPromptEditor, state.stagePrompts, promptPreviews, editingPrompts]);

  // Heartbeat and progress tracking for active processes
  useEffect(() => {
    const interval = setInterval(() => {
      setHeartbeat(prev => {
        const newHeartbeat = { ...prev };
        Object.keys(state.stageProcessing || {}).forEach(stageKey => {
          if (state.stageProcessing[stageKey]) {
            newHeartbeat[stageKey] = (newHeartbeat[stageKey] || 0) + 1;
          }
        });
        return newHeartbeat;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [state.stageProcessing]);

  // Track when stages start and stop processing
  useEffect(() => {
    const newProcessing = state.stageProcessing || {};
    const currentProcessingKeys = Object.keys(newProcessing).filter(key => newProcessing[key]);
    
    currentProcessingKeys.forEach(stageKey => {
      if (!stageProgress[stageKey]) {
        // Stage just started processing
        setStageProgress(prev => ({
          ...prev,
          [stageKey]: {
            progress: 0,
            status: 'AI specialist start met analyse...',
            startTime: Date.now(),
            estimatedTime: state.stageTimes[stageKey] || 60
          }
        }));
      }
    });

    // Clean up completed stages
    Object.keys(stageProgress).forEach(stageKey => {
      if (!newProcessing[stageKey]) {
        setStageProgress(prev => {
          const newPrev = { ...prev };
          delete newPrev[stageKey];
          return newPrev;
        });
        setHeartbeat(prev => {
          const newPrev = { ...prev };
          delete newPrev[stageKey];
          return newPrev;
        });
      }
    });
  }, [state.stageProcessing, stageProgress]);

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
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    className="inline-flex"
                  >
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

        {/* Modern Workflow Interface */}
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
          {WORKFLOW_STAGES.map((stage, index) => {
            const stageResult = state.stageResults[stage.key] || "";
            const stagePrompt = state.stagePrompts[stage.key] || "";
            const isActive = index === state.currentStageIndex;
            const isCompleted = !!stageResult;
            const isProcessing = state.stageProcessing[stage.key] || false;
            const processingTime = state.stageTimes[stage.key];
            const canStart = index === 0 || !!state.stageResults[WORKFLOW_STAGES[index - 1].key];
            const isExpanded = expandedStages.has(stage.key) || isActive;
            
            // For reviewer stages
            const isReviewer = stage.type === "reviewer";
            const substepResults = state.substepResults[stage.key] || {};
            const hasReview = !!substepResults.review;
            const hasProcessing = !!substepResults.processing;
            
            return (
              <div key={stage.key} className={`border rounded-lg mb-3 transition-all ${
                isActive ? 'ring-2 ring-primary border-primary bg-primary/5' : 
                isCompleted ? 'border-green-500/50 bg-green-50/30 dark:bg-green-950/20' : 
                'border-gray-200 opacity-60'
              }`}>
                {/* Stage Header */}
                <div 
                  className={`p-3 md:p-4 flex items-center justify-between ${
                    (isCompleted || isActive) ? 'cursor-pointer hover:bg-gray-50/50 dark:hover:bg-gray-800/50' : ''
                  }`}
                  onClick={() => (isCompleted || isActive) && toggleStageExpansion(stage.key)}
                >
                  <div className="flex items-center gap-2 md:gap-3">
                    <div className={`w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isCompleted ? 'bg-green-500 text-white' :
                      isActive ? 'bg-primary text-white' :
                      'bg-gray-200 text-gray-400'
                    }`}>
                      {isCompleted ? <CheckCircle className="h-4 w-4 md:h-5 md:w-5" /> : 
                       isProcessing ? <div className="w-3 h-3 md:w-4 md:h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
                       <span className="text-xs md:text-sm font-medium">{index + 1}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-sm md:text-base">{stage.label}</h3>
                      {viewMode === "detailed" && (
                        <p className="text-xs text-muted-foreground mt-1">{stage.description}</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {processingTime && (
                      <Badge variant="outline" className="text-xs">
                        {processingTime}s
                      </Badge>
                    )}
                    {isProcessing && (
                      <Badge className="bg-orange-500 text-xs">
                        AI bezig...
                      </Badge>
                    )}
                    {(isCompleted || isActive) && (
                      isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                    )}
                  </div>
                </div>

                {/* Stage Content - Expandable */}
                {isExpanded && (
                  <div className="px-3 md:px-4 pb-3 md:pb-4 border-t">
                    <div className="mt-3 space-y-3">
                        {/* Show Input from Previous Steps */}
                        {index > 0 && (
                          <div className="space-y-2">
                            {/* Get previous stage results to show as input */}
                            {WORKFLOW_STAGES.slice(0, index).map((prevStage, prevIndex) => {
                              const prevResult = state.stageResults[prevStage.key];
                              if (!prevResult) return null;
                              
                              return (
                                <div key={prevStage.key} className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                                  <div className="flex items-center justify-between p-2 border-b border-blue-200 dark:border-blue-800">
                                    <div className="flex items-center gap-2">
                                      <ArrowRight className="h-3 w-3 text-blue-600" />
                                      <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                                        INPUT UIT STAP {prevIndex + 1}: {prevStage.title}
                                      </span>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => copyToClipboard(prevResult, `Output Stap ${prevIndex + 1}`)}
                                      className="h-6 w-6 p-0"
                                    >
                                      <Copy className="h-3 w-3" />
                                    </Button>
                                  </div>
                                  <div className="p-2 max-h-48 overflow-y-auto">
                                    <div className="text-xs text-blue-800 dark:text-blue-200 whitespace-pre-wrap bg-white/50 dark:bg-gray-900/50 p-2 rounded border">
                                      {prevResult.length > 500 ? (
                                        <>
                                          {prevResult.substring(0, 500)}
                                          <span className="text-blue-600 font-medium">... ({prevResult.length - 500} tekens meer)</span>
                                        </>
                                      ) : (
                                        prevResult
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        
                        {/* Show Prompt Preview for any stage when available */}
                        {(!stagePrompt || !isCompleted) && (promptPreviews[stage.key] || loadingPreview === stage.key) && (
                          <div className="space-y-2">
                            <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                              <div className="flex items-center justify-between p-2 border-b border-yellow-200 dark:border-yellow-800">
                                <div className="flex items-center gap-2">
                                  <Info className="h-3 w-3 text-yellow-600" />
                                  <span className="text-xs font-medium text-yellow-700 dark:text-yellow-300">
                                    PROMPT PREVIEW (wordt verstuurd bij uitvoering)
                                  </span>
                                </div>
                                {promptPreviews[stage.key] && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => copyToClipboard(promptPreviews[stage.key], "Prompt Preview")}
                                    className="h-6 w-6 p-0"
                                  >
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                              <div className="p-2 max-h-96 overflow-y-auto">
                                {loadingPreview === stage.key ? (
                                  <div className="flex items-center gap-2 text-xs text-yellow-600">
                                    <div className="w-3 h-3 border-2 border-yellow-600 border-t-transparent rounded-full animate-spin" />
                                    Prompt preview ophalen...
                                  </div>
                                ) : (
                                  <pre className="text-xs font-mono whitespace-pre-wrap text-yellow-800 dark:text-yellow-200">
                                    {promptPreviews[stage.key]}
                                  </pre>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Show Input/Prompt after execution or for completed stages */}
                        {(stagePrompt || (isCompleted && promptPreviews[stage.key])) && (
                          <div className="space-y-2">
                            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                              <div className="flex items-center justify-between p-2 border-b border-blue-200 dark:border-blue-800">
                                <div className="flex items-center gap-2">
                                  <Send className="h-3 w-3 text-blue-600" />
                                  <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                                    INPUT → AI
                                  </span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyToClipboard(stagePrompt || promptPreviews[stage.key], "Prompt")}
                                  className="h-6 w-6 p-0"
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="p-2 max-h-96 overflow-y-auto">
                                <pre className="text-xs font-mono whitespace-pre-wrap text-blue-800 dark:text-blue-200">
                                  {stagePrompt || promptPreviews[stage.key]}
                                </pre>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Show Output/Response */}
                        {stageResult && (
                          <div className="space-y-2">
                            <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
                              <div className="flex items-center justify-between p-2 border-b border-green-200 dark:border-green-800">
                                <div className="flex items-center gap-2">
                                  <CheckCircle className="h-3 w-3 text-green-600" />
                                  <span className="text-xs font-medium text-green-700 dark:text-green-300">
                                    OUTPUT ← AI
                                  </span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyToClipboard(stageResult, "Response")}
                                  className="h-6 w-6 p-0"
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="p-2 max-h-96 overflow-y-auto">
                                <pre className="text-xs font-mono whitespace-pre-wrap text-green-800 dark:text-green-200">
                                  {stageResult}
                                </pre>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Prompt Control Interface */}
                        {(isActive || isCompleted) && (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => togglePromptEditor(stage.key)}
                                className="text-xs"
                              >
                                <Edit3 className="mr-1 h-3 w-3" />
                                {showPromptEditor[stage.key] ? 'Verberg prompt editor' : 'Bewerk volledige prompt'}
                              </Button>
                              
                              {!showPromptEditor[stage.key] && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleCustomInput(stage.key)}
                                  className="text-xs"
                                >
                                  <Plus className="mr-1 h-3 w-3" />
                                  {showCustomInput[stage.key] ? 'Verberg' : 'Extra input toevoegen'}
                                </Button>
                              )}
                            </div>
                            
                            {/* Full Prompt Editor */}
                            {showPromptEditor[stage.key] && (
                              <div className="space-y-3">
                                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                                  <div className="flex items-center justify-between p-2 border-b border-blue-200 dark:border-blue-800">
                                    <div className="flex items-center gap-2">
                                      <Edit3 className="h-3 w-3 text-blue-600" />
                                      <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                                        VOLLEDIGE PROMPT BEWERKEN
                                      </span>
                                    </div>
                                  </div>
                                  <div className="p-2">
                                    <Textarea
                                      value={editingPrompts[stage.key] || ''}
                                      onChange={(e) => updateEditingPrompt(stage.key, e.target.value)}
                                      className="text-xs font-mono min-h-60 resize-y"
                                      placeholder="De prompt wordt hier geladen..."
                                    />
                                  </div>
                                </div>
                                
                                <div className="flex gap-2">
                                  <Button
                                    onClick={() => executeWithCustomPrompt(stage.key)}
                                    disabled={executeStageM.isPending || !editingPrompts[stage.key]}
                                    className="flex-1"
                                    size="sm"
                                  >
                                    {executeStageM.isPending ? (
                                      <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                                        AI is bezig...
                                      </>
                                    ) : (
                                      <>
                                        <Send className="mr-2 h-4 w-4" />
                                        Uitvoeren met aangepaste prompt
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      const originalPrompt = state.stagePrompts[stage.key] || promptPreviews[stage.key] || '';
                                      updateEditingPrompt(stage.key, originalPrompt);
                                    }}
                                  >
                                    Reset
                                  </Button>
                                </div>
                                
                                <p className="text-xs text-muted-foreground">
                                  Je kunt de volledige prompt bewerken en direct uitvoeren. Klik Reset om terug te gaan naar de originele prompt.
                                </p>
                              </div>
                            )}
                            
                            {/* Quick Extra Input (when not using full editor) */}
                            {!showPromptEditor[stage.key] && showCustomInput[stage.key] && (
                              <div className="space-y-2">
                                <Textarea
                                  placeholder="Voeg hier extra instructies of informatie toe die aan de prompt moet worden toegevoegd..."
                                  value={customInputs[stage.key] || ''}
                                  onChange={(e) => updateCustomInput(stage.key, e.target.value)}
                                  className="text-xs min-h-20"
                                />
                                <p className="text-xs text-muted-foreground">
                                  Deze tekst wordt toegevoegd aan de standaard prompt voor deze stap
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Action buttons for active stage */}
                        {isActive && !isCompleted && (
                          <>
                            {isReviewer ? (
                              <div className="space-y-3 mt-3">
                                {!hasReview && (
                                  <Button 
                                    onClick={() => state.currentReport && executeSubstepM.mutate({
                                      substepKey: stage.key,
                                      substepType: "review",
                                      reportId: state.currentReport.id
                                    })}
                                    disabled={executeSubstepM.isPending}
                                    className="w-full"
                                    size="sm"
                                  >
                                    <MessageSquare className="mr-2 h-4 w-4" />
                                    Start AI Review
                                  </Button>
                                )}
                                
                                {hasReview && !hasProcessing && (
                                  <ReviewFeedbackEditor
                                    stageName={stage.label}
                                    aiReviewOutput={substepResults.review || ""}
                                    onProcessFeedback={(mergedFeedback) => {
                                      if (state.currentReport) {
                                        executeSubstepM.mutate({
                                          substepKey: "5_feedback_verwerker",
                                          substepType: "processing",
                                          reportId: state.currentReport.id,
                                          customInput: mergedFeedback
                                        });
                                      }
                                    }}
                                    isProcessing={executeSubstepM.isPending && executeSubstepM.variables?.substepType === "processing"}
                                    hasProcessingResult={hasProcessing}
                                  />
                                )}
                              </div>
                            ) : (
                              <div className="mt-3">
                                <Button 
                                  onClick={executeCurrentStage}
                                  disabled={isProcessing || !canStart}
                                  className="w-full"
                                  size="sm"
                                >
                                  {isProcessing ? (
                                    <>
                                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                                      AI is bezig...
                                    </>
                                  ) : (
                                    <>
                                      <Play className="mr-2 h-4 w-4" />
                                      Start deze stap
                                    </>
                                  )}
                                </Button>
                                
                                {/* Enhanced Processing indicator */}
                                {isProcessing && (
                                  <div className="mt-3 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                                    <div className="space-y-3">
                                      {/* Main status */}
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                                          <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                                            {stageProgress[stage.key]?.status || 'AI specialist aan het werk...'}
                                          </span>
                                        </div>
                                        <div className="text-xs text-blue-600 dark:text-blue-400">
                                          {heartbeat[stage.key] ? `${heartbeat[stage.key]}s` : ''}
                                        </div>
                                      </div>
                                      
                                      {/* Progress bar with estimated time */}
                                      <div className="space-y-2">
                                        <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
                                          <div 
                                            className="bg-blue-600 h-2 rounded-full transition-all duration-1000" 
                                            style={{ 
                                              width: `${Math.min(95, Math.max(5, (heartbeat[stage.key] || 0) * 2))}%`,
                                              animationDuration: heartbeat[stage.key] > 30 ? '2s' : '1s'
                                            }} 
                                          />
                                        </div>
                                        
                                        {/* Time information */}
                                        <div className="flex justify-between text-xs text-blue-600 dark:text-blue-400">
                                          <span>
                                            Verstreken: {heartbeat[stage.key] || 0}s
                                          </span>
                                          {(() => {
                                            const estimated = calculateEstimatedTime(stage.key);
                                            const historicalTime = state.stageTimes[stage.key] || 60;
                                            return (
                                              <span>
                                                {estimated !== null ? (
                                                  `Nog ~${formatTimeRemaining(estimated)}`
                                                ) : (
                                                  `Gemiddeld: ${Math.round(historicalTime)}s`
                                                )}
                                              </span>
                                            );
                                          })()} 
                                        </div>
                                      </div>
                                      
                                      {/* Activity status */}
                                      <div className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                        <span>Actief - AI genereert inhoud</span>
                                        {heartbeat[stage.key] > 60 && (
                                          <span className="ml-2 text-orange-600">
                                            (Complexe analyse - kan langer duren)
                                          </span>
                                        )}
                                      </div>
                                      
                                      {/* Cancel option for long running processes */}
                                      {heartbeat[stage.key] > 90 && (
                                        <div className="pt-2 border-t border-blue-300 dark:border-blue-700">
                                          <div className="flex items-center justify-between">
                                            <span className="text-xs text-orange-700 dark:text-orange-300">
                                              ⚠️ Proces duurt langer dan verwacht
                                            </span>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => {
                                                // TODO: Implement cancel functionality
                                                console.log('Cancel requested for', stage.key);
                                              }}
                                              className="text-xs h-6 px-2"
                                            >
                                              Annuleren
                                            </Button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}

                        {/* Re-run button for completed stages */}
                        {isCompleted && (
                          <Button
                            onClick={() => executeStage(stage.key)}
                            disabled={executeStageM.isPending}
                            variant="outline"
                            size="sm"
                            className="w-full"
                          >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Opnieuw uitvoeren
                          </Button>
                        )}
                        
                        {/* No prompt/output yet message */}
                        {!stagePrompt && !stageResult && !isActive && !promptPreviews[stage.key] && (
                          <p className="text-xs text-muted-foreground text-center py-2">
                            Deze stap is nog niet uitgevoerd
                          </p>
                        )}
                      </div>
                  </div>
                )}
              </div>
            );
          })}
            </CardContent>
          </Card>
        </motion.div>

      
      {/* Live Process Monitor */}
      {Object.keys(state.stageProcessing || {}).some(key => state.stageProcessing[key]) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Card className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 backdrop-blur border border-green-200/50 dark:border-green-700/30 shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 shadow-lg">
                  <Activity className="h-5 w-5 text-white animate-pulse" />
                </div>
                <span className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                  Live Proces Monitor
                </span>
              </CardTitle>
            </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(state.stageProcessing || {}).map(([stageKey, isProcessing]) => {
                if (!isProcessing) return null;
                const stage = WORKFLOW_STAGES.find(s => s.key === stageKey);
                if (!stage) return null;
                
                const elapsed = heartbeat[stageKey] || 0;
                const estimated = calculateEstimatedTime(stageKey);
                const historicalTime = state.stageTimes[stageKey] || 60;
                
                return (
                  <div key={stageKey} className="bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-950/20 dark:to-green-950/20 border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h4 className="font-medium text-sm">{stage.label}</h4>
                        <p className="text-xs text-muted-foreground">{stage.description}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-blue-600">{elapsed}s</div>
                        <div className="text-xs text-muted-foreground">
                          {estimated !== null ? formatTimeRemaining(estimated) : `~${Math.round(historicalTime)}s`} resterend
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div 
                          className="bg-gradient-to-r from-blue-500 to-green-500 h-2 rounded-full transition-all duration-1000"
                          style={{ 
                            width: `${Math.min(95, Math.max(5, (elapsed / Math.max(historicalTime, 30)) * 100))}%`
                          }}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1 text-green-600">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                          AI aan het werk
                        </span>
                        <span className="text-muted-foreground">
                          {elapsed > historicalTime ? (
                            <span className="text-orange-600">
                              Complexe analyse (+{elapsed - historicalTime}s)
                            </span>
                          ) : (
                            `${Math.round(((elapsed / historicalTime) * 100))}% van verwachte tijd`
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
        </motion.div>
      )}
      </div>
    </>
  );
}