/**
 * AttachmentsTab Component
 *
 * Displays and manages attachments for a case.
 * Extracted from case-detail.tsx lines 607-776.
 */

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Paperclip,
  FileText,
  FileImage,
  Download,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import type { AttachmentsTabProps, Attachment } from "@/types/caseDetail.types";

/**
 * Get file icon based on mime type
 */
function getFileIcon(mimeType: string | undefined) {
  if (mimeType?.includes("pdf")) {
    return <FileText className="h-8 w-8 text-red-500" />;
  }
  if (mimeType?.includes("image")) {
    return <FileImage className="h-8 w-8 text-blue-500" />;
  }
  return <FileText className="h-8 w-8 text-gray-500" />;
}

/**
 * Check if OCR is still pending
 * Uses needsVisionOCR flag AND checks if extractedText already exists.
 * If we have substantial extractedText (>100 chars), OCR is effectively done
 * even if the flag wasn't properly updated.
 * Exported for use in workflow blocking logic
 */
export function isOcrPending(attachment: Attachment): boolean {
  // If needsVisionOCR is false, definitely not pending
  if (attachment.needsVisionOCR !== true) {
    return false;
  }

  // needsVisionOCR is true - but check if we already have substantial text
  // This handles cases where OCR completed but flag wasn't updated (legacy data)
  const hasSubstantialText = attachment.extractedText &&
    attachment.extractedText.length > 100 &&
    !attachment.extractedText.startsWith('[OCR') && // Not an error message
    !attachment.extractedText.startsWith('[Afbeelding') && // Not a placeholder
    !attachment.extractedText.startsWith('[PDF'); // Not a placeholder

  if (hasSubstantialText) {
    // We have real text, OCR must have completed
    return false;
  }

  // needsVisionOCR is true and no substantial text - OCR is pending
  return true;
}

/**
 * Get status badge for attachment
 */
function getStatusBadge(attachment: Attachment) {
  const ocrPending = isOcrPending(attachment);

  // Check if OCR is still in progress
  if (ocrPending) {
    return (
      <Badge
        variant="outline"
        className="bg-blue-50 text-blue-700 border-blue-200"
      >
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        OCR bezig...
      </Badge>
    );
  }

  // OCR completed via Vision (needsVisionOCR was true but we have text now)
  if (attachment.needsVisionOCR && attachment.extractedText && attachment.extractedText.length > 100) {
    return (
      <Badge
        variant="outline"
        className="bg-amber-50 text-amber-700 border-amber-200"
      >
        <FileImage className="h-3 w-3 mr-1" />
        Vision OCR
      </Badge>
    );
  }

  // Regular text extraction succeeded
  if (attachment.extractedText && attachment.extractedText.length > 50) {
    return (
      <Badge
        variant="outline"
        className="bg-green-50 text-green-700 border-green-200"
      >
        <CheckCircle className="h-3 w-3 mr-1" />
        Tekst geëxtraheerd
      </Badge>
    );
  }

  // No usable text
  return (
    <Badge variant="outline" className="bg-gray-50 text-gray-500">
      <AlertCircle className="h-3 w-3 mr-1" />
      Geen tekst
    </Badge>
  );
}

/**
 * Clean extracted text by removing page markers
 */
function cleanExtractedText(text: string | undefined): string {
  if (!text) return "";
  return text.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "").trim();
}

/**
 * Single attachment item
 */
interface AttachmentItemProps {
  attachment: Attachment;
  isExpanded: boolean;
  onToggle: () => void;
}

