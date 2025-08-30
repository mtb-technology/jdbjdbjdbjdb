import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { 
  Play,
  ArrowRight,
  CheckCircle,
  Clock,
  AlertCircle,
  Edit3,
  Eye,
  RotateCcw,
  FileText
} from "lucide-react";
import type { Report, DossierData, BouwplanData } from "@shared/schema";

const WORKFLOW_STAGES = [
  { key: "1_informatiecheck", label: "1. Informatiecheck", description: "Validatie en opslag dossier", icon: FileText },
  { key: "2_complexiteitscheck", label: "2. Complexiteitscheck", description: "Validatie en opslag bouwplan", icon: AlertCircle },
  { key: "3_generatie", label: "3. Generatie", description: "Basis rapport generatie", icon: FileText },
  { key: "4a_BronnenSpecialist", label: "4a. Bronnen Specialist", description: "Bronverwerking in rapport", icon: CheckCircle },
  { key: "4b_FiscaalTechnischSpecialist", label: "4b. Fiscaal Technisch Specialist", description: "Technische fiscale expertise", icon: CheckCircle },
  { key: "4c_ScenarioGatenAnalist", label: "4c. Scenario Gaten Analist", description: "Scenario analyse en gaps", icon: CheckCircle },
  { key: "4d_DeVertaler", label: "4d. De Vertaler", description: "Taal en communicatie optimalisatie", icon: CheckCircle },
  { key: "4e_DeAdvocaat", label: "4e. De Advocaat", description: "Juridische compliance check", icon: CheckCircle },
  { key: "4f_DeKlantpsycholoog", label: "4f. De Klantpsycholoog", description: "Klantgerichte communicatie", icon: CheckCircle },
  { key: "4g_ChefEindredactie", label: "4g. Chef Eindredactie", description: "Finale redactionele controle", icon: CheckCircle },
  { key: "final_check", label: "Final Check", description: "Laatste controle voor Mathijs", icon: CheckCircle },
] as const;

interface WorkflowInterfaceProps {
  dossier: DossierData;
  bouwplan: BouwplanData;
  clientName: string;
  onComplete: (report: Report) => void;
}

