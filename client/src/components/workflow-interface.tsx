import { useState, useEffect, useCallback, useMemo, memo } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { 
  Play,
  ArrowRight,
  CheckCircle,
  Clock,
  AlertCircle,
  Edit3,
  Eye,
  RotateCcw,
  FileText,
  Zap,
  Square,
  Settings,
  Copy,
  Wand2,
  PenTool
} from "lucide-react";
import type { Report, DossierData, BouwplanData } from "@shared/schema";

// Format plain text/markdown to professional fiscal report HTML - ONLY styling, no structure changes
function formatReportContent(content: string): string {
  if (!content) return "";
  
  // Just apply styling to whatever content comes from AI - no structural changes
  return content
    // Headers - professional styling without changing structure
    .replace(/^#{3}\s+(.+)$/gm, '<h3 class="text-lg font-bold text-gray-900 mt-8 mb-3 border-b border-gray-300 pb-2">$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2 class="text-xl font-bold text-gray-900 mt-10 mb-4 border-b-2 border-blue-600 pb-3">$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1 class="text-2xl font-bold text-gray-900 mt-10 mb-6">$1</h1>')
    
    // Special title patterns from PDF
    .replace(/^(Fiscale Analyse.*?)$/m, '<h1 class="text-3xl font-bold text-gray-900 mb-4 text-center">$1</h1>')
    .replace(/^(Uw vraag beantwoord)$/gm, '<h2 class="text-xl font-bold text-gray-900 mt-10 mb-4 text-blue-700">$1</h2>')
    
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-gray-900">$1</strong>')
    .replace(/\*([^\*]+?)\*/g, '<em class="italic text-gray-700">$1</em>')
    
    // Bullet lists - professional indentation
    .replace(/^[\*\-•]\s+(.+)$/gm, '<li class="ml-8 mb-2 text-gray-700 leading-relaxed">$1</li>')
    .replace(/(<li class="ml-8.*?<\/li>\s*)+/g, '<ul class="mb-6 list-disc list-outside pl-2">$&</ul>')
    
    // Numbered lists  
    .replace(/^\d+\.\s+(.+)$/gm, '<li class="ml-8 mb-2 text-gray-700 leading-relaxed">$1</li>')
    .replace(/(<li class="ml-8(?!.*list-disc).*?<\/li>\s*)+/g, '<ol class="mb-6 list-decimal list-outside pl-2">$&</ol>')
    
    // Tables - professional table styling
    .replace(/\|([^\n]+)\|/g, (match) => {
      const cells = match.split('|').filter(c => c.trim());
      if (cells.some(c => c.includes('---'))) return ''; // Skip separator rows
      
      const isFirstRow = !match.includes('<tr');
      const cellTag = isFirstRow ? 'th' : 'td';
      const cellClass = isFirstRow 
        ? 'border border-gray-300 px-4 py-3 text-left font-semibold bg-gray-100'
        : 'border border-gray-300 px-4 py-3 text-sm';
      
      const cellHtml = cells.map(cell => 
        `<${cellTag} class="${cellClass}">${cell.trim()}</${cellTag}>`
      ).join('');
      return `<tr>${cellHtml}</tr>`;
    })
    .replace(/(<tr>.*?<\/tr>\s*)+/g, '<table class="w-full mb-8 border-collapse shadow-sm"><tbody>$&</tbody></table>')
    
    // Important notes/warnings
    .replace(/^(?:Let op|Belangrijk|Aandachtspunt|Note|Opmerking):\s*(.+)$/gm, 
      '<div class="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 rounded-r"><p class="text-amber-900 font-medium">⚠️ Let op: $1</p></div>')
    
    // Special sections boxes
    .replace(/^(Belangrijke kennisgeving):\s*(.+)$/gm, 
      '<div class="bg-blue-50 border-l-4 border-blue-600 p-5 mb-6 rounded-r"><h3 class="font-bold text-blue-900 mb-2">$1</h3><p class="text-blue-800">$2</p></div>')
    
    // Calculation steps
    .replace(/^(Stap \d+):\s*(.+)$/gm, 
      '<div class="bg-gray-50 border-l-4 border-gray-400 pl-4 py-3 mb-4"><strong class="text-gray-800">$1:</strong> <span class="text-gray-700">$2</span></div>')
    
    // Money amounts - make them stand out
    .replace(/€\s*(\d+(?:[.,]\d+)*)/g, '<span class="font-semibold text-green-700">€ $1</span>')
    
    // Paragraphs - only apply to plain text blocks
    .split('\n\n').map(block => {
      // Don't wrap if already has HTML tags or is a list/header
      if (block.trim() && !block.includes('<') && !block.match(/^[\*\-\d#•]/)) {
        return `<p class="mb-6 text-gray-700 leading-relaxed text-justify">${block.trim()}</p>`;
      }
      return block;
    }).join('\n\n')
    
    // Clean up empty tags
    .replace(/<p[^>]*>\s*<\/p>/g, '')
    .replace(/<\/p>\s*<p/g, '</p>\n\n<p');
}

const WORKFLOW_STAGES = [
  { key: "1_informatiecheck", label: "1. Informatiecheck", description: "Ruwe tekst → Gestructureerde informatie", icon: FileText, type: "generator" },
  { key: "2_complexiteitscheck", label: "2. Complexiteitscheck", description: "Analyse van complexiteit en scope", icon: AlertCircle, type: "generator" },
  { key: "3_generatie", label: "3. Generatie", description: "Basis rapport generatie", icon: FileText, type: "generator" },
  { key: "4a_BronnenSpecialist", label: "4a. Bronnen Specialist", description: "Review bronnen → JSON feedback", icon: CheckCircle, type: "reviewer" },
  { key: "4b_FiscaalTechnischSpecialist", label: "4b. Fiscaal Technisch Specialist", description: "Review fiscale techniek → JSON feedback", icon: CheckCircle, type: "reviewer" },
  { key: "4c_ScenarioGatenAnalist", label: "4c. Scenario Gaten Analist", description: "Review scenarios → JSON feedback", icon: CheckCircle, type: "reviewer" },
  { key: "4d_DeVertaler", label: "4d. De Vertaler", description: "Review communicatie → JSON feedback", icon: CheckCircle, type: "reviewer" },
  { key: "4e_DeAdvocaat", label: "4e. De Advocaat", description: "Review juridisch → JSON feedback", icon: CheckCircle, type: "reviewer" },
  { key: "4f_DeKlantpsycholoog", label: "4f. De Klantpsycholoog", description: "Review klant focus → JSON feedback", icon: CheckCircle, type: "reviewer" },
  { key: "5_feedback_verwerker", label: "5. Feedback Verwerker", description: "Verwerkt JSON feedback in het rapport", icon: Zap, type: "processor" },
  { key: "final_check", label: "Final Check", description: "Laatste controle voor Mathijs", icon: Eye, type: "generator" },
] as const;

interface WorkflowInterfaceProps {
  dossier: DossierData;
  bouwplan: BouwplanData;
  clientName: string;
  rawText: string;  // Voeg ruwe tekst toe voor dynamische verwerking
  existingReport?: Report;  // Optionele bestaande report voor case detail pagina
  onComplete: (report: Report) => void;
}

const WorkflowInterface = memo(function WorkflowInterface({ dossier, bouwplan, clientName, rawText, existingReport, onComplete }: WorkflowInterfaceProps) {
  const [currentReport, setCurrentReport] = useState<Report | null>(null);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [stageResults, setStageResults] = useState<Record<string, string>>({});
  const [conceptReportVersions, setConceptReportVersions] = useState<Record<string, string>>({});
  const [editingStage, setEditingStage] = useState<string | null>(null);
  const [customInput, setCustomInput] = useState("");
  // Auto-run functionality removed per user request
  const [viewMode, setViewMode] = useState<"stage" | "concept">("stage");
  const [stageStartTime, setStageStartTime] = useState<Date | null>(null);
  const [currentStageTimer, setCurrentStageTimer] = useState(0);
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [manualMode, setManualMode] = useState<"ai" | "manual">("ai");
  const [manualContent, setManualContent] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
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
      
      // Auto-start eerste stap direct na case aanmaken
      setTimeout(() => {
        setStageStartTime(new Date());
        setCurrentStageTimer(0);
        
        const firstStage = WORKFLOW_STAGES[0];
        executeStageM.mutate({
          reportId: report.id,
          stage: firstStage.key,
          customInput: undefined,
        });
      }, 100);
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
      const currentStage = WORKFLOW_STAGES[currentStageIndex];
      
      setStageResults(prev => ({
        ...prev,
        [currentStage.key]: data.stageResult
      }));
      
      // Update concept report versions if provided
      if (data.conceptReport) {
        setConceptReportVersions(prev => ({
          ...prev,
          [currentStage.key]: data.conceptReport as string
        }));
      }
      
      setCustomInput("");
      setEditingStage(null);
      
      // Special messaging for stage 3 - first living report
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
      } else if (currentStage.key === '5_feedback_verwerker') {
        toast({
          title: "⚙️ Feedback verwerkt",
          description: "JSON feedback is verwerkt en rapport is bijgewerkt.",
        });
      } else {
        toast({
          title: "Stap voltooid",
          description: `${currentStage.label} is succesvol uitgevoerd.`,
        });
      }
      
      // No auto-advance - user must manually click to proceed
    },
    onError: (error: Error) => {
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

  // Initialize with existing report or create new one
  useEffect(() => {
    if (existingReport) {
      // Load existing report data
      setCurrentReport(existingReport);
      setStageResults(existingReport.stageResults as Record<string, string> || {});
      setConceptReportVersions(existingReport.conceptReportVersions as Record<string, string> || {});
      
      // Set current stage index based on completed stages
      const completedStages = Object.keys(existingReport.stageResults as Record<string, string> || {});
      const lastCompletedIndex = completedStages.length > 0 
        ? Math.max(...completedStages.map(stage => WORKFLOW_STAGES.findIndex(s => s.key === stage)))
        : -1;
      setCurrentStageIndex(Math.min(lastCompletedIndex + 1, WORKFLOW_STAGES.length - 1));
      
      sessionStorage.setItem('current-workflow-report-id', existingReport.id);
    } else {
      // Auto-start workflow direct bij laden - slechts 1x!
      const sessionReportId = sessionStorage.getItem('current-workflow-report-id');
      
      if (!currentReport && !createReportMutation.isPending && !sessionReportId) {
        // Add slight delay to prevent rapid successive calls
        setTimeout(() => {
          if (!currentReport && !createReportMutation.isPending) {
            createReportMutation.mutate();
          }
        }, 100);
      }
    }
  }, [existingReport]); // Afhankelijk van existingReport

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


  // Generate prompt for manual stage 3 execution
  const generateStage3Prompt = useCallback(() => {
    if (!currentReport || !stageResults["1_informatiecheck"] || !stageResults["2_complexiteitscheck"]) {
      return "";
    }
    
    // Bouw de volledige prompt op zoals die naar de AI zou gaan
    const prompt = `Je bent een senior fiscaal adviseur die een professioneel fiscaal duidingsrapport opstelt voor een klant.

## KLANTGEGEVENS
${stageResults["1_informatiecheck"]}

## COMPLEXITEITSANALYSE  
${stageResults["2_complexiteitscheck"]}

## BOUWPLAN INSTRUCTIES
${JSON.stringify(bouwplan, null, 2)}

## OPDRACHT
Schrijf een compleet fiscaal duidingsrapport in het Nederlands volgens het opgegeven bouwplan. Het rapport moet:

1. **Professioneel en helder** zijn, geschreven voor de klant (niet-fiscalist)
2. **Volledig uitgewerkt** zijn met alle secties uit het bouwplan
3. **Concrete antwoorden** geven op de klantvraag
4. **Wettelijke onderbouwing** bevatten met verwijzingen naar relevante wet- en regelgeving
5. **Praktische adviezen** en vervolgstappen bevatten

### STRUCTUUR VAN HET RAPPORT:
Volg exact de structuur uit het bouwplan, inclusief:
- Inleiding met probleemstelling
- Fiscale analyse per knelpunt
- Scenario analyse indien relevant
- Conclusie en advies
- Vervolgstappen

### FORMAAT:
- Gebruik Markdown opmaak
- Gebruik duidelijke koppen (##, ###)
- Gebruik bullets voor opsommingen
- Markeer belangrijke bedragen en percentages

Schrijf nu het volledige rapport:`;
    
    return prompt;
  }, [currentReport, stageResults, bouwplan]);

  // Manual execution only - no auto-advance
  const executeCurrentStage = () => {
    const currentStage = WORKFLOW_STAGES[currentStageIndex];
    
    // Voor stap 3, toon eerst de keuze dialog
    if (currentStage.key === "3_generatie") {
      setShowManualDialog(true);
      setManualMode("ai");
      setManualContent("");
      setCopiedPrompt(false);
      return;
    }
    
    // Voor andere stappen, voer direct uit
    if (!currentReport) {
      createReportMutation.mutate();
      return;
    }
    
    setStageStartTime(new Date());
    setCurrentStageTimer(0);
    
    executeStageM.mutate({
      reportId: currentReport.id,
      stage: currentStage.key,
      customInput: customInput || undefined,
    });
  };
  
  // Execute stage 3 with manual content
  const executeStage3Manual = () => {
    if (!currentReport || !manualContent.trim()) {
      toast({
        title: "Invoer vereist",
        description: "Voer eerst het gegenereerde rapport in.",
        variant: "destructive",
      });
      return;
    }
    
    setStageStartTime(new Date());
    setCurrentStageTimer(0);
    
    // Stuur de handmatige content als customInput met een speciale marker
    executeStageM.mutate({
      reportId: currentReport.id,
      stage: "3_generatie",
      customInput: `MANUAL_MODE:${manualContent}`,
    });
    
    setShowManualDialog(false);
    setManualContent("");
  };
  
  // Copy prompt to clipboard
  const copyPromptToClipboard = () => {
    const prompt = generateStage3Prompt();
    navigator.clipboard.writeText(prompt).then(() => {
      setCopiedPrompt(true);
      toast({
        title: "Prompt gekopieerd!",
        description: "Plak deze in ChatGPT of Gemini om het rapport te genereren.",
      });
      setTimeout(() => setCopiedPrompt(false), 3000);
    });
  };

  // Get the current working text that will be processed by this stage
  const getCurrentWorkingText = useCallback(() => {
    const currentStage = WORKFLOW_STAGES[currentStageIndex];
    
    if (currentStageIndex === 0) {
      return rawText; // First stage gets the original raw text
    }
    
    // Voor Feedback Verwerker: gebruik het concept rapport
    if (currentStage.key === "5_feedback_verwerker") {
      // Zoek het meest recente concept rapport
      const conceptReports = Object.values(conceptReportVersions);
      if (conceptReports.length > 0) {
        return conceptReports[conceptReports.length - 1]; // Laatste concept rapport
      }
      // Fallback naar generatie stap output als er geen concept rapport is
      return stageResults["3_generatie"] || rawText;
    }
    
    // Voor reviewer stappen (4a-4f): gebruik het concept rapport
    if (currentStage.key.startsWith("4")) {
      // Gebruik het concept rapport van stap 3 (generatie)
      return conceptReportVersions["3_generatie"] || stageResults["3_generatie"] || rawText;
    }
    
    // Voor andere stappen: gebruik output van vorige stap
    const previousStageKey = WORKFLOW_STAGES[currentStageIndex - 1]?.key;
    if (previousStageKey && stageResults[previousStageKey]) {
      return stageResults[previousStageKey];
    }
    
    return rawText; // Fallback to original
  }, [currentStageIndex, rawText, stageResults, conceptReportVersions]);


  // Cyclical workflow: 4x→5→4x→5→4x→5 etc
  const getNextStageIndex = useCallback((currentIndex: number): number | null => {
    const currentStage = WORKFLOW_STAGES[currentIndex];
    const reviewerStages = ["4a_BronnenSpecialist", "4b_FiscaalTechnischSpecialist", "4c_ScenarioGatenAnalist", 
                           "4d_DeVertaler", "4e_DeAdvocaat", "4f_DeKlantpsycholoog"];
    
    // Linear flow for initial stages
    if (currentStage.key === "1_informatiecheck") return currentIndex + 1; // → 2
    if (currentStage.key === "2_complexiteitscheck") return currentIndex + 1; // → 3  
    if (currentStage.key === "3_generatie") {
      // → 4a
      return WORKFLOW_STAGES.findIndex(s => s.key === "4a_BronnenSpecialist");
    }
    
    // Cyclical flow for review stages
    if (currentStage.key === "5_feedback_verwerker") {
      // After feedback processor, find next reviewer stage
      const reviewerIndices = reviewerStages.map(stage => WORKFLOW_STAGES.findIndex(s => s.key === stage));
      const completedReviewers = reviewerStages.filter(stage => stageResults[stage]);
      
      if (completedReviewers.length < reviewerStages.length) {
        const nextReviewerStage = reviewerStages[completedReviewers.length];
        return WORKFLOW_STAGES.findIndex(s => s.key === nextReviewerStage);
      } else {
        // All reviewers done → final check
        return WORKFLOW_STAGES.findIndex(s => s.key === "final_check");
      }
    }
    
    // After any reviewer (4a-4f), go to feedback processor  
    if (reviewerStages.includes(currentStage.key)) {
      return WORKFLOW_STAGES.findIndex(s => s.key === "5_feedback_verwerker");
    }
    
    // Final stage
    if (currentStage.key === "final_check") return null;
    
    return currentIndex + 1; // Default fallback
  }, [stageResults]);

  const goToNextStage = useCallback(() => {
    const nextIndex = getNextStageIndex(currentStageIndex);
    
    if (nextIndex !== null) {
      setCurrentStageIndex(nextIndex);
    } else {
      // Final stage reached, finalize report
      if (currentReport) {
        finalizeReportMutation.mutate(currentReport.id);
      }
    }
  }, [getNextStageIndex, currentStageIndex, currentReport, finalizeReportMutation]);

  const goToPreviousStage = useCallback(() => {
    if (currentStageIndex > 0) {
      setCurrentStageIndex(prev => prev - 1);
    }
  }, [currentStageIndex]);

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

  // Show case creation status if no current report yet
  const isCreatingCase = createReportMutation.isPending;

  return (
    <div className="space-y-6">
      
      {/* Case Creation Status */}
      {isCreatingCase && (
        <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <div>
                <p className="font-medium text-blue-700 dark:text-blue-300">Case wordt aangemaakt...</p>
                <p className="text-sm text-blue-600 dark:text-blue-400">Workflow start automatisch zodra de case gereed is</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => {
                  sessionStorage.removeItem('current-workflow-report-id');
                  window.location.reload();
                }}
                data-testid="button-reset-workflow"
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Professional Document Artifact */}
      {currentReport?.generatedContent && (
        <div className="relative">
          {/* Live Report Indicator */}
          <div className="absolute -top-2 -right-2 z-10">
            <div className="bg-green-500 text-white px-3 py-1 rounded-full text-xs font-medium shadow-lg flex items-center space-x-1">
              <div className="h-2 w-2 bg-white rounded-full animate-pulse"></div>
              <span>LIVE</span>
            </div>
          </div>
          
          {/* Document Container - Exact zoals finale PDF */}
          <div className="bg-white shadow-2xl rounded-lg overflow-hidden max-w-4xl mx-auto">
            
            {/* Professional Blue Header - exact zoals in PDF */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-8 py-5" style={{ fontFamily: '"Google Sans", system-ui, -apple-system, sans-serif' }}>
              <div className="flex justify-between items-start">
                <div>
                  <h1 className="text-xl font-bold tracking-wide">DE FISCALE ANALIST</h1>
                  <p className="text-blue-100 text-xs mt-1">Belastingadvies & Fiscale Duiding</p>
                  <div className="mt-2 text-xs text-blue-100 opacity-80">
                    BTW: NL123456789B01 | KvK: 12345678
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-blue-100 font-medium uppercase tracking-wider">FISCAAL DUIDINGSRAPPORT</div>
                  <div className="text-xs text-blue-100 mt-2">Rapport ID: {currentReport.id.substring(0, 8).toUpperCase()}</div>
                  <div className="text-xs text-blue-100">Datum: {new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                </div>
              </div>
            </div>

            {/* Client Info Bar - minimalist zoals in PDF */}
            <div className="bg-gray-50 px-8 py-2 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-700">
                  <span className="font-medium">Client:</span> {clientName}
                </div>
                <div className="flex items-center space-x-3 text-xs text-gray-500">
                  <div className="flex items-center space-x-1">
                    <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span>Versie {Math.max(1, currentStageIndex - 1)}</span>
                  </div>
                  <span className="text-gray-400">•</span>
                  <span>Live Preview</span>
                </div>
              </div>
            </div>

            {/* Document Content - professional styling zoals PDF */}
            <div className="px-10 py-8 bg-white" style={{ minHeight: '600px', maxHeight: '800px', overflowY: 'auto' }}>
              {/* Add report title if in later stages */}
              {currentStageIndex >= 3 && (
                <div className="text-center mb-8" style={{ fontFamily: '"Google Sans", system-ui, -apple-system, sans-serif' }}>
                  <h1 className="text-2xl font-bold text-gray-900">Fiscale Analyse</h1>
                  <p className="text-sm text-gray-600 mt-2">Aankoop Eigen Woning</p>
                </div>
              )}
              
              {/* Formatted content */}
              <div 
                className="prose prose-lg max-w-none"
                style={{
                  fontFamily: '"Google Sans", system-ui, -apple-system, sans-serif',
                  fontSize: '14px',
                  lineHeight: '1.8',
                  color: '#2d3748'
                }}
                dangerouslySetInnerHTML={{ __html: formatReportContent(currentReport.generatedContent || '') }}
              />
            </div>

            {/* Professional Footer */}
            <div className="bg-gray-50 border-t border-gray-200 px-8 py-3 mt-auto">
              <div className="flex justify-between items-center text-xs text-gray-500">
                <div>© {new Date().getFullYear()} De Fiscale Analist</div>
                <div className="flex items-center space-x-4">
                  <span>Pagina 1</span>
                  <span className="text-gray-400">•</span>
                  <span>Laatste update: {new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Growth Indicator */}
          {currentStageIndex >= 2 && currentStageIndex < WORKFLOW_STAGES.length - 1 && (
            <div className="mt-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-center space-x-3">
                <div className="h-3 w-3 bg-blue-500 rounded-full animate-pulse"></div>
                <div className="text-sm text-blue-700 dark:text-blue-400 font-medium">
                  🔄 Volgende specialist (<strong>{WORKFLOW_STAGES[currentStageIndex]?.label}</strong>) gaat dit rapport verder verbeteren en uitbreiden...
                </div>
              </div>
            </div>
          )}
        </div>
      )}

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
                {currentStageIndex === 0 ? "Ruwe Input (emails, etc.)" : 
                 currentStageIndex === 1 ? "Gestructureerde Info (uit stap 1)" :
                 WORKFLOW_STAGES[currentStageIndex].key === "5_feedback_verwerker" ? "Concept Rapport (te verwerken)" :
                 WORKFLOW_STAGES[currentStageIndex].key.startsWith("4") ? "Concept Rapport (te reviewen)" :
                 `Verfijnde Data (uit ${WORKFLOW_STAGES[currentStageIndex - 1]?.label})`}
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

          {/* Execute Controls */}
          {!currentStageResult && (
            <div className="space-y-3">
              <Button
                onClick={executeCurrentStage}
                disabled={executeStageM.isPending || isCreatingCase}
                className="w-full bg-primary"
                data-testid="button-execute-stage"
              >
                {executeStageM.isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    AI bezig...
                  </>
                ) : isCreatingCase ? (
                  <>
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2"></div>
                    Case wordt aangemaakt...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Voer {currentStage.label} Uit
                  </>
                )}
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
                    disabled={executeStageM.isPending || isCreatingCase}
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
                
                const isReviewer = stage.type === "reviewer";
                
                return (
                  <div key={stage.key} className={`border rounded-lg p-3 ${isReviewer ? 'border-l-4 border-l-orange-400 bg-orange-50/20' : 'border-l-4 border-l-blue-400'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <h5 className="font-medium text-sm">{stage.label}</h5>
                        <Badge variant={isReviewer ? "destructive" : "default"} className="text-xs">
                          {isReviewer ? "🔍 Review" : "📝 Generator"}
                        </Badge>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant="secondary" className="text-xs">Voltooid</Badge>
                        {conceptResult && (
                          <Badge variant="outline" className="text-xs text-blue-600">
                            + Rapport Update
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground max-h-20 overflow-y-auto">
                      <div className="font-medium text-muted-foreground mb-1">
                        {isReviewer ? "JSON Feedback:" : "Specialist Output:"}
                      </div>
                      {stageResult.length > 150 ? `${stageResult.substring(0, 150)}...` : stageResult}
                      
                      {conceptResult && (
                        <div className="mt-2 pt-2 border-t border-muted">
                          <div className="font-medium text-blue-600 dark:text-blue-400 mb-1">Rapport Update Toegepast:</div>
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

      {/* Manual Mode Dialog for Stage 3 */}
      <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Stap 3: Basis Rapport Generatie
            </DialogTitle>
            <DialogDescription>
              Kies hoe je het rapport wilt genereren
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            {/* Mode Selection */}
            <RadioGroup value={manualMode} onValueChange={(value: "ai" | "manual") => setManualMode(value)}>
              <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-muted/50">
                <RadioGroupItem value="ai" id="ai-mode" />
                <Label htmlFor="ai-mode" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-blue-600" />
                    <span className="font-medium">AI Generatie</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Laat de AI het rapport automatisch genereren (kan soms fouten geven)
                  </p>
                </Label>
              </div>
              
              <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-muted/50">
                <RadioGroupItem value="manual" id="manual-mode" />
                <Label htmlFor="manual-mode" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <PenTool className="h-4 w-4 text-green-600" />
                    <span className="font-medium">Handmatige Invoer</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Kopieer de prompt naar ChatGPT/Gemini en plak het resultaat hier
                  </p>
                </Label>
              </div>
            </RadioGroup>

            {/* Manual Mode Content */}
            {manualMode === "manual" && (
              <div className="space-y-4 pt-4 border-t">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-medium">Stap 1: Kopieer de prompt</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyPromptToClipboard}
                      data-testid="button-copy-prompt"
                    >
                      <Copy className="mr-1 h-3 w-3" />
                      {copiedPrompt ? "Gekopieerd!" : "Kopieer Prompt"}
                    </Button>
                  </div>
                  <div className="bg-muted rounded-lg p-3 max-h-48 overflow-y-auto">
                    <pre className="text-xs whitespace-pre-wrap font-mono">
                      {generateStage3Prompt().substring(0, 500)}...
                    </pre>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Plak deze prompt in ChatGPT, Claude, of Gemini om het rapport te genereren
                  </p>
                </div>

                <div>
                  <Label className="text-sm font-medium">
                    Stap 2: Plak het gegenereerde rapport hier
                  </Label>
                  <Textarea
                    value={manualContent}
                    onChange={(e) => setManualContent(e.target.value)}
                    placeholder="Plak hier het complete rapport dat je van de AI hebt ontvangen..."
                    className="min-h-[200px] mt-2"
                    data-testid="textarea-manual-content"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setShowManualDialog(false)}
              data-testid="button-cancel-manual"
            >
              Annuleren
            </Button>
            {manualMode === "ai" ? (
              <Button
                onClick={() => {
                  setShowManualDialog(false);
                  setStageStartTime(new Date());
                  setCurrentStageTimer(0);
                  executeStageM.mutate({
                    reportId: currentReport!.id,
                    stage: "3_generatie",
                    customInput: customInput || undefined,
                  });
                }}
                data-testid="button-run-ai"
              >
                <Wand2 className="mr-2 h-4 w-4" />
                Start AI Generatie
              </Button>
            ) : (
              <Button
                onClick={executeStage3Manual}
                disabled={!manualContent.trim()}
                data-testid="button-submit-manual"
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Rapport Toepassen
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
});

export default WorkflowInterface;