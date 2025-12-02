/**
 * PromptPreviewModal Component
 *
 * Modal for viewing the full prompt preview.
 */

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { PromptPreviewResponse } from "@/types/feedbackProcessor.types";

interface PromptPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stageName: string;
  promptData: PromptPreviewResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}

export const PromptPreviewModal = memo(function PromptPreviewModal({
  open,
  onOpenChange,
  stageName,
  promptData,
  isLoading,
  isError,
}: PromptPreviewModalProps) {
  const { toast } = useToast();

  const handleCopy = () => {
    if (promptData?.fullPrompt) {
      navigator.clipboard.writeText(promptData.fullPrompt);
      toast({
        title: "Gekopieerd!",
        description: "Prompt gekopieerd naar klembord",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Prompt Preview - {stageName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-700 dark:text-red-300">
                ❌ Fout bij het laden van de prompt preview
              </p>
            </div>
          )}

          {promptData && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">
                  Volledige Prompt (
                  {promptData.promptLength.toLocaleString()} karakters)
                </Label>
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  <Copy className="h-4 w-4 mr-1" />
                  Kopieer
                </Button>
              </div>

              <ScrollArea className="h-96 w-full border rounded-md p-4 bg-gray-50 dark:bg-gray-800">
                <pre
                  className="text-xs whitespace-pre-wrap break-all font-mono"
                  style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}
                >
                  {promptData.fullPrompt}
                </pre>
              </ScrollArea>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Laden van prompt preview...</span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});
