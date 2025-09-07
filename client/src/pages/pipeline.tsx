import { useState, useCallback, memo } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Play, Zap, FolderOpen, Menu, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import WorkflowInterface from "@/components/workflow-interface";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { apiRequest } from "@/lib/apiWrapper";
import type { DossierData, BouwplanData, Report } from "@shared/schema";

const Pipeline = memo(function Pipeline() {
  const [rawText, setRawText] = useState("");
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [finalReport, setFinalReport] = useState<string>("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [createdReport, setCreatedReport] = useState<Report | null>(null);
  const [isCreatingCase, setIsCreatingCase] = useState(false);
  const isMobile = useIsMobile();
  const { toast } = useToast();

  
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

  const startWorkflow = useCallback(async () => {
    if (!rawText.trim()) return;
    
    setIsCreatingCase(true);
    try {
      // Create the case immediately when "Start Case" is clicked
      const report = await apiRequest("POST", "/api/reports/create", {
        dossier: dossierData,
        bouwplan: bouwplanData,
        clientName: "Client",
        rawText: rawText.trim(),
      }) as Report;
      
      setCreatedReport(report);
      setShowWorkflow(true);
      
      toast({
        title: "Case aangemaakt",
        description: `Nieuwe case "${report.title}" is succesvol opgeslagen`,
      });
      
    } catch (error: any) {
      console.error('Failed to create case:', error);
      toast({
        title: "Fout bij aanmaken",
        description: error.message || "Er ging iets mis bij het aanmaken van de case",
        variant: "destructive",
      });
    } finally {
      setIsCreatingCase(false);
    }
  }, [rawText, dossierData, bouwplanData, toast]);


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
        {!showWorkflow ? (
          <Card>
            <CardHeader>
              <CardTitle>Fiscale Pipeline</CardTitle>
              <CardDescription>
                Voer je tekst in om een fiscaal rapport te genereren. Elke workflow wordt automatisch een case die je later kunt terugvinden.
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
              
              <div className="flex flex-col sm:flex-row gap-3">
                <Button 
                  onClick={startWorkflow}
                  disabled={!rawText.trim() || isCreatingCase}
                  data-testid="button-start-workflow"
                  className="flex-1"
                >
                  {isCreatingCase ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Case aanmaken...</>
                  ) : (
                    <><Play className="mr-2 h-4 w-4" /> Start Case</>
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
        ) : (
          <WorkflowInterface
            dossier={dossierData}
            bouwplan={bouwplanData}
            clientName="Client"
            rawText={rawText}
            onComplete={handleWorkflowComplete}
            existingReport={createdReport}
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