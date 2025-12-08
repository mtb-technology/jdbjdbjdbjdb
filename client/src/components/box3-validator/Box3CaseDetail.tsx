/**
 * Box3CaseDetail Component
 *
 * Displays the detail view of a Box 3 validation case.
 * Supports both legacy single-year and new multi-year dossier structures.
 */

import { memo, useState, useCallback, useRef, useMemo } from "react";
import imageCompression from "browser-image-compression";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  RefreshCw,
  Settings as SettingsIcon,
  User,
  Mail,
  Paperclip,
  FileText,
  ChevronDown,
  ChevronRight,
  Plus,
  Upload,
  Calendar,
  Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Extracted components
import {
  GlobalStatusBadge,
  DocumentChecklist,
  KansrijkheidAnalyse,
  ConceptMailEditor,
  GevondenDataCards,
  RawOutputPanel,
  Box3AttachmentsPanel,
  Box3TotalOverview,
  Box3YearEntry,
} from "@/components/box3-validator";

// Utils
import {
  extractBelastingjaar,
  isNewFormat,
  getMailData,
  stripHtmlToPlainText,
} from "@/utils/box3Utils";

// Constants
import { CATEGORY_LABELS } from "@/constants/box3.constants";

// Types
import type {
  Box3ValidatorSession,
  Box3ValidationResult,
  Box3ManualOverrides,
  Box3MultiYearData,
  Box3YearEntry as Box3YearEntryType,
} from "@shared/schema";
import type { PendingFile } from "@/types/box3Validator.types";

// Box 3 herstel years (2017-2023 are the relevant years)
const BOX3_YEARS = ["2017", "2018", "2019", "2020", "2021", "2022", "2023"];

interface Box3CaseDetailProps {
  session: Box3ValidatorSession;
  systemPrompt: string;
  isRevalidating: boolean;
  isAddingDocs: boolean;
  isGeneratingEmail?: boolean;
  onBack: () => void;
  onRevalidate: (jaar?: string) => void;
  onOpenSettings: () => void;
  onAddDocuments: (files: PendingFile[], additionalText?: string, jaar?: string) => Promise<void>;
  onUpdateOverrides: (overrides: Partial<Box3ManualOverrides>, jaar?: string) => Promise<void>;
  onConvertToMultiYear?: () => Promise<void>;
  onAddYear?: (jaar: string) => Promise<void>;
  onGenerateEmail?: () => Promise<{ onderwerp: string; body: string } | null>;
}

