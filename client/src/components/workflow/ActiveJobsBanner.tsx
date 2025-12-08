/**
 * ActiveJobsBanner Component
 *
 * Shows a banner when there are active background jobs for the current report.
 * Displays progress and allows users to see job status even after page refresh.
 */

import { useState } from "react";
import { Loader2, ChevronDown, ChevronUp, CheckCircle, XCircle, Clock, StopCircle } from "lucide-react";
import { useActiveJobs, useJobPolling, useCancelJob, type Job, type JobProgress } from "@/hooks/useJobPolling";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ActiveJobsBannerProps {
  reportId: string;
  onJobComplete?: () => void;
}

export function ActiveJobsBanner({ reportId, onJobComplete }: ActiveJobsBannerProps) {
  const { hasActiveJobs, activeJobs, isLoading } = useActiveJobs(reportId);
  const [expanded, setExpanded] = useState(true);

  if (isLoading || !hasActiveJobs || activeJobs.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-blue-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <span className="font-medium text-blue-800">
            {activeJobs.length === 1
              ? "Er loopt een achtergrondverwerking..."
              : `Er lopen ${activeJobs.length} achtergondverwerkingen...`}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-blue-600" />
        ) : (
          <ChevronDown className="h-4 w-4 text-blue-600" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {activeJobs.map((job) => (
            <JobProgressCard key={job.id} job={job} onComplete={onJobComplete} reportId={reportId} />
          ))}
          <p className="text-xs text-blue-600">
            Je kunt deze pagina sluiten - de verwerking loopt door op de achtergrond.
          </p>
        </div>
      )}
    </div>
  );
}

interface JobProgressCardProps {
  job: Job;
  reportId: string;
  onComplete?: () => void;
}

function JobProgressCard({ job: initialJob, reportId, onComplete }: JobProgressCardProps) {
  const [isCancelling, setIsCancelling] = useState(false);
  const { cancelJob } = useCancelJob();

  // Poll for this specific job's progress
  const { job, progress, isPolling } = useJobPolling({
    jobId: initialJob.id,
    reportId,
    onComplete: () => {
      onComplete?.();
    },
  });

  const currentJob = job || initialJob;
  const currentProgress = progress || currentJob.progress;

  const jobTypeLabel = currentJob.type === "express_mode" ? "Express Mode" : "Stage Executie";
  const overallPercentage = currentProgress?.percentage || 0;

  const handleCancel = async () => {
    setIsCancelling(true);
    await cancelJob(currentJob.id, reportId);
    setIsCancelling(false);
  };

  const canCancel = currentJob.status === "queued" || currentJob.status === "processing";

  return (
    <div className="bg-white rounded-md border border-blue-100 p-3">
      {/* Job header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800">{jobTypeLabel}</span>
          <StatusBadge status={currentJob.status} />
        </div>
        <div className="flex items-center gap-2">
          {isPolling && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={isCancelling}
              className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              {isCancelling ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <StopCircle className="h-3 w-3 mr-1" />
              )}
              Stop
            </Button>
          )}
        </div>
      </div>

      {/* Overall progress bar */}
      <div className="mb-2">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full transition-all duration-300",
              currentJob.status === "failed" ? "bg-red-500" : "bg-blue-500"
            )}
            style={{ width: `${overallPercentage}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-gray-500">{currentProgress?.message || "Bezig..."}</span>
          <span className="text-xs text-gray-500">{overallPercentage}%</span>
        </div>
      </div>

      {/* Stage details for Express Mode */}
      {currentJob.type === "express_mode" && currentProgress?.stages && (
        <div className="space-y-1 mt-3">
          <p className="text-xs font-medium text-gray-600 mb-1">Stages:</p>
          <div className="flex flex-wrap gap-1">
            {currentProgress.stages.map((stage) => (
              <StageChip key={stage.stageId} stage={stage} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Job["status"] }) {
  const config = {
    queued: { label: "Wachtend", className: "bg-gray-100 text-gray-600", icon: Clock },
    processing: { label: "Bezig", className: "bg-blue-100 text-blue-700", icon: Loader2 },
    completed: { label: "Voltooid", className: "bg-green-100 text-green-700", icon: CheckCircle },
    failed: { label: "Mislukt", className: "bg-red-100 text-red-700", icon: XCircle },
  };

  const { label, className, icon: Icon } = config[status];

  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs", className)}>
      <Icon className={cn("h-3 w-3", status === "processing" && "animate-spin")} />
      {label}
    </span>
  );
}

function StageChip({ stage }: { stage: JobProgress["stages"][0] }) {
  const statusColors = {
    pending: "bg-gray-100 text-gray-500",
    processing: "bg-blue-100 text-blue-700 animate-pulse",
    completed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
  };

  // Shorten stage name for display
  const shortName = stage.stageId.replace("_", " ").replace(/Specialist|Analist/g, "");

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs",
        statusColors[stage.status]
      )}
    >
      {shortName}
      {stage.status === "completed" && stage.changesCount !== undefined && (
        <span className="ml-1 text-[10px] opacity-70">({stage.changesCount})</span>
      )}
    </span>
  );
}
