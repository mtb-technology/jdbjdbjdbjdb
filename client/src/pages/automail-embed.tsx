/**
 * Automail Embedded Case View
 *
 * Compact view designed to be embedded in Automail next to a conversation.
 * Shows case status, workflow progress, and quick action buttons.
 *
 * Routes:
 * - /embed/automail/:conversationId - Find case by Automail conversation ID
 * - /embed/case/:reportId - Direct case view by report ID
 */

import { useParams, useSearch } from "wouter";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

// UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ExternalLink,
  Play,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  ChevronRight,
  Loader2,
} from "lucide-react";

// Types
import { STAGE_NAMES } from "@shared/constants";

// Minimal interface for embedded view
interface EmbedReport {
  id: string;
  dossierNumber: number;
  clientName: string;
  status: string;
  currentStage: string | null;
  dossierData: Record<string, unknown> | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
}

// Stage order for progress calculation
const STAGE_ORDER = [
  "1a_informatiecheck",
  "1b_informatiecheck_email",
  "2_complexiteitscheck",
  "3_generatie",
  "4a_BronnenSpecialist",
  "4b_FiscaalTechnischSpecialist",
  "4c_ScenarioGatenAnalist",
  "4e_DeAdvocaat",
  "4f_HoofdCommunicatie",
  "6_change_summary",
];

function getStageProgress(currentStage: string | null): number {
  if (!currentStage) return 0;
  const index = STAGE_ORDER.indexOf(currentStage);
  if (index === -1) return 0;
  return Math.round(((index + 1) / STAGE_ORDER.length) * 100);
}

function getStatusBadge(status: string): ReactNode {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Voltooid
        </Badge>
      );
    case "processing":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          In behandeling
        </Badge>
      );
    case "draft":
      return (
        <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100">
          <Clock className="w-3 h-3 mr-1" />
          Concept
        </Badge>
      );
    case "error":
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100">
          <AlertCircle className="w-3 h-3 mr-1" />
          Fout
        </Badge>
      );
    default:
      return (
        <Badge variant="outline">
          {status}
        </Badge>
      );
  }
}

interface EmbedCaseViewProps {
  report: EmbedReport;
  onOpenFull?: () => void;
}

