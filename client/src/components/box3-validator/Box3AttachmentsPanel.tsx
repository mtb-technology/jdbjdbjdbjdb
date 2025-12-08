/**
 * Box3AttachmentsPanel Component
 *
 * Displays attachments for Box3 validator sessions with expandable content preview.
 * Now includes AI analysis per file showing document type, summary, and extracted values.
 */

import { memo, useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
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
  ZoomIn,
  ZoomOut,
  RotateCw,
  X,
  Maximize2,
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
  // Optional year filter to match only analysis entries for this year
  yearFilter?: string;
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
 * Get badge for belastingjaar from AI analysis
 */
function getBelastingjaarBadge(jaar: number | string | null | undefined) {
  if (!jaar) return null;

  return (
    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
      {jaar}
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
 * Image zoom modal component
 */
interface ImageZoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  filename: string;
}

const ImageZoomModal = memo(function ImageZoomModal({
  isOpen,
  onClose,
  imageUrl,
  filename,
}: ImageZoomModalProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Reset state when modal opens
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      onClose();
      // Reset after close animation
      setTimeout(() => {
        setZoom(1);
        setRotation(0);
        setPosition({ x: 0, y: 0 });
      }, 200);
    }
  }, [onClose]);

  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + 0.5, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - 0.5, 0.5));
  }, []);

  const handleRotate = useCallback(() => {
    setRotation(prev => (prev + 90) % 360);
  }, []);

  const handleReset = useCallback(() => {
    setZoom(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    setZoom(prev => Math.max(0.5, Math.min(5, prev + delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  }, [zoom, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto h-auto p-0 bg-black/95 border-none">
        <DialogTitle className="sr-only">Document preview: {filename}</DialogTitle>

        {/* Toolbar */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-lg p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomOut}
            className="text-white hover:bg-white/20"
            title="Zoom uit"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-white text-sm min-w-[60px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomIn}
            className="text-white hover:bg-white/20"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-white/30" />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRotate}
            className="text-white hover:bg-white/20"
            title="Draai 90°"
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="text-white hover:bg-white/20"
            title="Reset"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-white/30" />
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white hover:bg-white/20"
            title="Sluiten"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Image container */}
        <div
          className="w-[95vw] h-[95vh] overflow-hidden flex items-center justify-center"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        >
          <img
            src={imageUrl}
            alt={filename}
            className="max-w-none select-none"
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${zoom}) rotate(${rotation}deg)`,
              transition: isDragging ? 'none' : 'transform 0.2s ease-out',
            }}
            draggable={false}
          />
        </div>

        {/* Filename footer */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm rounded-lg px-4 py-2">
          <p className="text-white text-sm">{filename}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
});

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
  const [isZoomOpen, setIsZoomOpen] = useState(false);

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

  // Handle image zoom
  const handleOpenZoom = useCallback(() => {
    setIsZoomOpen(true);
  }, []);

  const handleCloseZoom = useCallback(() => {
    setIsZoomOpen(false);
  }, []);

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
              <div className="flex-1 min-w-0">
                {analyse ? (
                  <>
                    {/* When AI analysis available: show doc type + year + summary */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {getDocumentTypeBadge(analyse.document_type)}
                      {getBelastingjaarBadge(analyse.belastingjaar)}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                      {analyse.samenvatting}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      {attachment.filename} • {formatFileSize(attachment.fileSize)}
                    </p>
                  </>
                ) : (
                  <>
                    {/* Fallback when no AI analysis */}
                    <p className="font-medium text-sm">{attachment.filename}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(attachment.fileSize)}</p>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
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
                <div
                  className="relative group cursor-pointer"
                  onClick={handleOpenZoom}
                >
                  <img
                    src={dataUrl}
                    alt={attachment.filename}
                    className="max-w-full max-h-96 rounded-lg border shadow-sm transition-opacity group-hover:opacity-90"
                  />
                  {/* Zoom overlay on hover */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded-lg">
                    <div className="bg-black/70 text-white px-4 py-2 rounded-lg flex items-center gap-2">
                      <ZoomIn className="h-5 w-5" />
                      <span className="text-sm font-medium">Klik om in te zoomen</span>
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenZoom}
                  className="mt-2"
                >
                  <Maximize2 className="h-4 w-4 mr-2" />
                  Vergroot afbeelding
                </Button>

                {/* Zoom Modal */}
                <ImageZoomModal
                  isOpen={isZoomOpen}
                  onClose={handleCloseZoom}
                  imageUrl={dataUrl}
                  filename={attachment.filename}
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
  yearFilter,
}: Box3AttachmentsPanelProps) {
  const [expandedAttachments, setExpandedAttachments] = useState<Set<number>>(new Set());

  // Filter bijlage_analyse to only include entries for the specified year (if any)
  const filteredBijlageAnalyse = useMemo(() => {
    if (!bijlageAnalyse || bijlageAnalyse.length === 0) return undefined;
    if (!yearFilter) return bijlageAnalyse;

    // Filter to only entries matching this year
    const yearEntries = bijlageAnalyse.filter(a =>
      a.belastingjaar && String(a.belastingjaar) === yearFilter
    );

    return yearEntries.length > 0 ? yearEntries : undefined;
  }, [bijlageAnalyse, yearFilter]);

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

  // Match attachments with their AI analysis by filename or index
  const getAnalyseForAttachment = useCallback((filename: string, index: number): BijlageAnalyse | undefined => {
    // Use filtered analysis (by year) if available, otherwise use all
    const analyseList = filteredBijlageAnalyse;
    if (!analyseList || analyseList.length === 0) return undefined;

    // First try exact match
    const exactMatch = analyseList.find(a =>
      a.bestandsnaam.toLowerCase() === filename.toLowerCase()
    );
    if (exactMatch) return exactMatch;

    // Try partial match (filename contains or is contained in bestandsnaam)
    const partialMatch = analyseList.find(a =>
      a.bestandsnaam.toLowerCase().includes(filename.toLowerCase()) ||
      filename.toLowerCase().includes(a.bestandsnaam.toLowerCase())
    );
    if (partialMatch) return partialMatch;

    // Fall back to index-based matching if counts match
    // This works well when we've filtered by year - e.g., 4 attachments for 2022
    // and 4 bijlage_analyse entries for 2022
    if (analyseList.length === attachments.length && analyseList[index]) {
      return analyseList[index];
    }

    return undefined;
  }, [filteredBijlageAnalyse, attachments.length]);

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
  const analysedCount = filteredBijlageAnalyse?.length || 0;

  return (
    <div className="space-y-3">
      {attachments.map((att, idx) => (
        <Box3AttachmentItem
          key={idx}
          attachment={att}
          analyse={getAnalyseForAttachment(att.filename, idx)}
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