export default function WorkflowInterface({ dossier, bouwplan, clientName, onComplete }: WorkflowInterfaceProps) {
  const [currentReport, setCurrentReport] = useState<Report | null>(null);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [stageResults, setStageResults] = useState<Record<string, string>>({});
  const [conceptReportVersions, setConceptReportVersions] = useState<Record<string, string>>({});
  const [editingStage, setEditingStage] = useState<string | null>(null);
  const [customInput, setCustomInput] = useState("");
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [autoRunMode, setAutoRunMode] = useState(false);
  const [viewMode, setViewMode] = useState<"stage" | "concept">("stage");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createReportMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/reports/create", {
        dossier,
        bouwplan,
        clientName,
      });
      return response.json();
    },
    onSuccess: (report: Report) => {
      setCurrentReport(report);
      setStageResults(report.stageResults as Record<string, string> || {});
      setConceptReportVersions(report.conceptReportVersions as Record<string, string> || {});
      
      // Automatically start auto-execution after report creation
      setTimeout(() => {
        setAutoRunMode(true);
        setIsAutoRunning(true);
      }, 500);
    },
    onError: (error: Error) => {
      toast({
        title: "Fout bij aanmaken",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const executeStageM = useMutation({
    mutationFn: async ({ reportId, stage, customInput }: { reportId: string; stage: string; customInput?: string }) => {
      const response = await apiRequest("POST", `/api/reports/${reportId}/stage/${stage}`, {
        customInput,
      });
      return response.json();
    },
    onSuccess: (data: { report: Report; stageResult: string; conceptReport?: string }) => {
      setCurrentReport(data.report);
      setStageResults(prev => ({
        ...prev,
        [WORKFLOW_STAGES[currentStageIndex].key]: data.stageResult
      }));
      
      // Update concept report versions if provided
      if (data.conceptReport) {
        setConceptReportVersions(prev => ({
          ...prev,
          [WORKFLOW_STAGES[currentStageIndex].key]: data.conceptReport as string
        }));
      }
      
      setCustomInput("");
      setEditingStage(null);
      
      // Auto-advance to next stage only if not in manual mode
      if (autoRunMode && currentStageIndex < WORKFLOW_STAGES.length - 1) {
        setTimeout(() => {
          setCurrentStageIndex(prev => prev + 1);
        }, 1000);
      }
      
      toast({
        title: "Stap voltooid",
        description: `${WORKFLOW_STAGES[currentStageIndex].label} is succesvol uitgevoerd.`,
      });
    },
    onError: (error: Error) => {
      setIsAutoRunning(false);
      toast({
        title: "Fout bij uitvoeren stap",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const finalizeReportMutation = useMutation({
    mutationFn: async (reportId: string) => {
      const response = await apiRequest("POST", `/api/reports/${reportId}/finalize`);
      return response.json();
    },
    onSuccess: (report: Report) => {
      setCurrentReport(report);
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

  const startWorkflow = () => {
    createReportMutation.mutate();
  };

  // Auto-execute next stage when in auto mode
  useEffect(() => {
    if (autoRunMode && isAutoRunning && currentReport && !stageResults[WORKFLOW_STAGES[currentStageIndex].key]) {
      // Execute current stage after a short delay
      const timer = setTimeout(() => {
        executeCurrentStage();
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [currentStageIndex, autoRunMode, isAutoRunning, currentReport]);

  const executeCurrentStage = () => {
    if (!currentReport) return;
    
    const currentStage = WORKFLOW_STAGES[currentStageIndex];
    executeStageM.mutate({
      reportId: currentReport.id,
      stage: currentStage.key,
      customInput: customInput || undefined,
    });
  };

  // Auto-execute all remaining stages sequentially
  const startAutoExecution = async () => {
    if (!currentReport) return;
    
    setIsAutoRunning(true);
    setAutoRunMode(true);
    
    try {
      // Execute all remaining stages sequentially
      for (let i = currentStageIndex; i < WORKFLOW_STAGES.length; i++) {
        const stage = WORKFLOW_STAGES[i];
        
        // Skip if stage already completed
        if (stageResults[stage.key]) {
          setCurrentStageIndex(i);
          continue;
        }
        
        setCurrentStageIndex(i);
        
        // Execute stage
        const response = await apiRequest("POST", `/api/reports/${currentReport.id}/stage/${stage.key}`, {
          customInput: undefined,
        });
        
        const data = await response.json();
        
        setCurrentReport(data.report);
        setStageResults(prev => ({
          ...prev,
          [stage.key]: data.stageResult
        }));
        
        // Update concept report versions if provided
        if (data.conceptReport) {
          setConceptReportVersions(prev => ({
            ...prev,
            [stage.key]: data.conceptReport
          }));
        }
        
        // Small delay between stages for better UX
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Finalize report after all stages
      const response = await apiRequest("POST", `/api/reports/${currentReport.id}/finalize`);
      const finalReport = await response.json();
      
      setCurrentReport(finalReport);
      onComplete(finalReport);
      
      toast({
        title: "Workflow voltooid",
        description: "Alle stappen zijn succesvol uitgevoerd en het rapport is gegenereerd.",
      });
      
    } catch (error) {
      toast({
        title: "Fout in automatische uitvoering",
        description: error instanceof Error ? error.message : "Onbekende fout",
        variant: "destructive",
      });
    } finally {
      setIsAutoRunning(false);
    }
  };

  const goToNextStage = () => {
    if (currentStageIndex < WORKFLOW_STAGES.length - 1) {
      setCurrentStageIndex(prev => prev + 1);
    } else {
      // Final stage reached, finalize report
      if (currentReport) {
        finalizeReportMutation.mutate(currentReport.id);
      }
    }
  };

  const goToPreviousStage = () => {
    if (currentStageIndex > 0) {
      setCurrentStageIndex(prev => prev - 1);
    }
  };

  const getStageStatus = (index: number) => {
    const stage = WORKFLOW_STAGES[index];
    const hasResult = !!stageResults[stage.key];
    
    if (index < currentStageIndex) return "completed";
    if (index === currentStageIndex) return "current";
    if (hasResult) return "completed";
    return "pending";
  };

  const currentStage = WORKFLOW_STAGES[currentStageIndex];
  const currentStageResult = stageResults[currentStage.key];
  const progressPercentage = (Object.keys(stageResults).length / WORKFLOW_STAGES.length) * 100;

  if (!currentReport) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Play className="mr-2 h-5 w-5 text-primary" />
              Start Rapport Workflow
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Klaar om het 11-stappen prompting proces te starten voor {clientName}?
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <strong>Klant:</strong> {dossier.klant.naam}
                </div>
                <div>
                  <strong>Situatie:</strong> {dossier.klant.situatie}
                </div>
                <div>
                  <strong>Taal:</strong> {bouwplan.taal === 'nl' ? 'Nederlands' : 'Engels'}
                </div>
              </div>
              
              <Button 
                onClick={startWorkflow} 
                disabled={createReportMutation.isPending}
                className="w-full"
                data-testid="button-start-workflow"
              >
                {createReportMutation.isPending ? "Starten..." : "Start Workflow"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Progress Header */}
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Rapport Workflow - {clientName}</h2>
              <Badge variant="outline">
                {Object.keys(stageResults).length}/{WORKFLOW_STAGES.length} Stappen Voltooid
              </Badge>
            </div>
            
            <Progress value={progressPercentage} className="w-full" />
            
            <div className="text-sm text-muted-foreground">
              Huidige stap: {currentStage.label}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Workflow Steps Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Workflow Stappen</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {WORKFLOW_STAGES.map((stage, index) => {
              const status = getStageStatus(index);
              const IconComponent = stage.icon;
              
              return (
                <div
                  key={stage.key}
                  className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${
                    status === "current" 
                      ? "bg-primary/10 border-primary" 
                      : status === "completed" 
                      ? "bg-muted/50 border-border" 
                      : "bg-background border-border opacity-60"
                  }`}
                  onClick={() => status !== "pending" && setCurrentStageIndex(index)}
                  data-testid={`stage-${stage.key}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${
                    status === "completed" ? "bg-green-500 text-white" :
                    status === "current" ? "bg-primary text-primary-foreground" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {status === "completed" ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : status === "current" ? (
                      <Clock className="h-4 w-4" />
                    ) : (
                      <IconComponent className="h-4 w-4" />
                    )}
                  </div>
                  
                  <div className="flex-1">
                    <div className="font-medium">{stage.label}</div>
                    <div className="text-sm text-muted-foreground">{stage.description}</div>
                  </div>
                  
                  {status === "current" && (
                    <ArrowRight className="h-4 w-4 text-primary" />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Current Stage Execution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Huidige Stap: {currentStage.label}</span>
            <div className="flex items-center space-x-2">
              {currentStageIndex > 0 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={goToPreviousStage}
                  data-testid="button-previous-stage"
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  Vorige
                </Button>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          
          {/* Stage Input (if needed) */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Aanvullende Input (optioneel)
            </label>
            <Textarea
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="Voer hier eventuele aanvullende instructies of context voor deze stap in..."
              className="min-h-16"
              data-testid="textarea-stage-input"
            />
          </div>

          {/* Auto Execute Buttons */}
          {!autoRunMode && !currentStageResult && (
            <div className="space-y-2">
              <Button
                onClick={startAutoExecution}
                disabled={isAutoRunning || executeStageM.isPending}
                className="w-full bg-primary"
                data-testid="button-auto-execute"
              >
                <Play className="mr-2 h-4 w-4" />
                {isAutoRunning ? "Automatisch uitvoeren..." : `Alle Stappen Automatisch Uitvoeren`}
              </Button>
              
              <Button
                onClick={executeCurrentStage}
                disabled={executeStageM.isPending || isAutoRunning}
                variant="outline"
                className="w-full"
                data-testid="button-execute-stage"
              >
                <Play className="mr-2 h-4 w-4" />
                {executeStageM.isPending ? "Uitvoeren..." : `Alleen ${currentStage.label}`}
              </Button>
            </div>
          )}

          {/* Auto Running Status */}
          {isAutoRunning && (
            <div className="flex items-center justify-center p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
              <Clock className="mr-2 h-4 w-4 animate-spin text-blue-600" />
              <span className="text-blue-700 dark:text-blue-300 font-medium">
                Automatisch uitvoeren stap {currentStageIndex + 1}/{WORKFLOW_STAGES.length}...
              </span>
            </div>
          )}

          {/* Stage Result */}
          {currentStageResult && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <h4 className="font-medium text-foreground">Resultaat:</h4>
                  
                  {/* View Mode Toggle */}
                  {conceptReportVersions[currentStage.key] && (
                    <div className="flex bg-muted rounded-lg p-1">
                      <Button
                        variant={viewMode === "stage" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setViewMode("stage")}
                        className="text-xs px-3 py-1 h-7"
                        data-testid="button-view-stage"
                      >
                        Specialist Output
                      </Button>
                      <Button
                        variant={viewMode === "concept" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setViewMode("concept")}
                        className="text-xs px-3 py-1 h-7"
                        data-testid="button-view-concept"
                      >
                        Concept Rapport
                      </Button>
                    </div>
                  )}
                </div>
                
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingStage(editingStage === currentStage.key ? null : currentStage.key)}
                    data-testid="button-edit-result"
                  >
                    <Edit3 className="mr-1 h-3 w-3" />
                    {editingStage === currentStage.key ? "Sluiten" : "Bewerken"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={executeCurrentStage}
                    disabled={executeStageM.isPending}
                    data-testid="button-rerun-stage"
                  >
                    <RotateCcw className="mr-1 h-3 w-3" />
                    Opnieuw
                  </Button>
                </div>
              </div>
              
              {editingStage === currentStage.key ? (
                <div className="space-y-2">
                  <Textarea
                    value={viewMode === "stage" ? currentStageResult : (conceptReportVersions[currentStage.key] || "")}
                    onChange={(e) => {
                      if (viewMode === "stage") {
                        setStageResults(prev => ({
                          ...prev,
                          [currentStage.key]: e.target.value
                        }));
                      } else {
                        setConceptReportVersions(prev => ({
                          ...prev,
                          [currentStage.key]: e.target.value
                        }));
                      }
                    }}
                    className="min-h-32 font-mono text-sm"
                    data-testid="textarea-edit-result"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditingStage(null)}
                    data-testid="button-save-edit"
                  >
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Opslaan
                  </Button>
                </div>
              ) : (
                <div className="bg-muted/50 rounded-lg p-4 max-h-64 overflow-y-auto">
                  <div className="text-xs text-blue-600 dark:text-blue-400 mb-2 font-medium">
                    {viewMode === "stage" ? "Specialist Output:" : "Bijgewerkt Concept Rapport:"}
                  </div>
                  <pre className="text-sm whitespace-pre-wrap text-muted-foreground">
                    {viewMode === "stage" ? currentStageResult : (conceptReportVersions[currentStage.key] || "Geen concept rapport voor deze stap")}
                  </pre>
                </div>
              )}

              <Separator />

              {/* Navigation */}
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Stap {currentStageIndex + 1} van {WORKFLOW_STAGES.length}
                </div>
                
                <Button
                  onClick={goToNextStage}
                  data-testid="button-next-stage"
                >
                  {currentStageIndex === WORKFLOW_STAGES.length - 1 ? (
                    <>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Rapport Finaliseren
                    </>
                  ) : (
                    <>
                      <ArrowRight className="mr-2 h-4 w-4" />
                      Volgende Stap
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* All Completed Stages Summary */}
      {Object.keys(stageResults).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Voltooide Stappen</span>
              
              {/* Latest Concept Report Preview */}
              {Object.keys(conceptReportVersions).length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const latestKey = Object.keys(conceptReportVersions).sort().pop();
                    if (latestKey) {
                      setViewMode("concept");
                      // Find stage index for latest concept
                      const stageIndex = WORKFLOW_STAGES.findIndex(s => s.key === latestKey);
                      if (stageIndex !== -1) {
                        setCurrentStageIndex(stageIndex);
                      }
                    }
                  }}
                  data-testid="button-view-latest-concept"
                >
                  <Eye className="mr-1 h-3 w-3" />
                  Laatste Concept Bekijken
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {WORKFLOW_STAGES.map((stage, index) => {
                const stageResult = stageResults[stage.key];
                const conceptResult = conceptReportVersions[stage.key];
                if (!stageResult) return null;
                
                return (
                  <div key={stage.key} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <h5 className="font-medium text-sm">{stage.label}</h5>
                      <div className="flex items-center space-x-2">
                        <Badge variant="secondary" className="text-xs">Voltooid</Badge>
                        {conceptResult && (
                          <Badge variant="outline" className="text-xs text-blue-600">
                            + Concept Update
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground max-h-20 overflow-y-auto">
                      <div className="font-medium text-muted-foreground mb-1">Specialist Output:</div>
                      {stageResult.length > 150 ? `${stageResult.substring(0, 150)}...` : stageResult}
                      
                      {conceptResult && (
                        <div className="mt-2 pt-2 border-t border-muted">
                          <div className="font-medium text-blue-600 dark:text-blue-400 mb-1">Concept Rapport Update:</div>
                          <div className="text-blue-700 dark:text-blue-300">
                            {conceptResult.length > 100 ? `${conceptResult.substring(0, 100)}...` : conceptResult}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}