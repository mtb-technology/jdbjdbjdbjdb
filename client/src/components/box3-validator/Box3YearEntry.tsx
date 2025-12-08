/**
 * Box3YearEntry Component
 *
 * Displays and manages data for a single tax year within a multi-year Box 3 dossier.
 * Shows documents, validation results, and kansrijkheid for one specific year.
 */

import { memo, useState, useCallback, useRef } from "react";
import imageCompression from "browser-image-compression";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  FileText,
  Plus,
  Upload,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Components
import {
  DocumentChecklist,
  KansrijkheidAnalyse,
  Box3AttachmentsPanel,
} from "@/components/box3-validator";

// Utils
import { extractBelastingjaar } from "@/utils/box3Utils";

// Constants
import { CATEGORY_LABELS } from "@/constants/box3.constants";

// Types
import type {
  Box3YearEntry as Box3YearEntryType,
  Box3ManualOverrides,
  Box3ValidationResult,
} from "@shared/schema";
import type { PendingFile } from "@/types/box3Validator.types";

// Type for bijlage analyse (from session-level validation)
interface BijlageAnalyse {
  bestandsnaam: string;
  document_type: string;
  belastingjaar?: number | string | null;
  samenvatting: string;
  geextraheerde_waarden?: Record<string, string | number | boolean | null>;
  relevantie?: string;
}

interface Box3YearEntryProps {
  jaar: string;
  yearData: Box3YearEntryType;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onAddDocuments: (jaar: string, files: PendingFile[]) => Promise<void>;
  onRevalidate: (jaar: string) => Promise<void>;
  onUpdateOverrides: (jaar: string, overrides: Partial<Box3ManualOverrides>) => Promise<void>;
  onRemoveYear?: (jaar: string) => void;
  isRevalidating?: boolean;
  isAddingDocs?: boolean;
  // Session-level bijlage_analyse to match with attachments
  sessionBijlageAnalyse?: BijlageAnalyse[];
}

