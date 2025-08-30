import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Play, 
  FileText, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  ChevronRight,
  Copy,
  Download,
  Zap
} from "lucide-react";
import WorkflowInterface from "@/components/workflow-interface";
import type { DossierData, BouwplanData, Report } from "@shared/schema";

export default function Pipeline() {
  const [rawText, setRawText] = useState("");
  const [extractedDossier, setExtractedDossier] = useState<DossierData | null>(null);
  const [extractedBouwplan, setExtractedBouwplan] = useState<BouwplanData | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [finalReport, setFinalReport] = useState<string>("");

  // Extract dossier data from raw text using AI
  const handleExtractData = async () => {
    if (!rawText.trim()) return;
    
    setIsExtracting(true);
    
    try {
      // Call API to extract structured data from raw text
      const response = await fetch('/api/extract-dossier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText }),
      });
      
      if (!response.ok) {
        throw new Error('Extractie mislukt');
      }
      
      const { dossier, bouwplan } = await response.json();
      setExtractedDossier(dossier);
      setExtractedBouwplan(bouwplan);
      setShowWorkflow(true);
      
    } catch (error) {
      console.error('Data extractie fout:', error);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleWorkflowComplete = (report: Report) => {
    setFinalReport(report.generatedContent || "");
  };

  const getCurrentStepProgress = () => {
    if (!rawText.trim()) return { step: 1, label: "Tekst Invoeren" };
    if (!extractedDossier) return { step: 2, label: "Data Extractie" };
    if (!finalReport) return { step: 3, label: "Rapport Generatie" };
    return { step: 4, label: "Voltooid" };
  };

  const progress = getCurrentStepProgress();
  const progressPercentage = (progress.step / 4) * 100;

  return (
    <div className="min-h-screen bg-background">
      
      {/* Header */}
      <header className="border-b border-border bg-card shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Zap className="text-2xl text-primary mr-3 h-8 w-8" />
                <span className="text-xl font-bold text-foreground">Fiscale Pipeline</span>
              </div>
              <nav className="hidden md:ml-10 md:flex md:space-x-8">
                <a href="/" className="text-primary font-medium" data-testid="nav-pipeline">
                  Pipeline
                </a>
                <a href="/dashboard" className="text-muted-foreground hover:text-foreground" data-testid="nav-dashboard">
                  Dashboard
                </a>
                <a href="/settings" className="text-muted-foreground hover:text-foreground" data-testid="nav-settings">
                  Instellingen
                </a>
              </nav>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Progress Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                Automatische Rapport Pipeline
              </h1>
              <p className="text-muted-foreground mt-2">
                Plak je dossiergegevens en laat de AI automatisch een professioneel fiscaal rapport genereren
              </p>
            </div>
            <Badge variant={progress.step === 4 ? "default" : "secondary"} className="text-sm">
              Stap {progress.step}/4: {progress.label}
            </Badge>
          </div>
          
          <Progress value={progressPercentage} className="h-2" />
        </div>

        {/* Step 1: Text Input */}
        {!showWorkflow && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center">
                <FileText className="mr-2 h-5 w-5" />
                Stap 1: Dossier Gegevens Invoeren
              </CardTitle>
              <CardDescription>
                Plak hier je volledige mailcorrespondentie, oorspronkelijke vraag en alle relevante dossiergegevens
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="raw-text">
                  Volledige Dossier Tekst (mailcorrespondentie, vraag, context)
                </Label>
                <Textarea
                  id="raw-text"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="Plak hier de volledige mailcorrespondentie, oorspronkelijke fiscale vraag en alle relevante klantgegevens...

Bijvoorbeeld:
- Email chain tussen klant en advisor
- Oorspronkelijke fiscale vraag 
- Klantgegevens (naam, BSN, etc.)
- Financiële situatie
- Specifieke problematiek

De AI zal automatisch de belangrijke informatie extraheren en structureren."
                  className="min-h-64 font-mono text-sm resize-none"
                  data-testid="textarea-raw-dossier"
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {rawText.length} karakters ingevoerd
                </div>
                
                <Button 
                  onClick={handleExtractData}
                  disabled={!rawText.trim() || isExtracting}
                  data-testid="button-start-pipeline"
                >
                  {isExtracting ? (
                    <>
                      <Clock className="mr-2 h-4 w-4 animate-spin" />
                      Extracteren...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Start Pipeline
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2-3: Workflow Execution */}
        {showWorkflow && extractedDossier && extractedBouwplan && (
          <div className="space-y-6">
            
            {/* Extracted Data Preview */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <CheckCircle className="mr-2 h-5 w-5 text-green-600" />
                  Stap 2: Data Extractie Voltooid
                </CardTitle>
                <CardDescription>
                  De AI heeft succesvol gestructureerde gegevens uit je tekst geëxtraheerd
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Klant Gegevens</Label>
                    <div className="bg-muted/50 p-3 rounded-md font-mono text-xs">
                      Naam: {extractedDossier.klant.naam}<br/>
                      BSN: {extractedDossier.klant.bsn || "Niet opgegeven"}<br/>
                      Situatie: {extractedDossier.klant.situatie}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Fiscale Gegevens</Label>
                    <div className="bg-muted/50 p-3 rounded-md font-mono text-xs">
                      Vermogen: €{extractedDossier.fiscale_gegevens.vermogen.toLocaleString()}<br/>
                      Inkomsten: €{extractedDossier.fiscale_gegevens.inkomsten.toLocaleString()}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Workflow Execution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Zap className="mr-2 h-5 w-5" />
                  Stap 3: 11-Stappen Workflow Uitvoering
                </CardTitle>
                <CardDescription>
                  De AI doorloopt nu alle gespecialiseerde rollen voor een complete fiscale analyse
                </CardDescription>
              </CardHeader>
              <CardContent>
                <WorkflowInterface
                  dossier={extractedDossier}
                  bouwplan={extractedBouwplan}
                  clientName={extractedDossier.klant.naam}
                  onComplete={handleWorkflowComplete}
                />
              </CardContent>
            </Card>

          </div>
        )}

        {/* Step 4: Final Report */}
        {finalReport && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center">
                <CheckCircle className="mr-2 h-5 w-5 text-green-600" />
                Stap 4: Fiscaal Rapport Voltooid
              </CardTitle>
              <CardDescription>
                Je professionele fiscale interpretatie rapport is gereed
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Button size="sm" variant="outline" data-testid="button-copy-report">
                  <Copy className="mr-2 h-4 w-4" />
                  Kopieer Rapport
                </Button>
                <Button size="sm" variant="outline" data-testid="button-download-report">
                  <Download className="mr-2 h-4 w-4" />
                  Download HTML
                </Button>
              </div>
              
              <Separator />
              
              <ScrollArea className="h-96 w-full border rounded-md p-4">
                <div 
                  dangerouslySetInnerHTML={{ __html: finalReport }}
                  className="prose prose-sm max-w-none"
                />
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* Help Section */}
        {!showWorkflow && (
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="p-6">
              <div className="flex items-start space-x-3">
                <AlertCircle className="h-5 w-5 text-muted-foreground mt-1" />
                <div>
                  <h3 className="font-semibold text-foreground mb-2">
                    Pipeline Workflow
                  </h3>
                  <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Plak je volledige dossiergegevens in het tekstveld</li>
                    <li>Klik "Start Pipeline" om data extractie te beginnen</li>
                    <li>De AI extraheert automatisch klant- en fiscale gegevens</li>
                    <li>Het 11-stappen workflow proces start automatisch</li>
                    <li>Ontvang je professionele rapport binnen enkele minuten</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}