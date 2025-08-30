import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  CheckCircle, 
  Clock, 
  AlertCircle, 
  Loader2, 
  FileText,
  ExternalLink 
} from "lucide-react";
import type { Job } from "@shared/schema";

interface JobStatusProps {
  jobId: string;
  onComplete?: (job: Job) => void;
  showReportLink?: boolean;
}

export function JobStatus({ jobId, onComplete, showReportLink = true }: JobStatusProps) {
  const [isPolling, setIsPolling] = useState(true);

  const { data: job, refetch } = useQuery<Job>({
    queryKey: ["/api/jobs", jobId],
    refetchInterval: isPolling ? 3000 : false, // Poll every 3 seconds when active
    enabled: !!jobId,
  });

  // Stop polling when job is complete or failed
  useEffect(() => {
    if (job && (job.status === "completed" || job.status === "failed")) {
      setIsPolling(false);
      if (job.status === "completed" && onComplete) {
        onComplete(job);
      }
    }
  }, [job, onComplete]);

  if (!job) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center space-x-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Job wordt geladen...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const progress = job.progress ? JSON.parse(job.progress) : null;
  const progressPercentage = progress ? (progress.stageNumber / progress.totalStages) * 100 : 0;

  const getStatusIcon = () => {
    switch (job.status) {
      case "queued":
        return <Clock className="h-5 w-5 text-yellow-500" />;
      case "processing":
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      case "completed":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "failed":
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Clock className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusBadge = () => {
    switch (job.status) {
      case "queued":
        return <Badge variant="secondary">In Wachtrij</Badge>;
      case "processing":
        return <Badge variant="default">Bezig</Badge>;
      case "completed":
        return <Badge variant="default" className="bg-green-500">Voltooid</Badge>;
      case "failed":
        return <Badge variant="destructive">Mislukt</Badge>;
      default:
        return <Badge variant="secondary">Onbekend</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {getStatusIcon()}
            <div>
              <CardTitle className="text-lg">Rapport Generatie</CardTitle>
              <p className="text-sm text-muted-foreground">
                Job ID: {job.id.slice(0, 8)}...
              </p>
            </div>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Progress Bar */}
        {job.status === "processing" && progress && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Voortgang</span>
              <span>{progress.stageNumber}/{progress.totalStages} stappen</span>
            </div>
            <Progress value={progressPercentage} className="w-full" />
          </div>
        )}

        {/* Current Stage Info */}
        {progress && (
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm font-medium">{progress.currentStage}</p>
            <p className="text-xs text-muted-foreground mt-1">{progress.message}</p>
          </div>
        )}

        {/* Error Message */}
        {job.status === "failed" && job.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-800 font-medium">Fout opgetreden:</p>
            <p className="text-xs text-red-600 mt-1">{job.error}</p>
          </div>
        )}

        {/* Success Message & Report Link */}
        {job.status === "completed" && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-3">
            <div>
              <p className="text-sm text-green-800 font-medium">Rapport succesvol gegenereerd!</p>
              <p className="text-xs text-green-600 mt-1">
                Het fiscaal duidingsrapport is klaar en kan worden bekeken.
              </p>
            </div>
            
            {showReportLink && job.reportId && (
              <div className="flex space-x-2">
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => window.open(`/cases/${job.reportId}`, '_blank')}
                  data-testid="button-view-report"
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Bekijk Rapport
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => window.location.href = `/cases/${job.reportId}`}
                  data-testid="button-goto-report"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open in Cases
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Timestamps */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>Aangemaakt: {job.createdAt ? new Date(job.createdAt).toLocaleString('nl-NL') : 'Onbekend'}</p>
          {job.startedAt && (
            <p>Gestart: {new Date(job.startedAt).toLocaleString('nl-NL')}</p>
          )}
          {job.completedAt && (
            <p>Voltooid: {new Date(job.completedAt).toLocaleString('nl-NL')}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}