/**
 * AdjustmentDiffPreview Component
 *
 * Shows an inline diff between the previous and proposed content.
 * Provides Accept/Reject buttons for the user to finalize their decision.
 */

import { lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, X, Loader2 } from "lucide-react";

// Lazy load the diff viewer
const ReactDiffViewer = lazy(() =>
  import("react-diff-viewer-continued").then((module) => ({
    default: module.default,
  }))
);

interface AdjustmentDiffPreviewProps {
  previousContent: string;
  proposedContent: string;
  instruction: string;
  onAccept: () => void;
  onReject: () => void;
  isAccepting: boolean;
}

export function AdjustmentDiffPreview({
  previousContent,
  proposedContent,
  instruction,
  onAccept,
  onReject,
  isAccepting,
}: AdjustmentDiffPreviewProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Instruction reminder */}
      <div className="px-4 py-3 bg-blue-50 dark:bg-blue-950/30 border-b">
        <p className="text-sm text-blue-700 dark:text-blue-300">
          <span className="font-medium">Instructie:</span> {instruction}
        </p>
      </div>

      {/* Diff viewer */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-3 text-sm text-muted-foreground">
                  Diff laden...
                </span>
              </div>
            }
          >
            <ReactDiffViewer
              oldValue={previousContent}
              newValue={proposedContent}
              splitView={false}
              useDarkTheme={false}
              leftTitle="Huidige versie"
              rightTitle="Voorgestelde aanpassing"
              styles={{
                variables: {
                  light: {
                    diffViewerBackground: "#ffffff",
                    diffViewerColor: "#000000",
                    addedBackground: "#e6ffed",
                    addedColor: "#24292e",
                    removedBackground: "#ffeef0",
                    removedColor: "#24292e",
                    wordAddedBackground: "#acf2bd",
                    wordRemovedBackground: "#fdb8c0",
                    addedGutterBackground: "#cdffd8",
                    removedGutterBackground: "#ffdce0",
                    gutterBackground: "#f6f8fa",
                    gutterBackgroundDark: "#f0f0f0",
                    highlightBackground: "#fffbdd",
                    highlightGutterBackground: "#fff5b1",
                  },
                  dark: {
                    diffViewerBackground: "#1e1e1e",
                    diffViewerColor: "#e8e8e8",
                    addedBackground: "#044B53",
                    addedColor: "#e8e8e8",
                    removedBackground: "#632F34",
                    removedColor: "#e8e8e8",
                    wordAddedBackground: "#055d67",
                    wordRemovedBackground: "#7d383f",
                    addedGutterBackground: "#034148",
                    removedGutterBackground: "#632b30",
                    gutterBackground: "#2c2c2c",
                    gutterBackgroundDark: "#262626",
                    highlightBackground: "#4a4a4a",
                    highlightGutterBackground: "#3d3d3d",
                  },
                },
                contentText: {
                  fontSize: "13px",
                  lineHeight: "1.6",
                },
              }}
            />
          </Suspense>
        </div>
      </ScrollArea>

      {/* Action buttons */}
      <div className="flex items-center justify-between gap-4 p-4 border-t bg-gray-50 dark:bg-gray-900">
        <p className="text-sm text-muted-foreground">
          Controleer de wijzigingen en kies een actie
        </p>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onReject}
            disabled={isAccepting}
          >
            <X className="h-4 w-4 mr-2" />
            Afwijzen
          </Button>
          <Button
            onClick={onAccept}
            disabled={isAccepting}
            className="bg-green-600 hover:bg-green-700"
          >
            {isAccepting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Opslaan...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Accepteren
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
