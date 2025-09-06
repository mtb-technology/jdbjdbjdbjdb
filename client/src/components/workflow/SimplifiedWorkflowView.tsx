import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
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
  Edit3
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
}

export function SimplifiedWorkflowView({
  state,
  dispatch,
  executeStageM,
  executeSubstepM,
  isCreatingCase
}: SimplifiedWorkflowViewProps) {
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"simple" | "detailed">("simple");
  const [promptPreviews, setPromptPreviews] = useState<Record<string, string>>({});
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [showCustomInput, setShowCustomInput] = useState<Record<string, boolean>>({});
  const { toast } = useToast();
  
  const currentStage = WORKFLOW_STAGES[state.currentStageIndex];
  const progressPercentage = Math.round((Object.keys(state.stageResults).length / WORKFLOW_STAGES.length) * 100);
  
  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: `${type} gekopieerd`,
      duration: 2000,
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

  // Fetch prompt preview for a stage
  const fetchPromptPreview = async (stageKey: string) => {
    if (!state.currentReport || promptPreviews[stageKey]) return;
    
    setLoadingPreview(stageKey);
    try {
      const response = await fetch(`/api/reports/${state.currentReport.id}/stage/${stageKey}/preview`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data?.prompt) {
          setPromptPreviews(prev => ({ ...prev, [stageKey]: data.data.prompt }));
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

  // Auto-fetch prompt preview for current stage in detailed view
  useEffect(() => {
    if (viewMode === "detailed" && currentStage && !state.stageResults[currentStage.key]) {
      fetchPromptPreview(currentStage.key);
    }
  }, [viewMode, state.currentStageIndex, state.currentReport]);

  return (
    <div className="space-y-4 max-w-full overflow-hidden">
      {/* Progress Header */}
      <Card className="bg-gradient-to-r from-primary/5 to-primary/10">
        <CardContent className="p-4 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Workflow className="h-5 w-5 md:h-6 md:w-6 text-primary" />
              <h2 className="text-lg md:text-xl font-bold">Fiscale Rapport Workflow</h2>
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
              <Badge variant="outline" className="text-xs md:text-sm w-fit">
                {Object.keys(state.stageResults).length}/{WORKFLOW_STAGES.length} Stappen
              </Badge>
              {totalProcessingTime > 0 && (
                <div className="flex items-center gap-1 text-xs md:text-sm text-muted-foreground">
                  <Clock className="h-3 w-3 md:h-4 md:w-4" />
                  {totalProcessingTime}s totaal
                </div>
              )}
            </div>
          </div>
          
          <Progress value={progressPercentage} className="h-2 md:h-3 my-3" />
          
          {/* View Mode Toggle */}
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <p className="text-xs md:text-sm text-muted-foreground">
              Huidige stap: {currentStage.label}
            </p>
            <Tabs value={viewMode} onValueChange={(v: any) => setViewMode(v)}>
              <TabsList className="h-7 md:h-8 w-full md:w-auto">
                <TabsTrigger value="simple" className="text-xs flex-1 md:flex-none">
                  <Zap className="h-3 w-3 mr-1" />
                  Simpel
                </TabsTrigger>
                <TabsTrigger value="detailed" className="text-xs flex-1 md:flex-none">
                  <FileText className="h-3 w-3 mr-1" />
                  Gedetailleerd
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* Unified Workflow Interface */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {viewMode === "simple" ? (
              <>
                <Zap className="h-5 w-5" />
                Workflow Overzicht
              </>
            ) : (
              <>
                <Eye className="h-5 w-5" />
                Gedetailleerde Workflow met AI Interacties
              </>
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {viewMode === "simple" 
              ? "Klik op een stap om deze uit te voeren"
              : "Bekijk exact wat naar de AI wordt gestuurd en wat terugkomt"}
          </p>
        </CardHeader>
        <CardContent className="p-3 md:p-4">
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
                    {/* Simple View: Just show action buttons */}
                    {viewMode === "simple" && (
                      <>
                        {/* For reviewer stages */}
                        {isReviewer && isActive && (
                          <div className="mt-3 space-y-3">
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
                            
                            {hasReview && hasProcessing && (
                              <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200">
                                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                                  <CheckCircle className="h-4 w-4" />
                                  <span className="text-sm font-medium">Review voltooid!</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* For regular stages */}
                        {!isReviewer && isActive && !isCompleted && (
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
                          </div>
                        )}
                        
                        {/* Completed indicator with re-run button */}
                        {isCompleted && (
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                              <CheckCircle className="h-4 w-4" />
                              <span className="text-sm">Voltooid</span>
                            </div>
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
                          </div>
                        )}
                      </>
                    )}

                    {/* Detailed View: Show full prompts and outputs */}
                    {viewMode === "detailed" && (
                      <div className="mt-3 space-y-3">
                        {/* Show Prompt Preview for any stage when available */}
                        {!stagePrompt && (promptPreviews[stage.key] || loadingPreview === stage.key) && (
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
                        
                        {/* Show Input/Prompt after execution */}
                        {stagePrompt && (
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
                                  onClick={() => copyToClipboard(stagePrompt, "Prompt")}
                                  className="h-6 w-6 p-0"
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="p-2 max-h-96 overflow-y-auto">
                                <pre className="text-xs font-mono whitespace-pre-wrap text-blue-800 dark:text-blue-200">
                                  {stagePrompt}
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

                        {/* Action buttons for active stage */}
                        {isActive && !isCompleted && (
                          <>
                            {isReviewer ? (
                              <div className="space-y-3">
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
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Quick Stats Summary */}
      {Object.keys(state.stageResults).length > 0 && (
        <Card className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Voltooid</p>
                <p className="text-lg font-bold text-green-600">
                  {Object.keys(state.stageResults).length}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Resterend</p>
                <p className="text-lg font-bold text-orange-600">
                  {WORKFLOW_STAGES.length - Object.keys(state.stageResults).length}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Tijd</p>
                <p className="text-lg font-bold text-blue-600">
                  {totalProcessingTime}s
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Voortgang</p>
                <p className="text-lg font-bold text-primary">
                  {progressPercentage}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}