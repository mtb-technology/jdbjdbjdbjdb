/**
 * ReportAdjustmentDialog Component
 *
 * Modal dialog for the "Rapport Aanpassen" feature.
 * Handles the full flow: input → processing → preview (diff) → accept/reject
 */

import { memo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Pencil, AlertCircle } from "lucide-react";
import { useReportAdjustment } from "@/hooks/useReportAdjustment";
import { AdjustmentDiffPreview } from "./AdjustmentDiffPreview";

interface ReportAdjustmentDialogProps {
  reportId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ReportAdjustmentDialog = memo(function ReportAdjustmentDialog({
  reportId,
  isOpen,
  onOpenChange,
}: ReportAdjustmentDialogProps) {
  const {
    stage,
    instruction,
    proposal,
    error,
    isProcessing,
    isAccepting,
    setInstruction,
    generateProposal,
    acceptProposal,
    rejectProposal,
    closeDialog,
  } = useReportAdjustment(reportId);

  // Sync external open state with hook
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      closeDialog();
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className={`${
          stage === "preview"
            ? "max-w-5xl h-[85vh]"
            : "max-w-xl"
        } flex flex-col`}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            Rapport Aanpassen
          </DialogTitle>
          <DialogDescription>
            {stage === "input" &&
              "Geef een instructie voor de aanpassing die je wilt doorvoeren."}
            {stage === "processing" &&
              "De AI verwerkt je instructie..."}
            {stage === "preview" &&
              "Bekijk de voorgestelde wijzigingen en accepteer of wijs af."}
          </DialogDescription>
        </DialogHeader>

        {/* Error display */}
        {error && (
          <Alert variant="destructive" className="mx-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Stage: Input */}
        {stage === "input" && (
          <div className="flex flex-col gap-4 p-4 pt-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Wat wil je aanpassen?
              </label>
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Bijv: Voeg een paragraaf toe over de fiscale implicaties van de bedrijfsoverdracht. Of: Verwijder de sectie over box 3 vermogen."
                className="min-h-[150px] resize-none"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Minimaal 10 karakters. Wees zo specifiek mogelijk.
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Annuleren
              </Button>
              <Button
                onClick={generateProposal}
                disabled={instruction.length < 10 || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verwerken...
                  </>
                ) : (
                  "Aanpassing Genereren"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Stage: Processing */}
        {stage === "processing" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              De AI past het rapport aan op basis van je instructie...
            </p>
            <p className="text-xs text-muted-foreground">
              Dit kan enkele seconden duren.
            </p>
          </div>
        )}

        {/* Stage: Preview (Diff) */}
        {stage === "preview" && proposal && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <AdjustmentDiffPreview
              previousContent={proposal.previousContent}
              proposedContent={proposal.proposedContent}
              instruction={proposal.instruction}
              onAccept={async () => {
                await acceptProposal();
                handleOpenChange(false);
              }}
              onReject={rejectProposal}
              isAccepting={isAccepting}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});