const AttachmentItem = memo(function AttachmentItem({
  attachment,
  isExpanded,
  onToggle,
}: AttachmentItemProps) {
  const cleanedText = cleanExtractedText(attachment.extractedText);

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div className="border rounded-lg overflow-hidden">
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between p-3 hover:bg-accent/50 transition-colors cursor-pointer">
            <div className="flex items-center gap-3">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              {getFileIcon(attachment.mimeType)}
              <div>
                <p className="font-medium text-sm">{attachment.filename}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {attachment.pageCount
                      ? `${attachment.pageCount} pagina's`
                      : "Bestand"}
                  </span>
                  <span>•</span>
                  <span>
                    {Math.round(parseInt(attachment.fileSize, 10) / 1024)} KB
                  </span>
                  {attachment.extractedText && (
                    <>
                      <span>•</span>
                      <span>
                        {attachment.extractedText.length.toLocaleString()} tekens
                      </span>
                    </>
                  )}
                  {attachment.usedInStages &&
                    attachment.usedInStages.length > 0 && (
                      <>
                        <span>•</span>
                        <span>
                          Gebruikt in: {attachment.usedInStages.join(", ")}
                        </span>
                      </>
                    )}
                </div>
              </div>
            </div>
            <div
              className="flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              {getStatusBadge(attachment)}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  window.open(
                    `/api/upload/attachment/${attachment.id}/download`,
                    "_blank"
                  )
                }
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t bg-muted/30 p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">
                {attachment.needsVisionOCR
                  ? "Gescande PDF - wordt door Gemini Vision gelezen"
                  : "Geëxtraheerde tekst"}
              </h4>
              {attachment.extractedText && (
                <span className="text-xs text-muted-foreground">
                  {attachment.extractedText.length.toLocaleString()} tekens
                </span>
              )}
            </div>
            {attachment.needsVisionOCR ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
                <p className="text-amber-800 mb-2">
                  <strong>Dit is een gescande PDF</strong> met weinig of geen
                  extracteerbare tekst.
                </p>
                <p className="text-amber-700">
                  Bij Stage 1 (Informatiecheck) wordt dit bestand direct naar
                  Gemini Vision gestuurd voor OCR-verwerking. De AI kan de inhoud
                  dan visueel lezen.
                </p>
                {cleanedText && cleanedText.length > 10 && (
                  <div className="mt-3 pt-3 border-t border-amber-200">
                    <p className="text-xs text-amber-600 mb-1">
                      Beschikbare tekst (beperkt):
                    </p>
                    <pre className="text-xs bg-white/50 p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap font-mono">
                      {cleanedText}
                    </pre>
                  </div>
                )}
              </div>
            ) : attachment.extractedText ? (
              <pre className="text-xs bg-background border rounded-lg p-3 overflow-auto max-h-96 whitespace-pre-wrap font-mono">
                {attachment.extractedText}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Geen tekst beschikbaar voor dit bestand.
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
});

/**
 * Summary footer for attachments
 */
interface AttachmentsSummaryProps {
  attachments: Attachment[];
}

const AttachmentsSummary = memo(function AttachmentsSummary({
  attachments,
}: AttachmentsSummaryProps) {
  const ocrPendingCount = attachments.filter((a) => isOcrPending(a)).length;
  // Vision completed = needsVisionOCR was true but we have substantial text now
  const visionCompletedCount = attachments.filter(
    (a) => a.needsVisionOCR && !isOcrPending(a) && a.extractedText && a.extractedText.length > 100
  ).length;
  // Regular text = has text and was not a vision OCR case
  const textCount = attachments.filter(
    (a) => a.extractedText && a.extractedText.length > 50 && !a.needsVisionOCR
  ).length;

  return (
    <div className="mt-4 pt-4 border-t">
      {ocrPendingCount > 0 && (
        <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-2 text-blue-700">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="font-medium">
              {ocrPendingCount} document(en) worden nog verwerkt (OCR)
            </span>
          </div>
          <p className="text-sm text-blue-600 mt-1">
            Wacht tot OCR klaar is voordat je de analyse start. Status wordt automatisch bijgewerkt.
          </p>
        </div>
      )}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Totaal: {attachments.length} bijlage(s)</span>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <CheckCircle className="h-4 w-4 text-green-500" />
            {textCount} tekst
          </span>
          {ocrPendingCount > 0 && (
            <span className="flex items-center gap-1">
              <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
              {ocrPendingCount} bezig
            </span>
          )}
          {visionCompletedCount > 0 && (
            <span className="flex items-center gap-1">
              <FileImage className="h-4 w-4 text-amber-500" />
              {visionCompletedCount} vision
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

/**
 * Empty state for no attachments
 */
const EmptyAttachments = memo(function EmptyAttachments() {
  return (
    <div className="py-8 text-center text-muted-foreground">
      <Paperclip className="h-12 w-12 mx-auto mb-4 opacity-50" />
      <p>Geen bijlages geüpload voor deze case.</p>
      <p className="text-sm mt-2">Upload bijlages via de Pipeline pagina.</p>
    </div>
  );
});

export const AttachmentsTab = memo(function AttachmentsTab({
  attachments,
  expandedAttachments,
  onToggleExpand,
}: AttachmentsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="h-5 w-5" />
          Bijlages bij deze case
        </CardTitle>
      </CardHeader>
      <CardContent>
        {attachments && attachments.length > 0 ? (
          <div className="space-y-3">
            {attachments.map((att) => (
              <AttachmentItem
                key={att.id}
                attachment={att}
                isExpanded={expandedAttachments.has(att.id)}
                onToggle={() => onToggleExpand(att.id)}
              />
            ))}
            <AttachmentsSummary attachments={attachments} />
          </div>
        ) : (
          <EmptyAttachments />
        )}
      </CardContent>
    </Card>
  );
});
