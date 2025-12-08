/**
 * Box3YearEntry Component
 *
 * Displays and manages data for a single tax year within a multi-year Box 3 dossier.
 * Shows documents, validation results, and kansrijkheid for one specific year.
 */

import { memo, useState, useCallback, useRef, useMemo } from "react";
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
  Sparkles,
  Info,
  Users,
  User,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/utils/box3Utils";

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

// Type for partner data
interface PartnerKerncijfers {
  partnerId: string;
  naam: string;
  belastingBedrag: number | null;
  belastbaarInkomen: number | null;
  totaalBezittingen: number | null;
  verdelingPercentage: number | null;
}

// Type for fiscal partners
interface FiscalePartner {
  id: string;
  naam?: string;
  rol?: string;
}

/**
 * Extract key figures from sessionBijlageAnalyse for a specific year
 * Used when there's no per-year validationResult
 * Now supports per-partner extraction
 */
function extractKerncijfersFromBijlage(
  bijlageAnalyse: BijlageAnalyse[] | undefined,
  jaar: string,
  fiscalePartners?: { heeft_partner?: boolean; partners?: FiscalePartner[] },
  perPartnerData?: Record<string, { naam?: string; fiscus_box3?: {
    belastbaar_inkomen_na_drempel?: number | null;
    betaalde_belasting?: number | null;
    rendementsgrondslag?: number | null;
    totaal_bezittingen_bruto?: number | null;
    box_3_verdeling_percentage?: number | null;
  } }>
): {
  hasPartners: boolean;
  partners: PartnerKerncijfers[];
  // Legacy combined values (for non-partner cases)
  belastingBedrag: number | null;
  belastbaarInkomen: number | null;
  totaalBezittingen: number | null;
} {
  const result = {
    hasPartners: false,
    partners: [] as PartnerKerncijfers[],
    belastingBedrag: null as number | null,
    belastbaarInkomen: null as number | null,
    totaalBezittingen: null as number | null,
  };

  // Check if we have per-partner data from the validation result
  if (perPartnerData && Object.keys(perPartnerData).length > 0) {
    result.hasPartners = true;
    for (const [partnerId, partnerData] of Object.entries(perPartnerData)) {
      const fiscus = partnerData.fiscus_box3;
      result.partners.push({
        partnerId,
        naam: partnerData.naam || fiscalePartners?.partners?.find(p => p.id === partnerId)?.naam || partnerId,
        belastingBedrag: fiscus?.betaalde_belasting ?? null,
        belastbaarInkomen: fiscus?.belastbaar_inkomen_na_drempel ?? null,
        totaalBezittingen: fiscus?.totaal_bezittingen_bruto ?? null,
        verdelingPercentage: fiscus?.box_3_verdeling_percentage ?? null,
      });
    }
    return result;
  }

  // Check if partners are detected but no per_partner data
  if (fiscalePartners?.heeft_partner && fiscalePartners?.partners && fiscalePartners.partners.length > 0) {
    result.hasPartners = true;
    // Initialize empty partner entries
    for (const partner of fiscalePartners.partners) {
      result.partners.push({
        partnerId: partner.id,
        naam: partner.naam || partner.id,
        belastingBedrag: null,
        belastbaarInkomen: null,
        totaalBezittingen: null,
        verdelingPercentage: null,
      });
    }
  }

  if (!bijlageAnalyse || bijlageAnalyse.length === 0) {
    return result;
  }

  // Filter to entries for this year
  const yearEntries = bijlageAnalyse.filter(
    (a) => a.belastingjaar && String(a.belastingjaar) === jaar
  );

  if (yearEntries.length === 0) {
    return result;
  }

  // Auto-detect partners from bijlageAnalyse if not already set
  if (!result.hasPartners) {
    const partnerIds = new Set<string>();
    for (const entry of yearEntries) {
      const partnerId = (entry as any).partner_id as string | undefined;
      if (partnerId && partnerId !== "gedeeld") {
        partnerIds.add(partnerId);
      }
    }
    if (partnerIds.size > 0) {
      result.hasPartners = true;
      for (const partnerId of partnerIds) {
        // Try to get name from bijlageAnalyse entries
        const entryWithName = yearEntries.find(
          (e) => (e as any).partner_id === partnerId && (e as any).partner_naam
        );
        result.partners.push({
          partnerId,
          naam: (entryWithName as any)?.partner_naam || partnerId,
          belastingBedrag: null,
          belastbaarInkomen: null,
          totaalBezittingen: null,
          verdelingPercentage: null,
        });
      }
    }
  }

  // Helper to parse currency from text
  const parseCurrency = (text: string): number | null => {
    const cleaned = text.replace(/[€\s.]/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  };

  // Helper to update partner or combined data
  const updateValues = (
    partnerId: string | undefined,
    values: { belasting?: number | null; inkomen?: number | null; vermogen?: number | null; verdeling?: number | null }
  ) => {
    if (result.hasPartners && partnerId && partnerId !== "gedeeld") {
      const partner = result.partners.find(p => p.partnerId === partnerId);
      if (partner) {
        if (values.belasting !== undefined && partner.belastingBedrag === null) {
          partner.belastingBedrag = values.belasting;
        }
        if (values.inkomen !== undefined && partner.belastbaarInkomen === null) {
          partner.belastbaarInkomen = values.inkomen;
        }
        if (values.vermogen !== undefined && partner.totaalBezittingen === null) {
          partner.totaalBezittingen = values.vermogen;
        }
        if (values.verdeling !== undefined && partner.verdelingPercentage === null) {
          partner.verdelingPercentage = values.verdeling;
        }
      }
    } else {
      // Update combined values
      if (values.belasting !== undefined && result.belastingBedrag === null) {
        result.belastingBedrag = values.belasting;
      }
      if (values.inkomen !== undefined && result.belastbaarInkomen === null) {
        result.belastbaarInkomen = values.inkomen;
      }
      if (values.vermogen !== undefined && result.totaalBezittingen === null) {
        result.totaalBezittingen = values.vermogen;
      }
    }
  };

  for (const entry of yearEntries) {
    const partnerId = (entry as any).partner_id as string | undefined;

    // Try geextraheerde_waarden first
    if (entry.geextraheerde_waarden) {
      const vals = entry.geextraheerde_waarden;
      const values: { belasting?: number | null; inkomen?: number | null; vermogen?: number | null; verdeling?: number | null } = {};

      for (const key of Object.keys(vals)) {
        const lowerKey = key.toLowerCase();
        const val = vals[key];

        if (lowerKey.includes("belasting") && !lowerKey.includes("inkomen")) {
          if (typeof val === "number") values.belasting = val;
          else if (typeof val === "string") values.belasting = parseCurrency(val);
        }

        if (lowerKey.includes("inkomen") || (lowerKey.includes("box") && lowerKey.includes("3"))) {
          if (typeof val === "number") values.inkomen = val;
          else if (typeof val === "string") values.inkomen = parseCurrency(val);
        }

        if (lowerKey.includes("vermogen") || lowerKey.includes("bezitting") || lowerKey.includes("rendementsgrondslag")) {
          if (typeof val === "number") values.vermogen = val;
          else if (typeof val === "string") values.vermogen = parseCurrency(val);
        }

        if (lowerKey.includes("verdeling") || lowerKey.includes("percentage")) {
          if (typeof val === "number") values.verdeling = val;
        }
      }

      updateValues(partnerId, values);
    }

    // Parse samenvatting for values
    if (entry.samenvatting) {
      const text = entry.samenvatting;
      const values: { belasting?: number | null; inkomen?: number | null; vermogen?: number | null } = {};

      const inkomenMatch = text.match(/box\s*3\s*inkomen[:\s]*€?\s*([\d.,]+)/i);
      if (inkomenMatch) values.inkomen = parseCurrency(inkomenMatch[1]);

      const belastingMatch = text.match(/belasting[:\s]*€?\s*([\d.,]+)/i);
      if (belastingMatch) values.belasting = parseCurrency(belastingMatch[1]);

      const vermogenMatch = text.match(/(?:vastgesteld\s*)?vermogen[:\s]*€?\s*([\d.,]+)/i);
      if (vermogenMatch) {
        const parsed = parseCurrency(vermogenMatch[1]);
        if (parsed !== null && parsed > 1000) values.vermogen = parsed;
      }

      updateValues(partnerId, values);
    }
  }

  return result;
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
  // Session-level fiscale partners data
  sessionFiscalePartners?: { heeft_partner?: boolean; partners?: FiscalePartner[] };
  // Session-level per_partner data
  sessionPerPartnerData?: Record<string, { naam?: string; fiscus_box3?: {
    belastbaar_inkomen_na_drempel?: number | null;
    betaalde_belasting?: number | null;
    rendementsgrondslag?: number | null;
    totaal_bezittingen_bruto?: number | null;
    box_3_verdeling_percentage?: number | null;
  } }>;
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
  sessionFiscalePartners,
  sessionPerPartnerData,
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

  // Extract kerncijfers from sessionBijlageAnalyse (for years without validationResult)
  // Also get per-partner data from validation result or session level
  const kerncijfersFromSession = useMemo(() => {
    // Get fiscale partners from year's validationResult or session level
    const fiscalePartners = validationResult?.fiscale_partners || sessionFiscalePartners;
    const perPartnerData = validationResult?.gevonden_data?.per_partner || sessionPerPartnerData;

    return extractKerncijfersFromBijlage(
      sessionBijlageAnalyse,
      jaar,
      fiscalePartners,
      perPartnerData
    );
  }, [validationResult, sessionBijlageAnalyse, jaar, sessionFiscalePartners, sessionPerPartnerData]);

  const hasKerncijfers = kerncijfersFromSession && (
    kerncijfersFromSession.belastingBedrag !== null ||
    kerncijfersFromSession.belastbaarInkomen !== null ||
    kerncijfersFromSession.totaalBezittingen !== null ||
    kerncijfersFromSession.partners.some(p =>
      p.belastingBedrag !== null || p.belastbaarInkomen !== null || p.totaalBezittingen !== null
    )
  );

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

          {/* Kerncijfers from session bijlage_analyse (when no validationResult) */}
          {hasKerncijfers && kerncijfersFromSession && (
            <Card className="border-2 border-blue-200 bg-blue-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-blue-500" />
                  Kerncijfers {jaar}
                  {kerncijfersFromSession.hasPartners && (
                    <Badge variant="outline" className="ml-2 text-xs bg-purple-50 text-purple-700 border-purple-200">
                      <Users className="h-3 w-3 mr-1" />
                      {kerncijfersFromSession.partners.length} partners
                    </Badge>
                  )}
                  <Badge variant="outline" className="ml-2 text-xs bg-amber-50 text-amber-700 border-amber-200">
                    Uit intake-analyse
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Per-partner kerncijfers */}
                {kerncijfersFromSession.hasPartners && kerncijfersFromSession.partners.length > 0 ? (
                  <div className="space-y-4">
                    {kerncijfersFromSession.partners.map((partner) => {
                      const hasPartnerData = partner.belastingBedrag !== null ||
                        partner.belastbaarInkomen !== null ||
                        partner.totaalBezittingen !== null;

                      if (!hasPartnerData) return null;

                      return (
                        <div key={partner.partnerId} className="border rounded-lg p-3 bg-white">
                          <div className="flex items-center gap-2 mb-3">
                            <User className="h-4 w-4 text-purple-500" />
                            <span className="font-medium text-sm">{partner.naam}</span>
                            {partner.verdelingPercentage !== null && (
                              <Badge variant="secondary" className="text-xs">
                                {partner.verdelingPercentage}% verdeling
                              </Badge>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {partner.belastingBedrag !== null && (
                              <div className="text-center p-2 bg-green-50 rounded-lg">
                                <p className="text-xs text-muted-foreground">Belasting</p>
                                <p className="text-lg font-semibold text-green-600">
                                  {formatCurrency(partner.belastingBedrag)}
                                </p>
                              </div>
                            )}
                            {partner.totaalBezittingen !== null && (
                              <div className="text-center p-2 bg-blue-50 rounded-lg">
                                <p className="text-xs text-muted-foreground">Vermogen</p>
                                <p className="text-lg font-semibold text-blue-600">
                                  {formatCurrency(partner.totaalBezittingen)}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Show message if partners detected but no data extracted yet */}
                    {kerncijfersFromSession.partners.every(p =>
                      p.belastingBedrag === null && p.belastbaarInkomen === null && p.totaalBezittingen === null
                    ) && (
                      <div className="text-center p-4 bg-muted/30 rounded-lg">
                        <Users className="h-6 w-6 text-purple-400 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          Fiscale partners gedetecteerd. Klik op "Hervalideren" om kerncijfers per partner te extraheren.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Legacy combined view (no partners) */
                  <div className="grid grid-cols-2 gap-4">
                    {kerncijfersFromSession.belastingBedrag !== null && (
                      <div className="text-center p-3 bg-white rounded-lg">
                        <p className="text-xs text-muted-foreground">Belasting</p>
                        <p className="text-lg font-semibold text-green-600">
                          {formatCurrency(kerncijfersFromSession.belastingBedrag)}
                        </p>
                      </div>
                    )}
                    {kerncijfersFromSession.totaalBezittingen !== null && (
                      <div className="text-center p-3 bg-white rounded-lg">
                        <p className="text-xs text-muted-foreground">Vermogen</p>
                        <p className="text-lg font-semibold">
                          {formatCurrency(kerncijfersFromSession.totaalBezittingen)}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-3 text-xs text-muted-foreground bg-muted/30 rounded p-2 flex items-start gap-2">
                  <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>
                    Klik op "Hervalideren" voor een volledige analyse van dit belastingjaar.
                  </span>
                </div>
              </CardContent>
            </Card>
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
                sessionBijlageAnalyse={sessionBijlageAnalyse}
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
          {!hasData && !hasKerncijfers && (
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
