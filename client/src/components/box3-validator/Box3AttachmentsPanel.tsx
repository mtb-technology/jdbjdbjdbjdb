/**
 * Box3AttachmentsPanel Component
 *
 * Displays attachments for Box3 validator sessions with expandable content preview.
 * Now includes AI analysis per file showing document type, summary, and extracted values.
 */

import { memo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  FileText,
  FileImage,
  Download,
  ChevronDown,
  ChevronRight,
  Eye,
  Sparkles,
  Info,
} from "lucide-react";

// Type for Box3 attachment (matches server storage structure)
interface Box3Attachment {
  filename: string;
  mimeType: string;
  fileSize: number;
  fileData: string; // base64 encoded
}

// Type for AI analysis per file
interface BijlageAnalyse {
  bestandsnaam: string;
  document_type: string;
  belastingjaar?: number | string | null;
  samenvatting: string;
  geextraheerde_waarden?: Record<string, string | number | boolean | null>;
  relevantie?: string;
}

interface Box3AttachmentsPanelProps {
  attachments: Box3Attachment[];
  bijlageAnalyse?: BijlageAnalyse[];
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get file icon based on mime type
 */
function getFileIcon(mimeType: string, filename: string) {
  const ext = filename.toLowerCase().split('.').pop();

  if (mimeType?.includes("pdf") || ext === 'pdf') {
    return <FileText className="h-6 w-6 text-red-500" />;
  }
  if (mimeType?.includes("image") || ['jpg', 'jpeg', 'png', 'gif'].includes(ext || '')) {
    return <FileImage className="h-6 w-6 text-blue-500" />;
  }
  return <FileText className="h-6 w-6 text-gray-500" />;
}

/**
 * Get badge for document type from AI analysis
 */
function getDocumentTypeBadge(documentType: string) {
  const typeColors: Record<string, string> = {
    "Aangifte Inkomstenbelasting": "bg-purple-50 text-purple-700 border-purple-200",
    "Bank Jaaropgave": "bg-green-50 text-green-700 border-green-200",
    "Beleggingsoverzicht": "bg-blue-50 text-blue-700 border-blue-200",
    "WOZ-beschikking": "bg-orange-50 text-orange-700 border-orange-200",
    "Hypotheekafschrift": "bg-pink-50 text-pink-700 border-pink-200",
  };

  const colorClass = typeColors[documentType] || "bg-gray-50 text-gray-700 border-gray-200";

  return (
    <Badge variant="outline" className={colorClass}>
      {documentType}
    </Badge>
  );
}

/**
 * Get badge for file type (fallback when no AI analysis)
 */
function getTypeBadge(mimeType: string, filename: string) {
  const ext = filename.toLowerCase().split('.').pop();

  if (mimeType?.includes("pdf") || ext === 'pdf') {
    return (
      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
        PDF
      </Badge>
    );
  }
  if (mimeType?.includes("image") || ['jpg', 'jpeg', 'png'].includes(ext || '')) {
    return (
      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
        Afbeelding
      </Badge>
    );
  }
  if (mimeType?.includes("text") || ext === 'txt') {
    return (
      <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
        Tekst
      </Badge>
    );
  }
  return null;
}

/**
 * Format extracted value for display
 */
function formatValue(key: string, value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Ja" : "Nee";
  if (typeof value === "number") {
    // Check if it looks like a currency value
    if (key.includes("bedrag") || key.includes("waarde") || key.includes("saldo") ||
        key.includes("rente") || key.includes("inkomen") || key.includes("bezittingen")) {
      return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(value);
    }
    return value.toLocaleString('nl-NL');
  }
  return String(value);
}

/**
 * Format key for display (convert snake_case to readable)
 */
function formatKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/box3/gi, 'Box 3')
    .replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Single attachment item with expandable preview and AI analysis
 */
interface AttachmentItemProps {
  attachment: Box3Attachment;
  analyse?: BijlageAnalyse;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}

