import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ArrowLeft, FileText, Calendar, User, Download, FileDown, GitBranch, Eye, Activity, Edit2, Save, X } from "lucide-react";
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
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [isEditingClient, setIsEditingClient] = useState(false);
  const [editedClient, setEditedClient] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: report, isLoading, error } = useQuery<Report>({
    queryKey: [`/api/reports/${reportId}`],
    enabled: !!reportId,
    refetchInterval: 2000, // Auto-refresh every 2 seconds for real-time updates
  });

  // Mutation for updating case metadata
  const updateCaseMutation = useMutation({
    mutationFn: async (updates: { title?: string; clientName?: string }) => {
      const response = await fetch(`/api/cases/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Fout bij updaten');
      }

      const data = await response.json();
      return data.data || data;
    },
    onMutate: async (updates) => {
      // Cancel any outgoing refetches to avoid optimistic update being overwritten
      await queryClient.cancelQueries({ queryKey: [`/api/reports/${reportId}`] });

      // Snapshot the previous value
      const previousReport = queryClient.getQueryData([`/api/reports/${reportId}`]);

      // Optimistically update to the new value
      queryClient.setQueryData([`/api/reports/${reportId}`], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          ...updates,
          updatedAt: new Date().toISOString()
        };
      });

      // Return context with the snapshotted value
      return { previousReport };
    },
    onError: (error: Error, variables, context) => {
      // Rollback to previous value on error
      if (context?.previousReport) {
        queryClient.setQueryData([`/api/reports/${reportId}`], context.previousReport);
      }
      toast({
        title: "Fout bij opslaan",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: async () => {
      // Refetch immediately to get the updated data from server
      await queryClient.refetchQueries({ queryKey: [`/api/reports/${reportId}`] });

      // Invalidate all related queries to ensure UI updates everywhere
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${reportId}`] });
      // Also invalidate the cases list query (with all filter combinations)
      queryClient.invalidateQueries({
        queryKey: ["/api/cases"],
        exact: false
      });
      toast({
        title: "Succesvol bijgewerkt",
        description: "De wijzigingen zijn opgeslagen.",
      });
      setIsEditingTitle(false);
      setIsEditingClient(false);
    },
  });

  const handleSaveTitle = () => {
    if (editedTitle.trim() && editedTitle !== report?.title) {
      updateCaseMutation.mutate({ title: editedTitle.trim() });
    } else {
      setIsEditingTitle(false);
    }
  };

  const handleSaveClient = () => {
    if (editedClient.trim() && editedClient !== report?.clientName) {
      updateCaseMutation.mutate({ clientName: editedClient.trim() });
    } else {
      setIsEditingClient(false);
    }
  };

  const handleCancelEdit = (type: 'title' | 'client') => {
    if (type === 'title') {
      setIsEditingTitle(false);
      setEditedTitle(report?.title || "");
    } else {
      setIsEditingClient(false);
      setEditedClient(report?.clientName || "");
    }
  };

  // Transform conceptReportVersions into version timeline format
  // Uses the history array for accurate chronological versioning
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

    const versions = report.conceptReportVersions as any;

    // Use history array if available (most accurate)
    const history = versions?.history || [];
    if (history.length > 0) {
      const latestPointer = versions?.latest?.pointer;
      const latestVersion = versions?.latest?.v;

      return history.map((entry: any) => {
        const isLatest = entry.stageId === latestPointer && entry.v === latestVersion;
        return {
          version: entry.v,
          stageKey: entry.stageId,
          stageName: `${stageNames[entry.stageId] || entry.stageId} v${entry.v}`,
          changeCount: undefined, // Not tracked in history
          timestamp: entry.timestamp,
          isCurrent: isLatest
        };
      });
    }

    // Fallback: use stage keys (legacy behavior)
    const versionsList = Object.keys(versions || {})
      .filter(key => key !== 'latest' && key !== 'history')
      .map((stageKey) => {
        const versionData = versions?.[stageKey];
        const v = versionData?.v || 1;
        return {
          version: v,
          stageKey,
          stageName: `${stageNames[stageKey] || stageKey} v${v}`,
          changeCount: versionData?.changeCount,
          timestamp: versionData?.createdAt || versionData?.timestamp,
          isCurrent: versions?.latest?.pointer === stageKey
        };
      })
      .sort((a, b) => {
        // Sort by timestamp if available
        if (a.timestamp && b.timestamp) {
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        }
        return a.version - b.version;
      });

    return versionsList;
  }, [report?.conceptReportVersions]);

  const currentVersion = useMemo(() => {
    const versions = report?.conceptReportVersions as any;
    if (!versions?.latest) return versionCheckpoints.length;
    const latestPointer = versions.latest.pointer;
    const checkpoint = versionCheckpoints.find((v: any) => v.stageKey === latestPointer);
    return checkpoint?.version || versionCheckpoints.length;
  }, [report?.conceptReportVersions, versionCheckpoints]);

  const currentContent = useMemo(() => {
    if (!report?.conceptReportVersions) return report?.generatedContent || "";

    const versions = report.conceptReportVersions as any;

    // PRIORITEIT 1: Latest pointer - dit is de meest recente versie
    // Na feedback processing wijst dit naar de bijgewerkte versie (4a, 4b, etc)
    const latestPointer = versions?.latest?.pointer;
    if (latestPointer && versions[latestPointer]) {
      const versionData = versions[latestPointer];
      if (typeof versionData === 'string') return versionData;
      if (typeof versionData === 'object' && versionData.content) {
        return versionData.content;
      }
    }

    // FALLBACK 2: Kijk naar het gegenereerde rapport (3_generatie)
    // Dit wordt alleen gebruikt als er nog geen latest pointer is
    if (versions['3_generatie']) {
      const generationData = versions['3_generatie'];
      if (typeof generationData === 'string') return generationData;
      if (typeof generationData === 'object' && generationData.content) {
        return generationData.content;
      }
    }

    // FALLBACK 3: generatedContent field
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
            <div className="flex-1">
              <CardTitle className="flex items-center space-x-2 text-2xl mb-2">
                <FileText className="h-6 w-6" />
                {isEditingTitle ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={editedTitle}
                      onChange={(e) => setEditedTitle(e.target.value)}
                      className="text-2xl font-semibold h-10"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveTitle();
                        if (e.key === 'Escape') handleCancelEdit('title');
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={handleSaveTitle}
                      disabled={updateCaseMutation.isPending}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleCancelEdit('title')}
                      disabled={updateCaseMutation.isPending}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <span className="flex items-center gap-2 group">
                    <span>{report.title}</span>
                    <div
                      role="button"
                      tabIndex={0}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-accent rounded cursor-pointer"
                      onClick={() => {
                        setEditedTitle(report.title);
                        setIsEditingTitle(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setEditedTitle(report.title);
                          setIsEditingTitle(true);
                        }
                      }}
                    >
                      <Edit2 className="h-4 w-4" />
                    </div>
                  </span>
                )}
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <User className="h-4 w-4" />
                  {isEditingClient ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editedClient}
                        onChange={(e) => setEditedClient(e.target.value)}
                        className="h-7 text-sm w-48"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveClient();
                          if (e.key === 'Escape') handleCancelEdit('client');
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={handleSaveClient}
                        disabled={updateCaseMutation.isPending}
                        className="h-7 px-2"
                      >
                        <Save className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCancelEdit('client')}
                        disabled={updateCaseMutation.isPending}
                        className="h-7 px-2"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <span className="flex items-center gap-2 group">
                      <span>{report.clientName}</span>
                      <div
                        role="button"
                        tabIndex={0}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-accent rounded cursor-pointer"
                        onClick={() => {
                          setEditedClient(report.clientName);
                          setIsEditingClient(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setEditedClient(report.clientName);
                            setIsEditingClient(true);
                          }
                        }}
                      >
                        <Edit2 className="h-3 w-3" />
                      </div>
                    </span>
                  )}
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
              {report.conceptReportVersions && Object.keys(report.conceptReportVersions as any).filter(k => k !== 'latest' && k !== 'history').length > 1 ? (
                <ReportDiffViewer
                  versions={report.conceptReportVersions as Record<string, string>}
                  currentStageKey={(report.conceptReportVersions as any)?.latest?.pointer}
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