export const Box3YearEntry = memo(function Box3YearEntry({
  jaar,
  yearData,
  isExpanded,
  onToggleExpand,
  onAddDocuments,
  onRevalidate,
  onUpdateOverrides,
  onRemoveYear,
  isRevalidating = false,
  isAddingDocs = false,
  sessionBijlageAnalyse,
}: Box3YearEntryProps) {
  const { toast } = useToast();
  const [showAddDocs, setShowAddDocs] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isDocsExpanded, setIsDocsExpanded] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(Object.keys(CATEGORY_LABELS))
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validationResult = yearData.validationResult;
  const attachments = yearData.attachments || [];
  const manualOverrides = yearData.manualOverrides;
  const isComplete = yearData.isComplete ?? false;
  const hasData = !!validationResult || attachments.length > 0;

  // Category toggle
  const toggleCategory = useCallback((key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // File handling with compression
  const compressionOptions = {
    maxSizeMB: 1,
    maxWidthOrHeight: 2048,
    useWebWorker: true,
  };

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;

      const files = Array.from(e.target.files);
      setIsCompressing(true);

      try {
        const processedFiles: PendingFile[] = await Promise.all(
          files.map(async (file) => {
            const isImage = file.type.startsWith("image/");
            if (isImage && file.size > 1024 * 1024) {
              try {
                const compressedFile = await imageCompression(
                  file,
                  compressionOptions
                );
                return {
                  file: compressedFile,
                  name: file.name,
                  originalSize: file.size,
                  compressed: true,
                };
              } catch {
                return { file, name: file.name };
              }
            }
            return { file, name: file.name };
          })
        );
        setPendingFiles((prev) => [...prev, ...processedFiles]);
      } finally {
        setIsCompressing(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    []
  );

  const handleAddDocuments = useCallback(async () => {
    if (pendingFiles.length === 0) return;
    await onAddDocuments(jaar, pendingFiles);
    setPendingFiles([]);
    setShowAddDocs(false);
  }, [pendingFiles, onAddDocuments, jaar]);

  const handleUpdateOverrides = useCallback(
    async (overrides: Partial<Box3ManualOverrides>) => {
      await onUpdateOverrides(jaar, overrides);
    },
    [onUpdateOverrides, jaar]
  );

  return (
    <Card className={`${isComplete ? "border-green-200" : ""}`}>
      <CardHeader className="pb-2">
        <button
          onClick={onToggleExpand}
          className="w-full flex items-center justify-between hover:bg-muted/30 -m-2 p-2 rounded-md transition-colors"
        >
          <CardTitle className="flex items-center gap-3 text-lg">
            <Calendar className="h-5 w-5 text-muted-foreground" />
            <span>Belastingjaar {jaar}</span>
            {isComplete ? (
              <Badge className="bg-green-500">
                <CheckCircle className="h-3 w-3 mr-1" />
                Compleet
              </Badge>
            ) : hasData ? (
              <Badge variant="outline" className="border-orange-300 text-orange-600">
                <AlertCircle className="h-3 w-3 mr-1" />
                Actie vereist
              </Badge>
            ) : (
              <Badge variant="secondary">Geen data</Badge>
            )}
            {attachments.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                <FileText className="h-3 w-3 mr-1" />
                {attachments.length} document{attachments.length !== 1 ? "en" : ""}
              </Badge>
            )}
          </CardTitle>
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          )}
        </button>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => setShowAddDocs(!showAddDocs)}
              variant="outline"
              size="sm"
              disabled={isAddingDocs}
            >
              <Plus className="h-4 w-4 mr-2" />
              Document toevoegen
            </Button>
            {hasData && (
              <Button
                onClick={() => onRevalidate(jaar)}
                variant="default"
                size="sm"
                disabled={isRevalidating || isAddingDocs}
              >
                {isRevalidating ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Hervalideren
              </Button>
            )}
            {onRemoveYear && !hasData && (
              <Button
                onClick={() => onRemoveYear(jaar)}
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Verwijder jaar
              </Button>
            )}
          </div>

          {/* Add Documents Section */}
          {showAddDocs && (
            <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Documenten toevoegen voor {jaar}
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddDocs(false)}
                >
                  Annuleren
                </Button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.txt,.jpg,.jpeg,.png"
                onChange={handleFileSelect}
                className="hidden"
              />

              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="w-full"
                disabled={isCompressing || isAddingDocs}
              >
                {isCompressing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Comprimeren...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Selecteer bestanden
                  </>
                )}
              </Button>

              {pendingFiles.length > 0 && (
                <div className="space-y-2">
                  {pendingFiles.map((pf, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 bg-background rounded text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{pf.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({(pf.file.size / 1024).toFixed(1)} KB)
                          {pf.compressed && (
                            <span className="text-green-600 ml-1">
                              ✓ gecomprimeerd
                            </span>
                          )}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setPendingFiles((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  <Button
                    onClick={handleAddDocuments}
                    disabled={isAddingDocs}
                    className="w-full"
                  >
                    {isAddingDocs ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Documenten toevoegen...
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-2" />
                        {pendingFiles.length} document(en) toevoegen
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Attachments - Collapsible */}
          {attachments.length > 0 && (
            <Collapsible open={isDocsExpanded} onOpenChange={setIsDocsExpanded}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center gap-2 text-sm font-medium hover:bg-muted/50 -mx-2 px-2 py-1.5 rounded-md transition-colors">
                  {isDocsExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Documenten ({attachments.length})
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <Box3AttachmentsPanel
                  attachments={attachments}
                  bijlageAnalyse={validationResult?.bijlage_analyse || sessionBijlageAnalyse}
                  yearFilter={jaar}
                />
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Validation Results */}
          {validationResult && (
            <div className="space-y-4">
              {/* Kansrijkheid Analyse for this year */}
              <KansrijkheidAnalyse
                validationResult={validationResult}
                belastingjaar={jaar}
                manualOverrides={manualOverrides}
              />

              {/* Document Checklist */}
              <DocumentChecklist
                validationResult={validationResult}
                expandedCategories={expandedCategories}
                onToggleCategory={toggleCategory}
                manualOverrides={manualOverrides}
                onUpdateOverrides={handleUpdateOverrides}
              />
            </div>
          )}

          {/* No data yet */}
          {!hasData && (
            <div className="bg-muted/30 rounded-lg p-6 text-center">
              <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Nog geen documenten voor {jaar}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Voeg documenten toe om een validatie te starten
              </p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
});
