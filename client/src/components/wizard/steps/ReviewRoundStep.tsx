import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  Users,
  Eye,
  AlertCircle
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Reviewer {
  key: string;
  name: string;
  icon: string;
  description: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  output?: string;
  error?: string;
}

interface ReviewRoundStepProps {
  reviewers: Reviewer[];
  onExecuteAll: () => void;
  onExecuteReviewer: (reviewerKey: string) => void;
  allCompleted: boolean;
  hasStarted: boolean;
}

export function ReviewRoundStep({
  reviewers,
  onExecuteAll,
  onExecuteReviewer,
  allCompleted,
  hasStarted,
}: ReviewRoundStepProps) {
  const [expandedReviewer, setExpandedReviewer] = useState<string | null>(null);

  const completedCount = reviewers.filter(r => r.status === 'completed').length;
  const progress = (completedCount / reviewers.length) * 100;
  const isProcessing = reviewers.some(r => r.status === 'processing');

  const getStatusIcon = (status: Reviewer['status']) => {
    switch (status) {
      case 'pending':
        return <div className="w-6 h-6 rounded-full border-2 border-gray-300" />;
      case 'processing':
        return <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="h-6 w-6 text-green-500" />;
      case 'error':
        return <XCircle className="h-6 w-6 text-red-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <div className={cn(
            "p-4 rounded-full transition-colors",
            isProcessing && "bg-blue-100 animate-pulse",
            allCompleted && "bg-green-100",
            !hasStarted && "bg-gray-100"
          )}>
            <Users className="h-8 w-8" />
          </div>
        </div>
        <h3 className="text-2xl font-bold mb-2">Review Ronde</h3>
        <p className="text-muted-foreground">
          7 gespecialiseerde AI reviewers controleren het concept rapport
        </p>
      </div>

      {/* Overall Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Totale Voortgang</span>
          <span className="text-muted-foreground">
            {completedCount} van {reviewers.length} voltooid
          </span>
        </div>
        <Progress value={progress} className="h-3" />
      </div>

      {/* Status Alert */}
      {!hasStarted && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Klik op "Start Alle Reviews" om alle reviewers parallel te laten werken
          </AlertDescription>
        </Alert>
      )}

      {isProcessing && (
        <Alert className="bg-blue-50 border-blue-200">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <AlertDescription className="text-blue-800">
            Reviews worden verwerkt... Dit kan enkele minuten duren.
          </AlertDescription>
        </Alert>
      )}

      {allCompleted && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Alle reviews zijn voltooid! Klik op "Volgende" om de feedback te verwerken.
          </AlertDescription>
        </Alert>
      )}

      {/* Start Button */}
      {!hasStarted && (
        <div className="flex justify-center">
          <Button onClick={onExecuteAll} size="lg" className="min-w-[250px]">
            <Play className="mr-2 h-5 w-5" />
            Start Alle Reviews
          </Button>
        </div>
      )}

      {/* Reviewers List */}
      <div className="space-y-3">
        <h4 className="font-semibold text-sm text-muted-foreground">REVIEWERS</h4>
        {reviewers.map((reviewer) => (
          <div
            key={reviewer.key}
            className={cn(
              "border rounded-lg p-4 transition-all",
              reviewer.status === 'completed' && "bg-green-50 border-green-200",
              reviewer.status === 'processing' && "bg-blue-50 border-blue-200",
              reviewer.status === 'error' && "bg-red-50 border-red-200",
              expandedReviewer === reviewer.key && "ring-2 ring-primary"
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1">
                {getStatusIcon(reviewer.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h5 className="font-semibold">{reviewer.icon} {reviewer.name}</h5>
                    {reviewer.status === 'completed' && (
                      <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
                        ✓ Voltooid
                      </Badge>
                    )}
                    {reviewer.status === 'processing' && (
                      <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
                        Bezig...
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{reviewer.description}</p>

                  {reviewer.error && (
                    <div className="mt-2 text-sm text-red-600">
                      ⚠️ {reviewer.error}
                    </div>
                  )}
                </div>
              </div>

              {reviewer.output && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpandedReviewer(
                    expandedReviewer === reviewer.key ? null : reviewer.key
                  )}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Expanded Output */}
            {expandedReviewer === reviewer.key && reviewer.output && (
              <div className="mt-4 pt-4 border-t">
                <ScrollArea className="h-[300px] w-full rounded-md border bg-white p-4">
                  <div className="prose prose-sm max-w-none">
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                      {reviewer.output}
                    </pre>
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Retry for errors */}
            {reviewer.status === 'error' && (
              <div className="mt-3">
                <Button
                  onClick={() => onExecuteReviewer(reviewer.key)}
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-300 hover:bg-red-50"
                >
                  Opnieuw Proberen
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
