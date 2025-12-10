/**
 * Box3CaseDetail Component - V2
 *
 * Displays the detail view of a Box 3 dossier.
 * Uses the new Blueprint data model with source tracking.
 */

import { memo, useState, useCallback, useRef } from "react";
import imageCompression from "browser-image-compression";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  Users,
  Building2,
  Landmark,
  TrendingUp,
  Home,
  PiggyBank,
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Extracted components
import {
  RawOutputPanel,
  Box3AttachmentsPanel,
} from "@/components/box3-validator";

// Types
import type { Box3Blueprint, Box3Dossier } from "@shared/schema";
import type { PendingFile } from "@/types/box3Validator.types";
import type { Box3DossierFull } from "@/hooks/useBox3Sessions";
import type { DebugInfo } from "@/hooks/useBox3Validation";

interface Box3CaseDetailProps {
  dossierFull: Box3DossierFull;
  systemPrompt: string;
  isRevalidating: boolean;
  isAddingDocs: boolean;
  debugInfo?: DebugInfo | null;
  onBack: () => void;
  onRevalidate: () => void;
  onOpenSettings: () => void;
  onAddDocuments: (files: PendingFile[]) => Promise<void>;
}

// Helper to format currency
const formatCurrency = (value: number | null | undefined): string => {
  if (value == null) return "—";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(value);
};

// Helper to get status color
const getStatusColor = (status: string | null | undefined) => {
  if (!status) return "bg-gray-100 text-gray-800";
  switch (status) {
    case "afgerond":
      return "bg-green-100 text-green-800";
    case "in_behandeling":
      return "bg-blue-100 text-blue-800";
    case "wacht_op_klant":
      return "bg-yellow-100 text-yellow-800";
    case "intake":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
};

const getStatusLabel = (status: string | null | undefined) => {
  if (!status) return "Onbekend";
  switch (status) {
    case "afgerond":
      return "Afgerond";
    case "in_behandeling":
      return "In behandeling";
    case "wacht_op_klant":
      return "Wacht op klant";
    case "intake":
      return "Intake";
    default:
      return status;
  }
};

// Component for rendering a data point with source info
// Works with Box3DataPoint<T> which has 'amount' instead of 'value'
function DataPointDisplay({
  label,
  dataPoint,
  format = "text",
}: {
  label: string;
  dataPoint: { amount?: any; value?: any; source_snippet?: string; confidence?: number | string } | string | number | boolean | null | undefined;
  format?: "text" | "currency" | "percentage" | "boolean";
}) {
  if (dataPoint == null) return null;

  // Handle primitive values directly
  if (typeof dataPoint === "string" || typeof dataPoint === "number" || typeof dataPoint === "boolean") {
    let displayValue: string;
    switch (format) {
      case "currency":
        displayValue = formatCurrency(typeof dataPoint === "number" ? dataPoint : null);
        break;
      case "percentage":
        displayValue = dataPoint != null ? `${dataPoint}%` : "—";
        break;
      case "boolean":
        displayValue = dataPoint ? "Ja" : "Nee";
        break;
      default:
        displayValue = dataPoint?.toString() || "—";
    }
    return (
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-medium">{displayValue}</span>
      </div>
    );
  }

  // Handle Box3DataPoint objects (use 'amount' field, fallback to 'value')
  const rawValue = dataPoint.amount ?? dataPoint.value;
  let displayValue: string;
  switch (format) {
    case "currency":
      displayValue = formatCurrency(typeof rawValue === "number" ? rawValue : null);
      break;
    case "percentage":
      displayValue = rawValue != null ? `${rawValue}%` : "—";
      break;
    case "boolean":
      displayValue = rawValue ? "Ja" : "Nee";
      break;
    default:
      displayValue = rawValue?.toString() || "—";
  }

  // Handle confidence as number (0-1) or string
  const confidence = dataPoint.confidence;
  let confidenceColor = "text-gray-500";
  let confidenceLabel = "";
  if (typeof confidence === "number") {
    confidenceColor = confidence > 0.8 ? "text-green-600" : confidence > 0.5 ? "text-yellow-600" : "text-red-600";
    confidenceLabel = `${Math.round(confidence * 100)}%`;
  } else if (typeof confidence === "string") {
    confidenceColor = confidence === "high" ? "text-green-600" : confidence === "medium" ? "text-yellow-600" : "text-red-600";
    confidenceLabel = confidence;
  }

  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium">{displayValue}</span>
      {dataPoint.source_snippet && (
        <span className="text-xs text-muted-foreground italic truncate" title={dataPoint.source_snippet}>
          "{dataPoint.source_snippet}"
        </span>
      )}
      {confidence != null && (
        <span className={`text-xs ${confidenceColor}`}>
          {confidenceLabel}
        </span>
      )}
    </div>
  );
}

