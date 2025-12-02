/**
 * FeedbackTextMode Component
 *
 * Text mode view for feedback processing.
 */

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy } from "lucide-react";

interface FeedbackTextModeProps {
  rawFeedback: string;
  stageName: string;
  userInstructions: string;
  onUserInstructionsChange: (value: string) => void;
  isDisabled: boolean;
  onCopyFeedback: () => void;
}

export const FeedbackTextMode = memo(function FeedbackTextMode({
  rawFeedback,
  stageName,
  userInstructions,
  onUserInstructionsChange,
  isDisabled,
  onCopyFeedback,
}: FeedbackTextModeProps) {
  return (
    <div className="space-y-6">
      {/* Original Raw Feedback */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <Label className="text-sm font-medium">
            Originele Feedback van {stageName}
          </Label>
          <Button
            variant="outline"
            size="sm"
            onClick={onCopyFeedback}
            data-testid="button-copy-feedback"
          >
            <Copy className="h-4 w-4 mr-1" />
            Kopieer
          </Button>
        </div>

        <ScrollArea className="h-48 w-full border rounded-md p-3 bg-gray-50 dark:bg-gray-800">
          <pre
            className="text-sm whitespace-pre-wrap break-all font-mono"
            style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}
            data-testid="text-raw-feedback"
          >
            {rawFeedback}
          </pre>
        </ScrollArea>
      </div>

      {/* Text Instructions Input */}
      <div>
        <Label htmlFor="userInstructions" className="text-sm font-medium">
          Jouw Instructies
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          Geef aan wat je wel en niet wilt verwerken. Bijvoorbeeld: "Verwerk
          alleen de bronverwijzingen, negeer stijlwijzigingen"
        </p>

        <Textarea
          id="userInstructions"
          placeholder="Verwerk alleen de punten over bronnen, negeer de stijlwijzigingen..."
          value={userInstructions}
          onChange={(e) => onUserInstructionsChange(e.target.value)}
          disabled={isDisabled}
          rows={4}
          className="resize-none"
          data-testid="input-user-instructions"
        />

        <div className="flex justify-between items-center mt-2">
          <p className="text-xs text-muted-foreground">
            {userInstructions.length}/50000 karakters
          </p>
          {userInstructions.length > 50000 && (
            <p className="text-xs text-red-500">Te veel karakters</p>
          )}
        </div>
      </div>
    </div>
  );
});