function EmbedCaseView({ report, onOpenFull }: EmbedCaseViewProps) {
  const [isStarting, setIsStarting] = useState(false);

  const currentStage = report.currentStage;
  const progress = getStageProgress(currentStage);
  const currentStageName = currentStage
    ? STAGE_NAMES[currentStage as keyof typeof STAGE_NAMES] || currentStage
    : "Niet gestart";

  const handleOpenInPortal = () => {
    // Open in new tab/window
    window.open(`/cases/${report.id}`, "_blank");
  };

  const handleStartWorkflow = async () => {
    setIsStarting(true);
    try {
      // Open the case with autoStart parameter
      window.open(`/cases/${report.id}?autoStart=true`, "_blank");
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="p-3 space-y-3 bg-background min-h-screen">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-sm truncate" title={report.clientName}>
            {report.clientName}
          </h2>
          <p className="text-xs text-muted-foreground">
            Dossier #{report.dossierNumber}
          </p>
        </div>
        {getStatusBadge(report.status as string)}
      </div>

      {/* Progress */}
      <Card className="border-0 shadow-none bg-muted/30">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Voortgang</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="w-3 h-3" />
            <span className="truncate">{currentStageName}</span>
          </div>
        </CardContent>
      </Card>

      {/* Quick Info */}
      {report.dossierData && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {(report.dossierData as any).automail?.subject && (
            <div className="col-span-2 p-2 bg-muted/30 rounded">
              <span className="text-muted-foreground">Onderwerp: </span>
              <span className="font-medium truncate">
                {(report.dossierData as any).automail.subject}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="space-y-2 pt-1">
        <Button
          size="sm"
          className="w-full justify-between"
          onClick={handleOpenInPortal}
        >
          <span className="flex items-center gap-2">
            <ExternalLink className="w-3.5 h-3.5" />
            Open in Portal
          </span>
          <ChevronRight className="w-4 h-4" />
        </Button>

        {report.status === "draft" && (
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-between"
            onClick={handleStartWorkflow}
            disabled={isStarting}
          >
            <span className="flex items-center gap-2">
              {isStarting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Start Workflow
            </span>
            <ChevronRight className="w-4 h-4" />
          </Button>
        )}

        {report.status === "processing" && (
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-between"
            onClick={() => window.location.reload()}
          >
            <span className="flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5" />
              Vernieuwen
            </span>
          </Button>
        )}
      </div>

      {/* Timestamps */}
      <div className="text-[10px] text-muted-foreground pt-2 border-t space-y-0.5">
        <div>Aangemaakt: {report.createdAt ? new Date(report.createdAt).toLocaleString("nl-NL") : "-"}</div>
        {report.updatedAt && (
          <div>Bijgewerkt: {new Date(report.updatedAt).toLocaleString("nl-NL")}</div>
        )}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-5 w-20" />
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

function NoCaseFound({ conversationId }: { conversationId?: string }) {
  return (
    <div className="p-4 text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-full bg-muted flex items-center justify-center">
        <FileText className="w-6 h-6 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">Geen dossier gevonden</p>
        <p className="text-xs text-muted-foreground mt-1">
          {conversationId
            ? `Conversatie #${conversationId} heeft nog geen gekoppeld dossier.`
            : "Dit dossier bestaat niet."}
        </p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="p-4 text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-red-600 dark:text-red-400">Fout</p>
        <p className="text-xs text-muted-foreground mt-1">{message}</p>
      </div>
    </div>
  );
}

function UnauthorizedState() {
  return (
    <div className="p-4 text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">Geen toegang</p>
        <p className="text-xs text-muted-foreground mt-1">
          Ongeldige of ontbrekende toegangstoken.
        </p>
      </div>
    </div>
  );
}

/**
 * Hook to get token from URL query parameters
 */
function useEmbedToken(): string | null {
  const search = useSearch();
  const params = new URLSearchParams(search);
  return params.get("token");
}

/**
 * Embedded view by Automail conversation ID
 * Finds the case associated with a conversation and displays it
 */
export function AutomailEmbedByConversation() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = params.conversationId;
  const token = useEmbedToken();

  const { data, isLoading, error } = useQuery<{ cases: EmbedReport[]; count: number }>({
    queryKey: ["automail-conversation-cases", conversationId, token],
    queryFn: async () => {
      const url = new URL(`/api/automail/conversations/${conversationId}/cases`, window.location.origin);
      if (token) {
        url.searchParams.set("token", token);
      }
      const response = await fetch(url.toString());
      if (response.status === 401) {
        throw new Error("UNAUTHORIZED");
      }
      if (!response.ok) throw new Error("Failed to fetch cases");
      const result = await response.json();
      return result.success ? result.data : result;
    },
    enabled: !!conversationId,
    retry: (failureCount, error) => {
      // Don't retry on unauthorized errors
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        return false;
      }
      return failureCount < 3;
    },
  });

  if (isLoading) return <LoadingSkeleton />;
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return <UnauthorizedState />;
  }
  if (error) return <ErrorState message="Kon dossiers niet laden" />;
  if (!data || data.cases.length === 0) {
    return <NoCaseFound conversationId={conversationId} />;
  }

  // Show the most recent case (first one, already sorted by createdAt desc)
  const report = data.cases[0];

  return <EmbedCaseView report={report} />;
}

/**
 * Embedded view by report ID
 * Direct case view for when we already know the report ID
 */
export function AutomailEmbedByReportId() {
  const params = useParams<{ reportId: string }>();
  const reportId = params.reportId;
  const token = useEmbedToken();

  const { data: report, isLoading, error } = useQuery<EmbedReport>({
    queryKey: ["report", reportId, token],
    queryFn: async () => {
      const url = new URL(`/api/reports/${reportId}`, window.location.origin);
      if (token) {
        url.searchParams.set("token", token);
      }
      const response = await fetch(url.toString());
      if (response.status === 401) {
        throw new Error("UNAUTHORIZED");
      }
      if (!response.ok) throw new Error("Failed to fetch report");
      const result = await response.json();
      return result.success ? result.data : result;
    },
    enabled: !!reportId,
    retry: (failureCount, error) => {
      // Don't retry on unauthorized errors
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        return false;
      }
      return failureCount < 3;
    },
  });

  if (isLoading) return <LoadingSkeleton />;
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return <UnauthorizedState />;
  }
  if (error) return <ErrorState message="Kon dossier niet laden" />;
  if (!report) return <NoCaseFound />;

  return <EmbedCaseView report={report} />;
}

/**
 * Default export - determines which view to show based on URL
 */
export default function AutomailEmbed() {
  const params = useParams();

  // Check which route pattern matched
  if ("conversationId" in params) {
    return <AutomailEmbedByConversation />;
  }
  if ("reportId" in params) {
    return <AutomailEmbedByReportId />;
  }

  return <NoCaseFound />;
}
