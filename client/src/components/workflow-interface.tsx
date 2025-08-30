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
  { key: "1_informatiecheck", label: "1. Informatiecheck", description: "Ruwe tekst → Gestructureerde informatie", icon: FileText },
  { key: "2_complexiteitscheck", label: "2. Complexiteitscheck", description: "Analyse van complexiteit en scope", icon: AlertCircle },
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
  rawText: string;  // Voeg ruwe tekst toe voor dynamische verwerking
  onComplete: (report: Report) => void;
}

export default function WorkflowInterface({ dossier, bouwplan, clientName, rawText, onComplete }: WorkflowInterfaceProps) {
  const [currentReport, setCurrentReport] = useState<Report | null>(null);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [stageResults, setStageResults] = useState<Record<string, string>>({});
  const [conceptReportVersions, setConceptReportVersions] = useState<Record<string, string>>({});
  const [editingStage, setEditingStage] = useState<string | null>(null);
  const [customInput, setCustomInput] = useState("");
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [autoRunMode, setAutoRunMode] = useState(false);
  const [viewMode, setViewMode] = useState<"stage" | "concept">("stage");
  const [stageStartTime, setStageStartTime] = useState<Date | null>(null);
  const [currentStageTimer, setCurrentStageTimer] = useState(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createReportMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/reports/create", {
        dossier,
        bouwplan,
        clientName,
        rawText,  // Stuur ruwe tekst mee voor dynamische verwerking
      });
      return response.json();
    },
    onSuccess: (report: Report) => {
      setCurrentReport(report);
      setStageResults(report.stageResults as Record<string, string> || {});
      setConceptReportVersions(report.conceptReportVersions as Record<string, string> || {});
      
      // Sla report ID op in sessie om dubbele creatie te voorkomen
      sessionStorage.setItem('current-workflow-report-id', report.id);
      
      // Auto-start informatiecheck (stap 1) direct na report aanmaken
      setTimeout(() => {
        executeCurrentStage();
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
      
      // Special messaging for stage 3 - first living report
      const currentStage = WORKFLOW_STAGES[currentStageIndex];
      if (currentStage.key === '3_generatie' && data.report.generatedContent) {
        toast({
          title: "🎉 Eerste rapport versie gereed!",
          description: "Het basis fiscaal rapport is aangemaakt en zal nu door specialisten verfijnd worden.",
          duration: 5000,
        });
      } else if (currentStage.key.startsWith('4') && data.report.generatedContent) {
        toast({
          title: "📝 Rapport bijgewerkt",
          description: `${currentStage.label} heeft het rapport verder verfijnd.`,
        });
      } else {
        toast({
          title: "Stap voltooid",
          description: `${currentStage.label} is succesvol uitgevoerd.`,
        });
      }
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

  // Timer voor huidige stap
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (executeStageM.isPending && stageStartTime) {
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - stageStartTime.getTime()) / 1000);
        setCurrentStageTimer(elapsed);
      }, 1000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [executeStageM.isPending, stageStartTime]);

  // Auto-start workflow direct bij laden - slechts 1x!
  useEffect(() => {
    // Check of er al een report ID in sessionStorage staat voor deze sessie
    const sessionReportId = sessionStorage.getItem('current-workflow-report-id');
    
    if (!currentReport && !createReportMutation.isPending && !sessionReportId) {
      createReportMutation.mutate();
    }
  }, []); // Geen dependencies - wordt slechts 1x uitgevoerd

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


  // Manual execution only - no auto-advance

  const executeCurrentStage = () => {
    if (!currentReport) return;
    
    setStageStartTime(new Date());
    setCurrentStageTimer(0);
    
    const currentStage = WORKFLOW_STAGES[currentStageIndex];
    executeStageM.mutate({
      reportId: currentReport.id,
      stage: currentStage.key,
      customInput: customInput || undefined,
    });
  };

  // Get the current working text that will be processed by this stage
  const getCurrentWorkingText = () => {
    if (currentStageIndex === 0) {
      return rawText; // First stage gets the original raw text
    }
    
    // Get the output of the previous stage
    const previousStageKey = WORKFLOW_STAGES[currentStageIndex - 1]?.key;
    if (previousStageKey && stageResults[previousStageKey]) {
      return stageResults[previousStageKey];
    }
    
    return rawText; // Fallback to original
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
              <Clock className="mr-2 h-5 w-5 text-primary animate-spin" />
              Workflow wordt opgestart...
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Het systeem maakt een nieuwe case aan en start automatisch met stap 1...
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
              
              <div className="bg-muted/50 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-sm">Case wordt aangemaakt...</span>
                </div>
              </div>
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
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>Huidige stap: {currentStage.label}</span>
              {executeStageM.isPending && (
                <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                  <div className="w-3 h-3 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                  <span className="font-medium">
                    AI bezig... {currentStageTimer}s
                  </span>
                </div>
              )}
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
                      ? executeStageM.isPending && index === currentStageIndex
                        ? "bg-orange-50 dark:bg-orange-950/20 border-orange-300 dark:border-orange-700"
                        : "bg-primary/10 border-primary" 
                      : status === "completed" 
                      ? "bg-green-50 dark:bg-green-950/20 border-green-300 dark:border-green-700" 
                      : "bg-background border-border opacity-60"
                  }`}
                  onClick={() => status !== "pending" && setCurrentStageIndex(index)}
                  data-testid={`stage-${stage.key}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${
                    status === "completed" ? "bg-green-500 text-white" :
                    status === "current" ? 
                      executeStageM.isPending && index === currentStageIndex ?
                        "bg-orange-500 text-white" : "bg-primary text-primary-foreground" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {status === "completed" ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : status === "current" ? (
                      executeStageM.isPending && index === currentStageIndex ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <Clock className="h-4 w-4" />
                      )
                    ) : (
                      <IconComponent className="h-4 w-4" />
                    )}
                  </div>
                  
                  <div className="flex-1">
                    <div className="font-medium">{stage.label}</div>
                    <div className="text-sm text-muted-foreground">{stage.description}</div>
                    {status === "current" && executeStageM.isPending && index === currentStageIndex && (
                      <div className="text-xs text-orange-600 dark:text-orange-400 mt-1 font-medium">
                        AI bezig... {currentStageTimer}s
                      </div>
                    )}
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
          
          {/* Current Working Text - What this stage will process */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-primary">
                Huidige Tekst (wordt verwerkt door deze stap)
              </label>
              <Badge variant="secondary">
                {currentStageIndex === 0 ? "Ruwe Input (emails, etc.)" : currentStageIndex === 1 ? "Gestructureerde Info (uit stap 1)" : `Verfijnde Data (uit ${WORKFLOW_STAGES[currentStageIndex - 1]?.label})`}
              </Badge>
            </div>
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="text-sm text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
                {getCurrentWorkingText()}
              </div>
            </div>
            {currentStageIndex === 0 && (
              <p className="text-xs text-muted-foreground">
                📧 Ruwe input: emails, klantvragen, documenten - wordt gestructureerd door informatiecheck
              </p>
            )}
            {currentStageIndex === 1 && (
              <p className="text-xs text-muted-foreground">
                ✅ Gestructureerde info uit stap 1 - dit is nu het startpunt voor alle verdere analyse
              </p>
            )}
            {currentStageIndex > 1 && (
              <p className="text-xs text-muted-foreground">
                🔄 Verfijnde data uit vorige stap - wordt verder geanalyseerd en verbeterd
              </p>
            )}
          </div>

          <Separator />
          
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

          {/* Manual Execute Button */}
          {!currentStageResult && (
            <div className="space-y-2">
              <Button
                onClick={executeCurrentStage}
                disabled={executeStageM.isPending}
                className="w-full bg-primary"
                data-testid="button-execute-stage"
              >
                <Play className="mr-2 h-4 w-4" />
                {executeStageM.isPending ? "Uitvoeren..." : `Voer ${currentStage.label} Uit`}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Elke stap wordt handmatig uitgevoerd voor volledige controle
              </p>
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

              {/* Living Report Display - starts from stage 3 */}
              {currentReport?.generatedContent && currentStageIndex >= 2 && (
                <div className="mt-6 space-y-3">
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <h4 className="font-medium text-foreground">📄 Levende Rapport</h4>
                      <Badge variant="outline" className="text-xs">
                        {currentStageIndex === 2 ? "Eerste versie" : `Bijgewerkt door ${WORKFLOW_STAGES[currentStageIndex].label}`}
                      </Badge>
                    </div>
                    <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>Real-time</span>
                    </div>
                  </div>
                  <div className="bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-950/20 dark:to-blue-950/20 border border-green-200 dark:border-green-800 rounded-lg p-4 max-h-96 overflow-y-auto">
                    <div className="text-xs text-green-700 dark:text-green-400 mb-2 font-medium">
                      🌱 Dit rapport groeit en verbetert met elke specialist stap
                    </div>
                    <div 
                      className="prose prose-sm max-w-none text-sm"
                      dangerouslySetInnerHTML={{ __html: currentReport.generatedContent }}
                    />
                  </div>
                  {currentStageIndex === 2 && (
                    <p className="text-xs text-green-600 dark:text-green-400">
                      ✨ Gefeliciteerd! Je eerste rapport versie is klaar. De volgende stappen zullen dit rapport verder verfijnen en verbeteren.
                    </p>
                  )}
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