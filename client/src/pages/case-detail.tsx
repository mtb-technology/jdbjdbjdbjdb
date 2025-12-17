/**
 * CaseDetail Page
 *
 * Refactored orchestrator following Clean Code and SOLID principles.
 *
 * Changes from original 851-line version:
 * - Extracted metadata editing into useCaseMetadata hook
 * - Extracted version management into useVersionManagement hook
 * - Extracted document header into CaseHeader component
 * - Extracted attachments tab into AttachmentsTab component
 * - Extracted status helpers into caseDetailUtils.ts
 *
 * Responsibilities:
 * - Overall page layout and routing
 * - Tab navigation
 * - Delegates UI rendering to extracted components
 */

import { useParams, Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { QUERY_KEYS } from "@/lib/queryKeys";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  ArrowLeft,
  FileText,
  GitBranch,
  Eye,
  Activity,
  Paperclip,
  PanelRight,
} from "lucide-react";

// Feature Components
import WorkflowInterface from "@/components/workflow-interface";
import { VersionTimeline } from "@/components/report/VersionTimeline";
import { ReportDiffViewer } from "@/components/report/ReportDiffViewer";
import {
  StickyReportPreview,
  FullScreenReportPreview,
} from "@/components/report/StickyReportPreview";
import { ExportDialog } from "@/components/export/ExportDialog";
import { FiscaleBriefingPanel } from "@/components/report/FiscaleBriefingPanel";
import { AppHeader } from "@/components/app-header";

// Extracted Components
import { CaseHeader, AttachmentsTab } from "@/components/case-detail";

// Hooks
import { useCaseMetadata } from "@/hooks/useCaseMetadata";
import { useVersionManagement } from "@/hooks/useVersionManagement";

// Utils
import { isWorkflowEditable } from "@/utils/caseDetailUtils";

// Types & Constants
import type { Report, DossierData, BouwplanData } from "@shared/schema";
import { STAGE_NAMES } from "@shared/constants";
import type { Attachment } from "@/types/caseDetail.types";

