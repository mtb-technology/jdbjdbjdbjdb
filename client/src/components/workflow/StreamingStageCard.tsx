import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StreamingWorkflow } from "../streaming/StreamingWorkflow";
import { Zap, Settings } from "lucide-react";

interface StreamingStageCardProps {
  reportId: string;
  stageId: string;
  stageName: string;
  stageDescription: string;
  isAvailable: boolean;
  hasStreamingSupport?: boolean;
  onComplete?: (result: any) => void;
  onError?: (error: string) => void;
}

export function StreamingStageCard({
  reportId,
  stageId,
  stageName,
  stageDescription,
  isAvailable,
  hasStreamingSupport = false,
  onComplete,
  onError
}: StreamingStageCardProps) {
  const [showStreamingMode, setShowStreamingMode] = useState(false);

  return (
    <Card 
      className={`${isAvailable ? 'border-blue-200' : 'border-gray-200 opacity-50'}`}
      data-testid={`stage-card-${stageId}`}
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>{stageName}</span>
            {hasStreamingSupport && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                Streaming
              </Badge>
            )}
          </div>
          {hasStreamingSupport && isAvailable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowStreamingMode(!showStreamingMode)}
              data-testid={`button-toggle-streaming-${stageId}`}
            >
              <Settings className="w-4 h-4" />
              {showStreamingMode ? 'Regular' : 'Streaming'}
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">{stageDescription}</p>
        
        {/* Show streaming workflow if enabled and has support */}
        {showStreamingMode && hasStreamingSupport && isAvailable ? (
          <StreamingWorkflow
            reportId={reportId}
            stageId={stageId}
            stageName={stageName}
            onComplete={onComplete}
            onError={onError}
          />
        ) : (
          /* Regular stage execution UI would go here */
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {hasStreamingSupport 
                ? 'Regular execution mode. Toggle to streaming mode for real-time progress updates.'
                : 'This stage uses regular execution mode.'
              }
            </p>
            {isAvailable && (
              <Button 
                data-testid={`button-execute-${stageId}`}
                disabled={!isAvailable}
              >
                Execute Stage
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}