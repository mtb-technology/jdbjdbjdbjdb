/**
 * Box3CaseDetail Component - V2
 *
 * Displays the detail view of a Box 3 dossier.
 * Uses the new Blueprint data model with source tracking.
 */

import { memo, useState, useCallback, useRef, useMemo, useEffect } from "react";
import imageCompression from "browser-image-compression";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  RefreshCw,
  User,
  Mail,
  Paperclip,
  FileText,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
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
  Eye,
  X,
  Download,
  Copy,
  Check,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

// Extracted components
import {
  RawOutputPanel,
  Box3AttachmentsPanel,
  Box3ActionCards,
} from "@/components/box3-validator";

// Types
import type { Box3Blueprint, Box3Dossier } from "@shared/schema";
import type { PendingFile } from "@/types/box3Validator.types";
import type { Box3DossierFull } from "@/hooks/useBox3Sessions";
import type { DebugInfo, PipelineProgress } from "@/hooks/useBox3Validation";

// Constants
import { BOX3_CONSTANTS } from "@shared/constants";

interface Box3CaseDetailProps {
  dossierFull: Box3DossierFull;
  isRevalidating: boolean;
  isAddingDocs: boolean;
  debugInfo?: DebugInfo | null;
  pipelineProgress?: PipelineProgress | null;
  /** Active job ID if background revalidation is running */
  activeJobId?: string | null;
  onBack: () => void;
  onRevalidate: () => void;
  /** Cancel active revalidation job */
  onCancelRevalidation?: () => void;
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

/**
 * Helper to extract numeric value from yearly_data fields.
 * Handles backward compatibility for old blueprints that used:
 * - "balance_jan1" instead of "value_jan_1"
 * - { value: X } instead of { amount: X }
 */
type YearlyDataField = { amount?: number; value?: number } | number | null | undefined;

interface YearlyDataLegacy {
  value_jan_1?: YearlyDataField;
  balance_jan1?: YearlyDataField;
  interest_received?: YearlyDataField;
  dividend_received?: YearlyDataField;
  woz_value?: YearlyDataField;
  rental_income_gross?: YearlyDataField;
  value_dec_31?: YearlyDataField;
  interest_paid?: YearlyDataField;
  [key: string]: YearlyDataField | undefined;
}

const getFieldValue = (field: YearlyDataField): number | null => {
  if (field == null) return null;
  if (typeof field === 'number') return field;
  // Handle both { amount: X } (new) and { value: X } (old)
  return field.amount ?? field.value ?? null;
};

const getValueJan1 = (yearData: YearlyDataLegacy | undefined): number | null => {
  if (!yearData) return null;
  // Try new field name first, then legacy
  return getFieldValue(yearData.value_jan_1) ?? getFieldValue(yearData.balance_jan1);
};

// Copyable currency component - shows copy button on hover
function CopyableCurrency({
  value,
  className = "",
}: {
  value: number | null | undefined;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (value == null) return;

    // Copy raw number for easy pasting in forms
    const rawValue = value.toFixed(2).replace('.', ',');
    await navigator.clipboard.writeText(rawValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [value]);

  if (value == null) return <span className={className}>—</span>;

  return (
    <span className={`inline-flex items-center gap-1 group ${className}`}>
      <span>{formatCurrency(value)}</span>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
        title="Kopieer bedrag"
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-500" />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
    </span>
  );
}

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
  isRevalidating,
  isAddingDocs,
  debugInfo,
  pipelineProgress,
  activeJobId,
  onBack,
  onRevalidate,
  onCancelRevalidation,
  onAddDocuments,
}: Box3CaseDetailProps) {
  const { toast } = useToast();
  const { dossier, blueprint, blueprintVersion, generatedEmail: savedEmail, documents } = dossierFull;

  const [showInputDetails, setShowInputDetails] = useState(false);
  const [showAddDocs, setShowAddDocs] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Email generation state - initialize from saved email if available
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [generatedEmail, setGeneratedEmail] = useState<{
    emailType: string;
    subject: string;
    body: string;
    metadata?: any;
  } | null>(savedEmail ?? null);
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);

  // Document preview state
  const [previewDocIndex, setPreviewDocIndex] = useState<number | null>(null);
  const previewDoc = previewDocIndex !== null ? documents[previewDocIndex] : null;

  // Year-first navigation: year is the primary selector
  const availableYears = Object.keys(blueprint?.year_summaries || {}).sort((a, b) => Number(b) - Number(a));
  const [selectedYear, setSelectedYear] = useState<string | null>(availableYears[0] || null);
  const [activeYearTab, setActiveYearTab] = useState("bank");

  // Per-person view: null = household view, string = specific person id
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  // Extract data from blueprint
  const taxYears = dossier.taxYears || [];
  const hasFiscalPartner = blueprint?.fiscal_entity?.fiscal_partner?.has_partner || false;
  const validationFlags = blueprint?.validation_flags || [];
  const sourceDocsRegistry = blueprint?.source_documents_registry || [];

  // Compute sidebar data (next step, missing items, profitability)
  const sidebarData = useMemo(() => {
    if (!blueprint) {
      return {
        nextStep: { action: 'Valideren', description: 'Valideer de documenten om te starten' },
        allMissingItems: [],
        isProfitable: false,
        totalRefund: 0,
      };
    }

    const yearSummaries = blueprint.year_summaries || {};
    const years = Object.keys(yearSummaries).sort();
    const hasPartner = blueprint.fiscal_entity?.fiscal_partner?.has_partner || false;

    // Overall totals
    const totalRefund = years.reduce((sum, year) => {
      const refund = yearSummaries[year]?.calculated_totals?.indicative_refund;
      return sum + (typeof refund === 'number' ? refund : 0);
    }, 0);
    const profitableYears = years.filter(y => yearSummaries[y]?.calculated_totals?.is_profitable);
    const incompleteYears = years.filter(y => yearSummaries[y]?.status === 'incomplete');
    const isProfitable = totalRefund > 0 || profitableYears.length > 0;
    const isComplete = incompleteYears.length === 0 && years.length > 0;

    // Collect ALL missing items across all years
    const allMissingItems: { year: string; description: string }[] = [];
    years.forEach(year => {
      const missing = yearSummaries[year]?.missing_items || [];
      missing.forEach((item: string | { description: string }) => {
        const description = typeof item === 'string' ? item : item.description;
        allMissingItems.push({ year, description });
      });
    });

    // Additional check: even if no missing_items from pipeline, check if actual return data is missing
    // This catches cases where assets exist but return data (interest/dividend/gains) is 0
    const hasMissingReturnData = years.some(year => {
      const actualReturn = yearSummaries[year]?.calculated_totals?.actual_return;
      const totalAssets = yearSummaries[year]?.calculated_totals?.total_assets_jan_1 || 0;

      // If we have significant assets but no actual return data, something is missing
      if (totalAssets > 10000) {
        const totalActualReturn = (actualReturn?.bank_interest || 0) +
                                  (actualReturn?.dividends || 0) +
                                  (actualReturn?.investment_gain || 0) +
                                  (actualReturn?.rental_income_net || 0);
        // If actual return is exactly 0 on significant assets, likely missing data
        return totalActualReturn === 0;
      }
      return false;
    });

    // Determine next step
    let nextStep = { action: '', description: '' };

    if (allMissingItems.length > 0 || hasMissingReturnData) {
      const itemCount = allMissingItems.length || (hasMissingReturnData ? 1 : 0);
      nextStep = {
        action: 'Documenten opvragen',
        description: hasMissingReturnData && allMissingItems.length === 0
          ? 'Jaaroverzichten nodig om werkelijk rendement te bepalen (rente, dividend, koerswinst)'
          : `${itemCount} document(en) nodig om volledig te kunnen beoordelen`,
      };
    } else if (isProfitable) {
      const numBezwaren = hasPartner ? 2 : 1;
      nextStep = {
        action: 'Bezwaar indienen',
        description: hasPartner
          ? `${numBezwaren} bezwaarschriften opstellen (per aanslag)`
          : 'Bezwaarschrift opstellen',
      };
    } else if (!isComplete) {
      nextStep = {
        action: 'Aanvullende info nodig',
        description: 'Wacht op meer gegevens van de klant',
      };
    } else {
      nextStep = {
        action: 'Afsluiten',
        description: 'Geen teruggave mogelijk op basis van huidige gegevens',
      };
    }

    return { nextStep, allMissingItems, isProfitable, totalRefund, hasMissingReturnData };
  }, [blueprint]);

  // File handling with compression
  const compressionOptions = {
    maxSizeMB: 1,
    maxWidthOrHeight: 2048,
    useWebWorker: true,
  };

  // Generate follow-up email based on dossier status
  const handleGenerateEmail = useCallback(async () => {
    setIsGeneratingEmail(true);
    try {
      const response = await fetch(`/api/box3-validator/dossiers/${dossier.id}/generate-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailType: 'auto' }),
      });

      if (!response.ok) {
        throw new Error('Kon email niet genereren');
      }

      const result = await response.json();
      setGeneratedEmail(result.data);
    } catch (error) {
      toast({
        title: 'Fout',
        description: 'Kon email niet genereren. Probeer het opnieuw.',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingEmail(false);
    }
  }, [dossier.id, toast]);

  // Auto-generate email only when:
  // 1. Blueprint exists and has no saved email yet
  // 2. Not currently generating or revalidating
  useEffect(() => {
    if (
      blueprint &&
      blueprintVersion > 0 &&
      !savedEmail &&
      !generatedEmail &&
      !isGeneratingEmail &&
      !isRevalidating
    ) {
      handleGenerateEmail();
    }
  }, [blueprint, blueprintVersion, savedEmail, generatedEmail, isGeneratingEmail, isRevalidating, handleGenerateEmail]);

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

  // Build preview URL using the download endpoint
  const getPreviewUrl = (doc: typeof previewDoc) => {
    if (!doc) return null;
    return `/api/box3-validator/documents/${doc.id}/download`;
  };

  const isImageFile = (mimeType: string) =>
    mimeType.startsWith('image/');

  const isPdfFile = (mimeType: string) =>
    mimeType === 'application/pdf';

  return (
    <>
      {/* Modals - outside the grid */}
      {/* Document Preview Modal */}
      <Dialog open={previewDocIndex !== null} onOpenChange={(open) => !open && setPreviewDocIndex(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden">
          {previewDoc && (
            <>
              <DialogHeader className="px-4 py-3 border-b bg-muted/30">
                <div className="flex items-center justify-between">
                  <DialogTitle className="text-base font-medium truncate pr-4">
                    {previewDoc.filename}
                  </DialogTitle>
                  <div className="flex items-center gap-2">
                    {/* Navigation */}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={previewDocIndex === 0}
                      onClick={() => setPreviewDocIndex((i) => i !== null && i > 0 ? i - 1 : i)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {(previewDocIndex ?? 0) + 1} / {documents.length}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={previewDocIndex === documents.length - 1}
                      onClick={() => setPreviewDocIndex((i) => i !== null && i < documents.length - 1 ? i + 1 : i)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    {/* Download */}
                    <a
                      href={getPreviewUrl(previewDoc) || '#'}
                      download={previewDoc.filename}
                      className="inline-flex"
                    >
                      <Button variant="ghost" size="sm">
                        <Download className="h-4 w-4" />
                      </Button>
                    </a>
                  </div>
                </div>
              </DialogHeader>
              <div className="overflow-auto max-h-[calc(90vh-60px)] bg-muted/10">
                {isImageFile(previewDoc.mimeType) ? (
                  <img
                    src={getPreviewUrl(previewDoc) || ''}
                    alt={previewDoc.filename}
                    className="w-full h-auto"
                  />
                ) : isPdfFile(previewDoc.mimeType) ? (
                  <iframe
                    src={getPreviewUrl(previewDoc) || ''}
                    className="w-full h-[80vh]"
                    title={previewDoc.filename}
                  />
                ) : (
                  <div className="flex items-center justify-center h-64 text-muted-foreground">
                    <div className="text-center">
                      <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>Preview niet beschikbaar voor dit bestandstype</p>
                      <p className="text-sm">{previewDoc.mimeType}</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Email Preview Modal */}
      <Dialog open={showEmailPreview} onOpenChange={setShowEmailPreview}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Gegenereerde email
              {generatedEmail && (
                <Badge variant={
                  generatedEmail.emailType === 'profitable' ? 'default' :
                  generatedEmail.emailType === 'request_docs' ? 'secondary' : 'outline'
                } className={
                  generatedEmail.emailType === 'profitable' ? 'bg-green-600' :
                  generatedEmail.emailType === 'request_docs' ? 'bg-amber-500' : ''
                }>
                  {generatedEmail.emailType === 'profitable' ? 'Kansrijk' :
                   generatedEmail.emailType === 'request_docs' ? 'Docs nodig' : 'Niet kansrijk'}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {generatedEmail && (
            <div className="space-y-4">
              {/* Subject */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Onderwerp</label>
                <div className="p-2 bg-muted rounded-md text-sm font-medium">
                  {generatedEmail.subject}
                </div>
              </div>

              {/* Body */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Inhoud</label>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        generatedEmail.subject + '\n\n' +
                        generatedEmail.body.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
                      );
                      toast({ title: 'Gekopieerd', description: 'Email inhoud gekopieerd naar klembord' });
                    }}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Kopieer email"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <div
                  className="p-4 bg-white border rounded-md text-sm prose prose-sm max-h-[400px] overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: generatedEmail.body }}
                />
              </div>

              {/* Metadata */}
              {generatedEmail.metadata && (
                <div className="p-3 bg-muted/50 rounded-md text-xs text-muted-foreground">
                  <div className="flex flex-wrap gap-4">
                    <span>Jaren: {generatedEmail.metadata.yearRange}</span>
                    <span>Indicatieve teruggave: €{generatedEmail.metadata.totalIndicativeRefund?.toFixed(2)}</span>
                    <span>Min. winstgevend: €{generatedEmail.metadata.minimumProfitableAmount}</span>
                  </div>
                </div>
              )}

            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Main content */}
      <div className="space-y-4">
        {/* Minimal Back Button */}
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Terug naar overzicht
        </button>

        {/* Modern Header Card */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-start justify-between">
            {/* Left: Client info */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                  <User className="h-5 w-5 text-slate-600" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-foreground">
                    {dossier.clientName || "Onbekende klant"}
                  </h1>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge className={getStatusColor(dossier.status)} variant="secondary">
                      {getStatusLabel(dossier.status)}
                    </Badge>
                    {taxYears.length > 0 && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {taxYears.length === 1
                          ? taxYears[0]
                          : `${taxYears[0]}-${taxYears[taxYears.length - 1]}`}
                      </span>
                    )}
                    {hasFiscalPartner && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        Fiscaal partner
                      </span>
                    )}
                    {blueprintVersion > 0 && (
                      <span className="text-xs text-muted-foreground">
                        v{blueprintVersion}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setShowAddDocs(!showAddDocs)}
                variant="outline"
                size="sm"
                disabled={isAddingDocs}
                className="h-9"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Document toevoegen
              </Button>
              <Button
                onClick={onRevalidate}
                size="sm"
                disabled={isRevalidating || isAddingDocs}
                className="h-9"
              >
                <RefreshCw className={`h-4 w-4 mr-1.5 ${isRevalidating ? 'animate-spin' : ''}`} />
                Opnieuw valideren
              </Button>
            </div>
          </div>

          {/* Pipeline Progress Indicator */}
          {isRevalidating && pipelineProgress && (
            <div className="mt-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-lg">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="w-12 h-12 rounded-full border-4 border-blue-200 flex items-center justify-center">
                    <RefreshCw className="h-5 w-5 text-blue-600 animate-spin" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 bg-blue-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    {pipelineProgress.step}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-blue-900">
                      Stap {pipelineProgress.step} van {pipelineProgress.totalSteps}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                        {pipelineProgress.phase}
                      </span>
                      {activeJobId && onCancelRevalidation && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={onCancelRevalidation}
                        >
                          Annuleren
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-blue-800">{pipelineProgress.message}</p>
                  {activeJobId && (
                    <p className="text-xs text-blue-600 mt-1">
                      Achtergrondverwerking - je kan de browser sluiten
                    </p>
                  )}
                  <div className="mt-2 h-2 bg-blue-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all duration-500 ease-out"
                      style={{ width: `${(pipelineProgress.step / pipelineProgress.totalSteps) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                {[1, 2, 3, 4, 5].map((step) => (
                  <div
                    key={step}
                    className={`flex-1 text-center text-xs py-1 rounded ${
                      step < pipelineProgress.step
                        ? 'bg-blue-600 text-white'
                        : step === pipelineProgress.step
                          ? 'bg-blue-400 text-white animate-pulse'
                          : 'bg-blue-100 text-blue-400'
                    }`}
                  >
                    {step === 1 && 'Classificatie'}
                    {step === 2 && 'Aangifte'}
                    {step === 3 && 'Vermogen'}
                    {step === 4 && 'Combineren'}
                    {step === 5 && 'Validatie'}
                  </div>
                ))}
              </div>
            </div>
          )}

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
                        <div
                          key={doc.id}
                          className="px-3 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer group"
                          onClick={() => setPreviewDocIndex(docIndex)}
                        >
                          {/* Main row */}
                          <div className="flex items-center gap-3">
                            {/* Icon */}
                            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />

                            {/* Filename */}
                            <span className="text-sm truncate min-w-0 flex-shrink group-hover:text-primary" title={doc.filename}>
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

                            {/* Preview button - visible on hover */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 p-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewDocIndex(docIndex);
                              }}
                              title="Preview"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
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
        </div>

      {/* Year-First Navigation Structure */}
      {blueprint && (
        <div className="space-y-6">
          {/* HERO SECTION: Verdict + Next Steps */}
          {(() => {
            const yearSummaries = blueprint.year_summaries || {};
            const taxAuthData = blueprint.tax_authority_data || {};
            const years = Object.keys(yearSummaries).sort();

            // Get fiscal entity info
            const taxpayer = blueprint.fiscal_entity?.taxpayer;
            const partner = blueprint.fiscal_entity?.fiscal_partner;
            const hasPartner = partner?.has_partner || false;

            // Calculate per-person totals across all years
            // We'll estimate indicative refund per person based on their tax_assessed and allocation
            type PersonSummary = {
              id: string;
              name: string;
              totalTaxAssessed: number;
              totalIndicativeRefund: number;
              yearBreakdown: Record<string, { taxAssessed: number; allocation: number; refund: number }>;
              isProfitable: boolean;
            };

            const personSummaries: PersonSummary[] = [];

            // Calculate for taxpayer
            if (taxpayer) {
              const tpSummary: PersonSummary = {
                id: taxpayer.id || 'tp_01',
                name: taxpayer.name || 'Belastingplichtige',
                totalTaxAssessed: 0,
                totalIndicativeRefund: 0,
                yearBreakdown: {},
                isProfitable: false,
              };

              years.forEach(year => {
                const yearTax = taxAuthData[year]?.per_person?.[taxpayer.id || 'tp_01'];
                const yearSummary = yearSummaries[year];
                const totalRefund = yearSummary?.calculated_totals?.indicative_refund || 0;

                // Always calculate, even if no per_person data
                // Default allocation: 50% if partner, 100% if single
                const defaultAllocation = hasPartner ? 50 : 100;
                const allocation = yearTax?.allocation_percentage || defaultAllocation;
                const personRefund = totalRefund * (allocation / 100);

                tpSummary.totalTaxAssessed += yearTax?.tax_assessed || 0;
                tpSummary.totalIndicativeRefund += personRefund;
                tpSummary.yearBreakdown[year] = {
                  taxAssessed: yearTax?.tax_assessed || 0,
                  allocation: allocation,
                  refund: personRefund,
                };
              });
              tpSummary.isProfitable = tpSummary.totalIndicativeRefund > 0;
              personSummaries.push(tpSummary);
            }

            // Calculate for partner if exists
            if (hasPartner && partner) {
              const fpId = partner.id || 'fp_01';
              const fpSummary: PersonSummary = {
                id: fpId,
                name: partner.name || 'Fiscaal partner',
                totalTaxAssessed: 0,
                totalIndicativeRefund: 0,
                yearBreakdown: {},
                isProfitable: false,
              };

              years.forEach(year => {
                const yearTax = taxAuthData[year]?.per_person?.[fpId];
                const yearSummary = yearSummaries[year];
                const totalRefund = yearSummary?.calculated_totals?.indicative_refund || 0;

                // Always calculate, even if no per_person data
                // Default allocation for partner: 50%
                const allocation = yearTax?.allocation_percentage || 50;
                const personRefund = totalRefund * (allocation / 100);

                fpSummary.totalTaxAssessed += yearTax?.tax_assessed || 0;
                fpSummary.totalIndicativeRefund += personRefund;
                fpSummary.yearBreakdown[year] = {
                  taxAssessed: yearTax?.tax_assessed || 0,
                  allocation: allocation,
                  refund: personRefund,
                };
              });
              fpSummary.isProfitable = fpSummary.totalIndicativeRefund > 0;
              personSummaries.push(fpSummary);
            }

            // Overall totals
            const totalRefund = years.reduce((sum, year) => {
              const refund = yearSummaries[year]?.calculated_totals?.indicative_refund;
              return sum + (typeof refund === 'number' ? refund : 0);
            }, 0);
            const profitableYears = years.filter(y => yearSummaries[y]?.calculated_totals?.is_profitable);
            const incompleteYears = years.filter(y => yearSummaries[y]?.status === 'incomplete');

            // Calculate estimated refund per year (same logic as breakdown)
            // This ensures consistency between summary bar and breakdown section
            const bankSavings = blueprint.assets?.bank_savings || [];
            let hasUnknownInterest = false;
            let estimatedRefund = 0;

            years.forEach(year => {
              const savingsRate = BOX3_CONSTANTS.AVERAGE_SAVINGS_RATES[year] || 0.001;
              const taxRate = BOX3_CONSTANTS.TAX_RATES[year] || 0.31;
              const yearSummary = yearSummaries[year];
              const calc = yearSummary?.calculated_totals;
              const deemedReturn = calc?.deemed_return_from_tax_authority || 0;
              const actualReturn = calc?.actual_return?.total || 0;
              const yearRefund = calc?.indicative_refund || 0;

              // Calculate estimated interest for this year
              let yearEstimatedInterest = 0;
              let yearHasUnknown = false;

              bankSavings.forEach(asset => {
                const yearData = asset.yearly_data?.[year];
                if (!yearData) return;

                const interestField = yearData.interest_received;
                const hasInterest = interestField != null &&
                  (typeof interestField === 'number' ? interestField > 0 :
                   typeof interestField === 'object' && interestField.amount != null);

                if (!hasInterest) {
                  yearHasUnknown = true;
                  hasUnknownInterest = true;
                  const balance = typeof yearData.value_jan_1 === 'number' ? yearData.value_jan_1 :
                    typeof yearData.value_jan_1 === 'object' ? yearData.value_jan_1?.amount :
                    typeof (yearData as any).balance_jan1 === 'number' ? (yearData as any).balance_jan1 : 0;

                  if (balance && balance > 0) {
                    yearEstimatedInterest += balance * savingsRate;
                  }
                }
              });

              // Calculate this year's estimated refund using same formula as breakdown
              if (yearHasUnknown) {
                const estimatedActualReturn = actualReturn + yearEstimatedInterest;
                const estimatedDifference = deemedReturn - estimatedActualReturn;
                const yearEstimatedRefund = Math.max(0, estimatedDifference * taxRate);
                estimatedRefund += yearEstimatedRefund;
              } else {
                estimatedRefund += yearRefund;
              }
            });

            // Calculate costs: €250 per year
            const costPerYear = 250; // BOX3_CONSTANTS.COST_PER_YEAR
            const totalCost = years.length * costPerYear;
            const netRefund = totalRefund - totalCost;
            const netEstimatedRefund = estimatedRefund - totalCost;

            const isProfitable = netRefund > 0 || profitableYears.length > 0;
            const isComplete = incompleteYears.length === 0 && years.length > 0;

            // Collect ALL missing items across all years
            const allMissingItems: { year: string; description: string }[] = [];
            years.forEach(year => {
              const missing = yearSummaries[year]?.missing_items || [];
              missing.forEach(item => {
                // Handle both string items and object items with description field
                const description = typeof item === 'string' ? item : item.description;
                allMissingItems.push({ year, description });
              });
            });

            // Determine next step
            let nextStep = {
              action: '',
              description: '',
              buttonLabel: '',
              buttonAction: null as (() => void) | null,
            };

            if (allMissingItems.length > 0) {
              nextStep = {
                action: 'Documenten opvragen',
                description: `${allMissingItems.length} document(en) nodig om volledig te kunnen beoordelen`,
                buttonLabel: 'Bekijk ontbrekende docs',
                buttonAction: null,
              };
            } else if (isProfitable) {
              // Box 3 bezwaar is per aanslag = per persoon
              const numBezwaren = hasPartner ? 2 : 1;
              nextStep = {
                action: 'Bezwaar indienen',
                description: hasPartner
                  ? `${numBezwaren} bezwaarschriften opstellen (per aanslag)`
                  : 'Bezwaarschrift opstellen',
                buttonLabel: 'Genereer bezwaar',
                buttonAction: null,
              };
            } else if (!isComplete) {
              nextStep = {
                action: 'Aanvullende info nodig',
                description: 'Wacht op meer gegevens van de klant',
                buttonLabel: 'Stuur herinnering',
                buttonAction: null,
              };
            } else {
              nextStep = {
                action: 'Afsluiten',
                description: 'Geen teruggave mogelijk op basis van huidige gegevens',
                buttonLabel: 'Informeer klant',
                buttonAction: null,
              };
            }

            // Get missing items for selected year only
            const selectedYearMissingItems = selectedYear
              ? (yearSummaries[selectedYear]?.missing_items || []).map(item => ({
                  year: selectedYear,
                  description: typeof item === 'string' ? item : item.description,
                }))
              : [];

            // Status determination: missing docs takes priority over profitability
            const hasMissingDocs = allMissingItems.length > 0;
            const incompleteYearsCount = years.filter(y => (yearSummaries[y]?.missing_items || []).length > 0).length;
            // Consistent status label: "Docs nodig" when incomplete, shows which years
            const statusLabel = hasMissingDocs
              ? `Docs nodig`
              : isProfitable ? 'Kansrijk' : 'Niet kansrijk';
            const statusColor = hasMissingDocs ? 'bg-amber-100 text-amber-700' : isProfitable ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600';
            const StatusIcon = hasMissingDocs ? AlertTriangle : isProfitable ? CheckCircle2 : Info;

            return (
              <div className="space-y-3">
                {/* Modern Summary Bar */}
                <div className="flex flex-wrap items-center gap-3 p-3 bg-white rounded-lg border shadow-sm">
                  {/* Status Pill */}
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-sm font-medium ${statusColor}`}>
                    <StatusIcon className="h-4 w-4" />
                    {statusLabel}
                    {hasMissingDocs
                      ? <span className="text-xs opacity-70">({incompleteYearsCount} jaar)</span>
                      : <span className="text-xs opacity-70">({profitableYears.length}/{years.length})</span>
                    }
                  </div>

                  <div className="h-6 w-px bg-border" />

                  {/* Total Refund with costs breakdown */}
                  <div className="flex items-center gap-4">
                    {/* Gross refund - show estimated if we have unknown interest */}
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">
                        {hasMissingDocs ? (hasUnknownInterest ? 'Geschat' : 'Max.') : 'Teruggave'}
                      </span>
                      <CopyableCurrency
                        value={hasUnknownInterest ? estimatedRefund : totalRefund}
                        className={`text-xl font-bold tracking-tight ${(hasUnknownInterest ? estimatedRefund : totalRefund) > 0 ? 'text-green-600' : 'text-muted-foreground'}`}
                      />
                      {hasUnknownInterest && hasMissingDocs && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <Info className="h-3.5 w-3.5 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs">
                              <p className="text-xs">
                                <strong>Max: {formatCurrency(totalRefund)}</strong><br />
                                Geschat op basis van gemiddelde spaarrentes.
                                Werkelijke teruggave kan hoger of lager zijn.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>

                    {/* Costs */}
                    {years.length > 0 && (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs text-muted-foreground">−</span>
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">
                          Kosten
                        </span>
                        <span className="text-sm font-medium text-gray-600">
                          €{totalCost.toLocaleString('nl-NL')}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({years.length}×€{costPerYear})
                        </span>
                      </div>
                    )}

                    {/* Net refund */}
                    {years.length > 0 && (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs text-muted-foreground">=</span>
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">
                          Netto
                        </span>
                        <CopyableCurrency
                          value={hasUnknownInterest ? netEstimatedRefund : netRefund}
                          className={`text-2xl font-bold tracking-tight ${(hasUnknownInterest ? netEstimatedRefund : netRefund) > 0 ? 'text-green-600' : 'text-red-500'}`}
                        />
                      </div>
                    )}
                  </div>

                  {/* Per person split */}
                  {hasPartner && personSummaries.length > 1 && (
                    <>
                      <div className="h-6 w-px bg-border" />
                      <div className="flex items-center gap-3 text-sm">
                        {personSummaries.map((person) => {
                          // Show first name, with full name on hover
                          const firstName = person.name.split(' ')[0];
                          return (
                            <div key={person.id} className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground" title={person.name}>
                                {firstName}:
                              </span>
                              <CopyableCurrency
                                value={person.totalIndicativeRefund}
                                className={`font-semibold ${person.isProfitable ? 'text-green-600' : 'text-muted-foreground'}`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                </div>

                {/* Calculation Breakdown - Collapsible */}
                {totalRefund > 0 && (
                  <details className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl overflow-hidden">
                    <summary className="p-4 cursor-pointer hover:bg-green-100/50 transition-colors flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-green-800">Hoe komt deze teruggave tot stand?</span>
                      <ChevronDown className="h-4 w-4 text-green-600 ml-auto" />
                    </summary>
                    <div className="p-4 pt-0 space-y-4">
                      {/* Formula explanation */}
                      <div className="bg-white/60 rounded-lg p-3 text-sm">
                        <p className="text-gray-700 mb-2">
                          <strong>Formule:</strong> (Forfaitair rendement − Werkelijk rendement) × Box 3 belastingtarief
                        </p>
                        <p className="text-gray-600 text-xs">
                          Als het werkelijke rendement lager is dan het forfaitaire rendement waarmee de Belastingdienst
                          rekent, kan een deel van de eerder betaalde Box 3 belasting worden teruggevraagd.
                        </p>
                      </div>

                      {/* Per year breakdown */}
                      <div className="space-y-3">
                        {years.map(year => {
                          const summary = yearSummaries[year];
                          const calc = summary?.calculated_totals;
                          if (!calc) return null;

                          const actualReturn = calc.actual_return;
                          const deemedReturn = calc.deemed_return_from_tax_authority;
                          const yearRefund = calc.indicative_refund;
                          const yearMissing = summary?.missing_items || [];
                          const hasMissingIncome = yearMissing.some(item =>
                            typeof item !== 'string' && (
                              item.field?.includes('interest') ||
                              item.field?.includes('dividend') ||
                              item.field?.includes('rental') ||
                              item.description?.toLowerCase().includes('rente') ||
                              item.description?.toLowerCase().includes('jaaroverzicht')
                            )
                          );

                          // Pre-calculate estimated refund for header
                          const savingsRateForHeader = BOX3_CONSTANTS.AVERAGE_SAVINGS_RATES[year] || 0.001;
                          const taxRateForHeader = BOX3_CONSTANTS.TAX_RATES[year] || 0.31;
                          let yearEstInterestForHeader = 0;
                          let yearHasUnknownForHeader = false;
                          (blueprint.assets?.bank_savings || []).forEach(asset => {
                            const assetYearData = asset.yearly_data?.[year];
                            if (!assetYearData) return;
                            const interestField = assetYearData.interest_received;
                            const hasInterest = interestField != null &&
                              (typeof interestField === 'number' ? interestField > 0 :
                               typeof interestField === 'object' && interestField.amount != null);
                            if (!hasInterest) {
                              yearHasUnknownForHeader = true;
                              const balance = typeof assetYearData.value_jan_1 === 'number' ? assetYearData.value_jan_1 :
                                typeof assetYearData.value_jan_1 === 'object' ? assetYearData.value_jan_1?.amount :
                                typeof (assetYearData as any).balance_jan1 === 'number' ? (assetYearData as any).balance_jan1 : 0;
                              if (balance && balance > 0) {
                                yearEstInterestForHeader += balance * savingsRateForHeader;
                              }
                            }
                          });
                          const estimatedActualReturnForHeader = (actualReturn?.total || 0) + yearEstInterestForHeader;
                          const estimatedDiffForHeader = deemedReturn - estimatedActualReturnForHeader;
                          const yearEstRefundForHeader = yearHasUnknownForHeader ? Math.max(0, estimatedDiffForHeader * taxRateForHeader) : yearRefund;

                          return (
                            <div key={year} className="bg-white rounded-lg p-3 border border-green-100">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-semibold text-gray-800">{year}</span>
                                <span className={`font-bold ${yearEstRefundForHeader > 0 ? 'text-green-600' : 'text-gray-500'}`}>
                                  {yearHasUnknownForHeader && '~'}{yearEstRefundForHeader > 0 ? '+' : ''}{formatCurrency(yearEstRefundForHeader)}
                                </span>
                              </div>

                              {/* Calculation steps */}
                              {(() => {
                                // Calculate estimated interest for this year
                                const savingsRate = BOX3_CONSTANTS.AVERAGE_SAVINGS_RATES[year] || 0.001;
                                const taxRate = BOX3_CONSTANTS.TAX_RATES[year] || 0.31;
                                const bankCount = blueprint.assets?.bank_savings?.length || 0;
                                const invCount = blueprint.assets?.investments?.length || 0;
                                const reCount = blueprint.assets?.real_estate?.length || 0;
                                const bankInterest = actualReturn?.bank_interest || 0;
                                const dividends = actualReturn?.dividends || 0;
                                const realizedGains = actualReturn?.investment_gain || 0;
                                const rentalNet = actualReturn?.rental_income_net || 0;

                                // Calculate estimated bank interest for this year
                                let yearEstimatedInterest = 0;
                                let yearHasUnknownInterest = false;
                                (blueprint.assets?.bank_savings || []).forEach(asset => {
                                  const assetYearData = asset.yearly_data?.[year];
                                  if (!assetYearData) return;
                                  const interestField = assetYearData.interest_received;
                                  const hasInterest = interestField != null &&
                                    (typeof interestField === 'number' ? interestField > 0 :
                                     typeof interestField === 'object' && interestField.amount != null);
                                  if (!hasInterest) {
                                    yearHasUnknownInterest = true;
                                    const balance = typeof assetYearData.value_jan_1 === 'number' ? assetYearData.value_jan_1 :
                                      typeof assetYearData.value_jan_1 === 'object' ? assetYearData.value_jan_1?.amount :
                                      typeof (assetYearData as any).balance_jan1 === 'number' ? (assetYearData as any).balance_jan1 : 0;
                                    if (balance && balance > 0) {
                                      yearEstimatedInterest += balance * savingsRate;
                                    }
                                  }
                                });

                                // Calculate estimated actual return and refund
                                const estimatedActualReturn = (actualReturn?.total || 0) + yearEstimatedInterest;
                                const estimatedDifference = deemedReturn - estimatedActualReturn;
                                const yearEstimatedRefund = Math.max(0, estimatedDifference * taxRate);

                                return (
                              <div className="space-y-1 text-sm">
                                <div className="flex justify-between text-gray-600">
                                  <span>Forfaitair rendement (Belastingdienst)</span>
                                  <span className="font-medium text-red-600">{formatCurrency(deemedReturn)}</span>
                                </div>
                                <div className="flex justify-between text-gray-600">
                                  <span>Werkelijk rendement {yearHasUnknownInterest && <span className="text-amber-600 text-xs">(incl. schatting)</span>}</span>
                                  <span className={`font-medium ${yearHasUnknownInterest ? 'text-amber-600' : 'text-green-600'}`}>
                                    {formatCurrency(yearHasUnknownInterest ? estimatedActualReturn : (actualReturn?.total || 0))}
                                  </span>
                                </div>

                                {/* Actual return breakdown - always show to clarify what's missing */}
                                {(bankCount > 0 || invCount > 0 || reCount > 0) && (
                                    <div className="ml-4 text-xs space-y-0.5">
                                      {/* Bank interest - show even if 0 when we have banks */}
                                      {bankCount > 0 && (
                                        <div className="flex justify-between">
                                          <span className={bankInterest === 0 ? 'text-amber-600' : 'text-gray-500'}>
                                            └ Bankrente {bankInterest === 0 && yearHasUnknownInterest && <span className="text-amber-500">(geschat ~{formatCurrency(yearEstimatedInterest)})</span>}
                                            {bankInterest === 0 && !yearHasUnknownInterest && <span className="text-amber-500">(ontbreekt)</span>}
                                          </span>
                                          <span className={bankInterest === 0 ? 'text-amber-600' : 'text-gray-500'}>
                                            {bankInterest > 0 ? formatCurrency(bankInterest) : (yearHasUnknownInterest ? `~${formatCurrency(yearEstimatedInterest)}` : formatCurrency(0))}
                                          </span>
                                        </div>
                                      )}
                                      {/* Dividends - show even if 0 when we have investments */}
                                      {invCount > 0 && (
                                        <div className="flex justify-between">
                                          <span className={dividends === 0 ? 'text-amber-600' : 'text-gray-500'}>
                                            └ Dividend {dividends === 0 && <span className="text-amber-500">(ontbreekt)</span>}
                                          </span>
                                          <span className={dividends === 0 ? 'text-amber-600' : 'text-gray-500'}>
                                            {formatCurrency(dividends)}
                                          </span>
                                        </div>
                                      )}
                                      {/* Realized gains - show even if 0 when we have investments */}
                                      {invCount > 0 && (
                                        <div className="flex justify-between">
                                          <span className={realizedGains === 0 ? 'text-amber-600' : 'text-gray-500'}>
                                            └ Koerswinst {realizedGains === 0 && <span className="text-amber-500">(ontbreekt)</span>}
                                          </span>
                                          <span className={realizedGains === 0 ? 'text-amber-600' : 'text-gray-500'}>
                                            {formatCurrency(realizedGains)}
                                          </span>
                                        </div>
                                      )}
                                      {/* Rental income - show even if 0 when we have real estate */}
                                      {reCount > 0 && (
                                        <div className="flex justify-between">
                                          <span className={rentalNet === 0 ? 'text-amber-600' : 'text-gray-500'}>
                                            └ Huurinkomsten {rentalNet === 0 && <span className="text-amber-500">(ontbreekt)</span>}
                                          </span>
                                          <span className={rentalNet === 0 ? 'text-amber-600' : 'text-gray-500'}>
                                            {formatCurrency(rentalNet)}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                )}

                                <div className="flex justify-between text-gray-600 border-t border-dashed pt-1 mt-1">
                                  <span>Verschil</span>
                                  <span className="font-medium">{formatCurrency(yearHasUnknownInterest ? estimatedDifference : calc.difference)}</span>
                                </div>
                                <div className="flex justify-between text-gray-600">
                                  <span>× {(taxRate * 100).toFixed(0)}% belastingtarief</span>
                                  <span className="font-bold text-green-600">{formatCurrency(yearHasUnknownInterest ? yearEstimatedRefund : yearRefund)}</span>
                                </div>
                              </div>
                                );
                              })()}

                              {/* Warning if income data missing or suspiciously low */}
                              {(() => {
                                // Check what's missing
                                const bankInterest = actualReturn?.bank_interest || 0;
                                const dividends = actualReturn?.dividends || 0;
                                const realizedGains = actualReturn?.investment_gain || 0;
                                const rentalNet = actualReturn?.rental_income_net || 0;
                                const totalAssets = calc.total_assets_jan_1 || 0;

                                // Calculate expected minimum return (0.5% is conservative)
                                const expectedMinReturn = totalAssets * 0.005;
                                const actualTotal = actualReturn?.total || 0;

                                // Missing items analysis
                                const missingItems: string[] = [];

                                // If we have bank accounts but no interest
                                const bankCount = blueprint.assets?.bank_savings?.length || 0;
                                if (bankCount > 0 && bankInterest === 0) {
                                  missingItems.push('bankrente');
                                }

                                // If we have investments but no dividends or realized gains
                                const invCount = blueprint.assets?.investments?.length || 0;
                                if (invCount > 0 && dividends === 0) {
                                  missingItems.push('dividend');
                                }
                                if (invCount > 0 && realizedGains === 0) {
                                  missingItems.push('koerswinst');
                                }

                                // If we have real estate but no rental income
                                const reCount = blueprint.assets?.real_estate?.length || 0;
                                if (reCount > 0 && rentalNet === 0) {
                                  missingItems.push('huurinkomsten');
                                }

                                // Show warning if there are known missing items OR if return seems too low
                                const showWarning = hasMissingIncome || missingItems.length > 0 ||
                                  (totalAssets > 10000 && actualTotal < expectedMinReturn);

                                if (!showWarning) return null;

                                return (
                                  <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded p-2">
                                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                                    <div>
                                      <span className="font-medium">Werkelijk rendement onvolledig</span>
                                      {missingItems.length > 0 && (
                                        <span> — ontbreekt: {missingItems.join(', ')}</span>
                                      )}
                                      <p className="mt-1 text-amber-600">
                                        Upload jaaroverzichten van banken/brokers om de exacte rente en dividend toe te voegen.
                                        Dit verhoogt mogelijk de teruggave.
                                      </p>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>

                      {/* Total summary */}
                      <div className="bg-green-100/50 rounded-lg p-3 flex justify-between items-center">
                        <span className="font-medium text-green-800">
                          {hasUnknownInterest ? 'Geschatte teruggave' : 'Totale indicatieve teruggave'}
                        </span>
                        <span className="text-xl font-bold text-green-700">
                          {hasUnknownInterest && '~'}{formatCurrency(hasUnknownInterest ? estimatedRefund : totalRefund)}
                        </span>
                      </div>

                      {/* Per person split if partner */}
                      {hasPartner && personSummaries.length > 1 && (
                        <div className="text-xs text-gray-600 bg-white/60 rounded-lg p-3">
                          <p className="font-medium mb-2">Verdeling per persoon:</p>
                          <div className="space-y-1">
                            {personSummaries.map(person => {
                              // Calculate allocation percentage
                              const totalAllocation = Object.values(person.yearBreakdown).reduce(
                                (sum, yb) => sum + yb.allocation, 0
                              );
                              const avgAllocation = years.length > 0
                                ? (totalAllocation / years.length).toFixed(0)
                                : '50';

                              return (
                                <div key={person.id} className="flex justify-between">
                                  <span>{person.name} ({avgAllocation}% toerekening)</span>
                                  <span className="font-medium">{formatCurrency(person.totalIndicativeRefund)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Disclaimer */}
                      <p className="text-xs text-gray-500 italic">
                        Let op: dit is een indicatieve berekening. De definitieve teruggave wordt vastgesteld door de Belastingdienst.
                      </p>
                    </div>
                  </details>
                )}

                {/* Action Cards: Next Best Action + Email */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Box3ActionCards
                    dossier={dossier}
                    nextStep={sidebarData.nextStep}
                    missingItems={sidebarData.allMissingItems}
                    isProfitable={sidebarData.isProfitable}
                    totalRefund={sidebarData.totalRefund}
                    hasMissingReturnData={sidebarData.hasMissingReturnData}
                    onGenerateEmail={handleGenerateEmail}
                    isGeneratingEmail={isGeneratingEmail}
                    generatedEmail={generatedEmail}
                    onShowEmailPreview={() => setShowEmailPreview(true)}
                  />
                </div>

                {/* Year Tabs - Minimal horizontal tabs */}
                <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                  <div className="flex border-b">
                    {years.map(year => {
                      const summary = blueprint.year_summaries?.[year];
                      const refund = summary?.calculated_totals?.indicative_refund || 0;
                      const yearProfitable = summary?.calculated_totals?.is_profitable || refund > 0;
                      const yearIncomplete = summary?.status === 'incomplete';
                      const isSelected = selectedYear === year;

                      return (
                        <button
                          key={year}
                          onClick={() => setSelectedYear(year)}
                          className={`flex-1 px-4 py-3 text-center transition-all relative ${
                            isSelected
                              ? 'bg-white'
                              : 'bg-muted/30 hover:bg-muted/50'
                          }`}
                        >
                          {/* Active indicator line */}
                          {isSelected && (
                            <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${
                              yearProfitable ? 'bg-green-500' : yearIncomplete ? 'bg-amber-400' : 'bg-gray-300'
                            }`} />
                          )}

                          <div className="flex items-center justify-center gap-1.5">
                            {yearIncomplete && (
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                            )}
                            <span className={`font-semibold text-sm ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>
                              {year}
                            </span>
                          </div>
                          <p className={`text-xs mt-0.5 ${
                            yearIncomplete
                              ? 'text-amber-600'
                              : yearProfitable
                                ? 'text-green-600'
                                : 'text-muted-foreground'
                          }`}>
                            {yearIncomplete ? 'Docs nodig' : formatCurrency(refund)}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Audit Trail - Validation checks with checkmarks */}
          {blueprint.audit_checks && blueprint.audit_checks.length > 0 && (
            <Card className="border-gray-200 bg-gray-50">
              <CardHeader className="pb-3 pt-4">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-gray-700">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Validatie ({blueprint.audit_checks.filter(c => c.passed).length}/{blueprint.audit_checks.length} checks geslaagd)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <TooltipProvider delayDuration={300}>
                  <div className="space-y-2">
                    {blueprint.audit_checks.map((check, idx) => {
                      // Build tooltip content from details
                      const hasDetails = check.details && (
                        check.details.expected !== undefined ||
                        check.details.actual !== undefined ||
                        check.details.difference !== undefined
                      );

                      const tooltipContent = hasDetails ? (
                        <div className="space-y-1 text-xs">
                          <div className="font-medium text-gray-200 mb-1">
                            {check.check_type === 'asset_total' && 'Vermogenstotaal controle'}
                            {check.check_type === 'asset_count' && 'Aantal assets controle'}
                            {check.check_type === 'interest_plausibility' && 'Rente plausibiliteit'}
                            {check.check_type === 'missing_data' && 'Ontbrekende data'}
                            {check.check_type === 'duplicate_asset' && 'Duplicaat detectie'}
                            {check.check_type === 'discrepancy' && 'Afwijking gedetecteerd'}
                          </div>
                          {check.details?.expected !== undefined && (
                            <div className="flex justify-between gap-4">
                              <span className="text-gray-400">Verwacht:</span>
                              <span className="font-mono">
                                {typeof check.details.expected === 'number'
                                  ? check.check_type === 'asset_count'
                                    ? check.details.expected
                                    : `€${check.details.expected.toLocaleString('nl-NL')}`
                                  : check.details.expected}
                              </span>
                            </div>
                          )}
                          {check.details?.actual !== undefined && (
                            <div className="flex justify-between gap-4">
                              <span className="text-gray-400">Gevonden:</span>
                              <span className="font-mono">
                                {typeof check.details.actual === 'number'
                                  ? check.check_type === 'asset_count'
                                    ? check.details.actual
                                    : `€${check.details.actual.toLocaleString('nl-NL')}`
                                  : check.details.actual}
                              </span>
                            </div>
                          )}
                          {check.details?.difference !== undefined && check.details.difference !== 0 && (
                            <div className="flex justify-between gap-4 pt-1 border-t border-gray-600">
                              <span className="text-gray-400">Verschil:</span>
                              <span className={`font-mono ${check.details.difference > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                                €{Math.abs(check.details.difference).toLocaleString('nl-NL')}
                              </span>
                            </div>
                          )}
                          {check.year && (
                            <div className="text-gray-500 text-[10px] mt-1">
                              Belastingjaar {check.year}
                            </div>
                          )}
                        </div>
                      ) : null;

                      return (
                        <Tooltip key={check.id || idx}>
                          <TooltipTrigger asChild>
                            <div
                              className={`flex items-center gap-3 p-2 rounded-lg cursor-default transition-colors ${
                                check.passed
                                  ? 'bg-green-50 border border-green-200 hover:bg-green-100'
                                  : 'bg-yellow-50 border border-yellow-200 hover:bg-yellow-100'
                              }`}
                            >
                              {check.passed ? (
                                <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                              ) : (
                                <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0" />
                              )}
                              <span className={`text-sm ${check.passed ? 'text-green-800' : 'text-yellow-800'}`}>
                                {check.message}
                              </span>
                              {hasDetails && (
                                <Info className="h-3.5 w-3.5 text-gray-400 ml-auto shrink-0" />
                              )}
                            </div>
                          </TooltipTrigger>
                          {tooltipContent && (
                            <TooltipContent side="right" className="bg-gray-900 text-white border-gray-700 max-w-xs">
                              {tooltipContent}
                            </TooltipContent>
                          )}
                        </Tooltip>
                      );
                    })}
                  </div>
                </TooltipProvider>
              </CardContent>
            </Card>
          )}

          {/* Aandachtspunten - After hero, with blocks and human-readable labels */}
          {validationFlags.length > 0 && (() => {
            // Map technical flag types to human-readable labels
            const getFlagLabel = (type: string | undefined): string => {
              if (!type) return 'Onbekend';
              const labels: Record<string, string> = {
                'low_confidence': 'Onzeker',
                'requires_validation': 'Controleren',
                'missing_data': 'Ontbreekt',
                'inconsistency': 'Afwijking',
                'estimation': 'Schatting',
                'manual_review': 'Nakijken',
              };
              return labels[type] || type.replace(/_/g, ' ');
            };

            return (
              <Card className="border-yellow-300 bg-yellow-50">
                <CardHeader className="pb-3 pt-4">
                  <CardTitle className="text-base font-bold flex items-center gap-2 text-yellow-800">
                    <Info className="h-5 w-5" />
                    Let op ({validationFlags.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 pb-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {validationFlags.map((flag, idx) => (
                      <div
                        key={flag.id || idx}
                        className="p-3 bg-white rounded-lg border border-yellow-200"
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-xs font-semibold bg-yellow-200 text-yellow-800 px-1.5 py-0.5 rounded shrink-0">
                            {getFlagLabel(flag.type)}
                          </span>
                          <p className="text-sm text-yellow-900">{flag.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* YEAR DETAIL: Shows when a year is selected */}
          {availableYears.length > 0 && selectedYear && (
            <Card>
              <CardContent className="pt-6">
                {/* YEAR DETAIL VIEW */}
                {selectedYear && blueprint.year_summaries?.[selectedYear] && (
                  <div>
                    {/* Enhanced year header with per-person breakdown */}
                    {(() => {
                      const summary = blueprint.year_summaries[selectedYear];
                      const taxData = blueprint.tax_authority_data?.[selectedYear];
                      const refund = summary?.calculated_totals?.indicative_refund || 0;
                      const actualReturn = summary?.calculated_totals?.actual_return;
                      const perPerson = taxData?.per_person || {};
                      const hasPartnerData = Object.keys(perPerson).length > 1;

                      return (
                        <div className="pb-4 border-b mb-4 space-y-3">
                          {/* Main row */}
                          <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold">Detail: {selectedYear}</h3>
                            <div className="text-right">
                              {(() => {
                                // Check if actual return is unknown (missing income data)
                                const yearMissing = summary?.missing_items || [];
                                const missingIncomeData = yearMissing.some(item =>
                                  typeof item !== 'string' && (
                                    item.field === 'bank_interest' ||
                                    item.field === 'dividend' ||
                                    item.field === 'rental_income'
                                  )
                                );
                                const isMaximum = missingIncomeData && (actualReturn?.total === 0 || actualReturn?.total == null);

                                return (
                                  <>
                                    <p className="text-xs text-muted-foreground">
                                      {isMaximum ? 'Max. teruggave' : 'Indicatieve teruggave'}
                                    </p>
                                    <CopyableCurrency value={refund} className={`text-2xl font-bold ${refund > 0 ? 'text-green-600' : 'text-gray-500'}`} />
                                  </>
                                );
                              })()}
                            </div>
                          </div>

                          {/* Stats row */}
                          {(() => {
                            // Check if we're missing income data
                            const yearMissing = summary?.missing_items || [];
                            const missingIncomeData = yearMissing.some(item =>
                              typeof item !== 'string' && (
                                item.field === 'bank_interest' ||
                                item.field === 'dividend' ||
                                item.field === 'rental_income'
                              )
                            );
                            const isActualReturnUnknown = missingIncomeData && (actualReturn?.total === 0 || actualReturn?.total == null);
                            const box3TaxPaid = taxData?.household_totals?.total_tax_assessed || 0;
                            const deemedReturn = summary?.calculated_totals?.deemed_return_from_tax_authority || 0;

                            return (
                              <div className="grid grid-cols-4 gap-4 text-sm">
                                <div className="bg-muted/30 rounded-lg p-2">
                                  <p className="text-xs text-muted-foreground">Totaal vermogen</p>
                                  <CopyableCurrency value={summary?.calculated_totals?.total_assets_jan_1} className="font-semibold" />
                                </div>
                                <div className="bg-muted/30 rounded-lg p-2">
                                  <p className="text-xs text-muted-foreground">Werkelijk rendement</p>
                                  {isActualReturnUnknown ? (
                                    <span className="font-semibold text-amber-600">Onbekend</span>
                                  ) : (
                                    <CopyableCurrency value={actualReturn?.total} className="font-semibold text-green-600" />
                                  )}
                                  {actualReturn && (actualReturn.bank_interest > 0 || actualReturn.dividends > 0 || actualReturn.rental_income_net > 0) && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      {[
                                        actualReturn.bank_interest ? `Rente ${formatCurrency(actualReturn.bank_interest)}` : null,
                                        actualReturn.dividends ? `Div ${formatCurrency(actualReturn.dividends)}` : null,
                                        actualReturn.rental_income_net ? `Huur ${formatCurrency(actualReturn.rental_income_net)}` : null,
                                      ].filter(Boolean).join(' · ')}
                                    </p>
                                  )}
                                </div>
                                <div className="bg-muted/30 rounded-lg p-2">
                                  <p className="text-xs text-muted-foreground">Forfaitair rendement</p>
                                  <CopyableCurrency value={deemedReturn} className="font-semibold text-red-600" />
                                </div>
                                <div className="bg-blue-50 rounded-lg p-2 border border-blue-200">
                                  <p className="text-xs text-blue-600">Box 3 belasting betaald</p>
                                  <CopyableCurrency value={box3TaxPaid} className="font-semibold text-blue-700" />
                                </div>
                              </div>
                            );
                          })()}

                          {/* Per-person allocation row - only show if partner data exists */}
                          {hasPartnerData && (() => {
                            // Check if allocations are valid (sum to ~100%)
                            const allocations = Object.values(perPerson).map(p => p.allocation_percentage).filter(a => a != null);
                            const totalAlloc = allocations.reduce((sum, a) => sum + (a || 0), 0);
                            const hasValidAllocations = allocations.length >= 2 && Math.abs(totalAlloc - 100) < 5;

                            return (
                              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                <p className="text-xs font-medium text-blue-800 mb-2">Verdeling per persoon ({selectedYear})</p>
                                <div className="grid grid-cols-2 gap-4">
                                  {Object.entries(perPerson).map(([personId, personData]) => {
                                    let personName = personId;
                                    if (personId === blueprint.fiscal_entity?.taxpayer?.id) {
                                      personName = blueprint.fiscal_entity.taxpayer.name || 'Belastingplichtige';
                                    } else if (personId === blueprint.fiscal_entity?.fiscal_partner?.id) {
                                      personName = blueprint.fiscal_entity.fiscal_partner.name || 'Fiscaal Partner';
                                    }

                                    return (
                                      <div key={personId} className="flex items-center justify-between bg-white rounded p-2">
                                        <div>
                                          <p className="font-medium text-sm">{personName}</p>
                                        </div>
                                        <div className="text-right">
                                          <CopyableCurrency value={personData.tax_assessed || 0} className="font-semibold text-amber-600" />
                                          <p className="text-xs text-muted-foreground">
                                            Forfaitair: {formatCurrency(personData.deemed_return)} • Belasting: {formatCurrency(personData.tax_assessed)}
                                          </p>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}

                    {/* Person selector + Year-specific tabs */}
                    {(() => {
                      // Build person options
                      const personOptions: { id: string | null; name: string; allocation?: number }[] = [
                        { id: null, name: 'Huishouden (totaal)' },
                      ];

                      // Get allocations from tax_authority_data
                      const tpId = blueprint.fiscal_entity?.taxpayer?.id || 'tp_01';
                      const fpId = blueprint.fiscal_entity?.fiscal_partner?.id || 'fp_01';
                      const tpAllocRaw = blueprint.tax_authority_data?.[selectedYear]?.per_person?.[tpId]?.allocation_percentage;
                      const fpAllocRaw = blueprint.tax_authority_data?.[selectedYear]?.per_person?.[fpId]?.allocation_percentage;

                      // Validate allocations - must sum to ~100%, both reasonable (10-90 range for partners)
                      // Reject extreme splits like 0/100 which usually indicate ownership was confused with allocation
                      const hasValidAllocations = tpAllocRaw != null && fpAllocRaw != null &&
                        Math.abs((tpAllocRaw + fpAllocRaw) - 100) < 5 && // Sum to 100%
                        tpAllocRaw > 5 && tpAllocRaw < 95 && // Both partners should have meaningful share
                        fpAllocRaw > 5 && fpAllocRaw < 95;

                      // Only use allocations if valid, otherwise don't show
                      const tpAlloc = hasValidAllocations ? tpAllocRaw : undefined;
                      const fpAlloc = hasValidAllocations ? fpAllocRaw : undefined;

                      if (blueprint.fiscal_entity?.taxpayer) {
                        const tp = blueprint.fiscal_entity.taxpayer;
                        personOptions.push({
                          id: tpId,
                          name: tp.name || 'Belastingplichtige',
                          allocation: tpAlloc,
                        });
                      }
                      if (blueprint.fiscal_entity?.fiscal_partner?.has_partner) {
                        const fp = blueprint.fiscal_entity.fiscal_partner;
                        personOptions.push({
                          id: fpId,
                          name: fp.name || 'Fiscaal Partner',
                          allocation: fpAlloc,
                        });
                      }

                      return (
                        <>
                          {/* Person selector - only show if there's a partner */}
                          {personOptions.length > 2 && (
                            <div className="flex items-center gap-2 mb-4 p-2 bg-muted/30 rounded-lg">
                              <span className="text-sm text-muted-foreground">Bekijk voor:</span>
                              <div className="flex gap-1">
                                {personOptions.map((person) => (
                                  <button
                                    key={person.id || 'all'}
                                    onClick={() => setSelectedPersonId(person.id)}
                                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                      selectedPersonId === person.id
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-background hover:bg-muted border'
                                    }`}
                                  >
                                    {person.name}
                                    {person.allocation != null && (
                                      <span className="ml-1 text-xs opacity-70">({person.allocation}%)</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          <Tabs value={activeYearTab} onValueChange={setActiveYearTab}>
                            <TabsList className="mb-4 flex-wrap h-auto gap-1">
                              <TabsTrigger value="bank">Bank- en spaartegoeden</TabsTrigger>
                              <TabsTrigger value="investments">Beleggingen</TabsTrigger>
                              <TabsTrigger value="realestate">Onroerend goed & overig</TabsTrigger>
                              <TabsTrigger value="debts">Schulden</TabsTrigger>
                              <TabsTrigger value="overview">Aanslag/Aangifte</TabsTrigger>
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
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                                      <div>
                                        <p className="text-xs text-muted-foreground">Totaal vermogen</p>
                                        <p className="font-semibold">{formatCurrency(taxData.household_totals.total_assets_gross)}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">Schulden</p>
                                        <p className="font-semibold">{formatCurrency(taxData.household_totals.total_debts)}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">Heffingsvrij</p>
                                        <p className="font-semibold">{formatCurrency(taxData.household_totals.total_exempt)}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">Grondslag</p>
                                        <p className="font-semibold">{formatCurrency(taxData.household_totals.taxable_base)}</p>
                                      </div>
                                      <div className="bg-blue-50 p-2 rounded -m-2">
                                        <p className="text-xs text-blue-700">Forfaitair rendement</p>
                                        <p className="font-semibold text-blue-800">{formatCurrency(taxData.household_totals.deemed_return)}</p>
                                      </div>
                                      <div className="bg-purple-50 p-2 rounded -m-2">
                                        <p className="text-xs text-purple-700">Box 3 belasting</p>
                                        <p className="font-semibold text-purple-800">{formatCurrency(taxData.household_totals.total_tax_assessed)}</p>
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

                                            const allocation = personData.allocation_percentage;

                                            return (
                                              <div key={personId} className="flex items-center justify-between text-sm bg-muted/30 p-2 rounded">
                                                <div className="flex items-center gap-2">
                                                  <span className="font-medium">{personName}</span>
                                                  {allocation != null && (
                                                    <Badge variant="outline" className="text-xs font-normal">
                                                      {allocation}% aandeel
                                                    </Badge>
                                                  )}
                                                </div>
                                                <div className="flex gap-4 text-muted-foreground text-xs">
                                                  <span>Vermogen: <span className="text-foreground">{formatCurrency(personData.total_assets_box3)}</span></span>
                                                  <span>Schulden: <span className="text-foreground">{formatCurrency(personData.total_debts_box3)}</span></span>
                                                  <span>Forfaitair: <span className="text-blue-700 font-medium">{formatCurrency(personData.deemed_return)}</span></span>
                                                  <span>Belasting: <span className="text-purple-700 font-medium">{formatCurrency(personData.tax_assessed)}</span></span>
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

                      {/* TAB 1: Bank- en spaartegoeden */}
                      <TabsContent value="bank" className="space-y-4">
                        {(() => {
                          const bankSavings = blueprint.assets?.bank_savings || [];

                          const matchesPerson = (asset: { owner_id?: string }) => {
                            if (!selectedPersonId) return true;
                            if (asset.owner_id === 'joint') return true;
                            return asset.owner_id === selectedPersonId;
                          };

                          // Filter by year AND person - show accounts that have data for this year
                          const yearBankSavings = bankSavings.filter(a => a.yearly_data?.[selectedYear] && matchesPerson(a));

                          let selectedPersonName = 'dit huishouden';
                          if (selectedPersonId) {
                            if (selectedPersonId === blueprint.fiscal_entity?.taxpayer?.id) {
                              selectedPersonName = blueprint.fiscal_entity.taxpayer.name || 'de belastingplichtige';
                            } else if (selectedPersonId === blueprint.fiscal_entity?.fiscal_partner?.id) {
                              selectedPersonName = blueprint.fiscal_entity.fiscal_partner.name || 'de fiscaal partner';
                            }
                          }

                          if (yearBankSavings.length === 0) {
                            return (
                              <Card className="border-dashed">
                                <CardContent className="py-8 text-center text-muted-foreground">
                                  Geen bank- en spaartegoeden gevonden voor {selectedPersonName} in {selectedYear}
                                </CardContent>
                              </Card>
                            );
                          }

                          // Calculate totals
                          let totalValue = 0;
                          let totalInterest = 0;
                          yearBankSavings.forEach(asset => {
                            const yearData = asset.yearly_data?.[selectedYear] as YearlyDataLegacy | undefined;
                            const amount = getValueJan1(yearData);
                            if (typeof amount === 'number') totalValue += amount;
                            const interestAmount = getFieldValue(yearData?.interest_received);
                            if (typeof interestAmount === 'number') totalInterest += interestAmount;
                          });

                          return (
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-base flex items-center justify-between">
                                  <span className="flex items-center gap-2">
                                    <PiggyBank className="h-4 w-4 text-blue-500" />
                                    Bank- en spaartegoeden ({yearBankSavings.length})
                                  </span>
                                  <span className="text-sm font-normal text-muted-foreground">
                                    Totaal: {formatCurrency(totalValue)} | Rente: {formatCurrency(totalInterest)}
                                  </span>
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="p-0">
                                {(() => {
                                  // Get savings rate for this year
                                  const savingsRate = BOX3_CONSTANTS.AVERAGE_SAVINGS_RATES[selectedYear] || 0.001;
                                  const hasAnyUnknownInterest = yearBankSavings.some(asset => {
                                    const yearData = asset.yearly_data?.[selectedYear] as YearlyDataLegacy | undefined;
                                    return getFieldValue(yearData?.interest_received) == null;
                                  });

                                  // Calculate estimated totals
                                  let totalEstimatedInterest = 0;
                                  yearBankSavings.forEach(asset => {
                                    const yearData = asset.yearly_data?.[selectedYear] as YearlyDataLegacy | undefined;
                                    const interestAmount = getFieldValue(yearData?.interest_received);
                                    if (interestAmount == null) {
                                      const amount = getValueJan1(yearData);
                                      if (amount != null) {
                                        totalEstimatedInterest += amount * savingsRate;
                                      }
                                    }
                                  });

                                  return (
                                <table className="w-full text-sm">
                                  <thead className="bg-muted/50 border-y">
                                    <tr>
                                      <th className="text-left px-4 py-2 font-medium">Omschrijving</th>
                                      <th className="text-left px-4 py-2 font-medium">Bank</th>
                                      <th className="text-left px-4 py-2 font-medium">Land</th>
                                      <th className="text-right px-4 py-2 font-medium">Eigendom</th>
                                      <th className="text-right px-4 py-2 font-medium">1 jan {selectedYear}</th>
                                      <th className="text-right px-4 py-2 font-medium">Rente</th>
                                      {hasAnyUnknownInterest && (
                                        <th className="text-right px-4 py-2 font-medium">
                                          <TooltipProvider>
                                            <Tooltip>
                                              <TooltipTrigger className="flex items-center gap-1 ml-auto">
                                                Schatting
                                                <Info className="h-3 w-3 text-muted-foreground" />
                                              </TooltipTrigger>
                                              <TooltipContent side="top" className="max-w-xs">
                                                <p>Geschatte rente op basis van {(savingsRate * 100).toFixed(2)}% gemiddelde spaarrente in {selectedYear}</p>
                                              </TooltipContent>
                                            </Tooltip>
                                          </TooltipProvider>
                                        </th>
                                      )}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {yearBankSavings.map((asset, idx) => {
                                      const yearData = asset.yearly_data?.[selectedYear] as YearlyDataLegacy | undefined;
                                      const amount = getValueJan1(yearData);
                                      const interestAmount = getFieldValue(yearData?.interest_received);
                                      const estimatedInterest = interestAmount == null && amount != null ? amount * savingsRate : null;

                                      return (
                                        <tr key={asset.id || idx} className="hover:bg-muted/30">
                                          <td className="px-4 py-3">
                                            <span className="font-medium">{asset.description || asset.bank_name}</span>
                                            {asset.account_masked && (
                                              <span className="text-muted-foreground text-xs block">{asset.account_masked}</span>
                                            )}
                                            {asset.is_green_investment && (
                                              <Badge variant="outline" className="text-xs ml-1 text-green-600 border-green-300">Groen</Badge>
                                            )}
                                          </td>
                                          <td className="px-4 py-3 text-muted-foreground">{asset.bank_name || '—'}</td>
                                          <td className="px-4 py-3 text-muted-foreground">{asset.country || 'NL'}</td>
                                          <td className="px-4 py-3 text-right">{asset.ownership_percentage}%</td>
                                          <td className="px-4 py-3 text-right font-semibold">
                                            {amount != null ? formatCurrency(amount) : '—'}
                                          </td>
                                          <td className="px-4 py-3 text-right text-green-600">
                                            {interestAmount != null ? formatCurrency(interestAmount) : <span className="text-muted-foreground text-xs">Onbekend</span>}
                                          </td>
                                          {hasAnyUnknownInterest && (
                                            <td className="px-4 py-3 text-right text-amber-600">
                                              {estimatedInterest != null ? `~${formatCurrency(estimatedInterest)}` : '—'}
                                            </td>
                                          )}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                  <tfoot className="bg-muted/30 border-t-2">
                                    <tr className="font-semibold">
                                      <td className="px-4 py-2" colSpan={4}>Subtotaal</td>
                                      <td className="px-4 py-2 text-right">{formatCurrency(totalValue)}</td>
                                      <td className="px-4 py-2 text-right text-green-600">{formatCurrency(totalInterest)}</td>
                                      {hasAnyUnknownInterest && (
                                        <td className="px-4 py-2 text-right text-amber-600">~{formatCurrency(totalEstimatedInterest)}</td>
                                      )}
                                    </tr>
                                  </tfoot>
                                </table>
                                  );
                                })()}
                              </CardContent>
                            </Card>
                          );
                        })()}
                      </TabsContent>

                      {/* TAB 2: Beleggingen */}
                      <TabsContent value="investments" className="space-y-4">
                        {(() => {
                          const investments = blueprint.assets?.investments || [];

                          const matchesPerson = (asset: { owner_id?: string }) => {
                            if (!selectedPersonId) return true;
                            if (asset.owner_id === 'joint') return true;
                            return asset.owner_id === selectedPersonId;
                          };

                          // Filter by year AND person
                          const yearInvestments = investments.filter(a => a.yearly_data?.[selectedYear] && matchesPerson(a));

                          let selectedPersonName = 'dit huishouden';
                          if (selectedPersonId) {
                            if (selectedPersonId === blueprint.fiscal_entity?.taxpayer?.id) {
                              selectedPersonName = blueprint.fiscal_entity.taxpayer.name || 'de belastingplichtige';
                            } else if (selectedPersonId === blueprint.fiscal_entity?.fiscal_partner?.id) {
                              selectedPersonName = blueprint.fiscal_entity.fiscal_partner.name || 'de fiscaal partner';
                            }
                          }

                          if (yearInvestments.length === 0) {
                            return (
                              <Card className="border-dashed">
                                <CardContent className="py-8 text-center text-muted-foreground">
                                  Geen beleggingen gevonden voor {selectedPersonName} in {selectedYear}
                                </CardContent>
                              </Card>
                            );
                          }

                          // Calculate totals
                          let totalValue = 0;
                          let totalDividend = 0;
                          yearInvestments.forEach(asset => {
                            const yearData = asset.yearly_data?.[selectedYear] as YearlyDataLegacy | undefined;
                            const amount = getValueJan1(yearData);
                            if (typeof amount === 'number') totalValue += amount;
                            const dividendAmount = getFieldValue(yearData?.dividend_received);
                            if (typeof dividendAmount === 'number') totalDividend += dividendAmount;
                          });

                          return (
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-base flex items-center justify-between">
                                  <span className="flex items-center gap-2">
                                    <TrendingUp className="h-4 w-4 text-green-500" />
                                    Beleggingen ({yearInvestments.length})
                                  </span>
                                  <span className="text-sm font-normal text-muted-foreground">
                                    Totaal: {formatCurrency(totalValue)} | Dividend: {formatCurrency(totalDividend)}
                                  </span>
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="p-0">
                                <table className="w-full text-sm">
                                  <thead className="bg-muted/50 border-y">
                                    <tr>
                                      <th className="text-left px-4 py-2 font-medium">Omschrijving</th>
                                      <th className="text-left px-4 py-2 font-medium">Type</th>
                                      <th className="text-left px-4 py-2 font-medium">Land</th>
                                      <th className="text-right px-4 py-2 font-medium">Eigendom</th>
                                      <th className="text-right px-4 py-2 font-medium">1 jan {selectedYear}</th>
                                      <th className="text-right px-4 py-2 font-medium">Dividend</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {yearInvestments.map((asset, idx) => {
                                      const yearData = asset.yearly_data?.[selectedYear] as YearlyDataLegacy | undefined;
                                      const amount = getValueJan1(yearData);
                                      const dividendAmount = getFieldValue(yearData?.dividend_received);

                                      const typeLabel = {
                                        stocks: 'Aandelen',
                                        bonds: 'Obligaties',
                                        funds: 'Fondsen',
                                        crypto: 'Crypto',
                                        other: 'Overig',
                                      }[asset.type] || asset.type;

                                      return (
                                        <tr key={asset.id || idx} className="hover:bg-muted/30">
                                          <td className="px-4 py-3">
                                            <span className="font-medium">{asset.description}</span>
                                            {asset.institution && (
                                              <span className="text-muted-foreground text-xs block">{asset.institution}</span>
                                            )}
                                            {asset.account_masked && (
                                              <span className="text-muted-foreground text-xs block">{asset.account_masked}</span>
                                            )}
                                          </td>
                                          <td className="px-4 py-3">
                                            <Badge variant="outline" className="text-xs">{typeLabel}</Badge>
                                          </td>
                                          <td className="px-4 py-3 text-muted-foreground">{asset.country || 'NL'}</td>
                                          <td className="px-4 py-3 text-right">{asset.ownership_percentage}%</td>
                                          <td className="px-4 py-3 text-right font-semibold">
                                            {amount != null ? formatCurrency(amount) : '—'}
                                          </td>
                                          <td className="px-4 py-3 text-right text-green-600">
                                            {dividendAmount != null ? formatCurrency(dividendAmount) : <span className="text-muted-foreground text-xs">Onbekend</span>}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                  <tfoot className="bg-muted/30 border-t-2">
                                    <tr className="font-semibold">
                                      <td className="px-4 py-2" colSpan={4}>Subtotaal</td>
                                      <td className="px-4 py-2 text-right">{formatCurrency(totalValue)}</td>
                                      <td className="px-4 py-2 text-right text-green-600">{formatCurrency(totalDividend)}</td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </CardContent>
                            </Card>
                          );
                        })()}
                      </TabsContent>

                      {/* TAB 3: Onroerend goed & overige bezittingen */}
                      <TabsContent value="realestate" className="space-y-4">
                        {(() => {
                          const realEstate = blueprint.assets?.real_estate || [];
                          const otherAssets = blueprint.assets?.other_assets || [];

                          const matchesPerson = (asset: { owner_id?: string }) => {
                            if (!selectedPersonId) return true;
                            if (asset.owner_id === 'joint') return true;
                            return asset.owner_id === selectedPersonId;
                          };

                          // Filter by year AND person
                          const yearRealEstate = realEstate.filter(a => a.yearly_data?.[selectedYear] && matchesPerson(a));
                          const yearOtherAssets = otherAssets.filter(a => a.yearly_data?.[selectedYear] && matchesPerson(a));

                          let selectedPersonName = 'dit huishouden';
                          if (selectedPersonId) {
                            if (selectedPersonId === blueprint.fiscal_entity?.taxpayer?.id) {
                              selectedPersonName = blueprint.fiscal_entity.taxpayer.name || 'de belastingplichtige';
                            } else if (selectedPersonId === blueprint.fiscal_entity?.fiscal_partner?.id) {
                              selectedPersonName = blueprint.fiscal_entity.fiscal_partner.name || 'de fiscaal partner';
                            }
                          }

                          if (yearRealEstate.length === 0 && yearOtherAssets.length === 0) {
                            return (
                              <Card className="border-dashed">
                                <CardContent className="py-8 text-center text-muted-foreground">
                                  Geen onroerend goed of overige bezittingen gevonden voor {selectedPersonName} in {selectedYear}
                                </CardContent>
                              </Card>
                            );
                          }

                          return (
                            <>
                              {/* Real Estate section */}
                              {yearRealEstate.length > 0 && (() => {
                                let totalWoz = 0;
                                let totalRental = 0;
                                yearRealEstate.forEach(asset => {
                                  const yearData = asset.yearly_data?.[selectedYear] as YearlyDataLegacy | undefined;
                                  const amount = getFieldValue(yearData?.woz_value);
                                  if (typeof amount === 'number') totalWoz += amount;
                                  const rentalAmount = getFieldValue(yearData?.rental_income_gross);
                                  if (typeof rentalAmount === 'number') totalRental += rentalAmount;
                                });

                                return (
                                  <Card>
                                    <CardHeader className="pb-2">
                                      <CardTitle className="text-base flex items-center justify-between">
                                        <span className="flex items-center gap-2">
                                          <Home className="h-4 w-4 text-orange-500" />
                                          Onroerend goed ({yearRealEstate.length})
                                        </span>
                                        <span className="text-sm font-normal text-muted-foreground">
                                          WOZ: {formatCurrency(totalWoz)} | Huur: {formatCurrency(totalRental)}
                                        </span>
                                      </CardTitle>
                                    </CardHeader>
                                    <CardContent className="p-0">
                                      <table className="w-full text-sm">
                                        <thead className="bg-muted/50 border-y">
                                          <tr>
                                            <th className="text-left px-4 py-2 font-medium">Omschrijving</th>
                                            <th className="text-left px-4 py-2 font-medium">Type</th>
                                            <th className="text-left px-4 py-2 font-medium">Land</th>
                                            <th className="text-right px-4 py-2 font-medium">Eigendom</th>
                                            <th className="text-right px-4 py-2 font-medium">WOZ {selectedYear}</th>
                                            <th className="text-right px-4 py-2 font-medium">Huurinkomsten</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                          {yearRealEstate.map((asset, idx) => {
                                            const yearData = asset.yearly_data?.[selectedYear] as YearlyDataLegacy | undefined;
                                            const amount = getFieldValue(yearData?.woz_value);
                                            const rentalAmount = getFieldValue(yearData?.rental_income_gross);

                                            const typeLabel = {
                                              rented_residential: 'Verhuurpand',
                                              rented_commercial: 'Commercieel',
                                              vacation_home: 'Vakantiewoning',
                                              second_home: 'Tweede woning',
                                              foreign_property: 'Buitenlands vastgoed',
                                              land: 'Grond',
                                              other: 'Overig',
                                            }[asset.type] || asset.type;

                                            return (
                                              <tr key={asset.id || idx} className="hover:bg-muted/30">
                                                <td className="px-4 py-3">
                                                  <span className="font-medium">{asset.description}</span>
                                                  {asset.address && (
                                                    <span className="text-muted-foreground text-xs block">{asset.address}</span>
                                                  )}
                                                </td>
                                                <td className="px-4 py-3">
                                                  <Badge variant="outline" className="text-xs">{typeLabel}</Badge>
                                                </td>
                                                <td className="px-4 py-3 text-muted-foreground">{asset.country || 'NL'}</td>
                                                <td className="px-4 py-3 text-right">{asset.ownership_percentage}%</td>
                                                <td className="px-4 py-3 text-right font-semibold">
                                                  {amount != null ? formatCurrency(amount) : '—'}
                                                </td>
                                                <td className="px-4 py-3 text-right text-green-600">
                                                  {rentalAmount != null ? formatCurrency(rentalAmount) : <span className="text-muted-foreground text-xs">Onbekend</span>}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                        <tfoot className="bg-muted/30 border-t-2">
                                          <tr className="font-semibold">
                                            <td className="px-4 py-2" colSpan={4}>Subtotaal</td>
                                            <td className="px-4 py-2 text-right">{formatCurrency(totalWoz)}</td>
                                            <td className="px-4 py-2 text-right text-green-600">{formatCurrency(totalRental)}</td>
                                          </tr>
                                        </tfoot>
                                      </table>
                                    </CardContent>
                                  </Card>
                                );
                              })()}

                              {/* Other Assets section */}
                              {yearOtherAssets.length > 0 && (() => {
                                let totalValue = 0;
                                yearOtherAssets.forEach(asset => {
                                  const yearData = asset.yearly_data?.[selectedYear] as YearlyDataLegacy | undefined;
                                  const amount = getValueJan1(yearData);
                                  if (typeof amount === 'number') totalValue += amount;
                                });

                                const typeLabels: Record<string, string> = {
                                  premiedepot: 'Premiedepot',
                                  vve_share: 'VvE reserve',
                                  claims: 'Vorderingen',
                                  rights: 'Rechten',
                                  capital_insurance: 'Kapitaalverzekering',
                                  loaned_money: 'Uitgeleend geld',
                                  cash: 'Contant geld',
                                  periodic_benefits: 'Periodieke uitkeringen',
                                  crypto: 'Cryptovaluta',
                                  other: 'Overig',
                                };

                                return (
                                  <Card>
                                    <CardHeader className="pb-2">
                                      <CardTitle className="text-base flex items-center justify-between">
                                        <span className="flex items-center gap-2">
                                          <FileText className="h-4 w-4 text-purple-500" />
                                          Overige bezittingen ({yearOtherAssets.length})
                                        </span>
                                        <span className="text-sm font-normal text-muted-foreground">
                                          Totaal: {formatCurrency(totalValue)}
                                        </span>
                                      </CardTitle>
                                    </CardHeader>
                                    <CardContent className="p-0">
                                      <table className="w-full text-sm">
                                        <thead className="bg-muted/50 border-y">
                                          <tr>
                                            <th className="text-left px-4 py-2 font-medium">Omschrijving</th>
                                            <th className="text-left px-4 py-2 font-medium">Type</th>
                                            <th className="text-left px-4 py-2 font-medium">Land</th>
                                            <th className="text-right px-4 py-2 font-medium">1 jan {selectedYear}</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                          {yearOtherAssets.map((asset, idx) => {
                                            const yearData = asset.yearly_data?.[selectedYear] as YearlyDataLegacy | undefined;
                                            const amount = getValueJan1(yearData);

                                            return (
                                              <tr key={asset.id || idx} className="hover:bg-muted/30">
                                                <td className="px-4 py-3">
                                                  <span className="font-medium">{asset.description}</span>
                                                </td>
                                                <td className="px-4 py-3">
                                                  <Badge variant="outline" className="text-xs">{typeLabels[asset.type] || asset.type}</Badge>
                                                </td>
                                                <td className="px-4 py-3 text-muted-foreground">{asset.country || 'NL'}</td>
                                                <td className="px-4 py-3 text-right font-semibold">
                                                  {amount != null ? formatCurrency(amount) : '—'}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                        <tfoot className="bg-muted/30 border-t-2">
                                          <tr className="font-semibold">
                                            <td className="px-4 py-2" colSpan={3}>Subtotaal</td>
                                            <td className="px-4 py-2 text-right">{formatCurrency(totalValue)}</td>
                                          </tr>
                                        </tfoot>
                                      </table>
                                    </CardContent>
                                  </Card>
                                );
                              })()}
                            </>
                          );
                        })()}
                      </TabsContent>

                      {/* TAB 4: Schulden */}
                      <TabsContent value="debts" className="space-y-4">
                        {(() => {
                          const debts = blueprint.debts || [];

                          // Filter debts that have data for this year AND match selected person (if any)
                          // owner_id is "tp_01", "fp_01", or "joint"
                          const matchesPerson = (debt: { owner_id?: string }) => {
                            if (!selectedPersonId) return true; // Household view shows all
                            if (debt.owner_id === 'joint') return true; // Joint debts show for both
                            return debt.owner_id === selectedPersonId;
                          };

                          // Filter by year AND person
                          const yearDebts = debts.filter(d => d.yearly_data?.[selectedYear] && matchesPerson(d));

                          // Get selected person name for display
                          let selectedPersonName = 'dit huishouden';
                          if (selectedPersonId) {
                            if (selectedPersonId === blueprint.fiscal_entity?.taxpayer?.id) {
                              selectedPersonName = blueprint.fiscal_entity.taxpayer.name || 'de belastingplichtige';
                            } else if (selectedPersonId === blueprint.fiscal_entity?.fiscal_partner?.id) {
                              selectedPersonName = blueprint.fiscal_entity.fiscal_partner.name || 'de fiscaal partner';
                            }
                          }

                          if (yearDebts.length === 0) {
                            return (
                              <Card className="border-dashed">
                                <CardContent className="py-8 text-center text-muted-foreground">
                                  Geen schulden gevonden voor {selectedPersonName} in {selectedYear}
                                </CardContent>
                              </Card>
                            );
                          }

                          // Calculate totals
                          let totalJan1 = 0;
                          let totalDec31 = 0;
                          let totalInterest = 0;
                          yearDebts.forEach(debt => {
                            const yearData = debt.yearly_data?.[selectedYear] as YearlyDataLegacy | undefined;
                            const jan1Amount = getValueJan1(yearData);
                            if (typeof jan1Amount === 'number') totalJan1 += jan1Amount;
                            const dec31Amount = getFieldValue(yearData?.value_dec_31);
                            if (typeof dec31Amount === 'number') totalDec31 += dec31Amount;
                            const interestAmount = getFieldValue(yearData?.interest_paid);
                            if (typeof interestAmount === 'number') totalInterest += interestAmount;
                          });

                          return (
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-base flex items-center justify-between">
                                  <span className="flex items-center gap-2">
                                    <CreditCard className="h-4 w-4 text-red-500" />
                                    Schulden ({yearDebts.length})
                                  </span>
                                  <span className="text-sm font-normal text-muted-foreground">
                                    Totaal: {formatCurrency(totalJan1)}
                                  </span>
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
                                      const yearData = debt.yearly_data?.[selectedYear] as YearlyDataLegacy | undefined;
                                      const jan1Amount = getValueJan1(yearData);
                                      const dec31Amount = getFieldValue(yearData?.value_dec_31);
                                      const interestAmount = getFieldValue(yearData?.interest_paid);

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
                                            {interestAmount != null ? formatCurrency(interestAmount) : <span className="text-muted-foreground text-xs">Onbekend</span>}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                  <tfoot className="bg-muted/30 border-t-2">
                                    <tr className="font-semibold">
                                      <td className="px-4 py-2" colSpan={3}>Subtotaal</td>
                                      <td className="px-4 py-2 text-right text-red-600">{formatCurrency(totalJan1)}</td>
                                      <td className="px-4 py-2 text-right text-red-600">{formatCurrency(totalDec31)}</td>
                                      <td className="px-4 py-2 text-right text-orange-600">{formatCurrency(totalInterest)}</td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </CardContent>
                            </Card>
                          );
                        })()}
                      </TabsContent>

                          </Tabs>
                        </>
                      );
                    })()}
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
                  <RawOutputPanel debugInfo={debugInfo} />
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
    </>
  );
});