export const Box3CaseDetail = memo(function Box3CaseDetail({
  session,
  systemPrompt,
  isRevalidating,
  isAddingDocs,
  isGeneratingEmail = false,
  onBack,
  onRevalidate,
  onOpenSettings,
  onAddDocuments,
  onUpdateOverrides,
  onConvertToMultiYear,
  onAddYear,
  onGenerateEmail,
}: Box3CaseDetailProps) {
  const { toast } = useToast();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(Object.keys(CATEGORY_LABELS))
  );
  const [showInputDetails, setShowInputDetails] = useState(false);
  const [showAddDocs, setShowAddDocs] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
  const [showAddYear, setShowAddYear] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Determine if this is a multi-year session
  const isMultiYear = session.isMultiYear ?? false;
  const multiYearData = session.multiYearData as Box3MultiYearData | null;

  // Legacy single-year data
  const validationResult = session.validationResult as Box3ValidationResult | null;
  const conceptMail = session.conceptMail as {
    onderwerp?: string;
    body?: string;
  } | null;
  const manualOverrides = session.manualOverrides as Box3ManualOverrides | null;

  const [editedConceptMail, setEditedConceptMail] = useState<{
    onderwerp: string;
    body: string;
  } | null>(
    conceptMail
      ? {
          onderwerp: stripHtmlToPlainText(conceptMail.onderwerp || ""),
          body: stripHtmlToPlainText(conceptMail.body || ""),
        }
      : null
  );

  // Derived values for legacy mode
  const belastingjaar = extractBelastingjaar(validationResult);
  const mailData = getMailData(validationResult);
  const showNewFormat = isNewFormat(validationResult);
  const attachments = (session.attachments as any[]) || [];

  // Get years that already have data
  const existingYears = useMemo(() => {
    if (!multiYearData?.years) return [];
    return Object.keys(multiYearData.years).sort();
  }, [multiYearData]);

  // Get years that can still be added
  const availableYears = useMemo(() => {
    return BOX3_YEARS.filter((y) => !existingYears.includes(y));
  }, [existingYears]);

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

  // Year toggle
  const toggleYear = useCallback((jaar: string) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(jaar)) {
        next.delete(jaar);
      } else {
        next.add(jaar);
      }
      return next;
    });
  }, []);

  // Copy mail handler
  const handleCopyMail = useCallback(() => {
    const onderwerp =
      editedConceptMail?.onderwerp ||
      stripHtmlToPlainText(mailData?.onderwerp || "");
    const body =
      editedConceptMail?.body || stripHtmlToPlainText(mailData?.body || "");

    if (!onderwerp && !body) return;

    const text = `Onderwerp: ${onderwerp}\n\n${body}`;
    navigator.clipboard.writeText(text);

    toast({
      title: "Gekopieerd",
      description: "Concept mail is naar het klembord gekopieerd.",
    });
  }, [editedConceptMail, mailData, toast]);

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
    await onAddDocuments(pendingFiles);
    setPendingFiles([]);
    setShowAddDocs(false);
  }, [pendingFiles, onAddDocuments]);

  // Multi-year handlers
  const handleAddDocumentsForYear = useCallback(
    async (jaar: string, files: PendingFile[]) => {
      await onAddDocuments(files, undefined, jaar);
    },
    [onAddDocuments]
  );

  const handleRevalidateYear = useCallback(
    async (jaar: string) => {
      onRevalidate(jaar);
    },
    [onRevalidate]
  );

  const handleUpdateOverridesForYear = useCallback(
    async (jaar: string, overrides: Partial<Box3ManualOverrides>) => {
      await onUpdateOverrides(overrides, jaar);
    },
    [onUpdateOverrides]
  );

  const handleAddYear = useCallback(
    async (jaar: string) => {
      if (onAddYear) {
        await onAddYear(jaar);
        setShowAddYear(false);
        setExpandedYears((prev) => {
          const next = new Set(prev);
          next.add(jaar);
          return next;
        });
      }
    },
    [onAddYear]
  );

  const handleSelectYearFromOverview = useCallback((jaar: string) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      next.add(jaar);
      return next;
    });
    // Scroll to the year if needed
    const element = document.getElementById(`year-${jaar}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // Generate email handler for multi-year dossiers
  const handleGenerateEmail = useCallback(async () => {
    if (!onGenerateEmail) return;

    const email = await onGenerateEmail();
    if (email) {
      setEditedConceptMail({
        onderwerp: email.onderwerp,
        body: email.body,
      });
    }
  }, [onGenerateEmail]);

  // ============ RENDER ============

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Terug naar overzicht
          </Button>
        </div>
        <div className="flex gap-2">
          {!isMultiYear && onConvertToMultiYear && (
            <Button
              variant="outline"
              size="sm"
              onClick={onConvertToMultiYear}
              title="Converteer naar multi-year dossier voor meerdere belastingjaren"
            >
              <Layers className="h-4 w-4 mr-2" />
              Multi-year
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onOpenSettings}>
            <SettingsIcon className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* Case Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-3">
              <User className="h-5 w-5 text-muted-foreground" />
              {session.clientName || "Onbekende klant"}
              {isMultiYear ? (
                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                  <Layers className="h-3 w-3 mr-1" />
                  Multi-year ({existingYears.length} jaar)
                </Badge>
              ) : (
                <>
                  {belastingjaar && (
                    <Badge variant="outline">Belastingjaar {belastingjaar}</Badge>
                  )}
                  {validationResult?.global_status && (
                    <GlobalStatusBadge status={validationResult.global_status} />
                  )}
                </>
              )}
            </CardTitle>
            {!isMultiYear && (
              <div className="flex gap-2">
                <Button
                  onClick={() => setShowAddDocs(!showAddDocs)}
                  variant="outline"
                  size="sm"
                  disabled={isAddingDocs}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Document toevoegen
                </Button>
                <Button
                  onClick={() => onRevalidate()}
                  variant="default"
                  size="sm"
                  disabled={isRevalidating || isAddingDocs}
                >
                  {isRevalidating ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Opnieuw valideren
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Add Documents Section - Legacy Mode */}
          {!isMultiYear && showAddDocs && (
            <div className="mb-4 p-4 border rounded-lg bg-muted/30 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Documenten toevoegen aan dossier
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
                        Documenten toevoegen & hervalideren...
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-2" />
                        {pendingFiles.length} document(en) toevoegen &
                        hervalideren
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Collapsible input details */}
          <button
            onClick={() => setShowInputDetails(!showInputDetails)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {showInputDetails ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span>Oorspronkelijke input bekijken</span>
            {attachments.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                <Paperclip className="h-3 w-3 mr-1" />
                {attachments.length} bijlage(s)
              </Badge>
            )}
          </button>

          {showInputDetails && (
            <div className="mt-4 space-y-4 border-t pt-4">
              {/* Original mail text */}
              {session.inputText && (
                <div>
                  <div className="flex items-center gap-2 mb-2 text-sm font-medium">
                    <Mail className="h-4 w-4 text-blue-500" />
                    Mail van klant
                  </div>
                  <div className="bg-muted p-3 rounded-md text-sm font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {session.inputText}
                  </div>
                </div>
              )}

              {/* Attachments - Session level (for both legacy and multi-year) */}
              {attachments.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3 text-sm font-medium">
                    <Paperclip className="h-4 w-4 text-green-500" />
                    Alle bijlages ({attachments.length})
                  </div>
                  <Box3AttachmentsPanel
                    attachments={attachments}
                    bijlageAnalyse={validationResult?.bijlage_analyse}
                  />
                </div>
              )}

              {/* Created date */}
              <div className="text-xs text-muted-foreground">
                Aangemaakt op{" "}
                {session.createdAt
                  ? new Date(session.createdAt).toLocaleString("nl-NL")
                  : "Onbekend"}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============ MULTI-YEAR MODE ============ */}
      {isMultiYear && multiYearData && (
        <div className="space-y-6">
          {/* Total Overview */}
          <Box3TotalOverview
            multiYearData={multiYearData}
            onSelectYear={handleSelectYearFromOverview}
          />

          {/* Add Year Button */}
          <div className="flex items-center gap-2">
            {!showAddYear && availableYears.length > 0 && (
              <Button
                variant="outline"
                onClick={() => setShowAddYear(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Belastingjaar toevoegen
              </Button>
            )}
            {showAddYear && (
              <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg">
                <span className="text-sm">Selecteer jaar:</span>
                {availableYears.map((jaar) => (
                  <Button
                    key={jaar}
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddYear(jaar)}
                  >
                    {jaar}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddYear(false)}
                >
                  Annuleren
                </Button>
              </div>
            )}
          </div>

          {/* Per-Year Entries */}
          <div className="space-y-4">
            {existingYears.map((jaar) => {
              const yearData = multiYearData.years[jaar];
              return (
                <div key={jaar} id={`year-${jaar}`}>
                  <Box3YearEntry
                    jaar={jaar}
                    yearData={yearData}
                    isExpanded={expandedYears.has(jaar)}
                    onToggleExpand={() => toggleYear(jaar)}
                    onAddDocuments={handleAddDocumentsForYear}
                    onRevalidate={handleRevalidateYear}
                    onUpdateOverrides={handleUpdateOverridesForYear}
                    isRevalidating={isRevalidating}
                    isAddingDocs={isAddingDocs}
                    sessionBijlageAnalyse={validationResult?.bijlage_analyse}
                  />
                </div>
              );
            })}
          </div>

          {/* Concept Mail - Combined for all years */}
          {editedConceptMail ? (
            <ConceptMailEditor
              editedConceptMail={editedConceptMail}
              mailData={mailData}
              onEditConceptMail={setEditedConceptMail}
              onCopyMail={handleCopyMail}
            />
          ) : onGenerateEmail && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Mail className="h-5 w-5 text-blue-500" />
                  Concept e-mail genereren
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Genereer een concept e-mail op basis van alle belastingjaren in dit dossier.
                </p>
                <Button
                  onClick={handleGenerateEmail}
                  disabled={isGeneratingEmail || existingYears.length === 0}
                >
                  {isGeneratingEmail ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      E-mail genereren...
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4 mr-2" />
                      Genereer concept e-mail
                    </>
                  )}
                </Button>
                {existingYears.length === 0 && (
                  <p className="text-xs text-amber-600 mt-2">
                    Voeg eerst minimaal één belastingjaar toe.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ============ LEGACY SINGLE-YEAR MODE ============ */}
      {!isMultiYear && (
        <>
          {/* Results Section */}
          {validationResult && (
            <div className="grid gap-6">
              {/* Kansrijkheid Analyse */}
              <KansrijkheidAnalyse
                validationResult={validationResult}
                belastingjaar={belastingjaar}
                manualOverrides={manualOverrides}
              />

              {/* Raw Output Panel */}
              <RawOutputPanel
                validationResult={validationResult}
                lastUsedPrompt={null}
                systemPrompt={systemPrompt}
              />

              {/* New Format: Gevonden Data Dashboard */}
              {showNewFormat && validationResult.gevonden_data && (
                <GevondenDataCards validationResult={validationResult} />
              )}

              {/* Document Checklist */}
              <DocumentChecklist
                validationResult={validationResult}
                expandedCategories={expandedCategories}
                onToggleCategory={toggleCategory}
                manualOverrides={manualOverrides}
                onUpdateOverrides={onUpdateOverrides}
              />

              {/* Concept Mail Editor */}
              <ConceptMailEditor
                editedConceptMail={editedConceptMail}
                mailData={mailData}
                onEditConceptMail={setEditedConceptMail}
                onCopyMail={handleCopyMail}
              />
            </div>
          )}

          {!validationResult && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-muted-foreground">
                  Geen validatie resultaat beschikbaar voor deze case.
                </p>
                <Button
                  onClick={() => onRevalidate()}
                  className="mt-4"
                  disabled={isRevalidating}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Nu valideren
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
});
