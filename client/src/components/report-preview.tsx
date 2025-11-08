import { memo, useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Printer,
  Download,
  Share,
  AlertTriangle,
  BarChart3,
  ArrowUp,
  Edit3
} from "lucide-react";
import type { Report } from "@shared/schema";
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from "@/hooks/use-toast";
import { OverrideConceptDialog } from "./workflow/OverrideConceptDialog";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ReportPreviewProps {
  report: Report | null;
  isGenerating: boolean;
}

const ReportPreview = memo(function ReportPreview({ report, isGenerating }: ReportPreviewProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Override dialog state  
  const [overrideDialog, setOverrideDialog] = useState<{
    isOpen: boolean;
    stageId: string;
    stageName: string;
    currentContent: string;
  }>({
    isOpen: false,
    stageId: "",
    stageName: "",
    currentContent: ""
  });

  // Promote stage mutation
  const promoteStageM = useMutation({
    mutationFn: async ({ stageId, reason }: { stageId: string; reason?: string }) => {
      if (!report) throw new Error("No current report");
      return await apiRequest('POST', `/api/reports/${report.id}/snapshots/promote`, { stageId, reason });
    },
    onSuccess: (response: any) => {
      toast({
        title: "Stage gepromoveerd",
        description: response.message || `Stage succesvol gepromoveerd`,
        duration: 3000,
      });
      
      // Invalidate queries to refresh data
      if (report) {
        queryClient.invalidateQueries({ queryKey: ['/api/reports', report.id] });
        queryClient.invalidateQueries({ queryKey: ['/api/reports'] });
      }
    },
    onError: (error: any) => {
      console.error("❌ Failed to promote stage:", error);
      const errorMessage = typeof error === 'string' ? error : 
                          error?.message || error?.userMessage || 
                          (error?.response?.data?.message) ||
                          'Er ging iets mis bij het promoten van de stage';
      toast({
        title: "Promote mislukt", 
        description: errorMessage,
        variant: "destructive",
        duration: 5000,
      });
    }
  });

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
              {/* Step-back buttons */}
              {report && (
                <>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      promoteStageM.mutate({
                        stageId: "3_generatie",
                        reason: "Handmatig teruggevallen naar concept vanuit rapport header"
                      });
                    }}
                    disabled={promoteStageM.isPending}
                    className="hover:bg-blue-50 hover:border-blue-300"
                    data-testid="button-promote-concept"
                  >
                    <ArrowUp className="h-4 w-4 mr-2" />
                    Gebruik als basis
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      const currentContent = report.generatedContent || 'Geen huidige inhoud gevonden.';
                      setOverrideDialog({
                        isOpen: true,
                        stageId: "3_generatie",
                        stageName: "3. Generatie",
                        currentContent
                      });
                    }}
                    className="hover:bg-orange-50 hover:border-orange-300"
                    data-testid="button-override-concept"
                  >
                    <Edit3 className="h-4 w-4 mr-2" />
                    Overschrijf concept
                  </Button>
                </>
              )}
              
              {/* Divider */}
              {report && <div className="w-px h-6 bg-border" />}
              
              {/* Original buttons */}
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
            <div className="prose prose-sm max-w-none dark:prose-invert" data-testid="report-content">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-6 mb-4 border-b-2 border-blue-600 pb-2">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-8 mb-4 border-b border-gray-300 dark:border-gray-600 pb-1">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mt-6 mb-3">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p className="mb-4 text-gray-700 dark:text-gray-300 leading-relaxed">
                      {children}
                    </p>
                  ),
                  ul: ({ children }) => (
                    <ul className="mb-4 list-disc list-outside ml-6 space-y-1">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="mb-4 list-decimal list-outside ml-6 space-y-1">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li className="text-gray-700 dark:text-gray-300">
                      {children}
                    </li>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-bold text-gray-900 dark:text-gray-100">
                      {children}
                    </strong>
                  ),
                  em: ({ children }) => (
                    <em className="italic text-gray-700 dark:text-gray-300">
                      {children}
                    </em>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto mb-4">
                      <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      {children}
                    </thead>
                  ),
                  tbody: ({ children }) => (
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
                      {children}
                    </tbody>
                  ),
                  th: ({ children }) => (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {children}
                    </td>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-blue-500 pl-4 italic my-4 text-gray-600 dark:text-gray-400">
                      {children}
                    </blockquote>
                  ),
                  code: ({ className, children }) => {
                    const isInline = !className || !className.includes('language-');
                    return isInline ? (
                      <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm font-mono text-blue-600 dark:text-blue-400">
                        {children}
                      </code>
                    ) : (
                      <code className="block bg-gray-100 dark:bg-gray-800 p-4 rounded text-sm font-mono overflow-x-auto">
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {report.generatedContent}
              </ReactMarkdown>
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
      
      {/* Override Concept Dialog */}
      {report && (
        <OverrideConceptDialog
          isOpen={overrideDialog.isOpen}
          onClose={() => setOverrideDialog({ ...overrideDialog, isOpen: false })}
          reportId={report.id}
          stageId={overrideDialog.stageId}
          stageName={overrideDialog.stageName}
          currentContent={overrideDialog.currentContent}
        />
      )}
    </div>
  );
});

export default ReportPreview;
