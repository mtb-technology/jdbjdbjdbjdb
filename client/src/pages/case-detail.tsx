import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, FileText, Calendar, User, Download, FileDown, GitBranch, Eye, Activity } from "lucide-react";
import WorkflowInterface from "@/components/workflow-interface";
import { VersionTimeline } from "@/components/report/VersionTimeline";
import { ReportDiffViewer } from "@/components/report/ReportDiffViewer";
import { StickyReportPreview, FullScreenReportPreview } from "@/components/report/StickyReportPreview";
import { ExportDialog } from "@/components/export/ExportDialog";
import type { Report } from "@shared/schema";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";

export default function CaseDetail() {
  const params = useParams();
  const reportId = params.id;
  const [showFullScreen, setShowFullScreen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("workflow");
  const { toast } = useToast();

  const { data: report, isLoading, error } = useQuery<Report>({
    queryKey: [`/api/reports/${reportId}`],
    enabled: !!reportId,
    refetchInterval: 5000, // Auto-refresh every 5 seconds for real-time updates
  });

  // Transform conceptReportVersions into version timeline format
  const versionCheckpoints = useMemo(() => {
    if (!report?.conceptReportVersions) return [];

    const stageNames: Record<string, string> = {
      '1_informatiecheck': 'Informatie Check',
      '2_complexiteitscheck': 'Complexiteits Check',
      '3_generatie': 'Basis Rapport',
      '4a_BronnenSpecialist': 'Bronnen Review',
      '4b_FiscaalTechnischSpecialist': 'Fiscaal Technisch',
      '4c_ScenarioGatenAnalist': 'Scenario Analyse',
      '4d_DeVertaler': 'Communicatie Review',
      '4e_DeAdvocaat': 'Juridisch Review',
      '4f_DeKlantpsycholoog': 'Client Psychologie',
      '6_change_summary': 'Wijzigingen Samenvatting'
    };

    const versions = Object.keys(report.conceptReportVersions || {})
      .filter(key => key !== 'latest' && key !== 'history')
      .map((stageKey, index) => {
        const versionData = report.conceptReportVersions?.[stageKey];
        return {
          version: index + 1,
          stageKey,
          stageName: stageNames[stageKey] || stageKey,
          changeCount: (versionData as any)?.changeCount,
          timestamp: (versionData as any)?.createdAt || (versionData as any)?.timestamp,
          isCurrent: report.conceptReportVersions?.latest?.pointer === stageKey
        };
      })
      .sort((a, b) => a.version - b.version);

    return versions;
  }, [report?.conceptReportVersions]);

  const currentVersion = useMemo(() => {
    if (!report?.conceptReportVersions?.latest) return versionCheckpoints.length;
    const latestPointer = report.conceptReportVersions.latest.pointer;
    const checkpoint = versionCheckpoints.find(v => v.stageKey === latestPointer);
    return checkpoint?.version || versionCheckpoints.length;
  }, [report?.conceptReportVersions, versionCheckpoints]);

  const currentContent = useMemo(() => {
    if (!report?.conceptReportVersions) return report?.generatedContent || "";

    // PRIORITEIT 1: Kijk altijd eerst naar het gegenereerde rapport (3_generatie)
    // Dit is het eigenlijke rapport, niet de reviewer feedback
    if (report.conceptReportVersions['3_generatie']) {
      const generationData = report.conceptReportVersions['3_generatie'];
      if (typeof generationData === 'string') return generationData;
      if (typeof generationData === 'object' && (generationData as any).content) {
        return (generationData as any).content;
      }
    }

    // PRIORITEIT 2 removed: 5_feedback_verwerker is deprecated

    // FALLBACK 3: Latest pointer (alleen als geen rapport beschikbaar)
    const latestPointer = report.conceptReportVersions.latest?.pointer;
    if (latestPointer && report.conceptReportVersions[latestPointer]) {
      const versionData = report.conceptReportVersions[latestPointer];
      if (typeof versionData === 'string') return versionData;
      if (typeof versionData === 'object' && (versionData as any).content) {
        return (versionData as any).content;
      }
    }

    // FALLBACK 4: generatedContent field
    return report?.generatedContent || "";
  }, [report?.conceptReportVersions, report?.generatedContent]);

  const latestChanges = useMemo(() => {
    if (!versionCheckpoints.length) return 0;
    const latestCheckpoint = versionCheckpoints[versionCheckpoints.length - 1];
    return latestCheckpoint.changeCount || 0;
  }, [versionCheckpoints]);

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
        if (report?.stageResults) {
          const completedStages = Object.keys(report.stageResults).length;
          const totalStages = 13;
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

  const handleVersionRestore = async (version: number) => {
    const checkpoint = versionCheckpoints.find(v => v.version === version);
    if (!checkpoint) return;

    toast({
      title: "Versie Herstellen",
      description: `Versie ${version} (${checkpoint.stageName}) wordt hersteld...`,
    });

    // TODO: Implement version restore API call
    // await apiRequest(`/api/reports/${reportId}/restore-version`, {
    //   method: 'POST',
    //   body: JSON.stringify({ stageKey: checkpoint.stageKey })
    // });
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header with back button */}
      <div className="flex items-center justify-between mb-8">
        <Link href="/cases">
          <Button variant="outline" size="sm" data-testid="button-back-to-cases">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Terug naar Cases
          </Button>
        </Link>

        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          <Badge className={getStatusColor(report.status)} data-testid="badge-case-status">
            {getStatusLabel(report.status, report)}
          </Badge>
          <ExportDialog
            reportId={reportId || ""}
            reportTitle={report.title}
            clientName={report.clientName}
          />
        </div>
      </div>

      {/* Document Header */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center space-x-2 text-2xl mb-2">
                <FileText className="h-6 w-6" />
                <span>{report.title}</span>
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <User className="h-4 w-4" />
                  <span>{report.clientName}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  <span>Bijgewerkt: {report.updatedAt ? new Date(report.updatedAt).toLocaleDateString('nl-NL') : 'Onbekend'}</span>
                </div>
                {versionCheckpoints.length > 0 && (
                  <div className="flex items-center gap-1">
                    <GitBranch className="h-4 w-4" />
                    <span>Versie {currentVersion} van {versionCheckpoints.length}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* 2-Column Layout: Content + Sticky Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
        {/* Main Content Area */}
        <div className="space-y-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="workflow" className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Workflow
              </TabsTrigger>
              <TabsTrigger value="timeline" className="flex items-center gap-2">
                <GitBranch className="h-4 w-4" />
                Timeline {versionCheckpoints.length > 0 && `(${versionCheckpoints.length})`}
              </TabsTrigger>
              <TabsTrigger value="diff" className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Vergelijk
              </TabsTrigger>
            </TabsList>

            <TabsContent value="workflow" className="mt-6">
              {report.status !== 'exported' && report.status !== 'archived' ? (
                <WorkflowInterface
                  dossier={report.dossierData as any}
                  bouwplan={report.bouwplanData as any}
                  clientName={report.clientName}
                  rawText={(report.dossierData as any)?.rawText || ""}
                  existingReport={report}
                  onComplete={(updatedReport) => {
                    // Trigger re-fetch
                    window.location.reload();
                  }}
                />
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Dit rapport is voltooid en geëxporteerd.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="timeline" className="mt-6">
              {versionCheckpoints.length > 0 ? (
                <VersionTimeline
                  versions={versionCheckpoints}
                  currentVersion={currentVersion}
                  onVersionSelect={(version) => {
                    console.log('Version selected:', version);
                  }}
                  onRestore={handleVersionRestore}
                />
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nog geen versie geschiedenis beschikbaar.</p>
                    <p className="text-sm mt-2">Start de workflow om versies te zien.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="diff" className="mt-6">
              {report.conceptReportVersions && Object.keys(report.conceptReportVersions).filter(k => k !== 'latest' && k !== 'history').length > 1 ? (
                <ReportDiffViewer
                  versions={report.conceptReportVersions}
                  currentStageKey={report.conceptReportVersions?.latest?.pointer}
                  stageNames={{
                    '1_informatiecheck': 'Informatie Check',
                    '2_complexiteitscheck': 'Complexiteits Check',
                    '3_generatie': 'Basis Rapport',
                    '4a_BronnenSpecialist': 'Bronnen Review',
                    '4b_FiscaalTechnischSpecialist': 'Fiscaal Technisch',
                    '4c_ScenarioGatenAnalist': 'Scenario Analyse',
                    '4d_DeVertaler': 'Communicatie Review',
                    '4e_DeAdvocaat': 'Juridisch Review',
                    '4f_DeKlantpsycholoog': 'Client Psychologie',
                    '6_change_summary': 'Wijzigingen Samenvatting'
                  }}
                />
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Minimaal 2 versies nodig om te vergelijken.</p>
                    <p className="text-sm mt-2">Voer meer workflow stappen uit.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Sticky Report Preview */}
        <div className="hidden lg:block">
          <StickyReportPreview
            content={currentContent}
            version={currentVersion}
            stageName={versionCheckpoints.find(v => v.version === currentVersion)?.stageName || "Concept"}
            changeCount={latestChanges}
            versions={versionCheckpoints}
            onFullView={() => setShowFullScreen(true)}
          />
        </div>
      </div>

      {/* Full Screen Preview Modal */}
      {showFullScreen && (
        <FullScreenReportPreview
          content={currentContent}
          version={currentVersion}
          stageName={versionCheckpoints.find(v => v.version === currentVersion)?.stageName || "Concept"}
          onClose={() => setShowFullScreen(false)}
        />
      )}
    </div>
  );
}
