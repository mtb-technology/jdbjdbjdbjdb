/**
 * AIStatusIndicator Component
 *
 * Displays the current status of AI services (OpenAI, Google AI).
 */

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, AlertCircle } from "lucide-react";
import type { AIServiceStatus } from "@/types/feedbackProcessor.types";

interface AIStatusIndicatorProps {
  aiStatus: AIServiceStatus | undefined;
  onShowDetails: (message: string) => void;
}

export const AIStatusIndicator = memo(function AIStatusIndicator({
  aiStatus,
  onShowDetails,
}: AIStatusIndicatorProps) {
  if (!aiStatus) return null;

  const { openai, google } = aiStatus;
  const hasIssues = !openai.available || !google.available;

  const getStatusMessage = () => {
    if (!openai.available && !google.available) {
      return "Beide AI services zijn momenteel niet beschikbaar. Probeer het later opnieuw.";
    }
    if (!openai.available) {
      return "OpenAI is tijdelijk niet beschikbaar. Het systeem zal automatisch terugvallen op Google AI.";
    }
    return "Google AI is tijdelijk niet beschikbaar. Het systeem zal automatisch terugvallen op OpenAI.";
  };

  const getButtonLabel = () => {
    if (!openai.available && !google.available) {
      return "AI services offline";
    }
    if (!openai.available) {
      return "OpenAI offline";
    }
    return "Google AI offline";
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      {hasIssues ? (
        <AlertTriangle className="w-4 h-4 text-yellow-500" />
      ) : (
        <CheckCircle className="w-4 h-4 text-green-500" />
      )}
      <div className="flex gap-2">
        <Badge
          variant={openai.available ? "outline" : "destructive"}
          className="text-xs"
        >
          OpenAI {openai.available ? "✓" : "✗"}
        </Badge>
        <Badge
          variant={google.available ? "outline" : "destructive"}
          className="text-xs"
        >
          Google AI {google.available ? "✓" : "✗"}
        </Badge>
      </div>
      {hasIssues && (
        <Button
          variant="ghost"
          size="sm"
          className="text-yellow-600 dark:text-yellow-400 h-6 px-2"
          onClick={() => onShowDetails(getStatusMessage())}
        >
          <AlertCircle className="w-4 h-4 mr-1" />
          {getButtonLabel()}
        </Button>
      )}
    </div>
  );
});
