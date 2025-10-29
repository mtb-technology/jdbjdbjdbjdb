import { useState, useCallback, memo } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Play, Zap, FolderOpen, Menu, Loader2, CheckCircle, Target } from "lucide-react";
import { Link } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import WorkflowInterface from "@/components/workflow-interface";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { apiRequest } from "@/lib/queryClient";
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
      const response = await apiRequest("POST", "/api/reports/create", {
        dossier: dossierData,
        bouwplan: bouwplanData,
        clientName: "Client",
        rawText: rawText.trim(),
      });
      const data = await response.json();
      // Handle API response format - extract report from success response or use data directly
      const report = (data && typeof data === 'object' && 'success' in data && data.success === true) ? data.data : data;

      console.log("🎯 Pipeline: Report created from API:", { reportId: report?.id, hasId: !!report?.id, data, report });

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

      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-primary/10 to-secondary/5 py-16 sm:py-24">
        <div className="absolute inset-0 bg-grid-pattern opacity-10"></div>
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
              De Fiscale <span className="text-primary">Analist</span>
            </h1>
            <p className="mt-6 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
              AI-gedreven fiscale analyse voor professionele rapportage. 
              Van ruwe input naar compleet duidingsrapport in minuten.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          <Card className="text-center border-primary/20 hover:shadow-lg transition-all duration-300">
            <CardContent className="pt-6">
              <div className="w-12 h-12 bg-primary/10 rounded-lg mx-auto mb-4 flex items-center justify-center">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">AI-Gedreven Analyse</h3>
              <p className="text-sm text-muted-foreground">13-stappen workflow met gespecialiseerde AI experts voor elke fase</p>
            </CardContent>
          </Card>
          <Card className="text-center border-primary/20 hover:shadow-lg transition-all duration-300">
            <CardContent className="pt-6">
              <div className="w-12 h-12 bg-primary/10 rounded-lg mx-auto mb-4 flex items-center justify-center">
                <FolderOpen className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Case Management</h3>
              <p className="text-sm text-muted-foreground">Automatische opslag en tracking van alle fiscale analyses</p>
            </CardContent>
          </Card>
          <Card className="text-center border-primary/20 hover:shadow-lg transition-all duration-300">
            <CardContent className="pt-6">
              <div className="w-12 h-12 bg-primary/10 rounded-lg mx-auto mb-4 flex items-center justify-center">
                <Play className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Snelle Resultaten</h3>
              <p className="text-sm text-muted-foreground">Van input tot professioneel rapport binnen 15 minuten</p>
            </CardContent>
          </Card>
        </div>

        {/* Input + Start */}
        {!showWorkflow ? (
          <Card className="border-2 border-primary/20 shadow-xl bg-gradient-to-br from-card to-card/80">
            <CardHeader className="bg-gradient-to-r from-primary/5 to-secondary/5 border-b">
              <CardTitle className="text-2xl flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                Start Nieuwe Fiscale Analyse
              </CardTitle>
              <CardDescription className="text-base">
                Voer je fiscale vraagstuk in om direct een gestructureerde analyse te starten. 
                Alle workflows worden automatisch opgeslagen als cases.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 p-8">
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground">Fiscale Input</label>
                <Textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="Voer hier uw fiscale vraagstuk in:\n\n• Klantsituatie en concrete vraag\n• Relevante feiten en bedragen\n• Specifieke fiscale overwegingen\n\nVoorbeeld: 'Mijn klant (DGA) wil zijn BV omzetten naar een holding...'"
                  className="min-h-40 resize-none border-primary/20 focus:border-primary/40 bg-background/50"
                  data-testid="textarea-raw-input"
                />
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  onClick={startWorkflow}
                  disabled={!rawText.trim() || isCreatingCase}
                  data-testid="button-start-workflow"
                  className="flex-1 h-12 text-base font-semibold bg-primary hover:bg-primary/90 shadow-lg"
                  size="lg"
                >
                  {isCreatingCase ? (
                    <><Loader2 className="mr-3 h-5 w-5 animate-spin" /> Case aanmaken...</>
                  ) : (
                    <><Play className="mr-3 h-5 w-5" /> Start Fiscale Analyse</>
                  )}
                </Button>
                <div className="sm:w-auto w-full">
                  <Link href="/cases" asChild>
                    <Button variant="outline" data-testid="button-view-cases" className="h-12 w-full border-primary/20 hover:border-primary/40">
                      <FolderOpen className="mr-2 h-4 w-4" />
                      Bekijk Bestaande Cases
                    </Button>
                  </Link>
                </div>
              </div>
              
              {!rawText.trim() && (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">💡 Start met het invoeren van uw fiscale vraagstuk hierboven</p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <WorkflowInterface
            dossier={dossierData}
            bouwplan={bouwplanData}
            clientName="Client"
            rawText={rawText}
            onComplete={handleWorkflowComplete}
            existingReport={createdReport || undefined}
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