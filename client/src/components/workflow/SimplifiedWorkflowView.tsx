import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { 
  Play, 
  CheckCircle, 
  Eye, 
  EyeOff, 
  ChevronRight,
  Copy,
  MessageSquare,
  Clock,
  Workflow,
  ArrowRight,
  Send
} from "lucide-react";
import { useState } from "react";
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
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"simple" | "detailed">("simple");
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

  const executeCurrentStage = () => {
    if (!state.currentReport) return;
    
    executeStageM.mutate({
      reportId: state.currentReport.id,
      stage: currentStage.key,
      customInput: state.customInput || undefined,
    });
  };

  const handleStageClick = (stageKey: string, index: number) => {
    // Navigate to stage if already completed
    if (state.stageResults[stageKey]) {
      dispatch({ type: "SET_STAGE_INDEX", payload: index });
      setExpandedStage(stageKey);
    }
  };

  return (
    <div className="space-y-4">
      {/* Progress Header */}
      <Card className="bg-gradient-to-r from-primary/5 to-primary/10">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Workflow className="h-6 w-6 text-primary" />
              <h2 className="text-xl font-bold">Fiscale Rapport Workflow</h2>
            </div>
            <div className="flex items-center gap-4">
              <Badge variant="outline" className="text-sm">
                {Object.keys(state.stageResults).length}/{WORKFLOW_STAGES.length} Voltooid
              </Badge>
              {Object.keys(state.stageTimes).length > 0 && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {Object.values(state.stageTimes).reduce((a: number, b: any) => a + (Number(b) || 0), 0)}s
                </div>
              )}
            </div>
          </div>
          
          <Progress value={progressPercentage} className="h-3 mb-3" />
          
          {/* View Mode Toggle */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Stap {state.currentStageIndex + 1}: {currentStage.label}
            </p>
            <Tabs value={viewMode} onValueChange={(v: any) => setViewMode(v)}>
              <TabsList className="h-8">
                <TabsTrigger value="simple" className="text-xs">Simpel</TabsTrigger>
                <TabsTrigger value="detailed" className="text-xs">Gedetailleerd</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* Complete Input/Output Transparency */}
      <Card className="border-2 border-primary/30">
        <CardHeader className="bg-gradient-to-r from-primary/5 to-primary/10">
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Complete Transparantie - Alle AI Prompts & Outputs
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Hieronder zie je EXACT wat naar de AI wordt gestuurd en wat terugkomt - precies zoals je handmatig zou doen.
          </p>
        </CardHeader>
        <CardContent className="p-4">
          {WORKFLOW_STAGES.map((stage, index) => {
            const stageResult = state.stageResults[stage.key] || "";
            const stagePrompt = state.stagePrompts[stage.key] || "";
            const isActive = index === state.currentStageIndex;
            const isCompleted = !!stageResult;
            const isProcessing = state.stageProcessing[stage.key] || false;
            const processingTime = state.stageTimes[stage.key];
            
            return (
              <div key={`transparency-${stage.key}`} className={`border rounded-lg p-4 mb-4 ${
                isActive ? 'ring-2 ring-primary border-primary bg-primary/5' : 
                isCompleted ? 'border-green-500/50 bg-green-50/30 dark:bg-green-950/20' : 
                'border-gray-200 opacity-60'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      isCompleted ? 'bg-green-500 text-white' :
                      isActive ? 'bg-primary text-white' :
                      'bg-gray-200 text-gray-400'
                    }`}>
                      {isCompleted ? <CheckCircle className="h-5 w-5" /> : 
                       isProcessing ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
                       <span className="text-sm font-medium">{index + 1}</span>}
                    </div>
                    <div>
                      <h3 className="font-medium">{stage.label}</h3>
                      {processingTime && (
                        <Badge variant="outline" className="text-xs mt-1">
                          {processingTime}s
                        </Badge>
                      )}
                    </div>
                  </div>
                  {isProcessing && (
                    <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                      <div className="w-3 h-3 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-sm font-medium">AI bezig...</span>
                    </div>
                  )}
                </div>

                {/* Input/Output Display */}
                {(stagePrompt || stageResult || isActive) && (
                  <div className="space-y-4">
                    {/* AI Input (Prompt) */}
                    {stagePrompt && (
                      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <div className="flex items-center justify-between p-3 border-b border-blue-200 dark:border-blue-800">
                          <div className="flex items-center gap-2">
                            <Send className="h-4 w-4 text-blue-600" />
                            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                              Prompt naar AI
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(stagePrompt, "Prompt")}
                            className="h-6 text-blue-600 hover:text-blue-700"
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="p-3 max-h-60 overflow-y-auto">
                          <pre className="text-xs font-mono whitespace-pre-wrap text-blue-800 dark:text-blue-200">
                            {stagePrompt}
                          </pre>
                        </div>
                      </div>
                    )}

                    {/* Arrow between input and output */}
                    {stagePrompt && stageResult && (
                      <div className="flex justify-center">
                        <ArrowRight className="h-5 w-5 text-gray-400" />
                      </div>
                    )}

                    {/* AI Output (Response) */}
                    {stageResult && (
                      <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
                        <div className="flex items-center justify-between p-3 border-b border-green-200 dark:border-green-800">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <span className="text-sm font-medium text-green-700 dark:text-green-300">
                              AI Response
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(stageResult, "Response")}
                            className="h-6 text-green-600 hover:text-green-700"
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="p-3 max-h-60 overflow-y-auto">
                          <pre className="text-xs font-mono whitespace-pre-wrap text-green-800 dark:text-green-200">
                            {stageResult.slice(0, 1000)}{stageResult.length > 1000 ? '...' : ''}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Interactive Workflow Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Workflow Controle</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {WORKFLOW_STAGES.map((stage, index) => {
            const isActive = index === state.currentStageIndex;
            const isCompleted = !!state.stageResults[stage.key];
            const isProcessing = state.stageProcessing[stage.key];
            const canStart = index === 0 || !!state.stageResults[WORKFLOW_STAGES[index - 1].key];
            const isExpanded = expandedStage === stage.key || isActive;
            
            // For reviewer stages, check substep results
            const isReviewer = stage.type === "reviewer";
            const substepResults = state.substepResults[stage.key] || {};
            const hasReview = !!substepResults.review;
            const hasProcessing = !!substepResults.processing;
            
            return (
              <div 
                key={stage.key}
                className={`border rounded-lg mb-3 transition-all ${
                  isActive ? 'ring-2 ring-primary border-primary' : 
                  isCompleted ? 'border-green-500/50 bg-green-50/30 dark:bg-green-950/20' : 
                  'border-gray-200'
                }`}
              >
                {/* Stage Header */}
                <div 
                  className={`p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50/50 dark:hover:bg-gray-800/50 ${
                    isCompleted && !isActive ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => handleStageClick(stage.key, index)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      isCompleted ? 'bg-green-500 text-white' :
                      isActive ? 'bg-primary text-white' :
                      'bg-gray-200 text-gray-400'
                    }`}>
                      {isCompleted ? <CheckCircle className="h-5 w-5" /> : 
                       isProcessing ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
                       <span className="text-sm font-medium">{index + 1}</span>}
                    </div>
                    <div>
                      <h3 className="font-medium">{stage.label}</h3>
                      {viewMode === "detailed" && (
                        <p className="text-sm text-muted-foreground">{stage.description}</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {state.stageTimes[stage.key] && (
                      <Badge variant="outline" className="text-xs">
                        {state.stageTimes[stage.key]}s
                      </Badge>
                    )}
                    {isActive && !isProcessing && !isCompleted && (
                      <ChevronRight className="h-5 w-5 text-primary animate-pulse" />
                    )}
                  </div>
                </div>

                {/* Stage Content - Only show for active or completed stages when expanded */}
                {(isActive || (isExpanded && isCompleted)) && (
                  <div className="px-4 pb-4 border-t">
                    {/* For reviewer stages with special handling */}
                    {isReviewer && isActive && (
                      <div className="mt-4 space-y-4">
                        {/* Review button */}
                        {!hasReview && (
                          <Button 
                            onClick={() => state.currentReport && executeSubstepM.mutate({
                              substepKey: stage.key,
                              substepType: "review",
                              reportId: state.currentReport.id
                            })}
                            disabled={executeSubstepM.isPending}
                            className="w-full"
                          >
                            <MessageSquare className="mr-2 h-4 w-4" />
                            Start AI Review
                          </Button>
                        )}
                        
                        {/* Feedback Editor */}
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
                        
                        {/* Completion status */}
                        {hasReview && hasProcessing && (
                          <div className="p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200">
                            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                              <CheckCircle className="h-5 w-5" />
                              <span className="font-medium">Review voltooid en verwerkt!</span>
                            </div>
                            <Button 
                              className="mt-3 w-full"
                              onClick={() => {
                                const nextIndex = Math.min(state.currentStageIndex + 1, WORKFLOW_STAGES.length - 1);
                                dispatch({ type: "SET_STAGE_INDEX", payload: nextIndex });
                              }}
                            >
                              Ga naar volgende stap →
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* For regular stages */}
                    {!isReviewer && isActive && !isCompleted && (
                      <div className="mt-4">
                        <Button 
                          onClick={executeCurrentStage}
                          disabled={isProcessing || !canStart}
                          className="w-full"
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
                    
                    {/* Show results in detailed mode */}
                    {viewMode === "detailed" && state.stageResults[stage.key] && (
                      <div className="mt-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium">Output</h4>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(state.stageResults[stage.key], "Output")}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-xs font-mono max-h-40 overflow-y-auto">
                          <pre className="whitespace-pre-wrap">{state.stageResults[stage.key].slice(0, 500)}...</pre>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}