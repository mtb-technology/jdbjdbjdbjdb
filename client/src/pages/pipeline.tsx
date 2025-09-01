import { useState, useCallback, memo } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Play, Zap, FolderOpen, Menu, Timer, Settings } from "lucide-react";
import { Link } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import WorkflowInterface from "@/components/workflow-interface";
import { JobStatus } from "@/components/job-status";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import type { DossierData, BouwplanData, Report, Job } from "@shared/schema";

const Pipeline = memo(function Pipeline() {
  const [rawText, setRawText] = useState("");
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [finalReport, setFinalReport] = useState<string>("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [processingMode, setProcessingMode] = useState<"sync" | "background">("sync");
  const isMobile = useIsMobile();
  const { toast } = useToast();

  // Mutation to start background job
  const startJobMutation = useMutation({
    mutationFn: async (data: { clientName: string; rawText: string }) => {
      const response = await apiRequest("POST", "/api/jobs/start-report", data);
      return response.json();
    },
    onSuccess: (result) => {
      setActiveJobId(result.jobId);
      toast({
        title: "Achtergrond taak gestart",
        description: `Rapport generatie begonnen. Job ID: ${result.jobId.slice(0, 8)}...`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Fout bij starten job",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  // Direct workflow data
  const dossierData: DossierData = { 
    klant: { naam: "Client", situatie: "Direct processing" },
    fiscale_gegevens: { vermogen: 0, inkomsten: 0 }
  };
  const bouwplanData: BouwplanData = {
    taal: "nl",
    structuur: { inleiding: true, knelpunten: [], scenario_analyse: true, vervolgstappen: true }
  };

  const handleWorkflowComplete = useCallback((report: Report) => {
    setFinalReport(report.generatedContent || "");
  }, []);

  const startWorkflow = useCallback(() => {
    if (rawText.trim()) {
      if (processingMode === "sync") {
        setShowWorkflow(true);
      } else {
        // Start background job
        startJobMutation.mutate({
          clientName: "Client", // In real app, get from form
          rawText: rawText.trim(),
        });
      }
    }
  }, [rawText, processingMode, startJobMutation]);

  const handleJobComplete = useCallback((job: Job) => {
    toast({
      title: "Rapport voltooid!",
      description: "Het fiscaal rapport is klaar en kan worden bekeken.",
    });
  }, [toast]);

  return (
    <div className="min-h-screen bg-background">
      
      {/* Header */}
      <header className="border-b border-border bg-card shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <div className="flex-shrink-0 flex items-center">
                <Zap className="text-2xl text-primary mr-3 h-8 w-8" />
                <span className="text-xl font-bold text-foreground">Fiscale Pipeline</span>
              </div>
              {/* Desktop Navigation */}
              <nav className="hidden md:ml-10 md:flex md:space-x-8">
                <Link href="/" className="text-primary font-medium" data-testid="nav-pipeline">
                  Pipeline
                </Link>
                <Link href="/cases" className="text-muted-foreground hover:text-foreground" data-testid="nav-cases">
                  Cases
                </Link>
                <Link href="/settings" className="text-muted-foreground hover:text-foreground" data-testid="nav-settings">
                  Instellingen
                </Link>
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              <DarkModeToggle />
              {/* Mobile Navigation */}
              <div className="md:hidden">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-64">
                  <nav className="flex flex-col space-y-4 mt-8">
                    <Link href="/" className="text-primary font-medium p-2 rounded-md" data-testid="nav-mobile-pipeline">
                      Pipeline
                    </Link>
                    <Link href="/cases" className="text-muted-foreground hover:text-foreground p-2 rounded-md" data-testid="nav-mobile-cases">
                      Cases
                    </Link>
                    <Link href="/settings" className="text-muted-foreground hover:text-foreground p-2 rounded-md" data-testid="nav-mobile-settings">
                      Instellingen
                    </Link>
                  </nav>
                </SheetContent>
              </Sheet>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">

        {/* Input + Start */}
        {!showWorkflow && !activeJobId ? (
          <Card>
            <CardHeader>
              <CardTitle>Fiscale Pipeline</CardTitle>
              <CardDescription>
                Voer je tekst in en kies hoe je het rapport wilt genereren. Elke workflow wordt automatisch een case die je later kunt terugvinden.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Plak hier je ruwe tekst: emails, documenten, klantvragen..."
                className="min-h-32"
                data-testid="textarea-raw-input"
              />
              
              {/* Processing Mode Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
                <div 
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    processingMode === "sync" ? "border-primary bg-primary/10" : "border-muted"
                  }`}
                  onClick={() => setProcessingMode("sync")}
                  data-testid="option-sync-mode"
                >
                  <div className="flex items-center space-x-2 mb-2">
                    <Settings className="h-5 w-5" />
                    <span className="font-medium">Interactieve Workflow</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Volg elke stap live mee en pas prompts aan tijdens het proces
                  </p>
                </div>
                
                <div 
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    processingMode === "background" ? "border-primary bg-primary/10" : "border-muted"
                  }`}
                  onClick={() => setProcessingMode("background")}
                  data-testid="option-background-mode"
                >
                  <div className="flex items-center space-x-2 mb-2">
                    <Timer className="h-5 w-5" />
                    <span className="font-medium">Achtergrond Verwerking</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Start proces in achtergrond, je kunt browser sluiten (5-10 min)
                  </p>
                </div>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-3">
                <Button 
                  onClick={startWorkflow}
                  disabled={!rawText.trim() || startJobMutation.isPending}
                  data-testid="button-start-workflow"
                  className="flex-1"
                >
                  {processingMode === "sync" ? (
                    <><Play className="mr-2 h-4 w-4" /> Start Interactieve Case</>
                  ) : (
                    <><Timer className="mr-2 h-4 w-4" /> 
                    {startJobMutation.isPending ? "Starten..." : "Start Achtergrond Job"}</>
                  )}
                </Button>
                <Link href="/cases">
                  <Button variant="outline" data-testid="button-view-cases" className="sm:w-auto w-full">
                    <FolderOpen className="mr-2 h-4 w-4" />
                    Bekijk Cases
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : activeJobId ? (
          <div className="space-y-6">
            <JobStatus 
              jobId={activeJobId} 
              onComplete={handleJobComplete}
              showReportLink={true}
            />
            <div className="flex justify-center">
              <Button 
                variant="outline"
                onClick={() => {
                  setActiveJobId(null);
                  setRawText("");
                }}
                data-testid="button-new-job"
              >
                Start Nieuwe Job
              </Button>
            </div>
          </div>
        ) : (
          <WorkflowInterface
            dossier={dossierData}
            bouwplan={bouwplanData}
            clientName="Client"
            rawText={rawText}
            onComplete={handleWorkflowComplete}
          />
        )}

        {/* Final Report */}
        {finalReport && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Rapport Voltooid</CardTitle>
            </CardHeader>
            <CardContent>
              <div 
                dangerouslySetInnerHTML={{ __html: finalReport }}
                className="prose prose-sm max-w-none"
              />
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
});

export default Pipeline;