export const Box3CaseDetail = memo(function Box3CaseDetail({
  dossierFull,
  systemPrompt,
  isRevalidating,
  isAddingDocs,
  debugInfo,
  onBack,
  onRevalidate,
  onOpenSettings,
  onAddDocuments,
}: Box3CaseDetailProps) {
  const { toast } = useToast();
  const { dossier, blueprint, blueprintVersion, documents } = dossierFull;

  const [showInputDetails, setShowInputDetails] = useState(false);
  const [showAddDocs, setShowAddDocs] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Year-first navigation: year is the primary selector
  const availableYears = Object.keys(blueprint?.year_summaries || {}).sort((a, b) => Number(b) - Number(a));
  const [selectedYear, setSelectedYear] = useState<string | null>(availableYears[0] || null);
  const [activeYearTab, setActiveYearTab] = useState("overview");

  // Extract data from blueprint
  const taxYears = dossier.taxYears || [];
  const hasFiscalPartner = blueprint?.fiscal_entity?.fiscal_partner?.has_partner || false;
  const validationFlags = blueprint?.validation_flags || [];
  const sourceDocsRegistry = blueprint?.source_documents_registry || [];

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
    },
    []
  );

  const handleAddDocuments = useCallback(async () => {
    if (pendingFiles.length === 0) return;
    await onAddDocuments(pendingFiles);
    setPendingFiles([]);
    setShowAddDocs(false);
  }, [pendingFiles, onAddDocuments]);

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
          <Button variant="outline" size="sm" onClick={onOpenSettings}>
            <SettingsIcon className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* Dossier Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-3">
                <User className="h-5 w-5 text-muted-foreground" />
                {dossier.clientName || "Onbekende klant"}
                {dossier.dossierNummer && (
                  <span className="text-sm font-normal text-muted-foreground">
                    #{dossier.dossierNummer}
                  </span>
                )}
              </CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1">
                <Badge className={getStatusColor(dossier.status)}>
                  {getStatusLabel(dossier.status)}
                </Badge>
                {taxYears.length > 0 && (
                  <Badge variant="outline">
                    <Calendar className="h-3 w-3 mr-1" />
                    {taxYears.length === 1
                      ? taxYears[0]
                      : `${taxYears[0]}-${taxYears[taxYears.length - 1]}`}
                  </Badge>
                )}
                {hasFiscalPartner && (
                  <Badge variant="outline">
                    <Users className="h-3 w-3 mr-1" />
                    Fiscaal partner
                  </Badge>
                )}
                {blueprintVersion > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Blueprint v{blueprintVersion}
                  </span>
                )}
              </CardDescription>
            </div>
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
                            <span className="text-green-600 ml-1">✓ gecomprimeerd</span>
                          )}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  <Button onClick={handleAddDocuments} disabled={isAddingDocs} className="w-full">
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

          {/* Collapsible input details */}
          <button
            onClick={() => setShowInputDetails(!showInputDetails)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {showInputDetails ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span>Oorspronkelijke input bekijken</span>
            {documents.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                <Paperclip className="h-3 w-3 mr-1" />
                {documents.length} document(en)
              </Badge>
            )}
          </button>

          {showInputDetails && (
            <div className="mt-4 space-y-4 border-t pt-4">
              {/* Original mail text */}
              {dossier.intakeText && (
                <div>
                  <div className="flex items-center gap-2 mb-2 text-sm font-medium">
                    <Mail className="h-4 w-4 text-blue-500" />
                    Mail van klant
                  </div>
                  <div className="bg-muted p-3 rounded-md text-sm font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {dossier.intakeText}
                  </div>
                </div>
              )}

              {/* Documents - Combined view */}
              {documents.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3 text-sm font-medium">
                    <Paperclip className="h-4 w-4 text-green-500" />
                    Documenten ({documents.length})
                    {sourceDocsRegistry.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        • {sourceDocsRegistry.length} geclassificeerd
                      </span>
                    )}
                  </div>
                  <div className="border rounded-lg divide-y">
                    {documents.map((doc, docIndex) => {
                      // Match registry entry by index - AI generates them in the same order as uploaded
                      const registryEntry = sourceDocsRegistry[docIndex];
                      const docType = registryEntry?.detected_type;
                      const taxYear = registryEntry?.detected_tax_year;
                      const forPerson = registryEntry?.for_person;

                      // Determine person name
                      let personName: string | null = null;
                      if (forPerson) {
                        if (forPerson === blueprint?.fiscal_entity?.taxpayer?.id) {
                          personName = blueprint?.fiscal_entity?.taxpayer?.name || "Belastingplichtige";
                        } else if (forPerson === blueprint?.fiscal_entity?.fiscal_partner?.id) {
                          personName = blueprint?.fiscal_entity?.fiscal_partner?.name || "Partner";
                        } else {
                          personName = forPerson;
                        }
                      }

                      // Format document type for display
                      const formatDocType = (type: string | undefined) => {
                        if (!type) return null;
                        const labels: Record<string, string> = {
                          'aangifte_ib': 'Aangifte IB',
                          'definitieve_aanslag': 'Definitieve aanslag',
                          'voorlopige_aanslag': 'Voorlopige aanslag',
                          'aanslag_definitief': 'Definitieve aanslag',
                          'aanslag_voorlopig': 'Voorlopige aanslag',
                          'jaaroverzicht_bank': 'Jaaroverzicht bank',
                          'jaaropgave_bank': 'Jaaroverzicht bank',
                          'spaarrekeningoverzicht': 'Spaarrekening',
                          'effectenoverzicht': 'Effectenoverzicht',
                          'dividendnota': 'Dividendnota',
                          'woz_beschikking': 'WOZ-beschikking',
                          'hypotheekoverzicht': 'Hypotheekoverzicht',
                          'leningoverzicht': 'Leningoverzicht',
                          'email_body': 'E-mail',
                          'overig': 'Overig',
                        };
                        return labels[type] || type;
                      };

                      const hasTags = docType || taxYear || personName;
                      const notes = registryEntry?.notes;

                      return (
                        <div key={doc.id} className="px-3 py-2.5 hover:bg-muted/30 transition-colors">
                          {/* Main row */}
                          <div className="flex items-center gap-3">
                            {/* Icon */}
                            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />

                            {/* Filename */}
                            <span className="text-sm truncate min-w-0 flex-shrink" title={doc.filename}>
                              {doc.filename}
                            </span>

                            {/* Size */}
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              ({(doc.fileSize / 1024).toFixed(0)} KB)
                            </span>

                            {/* Spacer */}
                            <div className="flex-1" />

                            {/* Tags */}
                            {hasTags && (
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {docType && (
                                  <Badge variant="secondary" className="text-xs font-normal px-2 py-0.5">
                                    {formatDocType(docType)}
                                  </Badge>
                                )}
                                {taxYear && (
                                  <Badge variant="outline" className="text-xs font-normal px-2 py-0.5">
                                    {taxYear}
                                  </Badge>
                                )}
                                {personName && (
                                  <Badge variant="outline" className="text-xs font-normal px-2 py-0.5 bg-blue-50 border-blue-200">
                                    <User className="h-3 w-3 mr-1" />
                                    {personName}
                                  </Badge>
                                )}
                              </div>
                            )}

                            {/* Readable indicator */}
                            {registryEntry && (
                              registryEntry.is_readable ? (
                                <span title="Document leesbaar">
                                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                                </span>
                              ) : (
                                <span title="Document niet volledig leesbaar">
                                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                                </span>
                              )
                            )}
                          </div>

                          {/* Notes row */}
                          {notes && (
                            <p className="text-xs text-muted-foreground mt-1 ml-7 italic">
                              {notes}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Hint if no registry data */}
                  {sourceDocsRegistry.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-2 italic">
                      Klik op "Opnieuw valideren" om documenten te classificeren
                    </p>
                  )}
                </div>
              )}

              {/* Created date */}
              <div className="text-xs text-muted-foreground">
                Aangemaakt op{" "}
                {dossier.createdAt ? new Date(dossier.createdAt).toLocaleString("nl-NL") : "Onbekend"}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Validation Flags */}
      {validationFlags.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              Aandachtspunten ({validationFlags.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {validationFlags.map((flag, idx) => (
                <div
                  key={flag.id || idx}
                  className={`p-3 rounded-md text-sm ${
                    flag.severity === "high"
                      ? "bg-red-100 border-red-200"
                      : flag.severity === "medium"
                      ? "bg-yellow-100 border-yellow-200"
                      : "bg-blue-100 border-blue-200"
                  } border`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-medium">{flag.type}</span>
                      {flag.field_path && (
                        <span className="text-xs text-muted-foreground ml-2">({flag.field_path})</span>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        flag.severity === "high"
                          ? "border-red-300 text-red-700"
                          : flag.severity === "medium"
                          ? "border-yellow-300 text-yellow-700"
                          : "border-blue-300 text-blue-700"
                      }
                    >
                      {flag.severity}
                    </Badge>
                  </div>
                  <p className="mt-1">{flag.message}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Year-First Navigation Structure */}
      {blueprint && (
        <div className="space-y-6">
          {/* LEVEL 1: Case Summary (always visible) */}
          {(() => {
            const yearSummaries = blueprint.year_summaries || {};
            const years = Object.keys(yearSummaries).sort();
            const totalRefund = years.reduce((sum, year) => {
              const refund = yearSummaries[year]?.calculated_totals?.indicative_refund;
              return sum + (typeof refund === 'number' ? refund : 0);
            }, 0);
            const profitableYears = years.filter(y => yearSummaries[y]?.calculated_totals?.is_profitable);
            const incompleteYears = years.filter(y => yearSummaries[y]?.status === 'incomplete');
            const isProfitable = totalRefund > 0 || profitableYears.length > 0;
            const isComplete = incompleteYears.length === 0 && years.length > 0;

            return (
              <Card className={`border-2 ${isProfitable ? 'border-green-300 bg-green-50/30' : !isComplete ? 'border-yellow-300 bg-yellow-50/30' : 'border-gray-200'}`}>
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-full ${isProfitable ? 'bg-green-100' : !isComplete ? 'bg-yellow-100' : 'bg-gray-100'}`}>
                        {isProfitable ? (
                          <CheckCircle2 className="h-8 w-8 text-green-600" />
                        ) : (
                          <AlertTriangle className="h-8 w-8 text-yellow-600" />
                        )}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold">
                          {isProfitable ? 'Kansrijk dossier' : isComplete ? 'Niet kansrijk' : 'Onvolledig dossier'}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {years.length} {years.length === 1 ? 'jaar' : 'jaren'} geanalyseerd
                          {incompleteYears.length > 0 && ` • ${incompleteYears.length} incompleet`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Indicatieve teruggave totaal</p>
                      <p className={`text-3xl font-bold ${totalRefund > 0 ? 'text-green-600' : totalRefund < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                        {formatCurrency(totalRefund)}
                      </p>
                    </div>
                  </div>

                  {/* Quick stats */}
                  <div className="mt-6 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-semibold">{years.length}</p>
                      <p className="text-xs text-muted-foreground">Belastingjaren</p>
                    </div>
                    <div>
                      <p className="text-2xl font-semibold text-green-600">{profitableYears.length}</p>
                      <p className="text-xs text-muted-foreground">Kansrijk</p>
                    </div>
                    <div>
                      <p className="text-2xl font-semibold text-yellow-600">{incompleteYears.length}</p>
                      <p className="text-xs text-muted-foreground">Incompleet</p>
                    </div>
                    <div>
                      <p className="text-2xl font-semibold">{documents.length}</p>
                      <p className="text-xs text-muted-foreground">Documenten</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Fiscal Entity - Compact two-person display */}
          <div className={`grid gap-4 ${blueprint.fiscal_entity?.fiscal_partner?.has_partner ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
            <Card className="border-blue-200 bg-blue-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-blue-800">
                  <User className="h-4 w-4" />
                  Belastingplichtige
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="font-semibold text-lg">{blueprint.fiscal_entity?.taxpayer?.name || '—'}</p>
                <p className="text-sm text-muted-foreground">BSN: {blueprint.fiscal_entity?.taxpayer?.bsn_masked || '—'}</p>
              </CardContent>
            </Card>
            {blueprint.fiscal_entity?.fiscal_partner?.has_partner && (
              <Card className="border-purple-200 bg-purple-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-purple-800">
                    <User className="h-4 w-4" />
                    Fiscaal Partner
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="font-semibold text-lg">{blueprint.fiscal_entity.fiscal_partner.name || '—'}</p>
                  <p className="text-sm text-muted-foreground">BSN: {blueprint.fiscal_entity.fiscal_partner.bsn_masked || '—'}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* LEVEL 2: Year Selector (PRIMARY NAVIGATION) */}
          {availableYears.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Selecteer Belastingjaar
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {/* Year tabs as buttons */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {availableYears.map(year => {
                    const summary = blueprint.year_summaries?.[year];
                    const isProfitable = summary?.calculated_totals?.is_profitable || (summary?.calculated_totals?.indicative_refund || 0) > 0;
                    const isIncomplete = summary?.status === 'incomplete';
                    const isSelected = selectedYear === year;

                    return (
                      <button
                        key={year}
                        onClick={() => setSelectedYear(year)}
                        className={`
                          relative px-4 py-3 rounded-lg border-2 transition-all font-medium
                          ${isSelected
                            ? 'border-primary bg-primary text-primary-foreground shadow-md scale-105'
                            : isProfitable
                              ? 'border-green-300 bg-green-50 hover:bg-green-100 text-green-800'
                              : isIncomplete
                                ? 'border-yellow-300 bg-yellow-50 hover:bg-yellow-100 text-yellow-800'
                                : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700'
                          }
                        `}
                      >
                        <div className="text-lg">{year}</div>
                        <div className="text-xs opacity-80">
                          {isProfitable ? 'Kansrijk' : isIncomplete ? 'Incompleet' : 'Compleet'}
                        </div>
                        {/* Status indicator dot */}
                        <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${
                          isProfitable ? 'bg-green-500' : isIncomplete ? 'bg-yellow-500' : 'bg-gray-400'
                        }`} />
                      </button>
                    );
                  })}
                </div>

                {/* LEVEL 3: Year Detail View with Tabs */}
                {selectedYear && blueprint.year_summaries?.[selectedYear] && (
                  <div className="border-t pt-4">
                    {/* Year header with status */}
                    {(() => {
                      const summary = blueprint.year_summaries[selectedYear];
                      const isProfitable = summary?.calculated_totals?.is_profitable || (summary?.calculated_totals?.indicative_refund || 0) > 0;
                      const isIncomplete = summary?.status === 'incomplete';
                      const taxData = blueprint.tax_authority_data?.[selectedYear];

                      return (
                        <div className={`p-4 rounded-lg mb-4 ${
                          isProfitable ? 'bg-green-50 border border-green-200' :
                          isIncomplete ? 'bg-yellow-50 border border-yellow-200' :
                          'bg-blue-50 border border-blue-200'
                        }`}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <h3 className="text-xl font-bold">Belastingjaar {selectedYear}</h3>
                              <Badge className={
                                isProfitable ? 'bg-green-100 text-green-800 border-green-300' :
                                isIncomplete ? 'bg-yellow-100 text-yellow-800 border-yellow-300' :
                                'bg-blue-100 text-blue-800 border-blue-300'
                              }>
                                {isProfitable ? 'Kansrijk' : isIncomplete ? 'Incompleet' : 'Compleet'}
                              </Badge>
                            </div>
                            {summary?.calculated_totals?.indicative_refund != null && (
                              <div className="text-right">
                                <span className="text-sm text-muted-foreground">Indicatieve teruggave:</span>
                                <span className={`text-2xl font-bold ml-2 ${
                                  (summary.calculated_totals.indicative_refund || 0) > 0 ? 'text-green-600' : 'text-gray-600'
                                }`}>
                                  {formatCurrency(summary.calculated_totals.indicative_refund)}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Key numbers for this year */}
                          {summary?.calculated_totals && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div className="p-2 bg-white/50 rounded">
                                <p className="text-xs text-muted-foreground">Totaal vermogen</p>
                                <p className="font-semibold">{formatCurrency(summary.calculated_totals.total_assets_jan_1)}</p>
                              </div>
                              <div className="p-2 bg-white/50 rounded">
                                <p className="text-xs text-muted-foreground">Werkelijk rendement</p>
                                <p className="font-semibold">{formatCurrency(summary.calculated_totals.actual_return?.total)}</p>
                              </div>
                              <div className="p-2 bg-white/50 rounded">
                                <p className="text-xs text-muted-foreground">Forfaitair (BD)</p>
                                <p className="font-semibold">{formatCurrency(summary.calculated_totals.deemed_return_from_tax_authority)}</p>
                              </div>
                              <div className="p-2 bg-white/50 rounded">
                                <p className="text-xs text-muted-foreground">Verschil</p>
                                <p className={`font-semibold ${
                                  (summary.calculated_totals.difference || 0) < 0 ? 'text-green-600' : 'text-red-600'
                                }`}>
                                  {formatCurrency(summary.calculated_totals.difference)}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Missing items for this year */}
                          {summary?.missing_items && summary.missing_items.length > 0 && (
                            <div className="mt-3 p-3 bg-yellow-100 rounded-lg border border-yellow-300">
                              <p className="text-xs font-medium text-yellow-800 mb-2 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Ontbrekende documenten/gegevens voor {selectedYear}
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {summary.missing_items.map((item, i) => (
                                  <Badge key={i} variant="outline" className="text-xs bg-white border-yellow-400 text-yellow-800">
                                    {item.description}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Year-specific tabs */}
                    <Tabs value={activeYearTab} onValueChange={setActiveYearTab}>
                      <TabsList className="mb-4">
                        <TabsTrigger value="overview">Overzicht</TabsTrigger>
                        <TabsTrigger value="assets">Vermogen</TabsTrigger>
                        <TabsTrigger value="debts">Schulden</TabsTrigger>
                        <TabsTrigger value="tax_data">Belastingdienst</TabsTrigger>
                      </TabsList>

                      {/* Overview for selected year */}
                      <TabsContent value="overview" className="space-y-4">
                        {(() => {
                          const taxData = blueprint.tax_authority_data?.[selectedYear];
                          return (
                            <>
                              {/* Tax Authority Data */}
                              {taxData?.household_totals && (
                                <Card className="border-blue-200">
                                  <CardHeader className="pb-2 bg-blue-50">
                                    <CardTitle className="text-sm flex items-center gap-2 text-blue-800">
                                      <Landmark className="h-4 w-4" />
                                      Data uit Belastingdienst ({
                                        taxData.document_type === 'definitieve_aanslag' ? 'Definitieve aanslag' :
                                        taxData.document_type === 'voorlopige_aanslag' ? 'Voorlopige aanslag' : 'Aangifte'
                                      })
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent className="pt-4">
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                      <div>
                                        <p className="text-xs text-muted-foreground">Totaal vermogen</p>
                                        <p className="font-semibold">{formatCurrency(taxData.household_totals.total_assets_gross)}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">Schulden</p>
                                        <p className="font-semibold">{formatCurrency(taxData.household_totals.total_debts)}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">Grondslag</p>
                                        <p className="font-semibold">{formatCurrency(taxData.household_totals.taxable_base)}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">Box 3 belasting</p>
                                        <p className="font-semibold">{formatCurrency(taxData.household_totals.total_tax_assessed)}</p>
                                      </div>
                                    </div>

                                    {/* Per person breakdown */}
                                    {taxData.per_person && Object.keys(taxData.per_person).length > 0 && (
                                      <div className="mt-4 pt-3 border-t">
                                        <h5 className="text-sm font-medium mb-2">Per persoon</h5>
                                        <div className="grid gap-2">
                                          {Object.entries(taxData.per_person).map(([personId, personData]) => {
                                            // Try to get person name
                                            let personName = personId;
                                            if (personId === blueprint.fiscal_entity?.taxpayer?.id) {
                                              personName = blueprint.fiscal_entity.taxpayer.name || 'Belastingplichtige';
                                            } else if (personId === blueprint.fiscal_entity?.fiscal_partner?.id) {
                                              personName = blueprint.fiscal_entity.fiscal_partner.name || 'Fiscaal Partner';
                                            }

                                            return (
                                              <div key={personId} className="flex items-center justify-between text-sm bg-muted/30 p-2 rounded">
                                                <span className="font-medium">{personName}</span>
                                                <div className="flex gap-4 text-muted-foreground">
                                                  <span>Vermogen: <span className="text-foreground">{formatCurrency(personData.total_assets_box3)}</span></span>
                                                  <span>Schulden: <span className="text-foreground">{formatCurrency(personData.total_debts_box3)}</span></span>
                                                  <span>Belasting: <span className="text-foreground">{formatCurrency(personData.tax_assessed)}</span></span>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </CardContent>
                                </Card>
                              )}

                              {!taxData?.household_totals && (
                                <Card className="border-dashed border-yellow-300 bg-yellow-50/30">
                                  <CardContent className="py-6 text-center text-yellow-700">
                                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
                                    <p>Geen belastingdienst gegevens gevonden voor {selectedYear}</p>
                                    <p className="text-sm text-muted-foreground mt-1">Upload een aangifte of aanslag voor dit jaar</p>
                                  </CardContent>
                                </Card>
                              )}
                            </>
                          );
                        })()}
                      </TabsContent>

                      {/* Assets for selected year */}
                      <TabsContent value="assets" className="space-y-4">
                        {(() => {
                          const bankSavings = blueprint.assets?.bank_savings || [];
                          const investments = blueprint.assets?.investments || [];
                          const realEstate = blueprint.assets?.real_estate || [];

                          // Filter assets that have data for this year
                          const yearBankSavings = bankSavings.filter(a => a.yearly_data?.[selectedYear]);
                          const yearInvestments = investments.filter(a => a.yearly_data?.[selectedYear]);
                          const yearRealEstate = realEstate.filter(a => a.yearly_data?.[selectedYear]);

                          const hasYearAssets = yearBankSavings.length > 0 || yearInvestments.length > 0 || yearRealEstate.length > 0;

                          if (!hasYearAssets) {
                            return (
                              <Card className="border-dashed">
                                <CardContent className="py-8 text-center text-muted-foreground">
                                  Geen vermogensbestanddelen gevonden voor {selectedYear}
                                </CardContent>
                              </Card>
                            );
                          }

                          return (
                            <>
                              {/* Summary cards */}
                              <div className="grid grid-cols-3 gap-4">
                                <Card className="bg-blue-50 border-blue-200">
                                  <CardContent className="pt-4 pb-3 text-center">
                                    <PiggyBank className="h-5 w-5 mx-auto text-blue-600 mb-1" />
                                    <p className="text-xl font-bold text-blue-700">{yearBankSavings.length}</p>
                                    <p className="text-xs text-blue-600">Bankrekeningen</p>
                                  </CardContent>
                                </Card>
                                <Card className="bg-green-50 border-green-200">
                                  <CardContent className="pt-4 pb-3 text-center">
                                    <TrendingUp className="h-5 w-5 mx-auto text-green-600 mb-1" />
                                    <p className="text-xl font-bold text-green-700">{yearInvestments.length}</p>
                                    <p className="text-xs text-green-600">Beleggingen</p>
                                  </CardContent>
                                </Card>
                                <Card className="bg-orange-50 border-orange-200">
                                  <CardContent className="pt-4 pb-3 text-center">
                                    <Home className="h-5 w-5 mx-auto text-orange-600 mb-1" />
                                    <p className="text-xl font-bold text-orange-700">{yearRealEstate.length}</p>
                                    <p className="text-xs text-orange-600">Onroerend goed</p>
                                  </CardContent>
                                </Card>
                              </div>

                              {/* Bank Savings for this year */}
                              {yearBankSavings.length > 0 && (
                                <Card>
                                  <CardHeader className="pb-2">
                                    <CardTitle className="text-base flex items-center gap-2">
                                      <PiggyBank className="h-4 w-4 text-blue-500" />
                                      Banktegoeden
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent className="p-0">
                                    <table className="w-full text-sm">
                                      <thead className="bg-muted/50 border-y">
                                        <tr>
                                          <th className="text-left px-4 py-2 font-medium">Omschrijving</th>
                                          <th className="text-left px-4 py-2 font-medium">Bank</th>
                                          <th className="text-right px-4 py-2 font-medium">Eigendom</th>
                                          <th className="text-right px-4 py-2 font-medium">1 jan {selectedYear}</th>
                                          <th className="text-right px-4 py-2 font-medium">Rente</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y">
                                        {yearBankSavings.map((asset, idx) => {
                                          const yearData = asset.yearly_data?.[selectedYear];
                                          const val = yearData?.value_jan_1;
                                          const amount = typeof val === 'object' && val !== null ? val.amount : val;
                                          const interest = yearData?.interest_received;
                                          const interestAmount = typeof interest === 'object' && interest !== null ? interest.amount : interest;

                                          return (
                                            <tr key={asset.id || idx} className="hover:bg-muted/30">
                                              <td className="px-4 py-3">
                                                <span className="font-medium">{asset.description}</span>
                                                {asset.account_masked && (
                                                  <span className="text-muted-foreground text-xs block">{asset.account_masked}</span>
                                                )}
                                              </td>
                                              <td className="px-4 py-3 text-muted-foreground">{asset.bank_name || '—'}</td>
                                              <td className="px-4 py-3 text-right">{asset.ownership_percentage}%</td>
                                              <td className="px-4 py-3 text-right font-semibold">
                                                {amount != null ? formatCurrency(amount) : '—'}
                                              </td>
                                              <td className="px-4 py-3 text-right text-green-600">
                                                {interestAmount != null ? formatCurrency(interestAmount) : '—'}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </CardContent>
                                </Card>
                              )}

                              {/* Investments for this year */}
                              {yearInvestments.length > 0 && (
                                <Card>
                                  <CardHeader className="pb-2">
                                    <CardTitle className="text-base flex items-center gap-2">
                                      <TrendingUp className="h-4 w-4 text-green-500" />
                                      Beleggingen
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent className="p-0">
                                    <table className="w-full text-sm">
                                      <thead className="bg-muted/50 border-y">
                                        <tr>
                                          <th className="text-left px-4 py-2 font-medium">Omschrijving</th>
                                          <th className="text-left px-4 py-2 font-medium">Type</th>
                                          <th className="text-right px-4 py-2 font-medium">Eigendom</th>
                                          <th className="text-right px-4 py-2 font-medium">1 jan {selectedYear}</th>
                                          <th className="text-right px-4 py-2 font-medium">Dividend</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y">
                                        {yearInvestments.map((asset, idx) => {
                                          const yearData = asset.yearly_data?.[selectedYear];
                                          const val = yearData?.value_jan_1;
                                          const amount = typeof val === 'object' && val !== null ? val.amount : val;
                                          const dividend = yearData?.dividend_received;
                                          const dividendAmount = typeof dividend === 'object' && dividend !== null ? dividend.amount : dividend;

                                          return (
                                            <tr key={asset.id || idx} className="hover:bg-muted/30">
                                              <td className="px-4 py-3">
                                                <span className="font-medium">{asset.description}</span>
                                                {asset.institution && (
                                                  <span className="text-muted-foreground text-xs block">{asset.institution}</span>
                                                )}
                                              </td>
                                              <td className="px-4 py-3">
                                                <Badge variant="outline" className="text-xs">{asset.type || 'Overig'}</Badge>
                                              </td>
                                              <td className="px-4 py-3 text-right">{asset.ownership_percentage}%</td>
                                              <td className="px-4 py-3 text-right font-semibold">
                                                {amount != null ? formatCurrency(amount) : '—'}
                                              </td>
                                              <td className="px-4 py-3 text-right text-green-600">
                                                {dividendAmount != null ? formatCurrency(dividendAmount) : '—'}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </CardContent>
                                </Card>
                              )}

                              {/* Real Estate for this year */}
                              {yearRealEstate.length > 0 && (
                                <Card>
                                  <CardHeader className="pb-2">
                                    <CardTitle className="text-base flex items-center gap-2">
                                      <Home className="h-4 w-4 text-orange-500" />
                                      Onroerend Goed
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent className="p-0">
                                    <table className="w-full text-sm">
                                      <thead className="bg-muted/50 border-y">
                                        <tr>
                                          <th className="text-left px-4 py-2 font-medium">Omschrijving</th>
                                          <th className="text-left px-4 py-2 font-medium">Type</th>
                                          <th className="text-right px-4 py-2 font-medium">Eigendom</th>
                                          <th className="text-right px-4 py-2 font-medium">WOZ {selectedYear}</th>
                                          <th className="text-right px-4 py-2 font-medium">Huurinkomsten</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y">
                                        {yearRealEstate.map((asset, idx) => {
                                          const yearData = asset.yearly_data?.[selectedYear];
                                          const val = yearData?.woz_value;
                                          const amount = typeof val === 'object' && val !== null ? val.amount : val;
                                          const rental = yearData?.rental_income_gross;
                                          const rentalAmount = typeof rental === 'object' && rental !== null ? rental.amount : rental;

                                          return (
                                            <tr key={asset.id || idx} className="hover:bg-muted/30">
                                              <td className="px-4 py-3">
                                                <span className="font-medium">{asset.description}</span>
                                                {asset.address && (
                                                  <span className="text-muted-foreground text-xs block">{asset.address}</span>
                                                )}
                                              </td>
                                              <td className="px-4 py-3">
                                                <Badge variant="outline" className="text-xs">
                                                  {asset.type === 'rented_residential' ? 'Verhuurpand' :
                                                   asset.type === 'rented_commercial' ? 'Commercieel' :
                                                   asset.type === 'land' ? 'Grond' :
                                                   asset.type === 'other' ? 'Overig' : asset.type}
                                                </Badge>
                                              </td>
                                              <td className="px-4 py-3 text-right">{asset.ownership_percentage}%</td>
                                              <td className="px-4 py-3 text-right font-semibold">
                                                {amount != null ? formatCurrency(amount) : '—'}
                                              </td>
                                              <td className="px-4 py-3 text-right text-green-600">
                                                {rentalAmount != null ? formatCurrency(rentalAmount) : '—'}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </CardContent>
                                </Card>
                              )}
                            </>
                          );
                        })()}
                      </TabsContent>

                      {/* Debts for selected year */}
                      <TabsContent value="debts" className="space-y-4">
                        {(() => {
                          const debts = blueprint.debts || [];
                          const yearDebts = debts.filter(d => d.yearly_data?.[selectedYear]);

                          if (yearDebts.length === 0) {
                            return (
                              <Card className="border-dashed">
                                <CardContent className="py-8 text-center text-muted-foreground">
                                  Geen schulden gevonden voor {selectedYear}
                                </CardContent>
                              </Card>
                            );
                          }

                          return (
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-base flex items-center gap-2">
                                  <CreditCard className="h-4 w-4 text-red-500" />
                                  Schulden ({yearDebts.length})
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="p-0">
                                <table className="w-full text-sm">
                                  <thead className="bg-muted/50 border-y">
                                    <tr>
                                      <th className="text-left px-4 py-2 font-medium">Omschrijving</th>
                                      <th className="text-left px-4 py-2 font-medium">Verstrekker</th>
                                      <th className="text-right px-4 py-2 font-medium">Eigendom</th>
                                      <th className="text-right px-4 py-2 font-medium">1 jan {selectedYear}</th>
                                      <th className="text-right px-4 py-2 font-medium">31 dec {selectedYear}</th>
                                      <th className="text-right px-4 py-2 font-medium">Rente betaald</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {yearDebts.map((debt, idx) => {
                                      const yearData = debt.yearly_data?.[selectedYear];
                                      const jan1Val = yearData?.value_jan_1;
                                      const jan1Amount = typeof jan1Val === 'object' && jan1Val !== null ? jan1Val.amount : jan1Val;
                                      const dec31Val = yearData?.value_dec_31;
                                      const dec31Amount = typeof dec31Val === 'object' && dec31Val !== null ? dec31Val.amount : dec31Val;
                                      const interestVal = yearData?.interest_paid;
                                      const interestAmount = typeof interestVal === 'object' && interestVal !== null ? interestVal.amount : interestVal;

                                      return (
                                        <tr key={debt.id || idx} className="hover:bg-muted/30">
                                          <td className="px-4 py-3 font-medium">{debt.description}</td>
                                          <td className="px-4 py-3 text-muted-foreground">{debt.lender || '—'}</td>
                                          <td className="px-4 py-3 text-right">{debt.ownership_percentage}%</td>
                                          <td className="px-4 py-3 text-right font-semibold text-red-600">
                                            {jan1Amount != null ? formatCurrency(jan1Amount) : '—'}
                                          </td>
                                          <td className="px-4 py-3 text-right text-red-600">
                                            {dec31Amount != null ? formatCurrency(dec31Amount) : '—'}
                                          </td>
                                          <td className="px-4 py-3 text-right text-orange-600">
                                            {interestAmount != null ? formatCurrency(interestAmount) : '—'}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </CardContent>
                            </Card>
                          );
                        })()}
                      </TabsContent>

                      {/* Tax Authority Data for selected year */}
                      <TabsContent value="tax_data" className="space-y-4">
                        {(() => {
                          const taxData = blueprint.tax_authority_data?.[selectedYear];

                          if (!taxData) {
                            return (
                              <Card className="border-dashed">
                                <CardContent className="py-8 text-center text-muted-foreground">
                                  Geen belastingdienst gegevens gevonden voor {selectedYear}
                                </CardContent>
                              </Card>
                            );
                          }

                          return (
                            <Card>
                              <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                  <Landmark className="h-5 w-5 text-purple-500" />
                                  Belastingdienst Gegevens {selectedYear}
                                  <Badge variant="outline" className="ml-2">{taxData.document_type}</Badge>
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                {taxData.household_totals && (
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                    <DataPointDisplay
                                      label="Totaal Vermogen"
                                      dataPoint={taxData.household_totals.total_assets_gross}
                                      format="currency"
                                    />
                                    <DataPointDisplay
                                      label="Totaal Schulden"
                                      dataPoint={taxData.household_totals.total_debts}
                                      format="currency"
                                    />
                                    <DataPointDisplay
                                      label="Grondslag"
                                      dataPoint={taxData.household_totals.taxable_base}
                                      format="currency"
                                    />
                                    <DataPointDisplay
                                      label="Box 3 Belasting"
                                      dataPoint={taxData.household_totals.total_tax_assessed}
                                      format="currency"
                                    />
                                  </div>
                                )}
                                {taxData.per_person && Object.keys(taxData.per_person).length > 0 && (
                                  <div className="border-t pt-3">
                                    <h5 className="text-sm font-medium mb-2">Per persoon</h5>
                                    <div className="grid gap-2">
                                      {Object.entries(taxData.per_person).map(([personId, personData]) => (
                                        <div key={personId} className="flex items-center justify-between text-sm bg-muted/30 p-2 rounded">
                                          <span className="font-medium">{personId}</span>
                                          <div className="flex gap-4">
                                            <span>Vermogen: {formatCurrency(personData.total_assets_box3)}</span>
                                            <span>Schulden: {formatCurrency(personData.total_debts_box3)}</span>
                                            <span>Belasting: {formatCurrency(personData.tax_assessed)}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          );
                        })()}
                      </TabsContent>
                    </Tabs>
                  </div>
                )}

                {/* No year selected or no years available */}
                {!selectedYear && availableYears.length > 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    Selecteer een belastingjaar hierboven om de details te bekijken
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* No years available */}
          {availableYears.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                <p>Geen belastingjaren gevonden in de documenten.</p>
                <p className="text-sm mt-1">Upload documenten om jaren te detecteren.</p>
              </CardContent>
            </Card>
          )}

          {/* Raw Output Section (always available at case level) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="h-4 w-4" />
                Developer: Raw Output
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* AI Debug Info */}
                {debugInfo && (
                  <RawOutputPanel
                    debugInfo={debugInfo}
                    systemPrompt={systemPrompt}
                  />
                )}

                {/* Blueprint Debug */}
                <details className="group">
                  <summary className="text-sm font-medium cursor-pointer hover:text-primary flex items-center gap-2">
                    <ChevronRight className="h-4 w-4 group-open:rotate-90 transition-transform" />
                    Blueprint Debug Data (v{blueprintVersion})
                  </summary>
                  <div className="mt-2 space-y-3">
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground mb-1">
                        source_documents_registry ({blueprint.source_documents_registry?.length || 0})
                      </h4>
                      <pre className="bg-muted rounded p-2 text-xs font-mono overflow-auto max-h-48">
                        {JSON.stringify(blueprint.source_documents_registry, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground mb-1">Full Blueprint</h4>
                      <pre className="bg-muted rounded p-2 text-xs font-mono overflow-auto max-h-64">
                        {JSON.stringify(blueprint, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* No Blueprint State */}
      {!blueprint && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground">
              Geen blueprint beschikbaar voor dit dossier.
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