const Box3AttachmentItem = memo(function Box3AttachmentItem({
  attachment,
  analyse,
  index,
  isExpanded,
  onToggle,
}: AttachmentItemProps) {
  const isImage = attachment.mimeType?.includes("image") ||
    ['jpg', 'jpeg', 'png', 'gif'].includes(attachment.filename.toLowerCase().split('.').pop() || '');
  const isPDF = attachment.mimeType?.includes("pdf") ||
    attachment.filename.toLowerCase().endsWith('.pdf');

  // Create data URL for preview
  const dataUrl = `data:${attachment.mimeType};base64,${attachment.fileData}`;

  // Handle download
  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = attachment.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [dataUrl, attachment.filename]);

  // Handle view in new tab (for PDFs)
  const handleView = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const blob = base64ToBlob(attachment.fileData, attachment.mimeType);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }, [attachment.fileData, attachment.mimeType]);

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
              {getFileIcon(attachment.mimeType, attachment.filename)}
              <div>
                <p className="font-medium text-sm">{attachment.filename}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatFileSize(attachment.fileSize)}</span>
                  {analyse && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1 text-primary">
                        <Sparkles className="h-3 w-3" />
                        AI geanalyseerd
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {analyse ? getDocumentTypeBadge(analyse.document_type) : getTypeBadge(attachment.mimeType, attachment.filename)}
              {isPDF && (
                <Button size="sm" variant="ghost" onClick={handleView} title="Bekijk PDF">
                  <Eye className="h-4 w-4" />
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={handleDownload} title="Download">
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t bg-muted/30 p-4 space-y-4">
            {/* AI Analysis Section */}
            {analyse && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <Sparkles className="h-4 w-4" />
                  AI Analyse
                </div>

                {/* Summary */}
                <p className="text-sm">{analyse.samenvatting}</p>

                {/* Extracted values */}
                {analyse.geextraheerde_waarden && Object.keys(analyse.geextraheerde_waarden).length > 0 && (
                  <div className="bg-background rounded-md p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Geëxtraheerde waarden:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(analyse.geextraheerde_waarden).map(([key, value]) => (
                        <div key={key} className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{formatKey(key)}:</span>
                          <span className="font-medium">{formatValue(key, value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Relevance */}
                {analyse.relevantie && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <span>{analyse.relevantie}</span>
                  </div>
                )}
              </div>
            )}

            {/* File Preview */}
            {isImage ? (
              <div className="flex flex-col items-center gap-2">
                <img
                  src={dataUrl}
                  alt={attachment.filename}
                  className="max-w-full max-h-96 rounded-lg border shadow-sm"
                />
              </div>
            ) : isPDF ? (
              <div className="space-y-3">
                {!analyse && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
                    <p className="text-amber-800 mb-2">
                      <strong>PDF Document</strong>
                    </p>
                    <p className="text-amber-700">
                      Dit PDF bestand wordt door de AI geanalyseerd. Klik op het oog-icoon om het document te bekijken.
                    </p>
                  </div>
                )}
                <Button onClick={handleView} variant="outline" className="w-full">
                  <Eye className="h-4 w-4 mr-2" />
                  Open PDF in nieuw tabblad
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Preview niet beschikbaar voor dit bestandstype.
                </p>
                <Button onClick={handleDownload} variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Download bestand
                </Button>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
});

/**
 * Convert base64 to Blob
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);

    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  return new Blob(byteArrays, { type: mimeType });
}

/**
 * Main attachments panel
 */
export const Box3AttachmentsPanel = memo(function Box3AttachmentsPanel({
  attachments,
  bijlageAnalyse,
}: Box3AttachmentsPanelProps) {
  const [expandedAttachments, setExpandedAttachments] = useState<Set<number>>(new Set());

  const toggleAttachment = useCallback((index: number) => {
    setExpandedAttachments((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Match attachments with their AI analysis by filename
  const getAnalyseForAttachment = useCallback((filename: string): BijlageAnalyse | undefined => {
    if (!bijlageAnalyse) return undefined;
    return bijlageAnalyse.find(a =>
      a.bestandsnaam.toLowerCase() === filename.toLowerCase()
    );
  }, [bijlageAnalyse]);

  if (!attachments || attachments.length === 0) {
    return null;
  }

  // Calculate summary stats
  const pdfCount = attachments.filter(a =>
    a.mimeType?.includes("pdf") || a.filename.toLowerCase().endsWith('.pdf')
  ).length;
  const imageCount = attachments.filter(a =>
    a.mimeType?.includes("image") || ['jpg', 'jpeg', 'png'].includes(a.filename.toLowerCase().split('.').pop() || '')
  ).length;
  const totalSize = attachments.reduce((sum, a) => sum + (a.fileSize || 0), 0);
  const analysedCount = bijlageAnalyse?.length || 0;

  return (
    <div className="space-y-3">
      {attachments.map((att, idx) => (
        <Box3AttachmentItem
          key={idx}
          attachment={att}
          analyse={getAnalyseForAttachment(att.filename)}
          index={idx}
          isExpanded={expandedAttachments.has(idx)}
          onToggle={() => toggleAttachment(idx)}
        />
      ))}

      {/* Summary footer */}
      <div className="pt-3 border-t">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Totaal: {attachments.length} bijlage(s)</span>
          <div className="flex items-center gap-4">
            {analysedCount > 0 && (
              <span className="flex items-center gap-1 text-primary">
                <Sparkles className="h-4 w-4" />
                {analysedCount} geanalyseerd
              </span>
            )}
            {pdfCount > 0 && (
              <span className="flex items-center gap-1">
                <FileText className="h-4 w-4 text-red-500" />
                {pdfCount} PDF
              </span>
            )}
            {imageCount > 0 && (
              <span className="flex items-center gap-1">
                <FileImage className="h-4 w-4 text-blue-500" />
                {imageCount} afbeelding(en)
              </span>
            )}
            <span>{formatFileSize(totalSize)}</span>
          </div>
        </div>
      </div>
    </div>
  );
});
