import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Calendar, User, Download, FileDown } from "lucide-react";
import WorkflowInterface from "@/components/workflow-interface";
import type { Report } from "@shared/schema";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function CaseDetail() {
  const params = useParams();
  const reportId = params.id;
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const { data: report, isLoading, error } = useQuery<Report>({
    queryKey: [`/api/reports`, reportId],
    enabled: !!reportId,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center space-x-4 mb-8">
          <Link href="/cases" asChild>
            <Button variant="outline" size="sm" data-testid="button-back-to-cases">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Terug naar Cases
            </Button>
          </Link>
        </div>
        <div className="text-center">Rapport laden...</div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center space-x-4 mb-8">
          <Link href="/cases" asChild>
            <Button variant="outline" size="sm" data-testid="button-back-to-cases">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Terug naar Cases
            </Button>
          </Link>
        </div>
        <div className="text-center text-red-600">
          Rapport niet gevonden of fout bij laden.
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "draft": return "bg-gray-100 text-gray-800";
      case "processing": return "bg-blue-100 text-blue-800";
      case "generated": return "bg-green-100 text-green-800";
      case "exported": return "bg-purple-100 text-purple-800";
      case "archived": return "bg-yellow-100 text-yellow-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusLabel = (status: string, report?: any) => {
    switch (status) {
      case "draft": return "Concept";
      case "processing": return "In Behandeling";
      case "generated": {
        // Calculate progress based on completed stages
        if (report?.stageResults) {
          const completedStages = Object.keys(report.stageResults).length;
          const totalStages = 13; // 13 workflow stages: 1-3 (3) + 4a-4g (7) + 5,6,final = 13
          const percentage = Math.round((completedStages / totalStages) * 100);
          
          if (completedStages >= 3) {
            return `Stap ${completedStages}/13 (${percentage}%)`;
          } else {
            return `Wordt gegenereerd... ${completedStages}/13`;
          }
        }
        return "Gegenereerd";
      }
      case "exported": return "Geëxporteerd";
      case "archived": return "Gearchiveerd";
      default: return status;
    }
  };

  const handlePDFExport = async () => {
    if (!reportId) return;
    
    setIsExporting(true);
    try {
      const response = await fetch(`/api/cases/${reportId}/export/pdf`);
      
      if (!response.ok) {
        throw new Error('PDF export mislukt');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `rapport-${report?.clientName?.replace(/[^a-zA-Z0-9]/g, '-')}-${reportId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "PDF Geëxporteerd",
        description: "Het rapport is succesvol geëxporteerd als PDF",
      });
    } catch (error: any) {
      console.error('PDF export error:', error);
      toast({
        title: "Export Mislukt",
        description: error.message || "Er ging iets mis bij het exporteren van het PDF",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header with back button */}
      <div className="flex items-center space-x-4 mb-8">
        <Link href="/cases">
          <Button variant="outline" size="sm" data-testid="button-back-to-cases">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Terug naar Cases
          </Button>
        </Link>
      </div>

      {/* Case Overview */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center space-x-2">
              <FileText className="h-5 w-5" />
              <span>{report.title}</span>
            </CardTitle>
            <Badge className={getStatusColor(report.status)} data-testid="badge-case-status">
              {getStatusLabel(report.status, report)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center space-x-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span>Client: {report.clientName}</span>
            </div>
            <div className="flex items-center space-x-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>Aangemaakt: {report.createdAt ? new Date(report.createdAt).toLocaleDateString('nl-NL') : 'Onbekend'}</span>
            </div>
            <div className="flex items-center space-x-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>Bijgewerkt: {report.updatedAt ? new Date(report.updatedAt).toLocaleDateString('nl-NL') : 'Onbekend'}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Show generated report if available */}
      {report.generatedContent && (
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>📄 Gegenereerd Rapport</CardTitle>
              <Button
                onClick={handlePDFExport}
                disabled={isExporting}
                variant="outline"
                size="sm"
                data-testid="button-export-pdf"
              >
                {isExporting ? (
                  <>
                    <Download className="mr-2 h-4 w-4 animate-spin" />
                    Exporteren...
                  </>
                ) : (
                  <>
                    <FileDown className="mr-2 h-4 w-4" />
                    Export PDF
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div 
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: report.generatedContent }}
            />
          </CardContent>
        </Card>
      )}

      {/* Continue workflow if not completed */}
      {report.status !== 'exported' && report.status !== 'archived' && (
        <WorkflowInterface
          dossier={report.dossierData as any}
          bouwplan={report.bouwplanData as any}
          clientName={report.clientName}
          rawText={(report.dossierData as any)?.rawText || ""}
          existingReport={report}
          onComplete={(updatedReport) => {
            // Refresh the report data
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}