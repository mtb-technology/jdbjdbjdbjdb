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
  FileCheck,
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
  Calculator,
  TrendingUp,
  Bug,
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
  Box3FiscalePartners,
  Box3Partner,
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

// Use Box3Partner from schema as FiscalePartner alias for local use
type FiscalePartner = Box3Partner;

/**
 * Extract key figures from sessionBijlageAnalyse for a specific year
 * Used when there's no per-year validationResult
 * Now supports per-partner extraction
 */
function extractKerncijfersFromBijlage(
  bijlageAnalyse: BijlageAnalyse[] | undefined,
  jaar: string,
  fiscalePartners?: Box3FiscalePartners,
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
  // But first, we'll try to enhance with bijlageAnalyse data below
  if (perPartnerData && Object.keys(perPartnerData).length > 0) {
    result.hasPartners = true;
    for (const [partnerId, partnerData] of Object.entries(perPartnerData)) {
      const fiscus = partnerData.fiscus_box3;
      const verdelingPct = fiscus?.box_3_verdeling_percentage ?? null;

      // If verdeling is 0%, the effective vermogen for Box 3 is €0
      // (the partner doesn't contribute to the Box 3 calculation)
      const effectiefVermogen = verdelingPct === 0 ? 0 : (fiscus?.totaal_bezittingen_bruto ?? null);

      result.partners.push({
        partnerId,
        naam: partnerData.naam || fiscalePartners?.partners?.find(p => p.id === partnerId)?.naam || partnerId,
        belastingBedrag: fiscus?.betaalde_belasting ?? null,
        belastbaarInkomen: fiscus?.belastbaar_inkomen_na_drempel ?? null,
        totaalBezittingen: effectiefVermogen,
        verdelingPercentage: verdelingPct,
      });
    }
    // Don't return early - continue to check bijlageAnalyse for better values
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
      for (const partnerId of Array.from(partnerIds)) {
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
  // isHighPriority=true means this value should override existing values (e.g. from document extraction)
  const updateValues = (
    partnerId: string | undefined,
    values: { belasting?: number | null; inkomen?: number | null; vermogen?: number | null; verdeling?: number | null },
    isHighPriority = false
  ) => {
    if (result.hasPartners && partnerId && partnerId !== "gedeeld") {
      const partner = result.partners.find(p => p.partnerId === partnerId);
      if (partner) {
        if (values.belasting !== undefined && (partner.belastingBedrag === null || isHighPriority)) {
          partner.belastingBedrag = values.belasting;
        }
        if (values.inkomen !== undefined && (partner.belastbaarInkomen === null || isHighPriority)) {
          partner.belastbaarInkomen = values.inkomen;
        }
        if (values.vermogen !== undefined && (partner.totaalBezittingen === null || isHighPriority)) {
          partner.totaalBezittingen = values.vermogen;
        }
        if (values.verdeling !== undefined && (partner.verdelingPercentage === null || isHighPriority)) {
          partner.verdelingPercentage = values.verdeling;
        }
      }
    } else {
      // Update combined values
      if (values.belasting !== undefined && (result.belastingBedrag === null || isHighPriority)) {
        result.belastingBedrag = values.belasting;
      }
      if (values.inkomen !== undefined && (result.belastbaarInkomen === null || isHighPriority)) {
        result.belastbaarInkomen = values.inkomen;
      }
      if (values.vermogen !== undefined && (result.totaalBezittingen === null || isHighPriority)) {
        result.totaalBezittingen = values.vermogen;
      }
    }
  };

  for (const entry of yearEntries) {
    const partnerId = (entry as any).partner_id as string | undefined;

    // Try geextraheerde_waarden first - these are extracted directly from documents
    // and should take priority over per_partner data from the AI summary
    if (entry.geextraheerde_waarden) {
      const vals = entry.geextraheerde_waarden;
      const values: { belasting?: number | null; inkomen?: number | null; vermogen?: number | null; verdeling?: number | null } = {};
      let hasHighPriorityVermogen = false;

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

        // "Totaal Bezittingen" is the most accurate source - prioritize it
        if (lowerKey.includes("totaal") && lowerKey.includes("bezitting")) {
          if (typeof val === "number") values.vermogen = val;
          else if (typeof val === "string") values.vermogen = parseCurrency(val);
          hasHighPriorityVermogen = true;
        } else if (lowerKey.includes("vermogen") || lowerKey.includes("bezitting") || lowerKey.includes("rendementsgrondslag")) {
          // Only use these if we don't have a "totaal bezittingen" value
          if (!hasHighPriorityVermogen) {
            if (typeof val === "number") values.vermogen = val;
            else if (typeof val === "string") values.vermogen = parseCurrency(val);
          }
        }

        if (lowerKey.includes("verdeling") || lowerKey.includes("percentage")) {
          if (typeof val === "number") values.verdeling = val;
        }
      }

      // Values from document extraction should override per_partner data
      updateValues(partnerId, values, hasHighPriorityVermogen);
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

/**
 * Light Document Status Component
 *
 * Shows a simplified document checklist based on bijlageAnalyse
 * Used when there's no full validationResult for a year
 */
interface LightDocumentStatusProps {
  bijlageAnalyse: BijlageAnalyse[];
  jaar: string;
}

const DOCUMENT_TYPE_TO_CATEGORY: Record<string, string> = {
  // Aangifte IB
  aangifte_ib: "aangifte_ib",
  aangifte_inkomstenbelasting: "aangifte_ib",
  aangifte: "aangifte_ib",
  definitieve_aanslag: "aangifte_ib",
  specificatie_aanslag: "aangifte_ib",
  // Bankrekeningen
  bankrekeningen: "bankrekeningen",
  bank: "bankrekeningen",
  rente: "bankrekeningen",
  spaarrekening: "bankrekeningen",
  jaaroverzicht_bank: "bankrekeningen",
  // Beleggingen
  beleggingen: "beleggingen",
  effectenportefeuille: "beleggingen",
  aandelen: "beleggingen",
  dividend: "beleggingen",
  jaaroverzicht_effecten: "beleggingen",
  // Vastgoed
  vastgoed: "vastgoed",
  woz: "vastgoed",
  onroerend_goed: "vastgoed",
  // Schulden
  schulden: "schulden",
  hypotheek: "schulden",
  lening: "schulden",
};

function LightDocumentStatus({ bijlageAnalyse, jaar }: LightDocumentStatusProps) {
  // Filter to entries for this year
  const yearEntries = bijlageAnalyse.filter(
    (a) => a.belastingjaar && String(a.belastingjaar) === jaar
  );

  if (yearEntries.length === 0) {
    return null;
  }

  // Map document types to categories
  const foundCategories = new Set<string>();
  const categoryDocs: Record<string, string[]> = {};

  for (const entry of yearEntries) {
    const docType = entry.document_type?.toLowerCase().replace(/\s+/g, "_") || "";

    // Try exact match first
    let category = DOCUMENT_TYPE_TO_CATEGORY[docType];

    // Try partial match
    if (!category) {
      for (const [key, cat] of Object.entries(DOCUMENT_TYPE_TO_CATEGORY)) {
        if (docType.includes(key) || key.includes(docType)) {
          category = cat;
          break;
        }
      }
    }

    if (category) {
      foundCategories.add(category);
      if (!categoryDocs[category]) categoryDocs[category] = [];
      categoryDocs[category].push(entry.bestandsnaam);
    }
  }

  const allCategories = Object.keys(CATEGORY_LABELS);
  const missingCategories = allCategories.filter(c => !foundCategories.has(c));
  const foundCount = foundCategories.size;

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-amber-600" />
            Document Status {jaar}
          </span>
          <Badge variant={foundCount === 5 ? "default" : "secondary"} className="bg-amber-100 text-amber-800">
            {foundCount}/5 gevonden
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Found documents */}
        {foundCategories.size > 0 && (
          <div className="space-y-1">
            {Array.from(foundCategories).map(cat => (
              <div key={cat} className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="font-medium">{CATEGORY_LABELS[cat]}</span>
                <span className="text-xs text-muted-foreground">
                  ({categoryDocs[cat]?.length || 0} doc{(categoryDocs[cat]?.length || 0) !== 1 ? "s" : ""})
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Missing documents */}
        {missingCategories.length > 0 && (
          <div className="space-y-1 pt-2 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-1">Nog niet gevonden:</p>
            {missingCategories.map(cat => (
              <div key={cat} className="flex items-center gap-2 text-sm text-orange-600">
                <AlertCircle className="h-4 w-4" />
                <span>{CATEGORY_LABELS[cat]}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 text-xs text-muted-foreground bg-muted/30 rounded p-2 flex items-start gap-2">
          <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>
            Dit is een voorlopige status op basis van de intake-analyse. Klik op "Hervalideren" voor een volledige document validatie.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Data Status Overview Component
 *
 * Shows a clear overview of what fiscal data has been extracted
 * and what is still needed for the rendement calculation
 */
interface DataStatusOverviewProps {
  bijlageAnalyse: BijlageAnalyse[];
  jaar: string;
  validationResult?: Box3ValidationResult | null;
}

interface ExtractedDataItem {
  label: string;
  value: number | string | null;
  source: string;
  required: boolean;
  category: 'fiscus' | 'werkelijk' | 'berekening';
  isPercentage?: boolean;
}

function DataStatusOverview({ bijlageAnalyse, jaar, validationResult }: DataStatusOverviewProps) {
  // Filter to entries for this year
  const yearEntries = bijlageAnalyse.filter(
    (a) => a.belastingjaar && String(a.belastingjaar) === jaar
  );

  // Get data from validationResult if available
  const fiscusData = validationResult?.gevonden_data?.fiscus_box3;
  const werkelijkData = validationResult?.gevonden_data?.werkelijk_rendement_input;

  // Extract values from bijlageAnalyse
  const extractedFromDocs: Record<string, { value: number | string | null; source: string }> = {};

  for (const entry of yearEntries) {
    if (entry.geextraheerde_waarden) {
      for (const [key, val] of Object.entries(entry.geextraheerde_waarden)) {
        if (val !== null && val !== undefined) {
          const lowerKey = key.toLowerCase();

          // Map to standardized keys - check most specific patterns first

          // Totaal bezittingen (most important)
          if (lowerKey.includes("totaal") && lowerKey.includes("bezitting")) {
            extractedFromDocs["totaal_bezittingen"] = { value: val as number, source: entry.bestandsnaam };
          }
          // Rendementsgrondslag
          else if (lowerKey.includes("rendementsgrondslag") || lowerKey.includes("rendements_grondslag")) {
            if (!extractedFromDocs["rendementsgrondslag"]) {
              extractedFromDocs["rendementsgrondslag"] = { value: val as number, source: entry.bestandsnaam };
            }
          }
          // Box 3 belasting bedrag
          else if ((lowerKey.includes("belasting") && lowerKey.includes("bedrag")) ||
                   (lowerKey.includes("box") && lowerKey.includes("3") && lowerKey.includes("belasting"))) {
            extractedFromDocs["box3_belasting"] = { value: val as number, source: entry.bestandsnaam };
          }
          // Schulden - totaal schulden bedrag
          else if ((lowerKey.includes("totaal") && lowerKey.includes("schuld")) ||
                   lowerKey === "schulden" || lowerKey === "totaal_schulden" ||
                   lowerKey === "schuld_bedrag" || lowerKey === "schulden_bedrag" ||
                   (lowerKey.includes("schuld") && !lowerKey.includes("rente") && !lowerKey.includes("percent"))) {
            // Only set if the value looks like a schulden bedrag (typically > 100)
            const numVal = typeof val === "number" ? val : null;
            if (numVal !== null && numVal >= 0 && !extractedFromDocs["schulden_totaal"]) {
              extractedFromDocs["schulden_totaal"] = { value: numVal, source: entry.bestandsnaam };
            }
          }
          // Schulden - rente percentage
          else if ((lowerKey.includes("rente") && lowerKey.includes("percent")) ||
                   lowerKey === "rente_percentage" || lowerKey === "schuld_rente_percentage") {
            extractedFromDocs["schulden_rente_percentage"] = { value: val as number, source: entry.bestandsnaam };
          }
          // Schulden - betaalde rente (bedrag)
          else if ((lowerKey.includes("schuld") && lowerKey.includes("rente") && !lowerKey.includes("percent")) ||
                   (lowerKey.includes("betaalde") && lowerKey.includes("rente")) ||
                   lowerKey.includes("schuldenrente") || lowerKey === "rente_betaald" ||
                   lowerKey === "betaalde_rente") {
            extractedFromDocs["schulden_rente"] = { value: val as number, source: entry.bestandsnaam };
          }
          // Bank rente ontvangen (niet schuldenrente)
          else if (lowerKey.includes("rente") && lowerKey.includes("ontvang")) {
            extractedFromDocs["bank_rente"] = { value: val as number, source: entry.bestandsnaam };
          }
          // Bank/spaar goederen (uit aangifte)
          else if (lowerKey.includes("bank") && lowerKey.includes("spaar")) {
            extractedFromDocs["bank_spaar_waarde"] = { value: val as number, source: entry.bestandsnaam };
          }
          // Onroerende zaken / vastgoed waarde
          else if (lowerKey.includes("onroerend") || (lowerKey.includes("vastgoed") && lowerKey.includes("waarde"))) {
            extractedFromDocs["vastgoed_waarde"] = { value: val as number, source: entry.bestandsnaam };
          }
          // Dividend
          else if (lowerKey.includes("dividend")) {
            extractedFromDocs["dividend"] = { value: val as number, source: entry.bestandsnaam };
          }
          // Beleggingen begin waarde (1 jan)
          else if ((lowerKey.includes("waarde") && lowerKey.includes("1")) ||
                   (lowerKey.includes("begin") && lowerKey.includes("waarde"))) {
            extractedFromDocs["beleggingen_begin"] = { value: val as number, source: entry.bestandsnaam };
          }
          // Beleggingen eind waarde (31 dec)
          else if ((lowerKey.includes("waarde") && lowerKey.includes("31")) ||
                   (lowerKey.includes("eind") && lowerKey.includes("waarde"))) {
            extractedFromDocs["beleggingen_eind"] = { value: val as number, source: entry.bestandsnaam };
          }
          // Heffingsvrij vermogen
          else if (lowerKey.includes("heffingsvrij") || lowerKey.includes("heffings_vrij")) {
            extractedFromDocs["heffingsvrij_vermogen"] = { value: val as number, source: entry.bestandsnaam };
          }
          // Grondslag sparen en beleggen
          else if (lowerKey.includes("grondslag") && (lowerKey.includes("sparen") || lowerKey.includes("beleggen"))) {
            extractedFromDocs["grondslag_sparen_beleggen"] = { value: val as number, source: entry.bestandsnaam };
          }
          // Forfaitair rendement
          else if (lowerKey.includes("forfaitair") && lowerKey.includes("rendement")) {
            extractedFromDocs["forfaitair_rendement"] = { value: val as number, source: entry.bestandsnaam };
          }
        }
      }
    }
  }

  // Build list of data items with their status
  const dataItems: ExtractedDataItem[] = [
    // Fiscale data (uit aangifte)
    {
      label: "Totaal bezittingen (bruto)",
      value: fiscusData?.totaal_bezittingen_bruto ?? extractedFromDocs["totaal_bezittingen"]?.value ?? null,
      source: extractedFromDocs["totaal_bezittingen"]?.source || "Aangifte IB",
      required: true,
      category: 'fiscus',
    },
    {
      label: "Rendementsgrondslag",
      value: fiscusData?.rendementsgrondslag ?? extractedFromDocs["rendementsgrondslag"]?.value ?? null,
      source: extractedFromDocs["rendementsgrondslag"]?.source || "Aangifte IB",
      required: true,
      category: 'fiscus',
    },
    {
      label: "Belastbaar inkomen Box 3",
      value: fiscusData?.belastbaar_inkomen_na_drempel ?? null,
      source: "Aangifte IB",
      required: true,
      category: 'fiscus',
    },
    {
      label: "Box 3 belasting betaald",
      value: fiscusData?.betaalde_belasting ?? extractedFromDocs["box3_belasting"]?.value ?? null,
      source: extractedFromDocs["box3_belasting"]?.source || "Aangifte IB",
      required: false,
      category: 'fiscus',
    },
    // Werkelijk rendement data
    {
      label: "Ontvangen bankrente",
      value: werkelijkData?.bank_rente_ontvangen ?? extractedFromDocs["bank_rente"]?.value ?? null,
      source: extractedFromDocs["bank_rente"]?.source || "Jaaroverzicht bank",
      required: true,
      category: 'werkelijk',
    },
    {
      label: "Beleggingen waarde 1 jan",
      value: werkelijkData?.beleggingen_waarde_1jan ?? extractedFromDocs["beleggingen_begin"]?.value ?? null,
      source: extractedFromDocs["beleggingen_begin"]?.source || "Effectenoverzicht",
      required: false,
      category: 'werkelijk',
    },
    {
      label: "Beleggingen waarde 31 dec",
      value: werkelijkData?.beleggingen_waarde_31dec ?? extractedFromDocs["beleggingen_eind"]?.value ?? null,
      source: extractedFromDocs["beleggingen_eind"]?.source || "Effectenoverzicht",
      required: false,
      category: 'werkelijk',
    },
    {
      label: "Ontvangen dividend",
      value: werkelijkData?.beleggingen_dividend ?? extractedFromDocs["dividend"]?.value ?? null,
      source: extractedFromDocs["dividend"]?.source || "Dividendnota",
      required: false,
      category: 'werkelijk',
    },
    {
      label: "Betaalde schuldenrente",
      value: werkelijkData?.schulden_rente_betaald ?? extractedFromDocs["schulden_rente"]?.value ?? null,
      source: extractedFromDocs["schulden_rente"]?.source || "Leningoverzicht",
      required: false,
      category: 'werkelijk',
    },
    {
      label: "Totaal schulden",
      value: extractedFromDocs["schulden_totaal"]?.value ?? null,
      source: extractedFromDocs["schulden_totaal"]?.source || "Aangifte IB",
      required: false,
      category: 'fiscus',
    },
    {
      label: "Schulden rente %",
      value: extractedFromDocs["schulden_rente_percentage"]?.value ?? null,
      source: extractedFromDocs["schulden_rente_percentage"]?.source || "Aangifte IB",
      required: false,
      category: 'fiscus',
      isPercentage: true,
    },
  ];

  // Count what we have and what's missing
  const requiredItems = dataItems.filter(item => item.required);
  const requiredFound = requiredItems.filter(item => item.value !== null).length;
  const totalRequired = requiredItems.length;

  const fiscusItems = dataItems.filter(item => item.category === 'fiscus');
  const werkelijkItems = dataItems.filter(item => item.category === 'werkelijk');

  const formatValue = (val: number | string | null, isPercentage = false): string => {
    if (val === null) return "—";
    if (typeof val === "number") {
      if (isPercentage) {
        return `${val.toFixed(2)}%`;
      }
      return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(val);
    }
    return String(val);
  };

  // Check if we have any data at all
  const hasAnyData = dataItems.some(item => item.value !== null);

  if (!hasAnyData && yearEntries.length === 0) {
    return null;
  }

  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-blue-600" />
            Gegevens voor berekening {jaar}
          </span>
          <Badge
            variant={requiredFound === totalRequired ? "default" : "secondary"}
            className={requiredFound === totalRequired ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"}
          >
            {requiredFound}/{totalRequired} verplicht
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Fiscale gegevens (uit aangifte) */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
            <FileText className="h-3 w-3" />
            Uit aangifte IB
          </h4>
          <div className="space-y-1">
            {fiscusItems.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-white/50">
                <div className="flex items-center gap-2">
                  {item.value !== null ? (
                    <CheckCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                  ) : item.required ? (
                    <AlertCircle className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                  ) : (
                    <div className="h-3.5 w-3.5 rounded-full border border-gray-300 flex-shrink-0" />
                  )}
                  <span className={item.value === null && item.required ? "text-orange-700" : ""}>
                    {item.label}
                    {item.required && <span className="text-red-500 ml-0.5">*</span>}
                  </span>
                </div>
                <span className={`font-mono text-xs ${item.value !== null ? "text-green-700 font-medium" : "text-muted-foreground"}`}>
                  {formatValue(item.value, item.isPercentage)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Werkelijk rendement gegevens */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            Voor werkelijk rendement
          </h4>
          <div className="space-y-1">
            {werkelijkItems.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-white/50">
                <div className="flex items-center gap-2">
                  {item.value !== null ? (
                    <CheckCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                  ) : item.required ? (
                    <AlertCircle className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                  ) : (
                    <div className="h-3.5 w-3.5 rounded-full border border-gray-300 flex-shrink-0" />
                  )}
                  <span className={item.value === null && item.required ? "text-orange-700" : ""}>
                    {item.label}
                    {item.required && <span className="text-red-500 ml-0.5">*</span>}
                  </span>
                </div>
                <span className={`font-mono text-xs ${item.value !== null ? "text-green-700 font-medium" : "text-muted-foreground"}`}>
                  {formatValue(item.value, item.isPercentage)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Missing required items summary */}
        {requiredFound < totalRequired && (
          <div className="bg-orange-100 border border-orange-200 rounded-lg p-3 mt-2">
            <p className="text-sm font-medium text-orange-800 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Nog nodig voor berekening:
            </p>
            <ul className="mt-1 text-sm text-orange-700 list-disc list-inside">
              {requiredItems.filter(item => item.value === null).map((item, idx) => (
                <li key={idx}>{item.label} <span className="text-xs text-orange-600">({item.source})</span></li>
              ))}
            </ul>
          </div>
        )}

        {/* All required data complete */}
        {requiredFound === totalRequired && (
          <div className="bg-green-100 border border-green-200 rounded-lg p-3 mt-2">
            <p className="text-sm font-medium text-green-800 flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Alle verplichte gegevens aanwezig - klaar voor berekening
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Type for jaren_data from new jurist format
interface JaarDataEntry {
  document_type?: string;
  datum_document?: string | null;
  vermogens_mix_totaal_huishouden?: {
    bank_en_spaartegoeden?: number | null;
    overige_bezittingen?: number | null;
    onroerende_zaken_waarde?: number | null;
    schulden_box_3?: number | null;
    totaal_bezittingen?: number | null;
    heffingsvrij_vermogen_totaal?: number | null;
  };
  fiscale_verdeling?: {
    grondslag_sparen_beleggen_totaal?: number | null;
    aandeel_persoon_1?: number | null;
    aandeel_persoon_2?: number | null;
  };
  te_betalen_terug_te_krijgen?: {
    box_3_inkomen_berekend?: number | null;
    totaal_te_betalen_aanslag?: number | null;
  };
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
  // Session-level fiscale partners data (use schema type directly)
  sessionFiscalePartners?: Box3FiscalePartners;
  // Session-level per_partner data
  sessionPerPartnerData?: Record<string, { naam?: string; fiscus_box3?: {
    belastbaar_inkomen_na_drempel?: number | null;
    betaalde_belasting?: number | null;
    rendementsgrondslag?: number | null;
    totaal_bezittingen_bruto?: number | null;
    box_3_verdeling_percentage?: number | null;
  } }>;
  // Session-level jaren_data from new jurist format
  sessionJarenData?: Record<string, JaarDataEntry>;
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
  sessionJarenData,
}: Box3YearEntryProps) {
  const { toast } = useToast();
  const [showAddDocs, setShowAddDocs] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isDocsExpanded, setIsDocsExpanded] = useState(true);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(Object.keys(CATEGORY_LABELS))
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validationResult = yearData.validationResult;
  const attachments = yearData.attachments || [];
  const manualOverrides = yearData.manualOverrides;
  const isComplete = yearData.isComplete ?? false;

  // Get this year's data from sessionJarenData (new jurist format)
  const jaarDataFromSession = sessionJarenData?.[jaar];

  const hasData = !!validationResult || attachments.length > 0 || !!jaarDataFromSession;

  // Extract kerncijfers from sessionBijlageAnalyse (for years without validationResult)
  // Also get per-partner data from validation result or session level
  // AND use sessionJarenData (new jurist format) if available
  const kerncijfersFromSession = useMemo(() => {
    // Get fiscale partners from year's validationResult or session level
    const fiscalePartners = validationResult?.fiscale_partners || sessionFiscalePartners;
    const perPartnerData = validationResult?.gevonden_data?.per_partner || sessionPerPartnerData;

    const result = extractKerncijfersFromBijlage(
      sessionBijlageAnalyse,
      jaar,
      fiscalePartners,
      perPartnerData
    );

    // Enhance with data from sessionJarenData (new jurist format)
    if (jaarDataFromSession) {
      const vermogen = jaarDataFromSession.vermogens_mix_totaal_huishouden;
      const teBetalen = jaarDataFromSession.te_betalen_terug_te_krijgen;

      // Use totaal_bezittingen from new format if not already set
      if (result.totaalBezittingen === null && vermogen?.totaal_bezittingen != null) {
        result.totaalBezittingen = vermogen.totaal_bezittingen;
      }

      // Use totaal_te_betalen_aanslag as belasting if not already set
      if (result.belastingBedrag === null && teBetalen?.totaal_te_betalen_aanslag != null) {
        result.belastingBedrag = teBetalen.totaal_te_betalen_aanslag;
      }

      // Use box_3_inkomen_berekend as inkomen if not already set
      if (result.belastbaarInkomen === null && teBetalen?.box_3_inkomen_berekend != null) {
        result.belastbaarInkomen = teBetalen.box_3_inkomen_berekend;
      }
    }

    return result;
  }, [validationResult, sessionBijlageAnalyse, jaar, sessionFiscalePartners, sessionPerPartnerData, jaarDataFromSession]);

  // Check if we have kerncijfers from any source (bijlage, jaren_data, etc.)
  const hasKerncijfers = kerncijfersFromSession && (
    kerncijfersFromSession.belastingBedrag !== null ||
    kerncijfersFromSession.belastbaarInkomen !== null ||
    kerncijfersFromSession.totaalBezittingen !== null ||
    kerncijfersFromSession.partners.some(p =>
      p.belastingBedrag !== null || p.belastbaarInkomen !== null || p.totaalBezittingen !== null
    )
  ) || !!jaarDataFromSession;

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
            {/* Developer debug button */}
            {(sessionPerPartnerData || sessionBijlageAnalyse || validationResult) && (
              <Button
                onClick={() => setShowDebugPanel(!showDebugPanel)}
                variant="ghost"
                size="sm"
                className="text-gray-400 hover:text-gray-600 ml-auto"
                title="Toon ruwe AI data"
              >
                <Bug className="h-4 w-4" />
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

          {/* Developer Debug Panel */}
          {showDebugPanel && (
            <Card className="border-2 border-orange-300 bg-orange-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-orange-700">
                  <Bug className="h-4 w-4" />
                  Developer: Ruwe AI Data voor {jaar}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Per Partner Data */}
                {sessionPerPartnerData && Object.keys(sessionPerPartnerData).length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-orange-800 mb-2">per_partner (session level - geen jaar filter!):</h4>
                    <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-64">
                      {JSON.stringify(sessionPerPartnerData, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Validation Result per_partner */}
                {validationResult?.gevonden_data?.per_partner && (
                  <div>
                    <h4 className="text-sm font-semibold text-orange-800 mb-2">per_partner (uit validationResult van dit jaar):</h4>
                    <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-64">
                      {JSON.stringify(validationResult.gevonden_data.per_partner, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Fiscale Partners */}
                {(sessionFiscalePartners || validationResult?.fiscale_partners) && (
                  <div>
                    <h4 className="text-sm font-semibold text-orange-800 mb-2">fiscale_partners:</h4>
                    <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-40">
                      {JSON.stringify(validationResult?.fiscale_partners || sessionFiscalePartners, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Bijlage Analyse for this year */}
                {sessionBijlageAnalyse && sessionBijlageAnalyse.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-orange-800 mb-2">
                      bijlage_analyse (gefilterd op jaar {jaar}):
                    </h4>
                    <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-64">
                      {JSON.stringify(
                        sessionBijlageAnalyse.filter(a => String(a.belastingjaar) === jaar),
                        null, 2
                      )}
                    </pre>
                    <h4 className="text-sm font-semibold text-orange-800 mb-2 mt-3">
                      bijlage_analyse (ALLE jaren - {sessionBijlageAnalyse.length} items):
                    </h4>
                    <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-64">
                      {JSON.stringify(sessionBijlageAnalyse, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Full Validation Result */}
                {validationResult && (
                  <div>
                    <h4 className="text-sm font-semibold text-orange-800 mb-2">Volledige validationResult:</h4>
                    <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-96">
                      {JSON.stringify(validationResult, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Computed kerncijfers */}
                <div>
                  <h4 className="text-sm font-semibold text-orange-800 mb-2">Berekende kerncijfersFromSession:</h4>
                  <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-64">
                    {JSON.stringify(kerncijfersFromSession, null, 2)}
                  </pre>
                </div>
              </CardContent>
            </Card>
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
                      // Show partner if we have any data OR if they have a verdeling percentage (even 0%)
                      const hasPartnerData = partner.belastingBedrag !== null ||
                        partner.belastbaarInkomen !== null ||
                        partner.totaalBezittingen !== null ||
                        partner.verdelingPercentage !== null;

                      if (!hasPartnerData) return null;

                      // Determine if this partner has 0% verdeling
                      const isZeroVerdeling = partner.verdelingPercentage === 0;

                      return (
                        <div key={partner.partnerId} className={`border rounded-lg p-3 ${isZeroVerdeling ? 'bg-gray-50' : 'bg-white'}`}>
                          <div className="flex items-center gap-2 mb-3">
                            <User className={`h-4 w-4 ${isZeroVerdeling ? 'text-gray-400' : 'text-purple-500'}`} />
                            <span className={`font-medium text-sm ${isZeroVerdeling ? 'text-gray-500' : ''}`}>{partner.naam}</span>
                            {partner.verdelingPercentage !== null && (
                              <Badge
                                variant="secondary"
                                className={`text-xs ${isZeroVerdeling ? 'bg-gray-200 text-gray-600' : ''}`}
                              >
                                {partner.verdelingPercentage}% verdeling
                              </Badge>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {/* Always show belasting if we have it, or show €0 if verdeling is 0% */}
                            {(partner.belastingBedrag !== null || isZeroVerdeling) && (
                              <div className={`text-center p-2 rounded-lg ${isZeroVerdeling ? 'bg-gray-100' : 'bg-green-50'}`}>
                                <p className="text-xs text-muted-foreground">Belasting</p>
                                <p className={`text-lg font-semibold ${isZeroVerdeling ? 'text-gray-500' : 'text-green-600'}`}>
                                  {formatCurrency(partner.belastingBedrag ?? 0)}
                                </p>
                              </div>
                            )}
                            {/* Always show vermogen if we have it, or show €0 if verdeling is 0% */}
                            {(partner.totaalBezittingen !== null || isZeroVerdeling) && (
                              <div className={`text-center p-2 rounded-lg ${isZeroVerdeling ? 'bg-gray-100' : 'bg-blue-50'}`}>
                                <p className="text-xs text-muted-foreground">Vermogen (Box 3)</p>
                                <p className={`text-lg font-semibold ${isZeroVerdeling ? 'text-gray-500' : 'text-blue-600'}`}>
                                  {formatCurrency(partner.totaalBezittingen ?? 0)}
                                </p>
                                {isZeroVerdeling && (
                                  <p className="text-xs text-gray-400 mt-1">0% toegedeeld</p>
                                )}
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

          {/* Light Document Status when no validationResult but we have bijlageAnalyse */}
          {!validationResult && sessionBijlageAnalyse && sessionBijlageAnalyse.length > 0 && (
            <LightDocumentStatus
              bijlageAnalyse={sessionBijlageAnalyse}
              jaar={jaar}
            />
          )}

          {/* Data Status Overview - shows what data we have and what's missing for calculation */}
          {sessionBijlageAnalyse && sessionBijlageAnalyse.length > 0 && (
            <DataStatusOverview
              bijlageAnalyse={sessionBijlageAnalyse}
              jaar={jaar}
              validationResult={validationResult}
            />
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
