import { memo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Printer, 
  Download, 
  Share, 
  AlertTriangle,
  Info,
  ExternalLink,
  ArrowRight,
  Book,
  BarChart3
} from "lucide-react";
import type { Report } from "@shared/schema";

// Format plain text/markdown to professional fiscal report HTML
function formatReportContent(content: string): string {
  if (!content) return "";
  
  console.log("🔍 Formatting content:", content.substring(0, 200) + "...");
  
  let formatted = content
    // Headers first - order matters!
    .replace(/^#{3}\s+(.+)$/gm, '<h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 mt-6 mb-3 border-b border-gray-300 dark:border-gray-600 pb-1">$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2 class="text-xl font-bold text-gray-900 dark:text-gray-100 mt-8 mb-4 border-b-2 border-blue-600 pb-2">$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-6 mb-4">$1</h1>')
    
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-gray-900 dark:text-gray-100">$1</strong>')
    .replace(/\*([^\*\n]+?)\*/g, '<em class="italic text-gray-700 dark:text-gray-300">$1</em>')
    
    // Lists - handle them before paragraph processing
    .replace(/^[\*\-•]\s+(.+)$/gm, '<<<UL_ITEM>>>$1<<</UL_ITEM>>>')
    .replace(/^(\d+)\.\s+(.+)$/gm, '<<<OL_ITEM>>>$2<<</OL_ITEM>>>')
    
    // Convert line breaks to paragraph breaks
    .replace(/\n\s*\n/g, '<<<PARA_BREAK>>>')
    .replace(/\n/g, ' ')
    .replace(/<<<PARA_BREAK>>>/g, '\n\n')
    
    // Convert to paragraphs
    .split('\n\n')
    .map(para => {
      para = para.trim();
      if (!para) return '';
      
      // Skip if already HTML
      if (para.includes('<h') || para.includes('<<<')) return para;
      
      return `<p class="mb-4 text-gray-700 dark:text-gray-300 leading-relaxed">${para}</p>`;
    })
    .join('\n')
    
    // Process list items
    .replace(/<<<UL_ITEM>>>(.*?)<<<\/UL_ITEM>>>/g, '<li class="ml-6 mb-1 text-gray-700 dark:text-gray-300">$1</li>')
    .replace(/(<li class="ml-6 mb-1[^>]*>.*?<\/li>\s*)+/g, '<ul class="mb-4 list-disc list-outside ml-4">$&</ul>')
    
    .replace(/<<<OL_ITEM>>>(.*?)<<<\/OL_ITEM>>>/g, '<li class="ml-6 mb-1 text-gray-700 dark:text-gray-300">$1</li>')
    .replace(/(<li class="ml-6 mb-1[^>]*>.*?<\/li>\s*)+/g, '<ol class="mb-4 list-decimal list-outside ml-4">$&</ol>');
  
  console.log("✅ Formatted result:", formatted.substring(0, 300) + "...");
  return formatted;
}

interface ReportPreviewProps {
  report: Report | null;
  isGenerating: boolean;
}

const ReportPreview = memo(function ReportPreview({ report, isGenerating }: ReportPreviewProps) {
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleExport = useCallback(() => {
    if (!report?.generatedContent) return;
    
    const element = document.createElement("a");
    const file = new Blob([report.generatedContent], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `fiscaal-rapport-${report.clientName}-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  }, [report?.generatedContent, report?.clientName]);

  const handleShare = useCallback(async () => {
    if (!report?.generatedContent) return;
    
    const shareData = {
      title: `Fiscaal Rapport - ${report.clientName}`,
      text: `Bekijk dit fiscale duidingsrapport voor ${report.clientName}`,
      url: window.location.href
    };
    
    try {
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        // Fallback: copy link to clipboard
        await navigator.clipboard.writeText(window.location.href);
        
        // Show feedback to user
        const button = document.querySelector('[data-testid="button-share"]');
        if (button) {
          const originalText = button.textContent;
          button.textContent = '✓ Link gekopieerd';
          setTimeout(() => {
            button.textContent = originalText;
          }, 2000);
        }
      }
    } catch (error) {
      console.error('Error sharing:', error);
    }
  }, [report?.generatedContent, report?.clientName]);

  if (isGenerating) {
    return (
      <div className="lg:col-span-8 mt-8 lg:mt-0">
        <Card className="shadow-sm">
          <div className="border-b border-border p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-40" />
              </div>
              <div className="flex space-x-3">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-8 w-8" />
              </div>
            </div>
          </div>
          <CardContent className="p-6">
            <div className="space-y-6">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="lg:col-span-8 mt-8 lg:mt-0">
        <Card className="shadow-sm">
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground">
              <BarChart3 className="mx-auto h-12 w-12 mb-4" />
              <h3 className="text-lg font-medium mb-2">Geen rapport beschikbaar</h3>
              <p className="text-sm">Vul de invoergegevens in en klik op "Genereer Duidingsrapport" om te beginnen.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="lg:col-span-8 mt-8 lg:mt-0">
      <Card className="shadow-sm">
        
        {/* Report Header */}
        <div className="border-b border-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-report-title">
                Fiscaal Duidingsrapport
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                <span data-testid="text-report-date">
                  {new Date().toLocaleDateString('nl-NL', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </span> • 
                <span data-testid="text-client-name" className="ml-1">
                  {report.clientName}
                </span>
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <Button variant="ghost" size="icon" onClick={handlePrint} data-testid="button-print">
                <Printer className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleExport} data-testid="button-export">
                <Download className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleShare} data-testid="button-share">
                <Share className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Report Content */}
        <CardContent className="p-6 space-y-8">
          
          {/* Mandatory Warning Box */}
          <div className="bg-accent/10 border-l-4 border-accent p-4 rounded-r-md" data-testid="warning-box">
            <div className="flex items-start">
              <AlertTriangle className="text-accent mt-1 mr-3 h-5 w-5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-foreground mb-2">Belangrijke kennisgeving: De aard van dit rapport</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Dit document is een initiële, diagnostische analyse, opgesteld op basis van de door u verstrekte informatie. Het doel is om de voornaamste fiscale aandachtspunten en potentiële risico's ('knelpunten') te identificeren en de onderliggende principes toe te lichten. Dit rapport biedt dus een analyse van de problematiek, geen kant-en-klare oplossingen.
                </p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  Het is nadrukkelijk geen definitief fiscaal advies en dient niet als basis voor het nemen van financiële, juridische of strategische beslissingen. De complexiteit en continue verandering van fiscale wetgeving maken een uitgebreid en persoonlijk adviestraject noodzakelijk.
                </p>
              </div>
            </div>
          </div>

          {/* Report Sections */}
          {report.generatedContent ? (
            <div className="prose prose-sm max-w-none" data-testid="report-content">
              <div dangerouslySetInnerHTML={{ __html: formatReportContent(report.generatedContent) }} />
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              <p>Rapport inhoud wordt geladen...</p>
            </div>
          )}

          {/* Final Disclaimer */}
          <div className="bg-muted rounded-lg p-4 border-l-4 border-muted-foreground" data-testid="disclaimer">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong>Disclaimer:</strong> Dit rapport bevat een initiële, algemene fiscale duiding en is (deels) geautomatiseerd opgesteld op basis van de door u verstrekte informatie. Het is geen vervanging van persoonlijk, professioneel fiscaal advies. Fiscale wet- en regelgeving kan wijzigen, wat invloed kan hebben op dit rapport. Voor een advies waarop u beslissingen kunt baseren, wordt u geadviseerd contact op te nemen met een gespecialiseerde fiscaal adviseur.
            </p>
          </div>

        </CardContent>
      </Card>
    </div>
  );
});

export default ReportPreview;
