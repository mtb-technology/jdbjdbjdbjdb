import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ArrowLeft, FileText, Calendar, User, Download, GitBranch, Eye, Activity, Edit2, Save, X, Paperclip, FileImage, AlertCircle, CheckCircle, ChevronDown, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import WorkflowInterface from "@/components/workflow-interface";
import { VersionTimeline } from "@/components/report/VersionTimeline";
import { ReportDiffViewer } from "@/components/report/ReportDiffViewer";
import { StickyReportPreview, FullScreenReportPreview } from "@/components/report/StickyReportPreview";
import { ExportDialog } from "@/components/export/ExportDialog";
import { DossierContextPanel } from "@/components/report/DossierContextPanel";
import { AppHeader } from "@/components/app-header";
import type { Report } from "@shared/schema";
import { STAGE_NAMES, getLatestConceptText } from "@shared/constants";
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
  const [expandedAttachments, setExpandedAttachments] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Check for autoStart query parameter
  const autoStart = new URLSearchParams(window.location.search).get('autoStart') === 'true';

  const { data: report, isLoading, error } = useQuery<Report>({
    queryKey: [`/api/reports/${reportId}`],
    enabled: !!reportId,
  });

  // Fetch attachments for the report
  const { data: attachmentsData } = useQuery<any[]>({
    queryKey: [`/api/upload/attachments/${reportId}`],
    enabled: !!reportId,
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
    onError: (error: Error, _variables, context) => {
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
    onSuccess: (updatedReport) => {
      // Close edit mode immediately - optimistic update already shows new value
      setIsEditingTitle(false);
      setIsEditingClient(false);

      // Update cache with server response
      if (updatedReport) {
        queryClient.setQueryData([`/api/reports/${reportId}`], (old: any) => ({
          ...old,
          ...updatedReport
        }));
      }

      // Invalidate cases list in background (non-blocking)
      queryClient.invalidateQueries({
        queryKey: ["/api/cases"],
        exact: false
      });

      toast({
        title: "Succesvol bijgewerkt",
        description: "De wijzigingen zijn opgeslagen.",
      });
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

    const versions = report.conceptReportVersions as any;

    // Use history array if available (most accurate)
    const history = versions?.history || [];
    if (history.length > 0) {
      const latestPointer = versions?.latest?.pointer;
      const latestVersion = versions?.latest?.v;

      const checkpoints = history.map((entry: any) => {
        const isLatest = entry.stageId === latestPointer && entry.v === latestVersion;
        return {
          version: entry.v,
          stageKey: entry.stageId,
          stageName: `${STAGE_NAMES[entry.stageId] || entry.stageId} v${entry.v}`,
          changeCount: undefined, // Not tracked in history
          timestamp: entry.timestamp,
          isCurrent: isLatest
        };
      });

      console.log('🔍 [versionCheckpoints] Final checkpoints from history:', checkpoints);
      return checkpoints;
    }

    // Fallback: use stage keys (legacy behavior)
    console.log('🔍 [versionCheckpoints] Using fallback (stage keys), no history array found');
    const versionsList = Object.keys(versions || {})
      .filter(key => key !== 'latest' && key !== 'history')
      .map((stageKey) => {
        const versionData = versions?.[stageKey];
        const v = versionData?.v || 1;
        return {
          version: v,
          stageKey,
          stageName: `${STAGE_NAMES[stageKey] || stageKey} v${v}`,
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

    console.log('🔍 [versionCheckpoints] Final checkpoints from fallback:', versionsList);
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
    return getLatestConceptText(report?.conceptReportVersions as any);
  }, [report?.conceptReportVersions]);

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
    if (!reportId) return;

    const checkpoint = versionCheckpoints.find((v: any) => v.version === version);
    if (!checkpoint) return;

    try {
      const response = await apiRequest(
        'POST',
        `/api/reports/${reportId}/restore-version`,
        { stageKey: checkpoint.stageKey }
      );

      if (!response.ok) {
        throw new Error('Failed to restore version');
      }

      const result = await response.json();
      const data = result.success ? result.data : result;

      toast({
        title: "Versie Hersteld",
        description: `Versie ${version} (${checkpoint.stageName}) is nu de actieve versie`,
        duration: 3000,
      });

      // Update the report data in cache
      if (data.report) {
        queryClient.setQueryData([`/api/reports/${reportId}`], data.report);
      }

      // Invalidate cases list to ensure all views show updated data
      queryClient.invalidateQueries({ queryKey: ["/api/cases"], exact: false });

      // Force refetch to get latest version data
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${reportId}`] });
    } catch (error: unknown) {
      console.error('Failed to restore version:', error);
      toast({
        title: "Fout bij herstellen",
        description: "Er ging iets mis bij het herstellen van de versie",
        variant: "destructive",
        duration: 5000,
      });
    }
  };

  const handleVersionDelete = async (stageKey: string) => {
    if (!reportId) return;

    try {
      const response = await apiRequest(
        'DELETE',
        `/api/reports/${reportId}/stage/${stageKey}`
      );

      if (!response.ok) {
        throw new Error('Failed to delete stage');
      }

      const result = await response.json();
      const data = result.success ? result.data : result;
      const cascadeDeleted = data.cascadeDeleted || [];

      // Get the new active version info
      const newLatest = data.report?.conceptReportVersions?.latest;
      const newActiveStage = newLatest?.pointer || 'vorige versie';

      const cascadeMessage = cascadeDeleted.length > 0
        ? ` en ${cascadeDeleted.length} volgende stage${cascadeDeleted.length > 1 ? 's' : ''}`
        : '';

      toast({
        title: "Versie Verwijderd",
        description: `${stageKey}${cascadeMessage} verwijderd. Actieve versie: ${newActiveStage}`,
        duration: 4000,
      });

      // DIRECT UPDATE: Set the returned report data immediately in the cache
      // This bypasses HTTP caching (304) and immediately updates the UI
      if (data.report) {
        queryClient.setQueryData([`/api/reports/${reportId}`], data.report);
      }

      // Invalidate cases list to ensure all views show updated data
      queryClient.invalidateQueries({ queryKey: ["/api/cases"], exact: false });

      // Force refetch to get latest version data
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${reportId}`] });
    } catch (error: unknown) {
      console.error('Failed to delete version:', error);
      toast({
        title: "Fout bij verwijderen",
        description: "Er ging iets mis bij het verwijderen van de versie",
        variant: "destructive",
        duration: 5000,
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/cases">
              <Button variant="outline" size="sm" data-testid="button-back-to-cases">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Terug
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{report.title}</h1>
              <p className="text-muted-foreground">{report.clientName}</p>
            </div>
          </div>

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
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="workflow" className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Workflow
              </TabsTrigger>
              <TabsTrigger value="attachments" className="flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                Bijlages {attachmentsData && attachmentsData.length > 0 && `(${attachmentsData.length})`}
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
                  autoStart={autoStart}
                  onComplete={() => {
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

            <TabsContent value="attachments" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Paperclip className="h-5 w-5" />
                    Bijlages bij deze case
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {attachmentsData && attachmentsData.length > 0 ? (
                    <div className="space-y-3">
                      {attachmentsData.map((att: any) => {
                        const isExpanded = expandedAttachments.has(att.id);
                        const toggleExpand = () => {
                          setExpandedAttachments(prev => {
                            const next = new Set(prev);
                            if (next.has(att.id)) {
                              next.delete(att.id);
                            } else {
                              next.add(att.id);
                            }
                            return next;
                          });
                        };

                        return (
                          <Collapsible key={att.id} open={isExpanded} onOpenChange={toggleExpand}>
                            <div className="border rounded-lg overflow-hidden">
                              <CollapsibleTrigger asChild>
                                <div className="flex items-center justify-between p-3 hover:bg-accent/50 transition-colors cursor-pointer">
                                  <div className="flex items-center gap-3">
                                    {isExpanded ? (
                                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    )}
                                    {att.mimeType?.includes('pdf') ? (
                                      <FileText className="h-8 w-8 text-red-500" />
                                    ) : att.mimeType?.includes('image') ? (
                                      <FileImage className="h-8 w-8 text-blue-500" />
                                    ) : (
                                      <FileText className="h-8 w-8 text-gray-500" />
                                    )}
                                    <div>
                                      <p className="font-medium text-sm">{att.filename}</p>
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>{att.pageCount ? `${att.pageCount} pagina's` : 'Bestand'}</span>
                                        <span>•</span>
                                        <span>{Math.round(parseInt(att.fileSize) / 1024)} KB</span>
                                        {att.extractedText && (
                                          <>
                                            <span>•</span>
                                            <span>{att.extractedText.length.toLocaleString()} tekens</span>
                                          </>
                                        )}
                                        {att.usedInStages && att.usedInStages.length > 0 && (
                                          <>
                                            <span>•</span>
                                            <span>Gebruikt in: {att.usedInStages.join(', ')}</span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    {att.needsVisionOCR ? (
                                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                                        <FileImage className="h-3 w-3 mr-1" />
                                        Gemini Vision
                                      </Badge>
                                    ) : att.extractedText ? (
                                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                        <CheckCircle className="h-3 w-3 mr-1" />
                                        Tekst geëxtraheerd
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="bg-gray-50 text-gray-500">
                                        <AlertCircle className="h-3 w-3 mr-1" />
                                        Geen tekst
                                      </Badge>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => window.open(`/api/upload/attachment/${att.id}/download`, '_blank')}
                                    >
                                      <Download className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="border-t bg-muted/30 p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-sm font-medium">
                                      {att.needsVisionOCR ? "📄 Gescande PDF - wordt door Gemini Vision gelezen" : "Geëxtraheerde tekst"}
                                    </h4>
                                    {att.extractedText && (
                                      <span className="text-xs text-muted-foreground">
                                        {att.extractedText.length.toLocaleString()} tekens
                                      </span>
                                    )}
                                  </div>
                                  {att.needsVisionOCR ? (
                                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
                                      <p className="text-amber-800 mb-2">
                                        <strong>Dit is een gescande PDF</strong> met weinig of geen extracteerbare tekst.
                                      </p>
                                      <p className="text-amber-700">
                                        Bij Stage 1 (Informatiecheck) wordt dit bestand direct naar Gemini Vision gestuurd
                                        voor OCR-verwerking. De AI kan de inhoud dan visueel lezen.
                                      </p>
                                      {(() => {
                                        // Filter out useless page markers like "-- 3 of 4 --"
                                        const cleanedText = att.extractedText
                                          ?.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '')
                                          .trim();
                                        return cleanedText && cleanedText.length > 10 ? (
                                          <div className="mt-3 pt-3 border-t border-amber-200">
                                            <p className="text-xs text-amber-600 mb-1">Beschikbare tekst (beperkt):</p>
                                            <pre className="text-xs bg-white/50 p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap font-mono">
                                              {cleanedText}
                                            </pre>
                                          </div>
                                        ) : null;
                                      })()}
                                    </div>
                                  ) : att.extractedText ? (
                                    <pre className="text-xs bg-background border rounded-lg p-3 overflow-auto max-h-96 whitespace-pre-wrap font-mono">
                                      {att.extractedText}
                                    </pre>
                                  ) : (
                                    <p className="text-sm text-muted-foreground italic">
                                      Geen tekst beschikbaar voor dit bestand.
                                    </p>
                                  )}
                                </div>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        );
                      })}

                      {/* Summary */}
                      <div className="mt-4 pt-4 border-t">
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                          <span>Totaal: {attachmentsData.length} bijlage(s)</span>
                          <div className="flex items-center gap-4">
                            <span className="flex items-center gap-1">
                              <CheckCircle className="h-4 w-4 text-green-500" />
                              {attachmentsData.filter((a: any) => a.extractedText && !a.needsVisionOCR).length} tekst
                            </span>
                            <span className="flex items-center gap-1">
                              <FileImage className="h-4 w-4 text-amber-500" />
                              {attachmentsData.filter((a: any) => a.needsVisionOCR).length} vision OCR
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-8 text-center text-muted-foreground">
                      <Paperclip className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Geen bijlages geüpload voor deze case.</p>
                      <p className="text-sm mt-2">Upload bijlages via de Pipeline pagina.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
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
                  onDelete={handleVersionDelete}
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
                  stageNames={STAGE_NAMES}
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

        {/* Dossier Context & Report Preview */}
        <div className="hidden lg:block">
          <DossierContextPanel
            reportId={reportId!}
            summary={report.dossierContextSummary || undefined}
            rawText={(report.dossierData as any)?.rawText || ""}
          />
          <StickyReportPreview
            content={currentContent}
            version={currentVersion}
            stageName={versionCheckpoints.find((v: any) => v.version === currentVersion)?.stageName || "Concept"}
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
          stageName={versionCheckpoints.find((v: any) => v.version === currentVersion)?.stageName || "Concept"}
          onClose={() => setShowFullScreen(false)}
        />
      )}
      </div>
    </div>
  );
}
