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

import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState, useCallback } from "react";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  FileText,
  GitBranch,
  Eye,
  Activity,
  Paperclip,
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
import { DossierContextPanel } from "@/components/report/DossierContextPanel";
import { AppHeader } from "@/components/app-header";

// Extracted Components
import { CaseHeader, AttachmentsTab } from "@/components/case-detail";

// Hooks
import { useCaseMetadata } from "@/hooks/useCaseMetadata";
import { useVersionManagement } from "@/hooks/useVersionManagement";

// Utils
import { getStatusColor, getStatusLabel, isWorkflowEditable } from "@/utils/caseDetailUtils";

// Types & Constants
import type { Report } from "@shared/schema";
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
    queryKey: [`/api/reports/${reportId}`],
    enabled: !!reportId,
  });

  const { data: attachmentsData } = useQuery<Attachment[]>({
    queryKey: [`/api/upload/attachments/${reportId}`],
    enabled: !!reportId,
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

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/cases">
              <Button
                variant="outline"
                size="sm"
                data-testid="button-back-to-cases"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Terug
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {report.title}
              </h1>
              <p className="text-muted-foreground">{report.clientName}</p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2">
            <Badge
              className={getStatusColor(report.status)}
              data-testid="badge-case-status"
            >
              {getStatusLabel(
                report.status,
                report.stageResults as Record<string, unknown>
              )}
            </Badge>
            <ExportDialog
              reportId={reportId || ""}
              reportTitle={report.title}
              clientName={report.clientName}
            />
          </div>
        </div>

        {/* Document Header */}
        <CaseHeader
          report={report}
          isEditingTitle={isEditingTitle}
          isEditingClient={isEditingClient}
          editedTitle={editedTitle}
          editedClient={editedClient}
          isPending={isPending}
          onEditTitle={handleEditTitle}
          onEditClient={handleEditClient}
          onSaveTitle={handleSaveTitle}
          onSaveClient={handleSaveClient}
          onCancelEdit={handleCancelEdit}
          onTitleChange={setEditedTitle}
          onClientChange={setEditedClient}
          versionCheckpoints={versionCheckpoints}
          currentVersion={currentVersion}
        />

        {/* 2-Column Layout: Content + Sticky Preview */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
          {/* Main Content Area */}
          <div className="space-y-6">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="workflow" className="flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Workflow
                </TabsTrigger>
                <TabsTrigger
                  value="attachments"
                  className="flex items-center gap-2"
                >
                  <Paperclip className="h-4 w-4" />
                  Bijlages{" "}
                  {attachmentsData &&
                    attachmentsData.length > 0 &&
                    `(${attachmentsData.length})`}
                </TabsTrigger>
                <TabsTrigger value="timeline" className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  Timeline{" "}
                  {versionCheckpoints.length > 0 &&
                    `(${versionCheckpoints.length})`}
                </TabsTrigger>
                <TabsTrigger value="diff" className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Vergelijk
                </TabsTrigger>
              </TabsList>

              {/* Workflow Tab */}
              <TabsContent value="workflow" className="mt-6">
                {isWorkflowEditable(report.status) ? (
                  <WorkflowInterface
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    dossier={report.dossierData as any}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    bouwplan={report.bouwplanData as any}
                    clientName={report.clientName}
                    rawText={
                      (report.dossierData as { rawText?: string })?.rawText || ""
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

          {/* Dossier Context & Report Preview - Hidden below XL (1280px) */}
          <div className="hidden xl:block">
            <DossierContextPanel
              reportId={reportId!}
              summary={report.dossierContextSummary || undefined}
              rawText={
                (report.dossierData as Record<string, unknown>)?.rawText as string || ""
              }
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
      </div>
    </div>
  );
}