export default function CaseDetail() {
  const params = useParams();
  const reportId = params.id;

  // UI State
  const [showFullScreen, setShowFullScreen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("workflow");
  const [expandedAttachments, setExpandedAttachments] = useState<Set<string>>(
    new Set()
  );

  // Check for autoStart query parameter
  const autoStart =
    new URLSearchParams(window.location.search).get("autoStart") === "true";

  // Data Fetching
  const {
    data: report,
    isLoading,
    error,
  } = useQuery<Report>({
    queryKey: QUERY_KEYS.reports.detail(reportId!),
    queryFn: async () => {
      const response = await fetch(`/api/reports/${reportId}`);
      if (!response.ok) throw new Error('Failed to fetch report');
      const result = await response.json();
      // API returns wrapped response { success: true, data: ... }
      return result.success ? result.data : result;
    },
    enabled: !!reportId,
  });

  const { data: attachmentsData } = useQuery<Attachment[]>({
    queryKey: [`/api/upload/attachments/${reportId}`],
    enabled: !!reportId,
    // Poll every 5s while OCR is in progress to auto-update status
    refetchInterval: (query) => {
      const attachments = query.state.data;
      if (!attachments) return false;
      // Check if any attachment has pending OCR
      const hasPendingOcr = attachments.some(
        (a) => a.needsVisionOCR === true &&
               (!a.extractedText || a.extractedText.length <= 100)
      );
      return hasPendingOcr ? 5000 : false;
    },
  });

  // Custom Hooks
  const {
    isEditingTitle,
    isEditingClient,
    editedTitle,
    editedClient,
    isPending,
    handleEditTitle,
    handleEditClient,
    handleSaveTitle,
    handleSaveClient,
    handleCancelEdit,
    setEditedTitle,
    setEditedClient,
  } = useCaseMetadata({ reportId, report });

  const {
    versionCheckpoints,
    currentVersion,
    currentContent,
    latestChanges,
    handleVersionRestore,
    handleVersionDelete,
  } = useVersionManagement({ reportId, report });

  // Handlers
  const handleToggleAttachment = useCallback((id: string) => {
    setExpandedAttachments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Loading State
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

  // Error State
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

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <div className="mx-auto max-w-[1800px] px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header - Minimal back button */}
        <div className="mb-4">
          <Link href="/cases">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground -ml-2"
              data-testid="button-back-to-cases"
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              Terug
            </Button>
          </Link>
        </div>

        {/* Document Header with Workflow Controls */}
        <CaseHeader
          report={report}
          isEditingClient={isEditingClient}
          editedClient={editedClient}
          isPending={isPending}
          onEditClient={handleEditClient}
          onSaveClient={handleSaveClient}
          onCancelEdit={handleCancelEdit}
          onClientChange={setEditedClient}
          versionCheckpoints={versionCheckpoints}
          currentVersion={currentVersion}
          // Workflow props
          stageResults={report.stageResults as Record<string, string>}
          conceptReportVersions={report.conceptReportVersions as Record<string, unknown>}
          onExpressComplete={() => window.location.reload()}
          onAdjustmentApplied={() => window.location.reload()}
          rolledBackChanges={report.rolledBackChanges as Record<string, { rolledBackAt: string }> | undefined}
          // Header action props
          reportId={reportId}
          onShowPreview={() => setShowFullScreen(true)}
        />

        {/* 2-Column Layout: Content + Sticky Preview */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-6">
          {/* Main Content Area */}
          <div className="space-y-6">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList className="inline-flex h-10 items-center justify-start gap-1 rounded-full bg-muted p-1">
                <TabsTrigger
                  value="workflow"
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  <Activity className="h-4 w-4" />
                  Workflow
                </TabsTrigger>
                <TabsTrigger
                  value="attachments"
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  <Paperclip className="h-4 w-4" />
                  Bijlages
                  {attachmentsData && attachmentsData.length > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground">({attachmentsData.length})</span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="timeline"
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  <GitBranch className="h-4 w-4" />
                  Timeline
                  {versionCheckpoints.length > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground">({versionCheckpoints.length})</span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="diff"
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  <Eye className="h-4 w-4" />
                  Vergelijk
                </TabsTrigger>
              </TabsList>

              {/* Workflow Tab */}
              <TabsContent value="workflow" className="mt-6">
                {isWorkflowEditable(report.status) ? (
                  <WorkflowInterface
                    dossier={report.dossierData as DossierData}
                    bouwplan={report.bouwplanData as BouwplanData}
                    clientName={report.clientName}
                    rawText={
                      (report.dossierData as DossierData & { rawText?: string })?.rawText || ""
                    }
                    existingReport={report}
                    autoStart={autoStart}
                    onComplete={() => {
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

              {/* Attachments Tab */}
              <TabsContent value="attachments" className="mt-6">
                <AttachmentsTab
                  attachments={attachmentsData}
                  expandedAttachments={expandedAttachments}
                  onToggleExpand={handleToggleAttachment}
                />
              </TabsContent>

              {/* Timeline Tab */}
              <TabsContent value="timeline" className="mt-6">
                {versionCheckpoints.length > 0 ? (
                  <VersionTimeline
                    versions={versionCheckpoints}
                    currentVersion={currentVersion}
                    onVersionSelect={(version) => {
                      console.log("Version selected:", version);
                    }}
                    onRestore={handleVersionRestore}
                    onDelete={handleVersionDelete}
                  />
                ) : (
                  <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                      <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Nog geen versie geschiedenis beschikbaar.</p>
                      <p className="text-sm mt-2">
                        Start de workflow om versies te zien.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Diff Tab */}
              <TabsContent value="diff" className="mt-6">
                {report.conceptReportVersions &&
                Object.keys(
                  report.conceptReportVersions as Record<string, unknown>
                ).filter((k) => k !== "latest" && k !== "history").length > 1 ? (
                  <ReportDiffViewer
                    versions={
                      report.conceptReportVersions as Record<string, string>
                    }
                    currentStageKey={
                      (
                        report.conceptReportVersions as {
                          latest?: { pointer?: string };
                        }
                      )?.latest?.pointer
                    }
                    stageNames={STAGE_NAMES}
                  />
                ) : (
                  <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                      <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Minimaal 2 versies nodig om te vergelijken.</p>
                      <p className="text-sm mt-2">
                        Voer meer workflow stappen uit.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Executive Summary & Report Preview - Hidden below XL (1280px) */}
          <div className="hidden xl:block space-y-4">
            <FiscaleBriefingPanel
              reportId={reportId!}
              stageResults={report.stageResults as Record<string, string> | null}
            />
            <StickyReportPreview
              content={currentContent}
              version={currentVersion}
              stageName={
                versionCheckpoints.find((v) => v.version === currentVersion)
                  ?.stageName || "Concept"
              }
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
            stageName={
              versionCheckpoints.find((v) => v.version === currentVersion)
                ?.stageName || "Concept"
            }
            onClose={() => setShowFullScreen(false)}
          />
        )}

        {/* Floating Action Button for Preview (visible below XL) */}
        <div className="fixed bottom-6 right-6 xl:hidden z-50">
          <Sheet>
            <SheetTrigger asChild>
              <Button
                size="lg"
                className="h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-shadow"
              >
                <PanelRight className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[400px] sm:w-[450px] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Executive Summary & Preview</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <FiscaleBriefingPanel
                  reportId={reportId!}
                  stageResults={report.stageResults as Record<string, string> | null}
                />
                <StickyReportPreview
                  content={currentContent}
                  version={currentVersion}
                  stageName={
                    versionCheckpoints.find((v) => v.version === currentVersion)
                      ?.stageName || "Concept"
                  }
                  changeCount={latestChanges}
                  versions={versionCheckpoints}
                  onFullView={() => setShowFullScreen(true)}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </div>
  );
}
