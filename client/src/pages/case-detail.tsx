import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Calendar, User } from "lucide-react";
import WorkflowInterface from "@/components/workflow-interface";
import type { Report } from "@shared/schema";

export default function CaseDetail() {
  const params = useParams();
  const reportId = params.id;

  const { data: report, isLoading, error } = useQuery<Report>({
    queryKey: [`/api/reports/${reportId}`],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/reports/${reportId}`);
      return response.json();
    },
    enabled: !!reportId,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center space-x-4 mb-8">
          <Link href="/cases">
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
          <Link href="/cases">
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
          const totalStages = 11; // 11 workflow stages
          const percentage = Math.round((completedStages / totalStages) * 100);
          
          if (completedStages >= 3) {
            return `Stap ${completedStages}/11 (${percentage}%)`;
          } else {
            return `Wordt gegenereerd... ${completedStages}/11`;
          }
        }
        return "Gegenereerd";
      }
      case "exported": return "Geëxporteerd";
      case "archived": return "Gearchiveerd";
      default: return status;
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
            <CardTitle>📄 Gegenereerd Rapport</CardTitle>
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