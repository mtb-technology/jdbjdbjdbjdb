/**
 * Box3CaseDetail Component
 *
 * Displays the detail view of a Box 3 validation case.
 * Shows validation results without the input form.
 */

import { memo, useState, useCallback, useRef } from "react";
import imageCompression from "browser-image-compression";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import type { Box3ValidatorSession, Box3ValidationResult, Box3ManualOverrides } from "@shared/schema";
import type { PendingFile } from "@/types/box3Validator.types";

interface Box3CaseDetailProps {
  session: Box3ValidatorSession;
  systemPrompt: string;
  isRevalidating: boolean;
  isAddingDocs: boolean;
  onBack: () => void;
  onRevalidate: () => void;
  onOpenSettings: () => void;
  onAddDocuments: (files: PendingFile[], additionalText?: string) => Promise<void>;
  onUpdateOverrides: (overrides: Partial<Box3ManualOverrides>) => Promise<void>;
}

export const Box3CaseDetail = memo(function Box3CaseDetail({
  session,
  systemPrompt,
  isRevalidating,
  isAddingDocs,
  onBack,
  onRevalidate,
  onOpenSettings,
  onAddDocuments,
  onUpdateOverrides,
}: Box3CaseDetailProps) {
  const { toast } = useToast();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(Object.keys(CATEGORY_LABELS))
  );
  const [showInputDetails, setShowInputDetails] = useState(false);
  const [showAddDocs, setShowAddDocs] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validationResult = session.validationResult as Box3ValidationResult | null;
  const conceptMail = session.conceptMail as {
    onderwerp?: string;
    body?: string;
  } | null;

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

  // Derived values
  const belastingjaar = extractBelastingjaar(validationResult);
  const mailData = getMailData(validationResult);
  const showNewFormat = isNewFormat(validationResult);
  const attachments = (session.attachments as any[]) || [];

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

  // Copy mail handler
  const handleCopyMail = useCallback(() => {
    // Use edited mail if available, otherwise fall back to original mailData
    const onderwerp = editedConceptMail?.onderwerp || stripHtmlToPlainText(mailData?.onderwerp || "");
    const body = editedConceptMail?.body || stripHtmlToPlainText(mailData?.body || "");

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

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const files = Array.from(e.target.files);
    setIsCompressing(true);

    try {
      const processedFiles: PendingFile[] = await Promise.all(
        files.map(async (file) => {
          const isImage = file.type.startsWith("image/");
          if (isImage && file.size > 1024 * 1024) {
            try {
              const compressedFile = await imageCompression(file, compressionOptions);
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
  }, []);

  const handleAddDocuments = useCallback(async () => {
    if (pendingFiles.length === 0) return;
    await onAddDocuments(pendingFiles);
    setPendingFiles([]);
    setShowAddDocs(false);
  }, [pendingFiles, onAddDocuments]);

  // Get manual overrides from session
  const manualOverrides = session.manualOverrides as Box3ManualOverrides | null;

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
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          <SettingsIcon className="h-4 w-4 mr-2" />
          Settings
        </Button>
      </div>

      {/* Case Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-3">
              <User className="h-5 w-5 text-muted-foreground" />
              {session.clientName || "Onbekende klant"}
              {belastingjaar && (
                <Badge variant="outline">Belastingjaar {belastingjaar}</Badge>
              )}
              {validationResult?.global_status && (
                <GlobalStatusBadge status={validationResult.global_status} />
              )}
            </CardTitle>
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
                onClick={onRevalidate}
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
          </div>
        </CardHeader>
        <CardContent>
          {/* Add Documents Section */}
          {showAddDocs && (
            <div className="mb-4 p-4 border rounded-lg bg-muted/30 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Documenten toevoegen aan dossier
                </h4>
                <Button variant="ghost" size="sm" onClick={() => setShowAddDocs(false)}>
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
                    <div key={idx} className="flex items-center justify-between p-2 bg-background rounded text-sm">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{pf.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({(pf.file.size / 1024).toFixed(1)} KB)
                          {pf.compressed && (
                            <span className="text-green-600 ml-1">✓ gecomprimeerd</span>
                          )}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))}
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
                        {pendingFiles.length} document(en) toevoegen & hervalideren
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

              {/* Attachments */}
              {attachments.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3 text-sm font-medium">
                    <Paperclip className="h-4 w-4 text-green-500" />
                    Bijlages
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
                {session.createdAt ? new Date(session.createdAt).toLocaleString("nl-NL") : "Onbekend"}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
            <Button onClick={onRevalidate} className="mt-4" disabled={isRevalidating}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Nu valideren
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
});
