/**
 * Box 3 Validator Utility Functions
 *
 * Pure utility functions extracted from box3-validator.tsx
 */

import type { Box3ValidationResult, Box3ManualOverrides } from "@shared/schema";
import {
  FORFAITAIRE_RENDEMENTEN,
  BOX3_TARIEVEN,
  type ForfaitaireRendementen,
} from "@/constants/box3.constants";

/**
 * Rendement berekening result type (legacy V1)
 */
export interface RendementBerekening {
  bankRente: number | null;
  beleggingenBegin: number | null;
  beleggingenEind: number | null;
  beleggingenDividend: number | null;
  beleggingenMutatiesGevonden: boolean;
  schuldenRente: number | null;
  forfaitairRendement: number | null;
  belastbaarInkomen: number | null;
  werkelijkRendement: number | null;
  verschil: number | null;
  indicatieveTeruggave: number | null;
  isKansrijk: boolean | null;
  missendVoorBerekening: string[];
  gebruiktTarief: number;
  gebruiktJaar: string | null;
}

/**
 * Get forfaitaire rendementen for a specific year
 */
export const getForfaitaireRendementen = (
  jaar: string | null | undefined
): ForfaitaireRendementen | null => {
  if (!jaar) return null;
  return FORFAITAIRE_RENDEMENTEN[jaar] || null;
};

/**
 * Get Box 3 tarief (tax percentage) for a specific year
 */
export const getBox3Tarief = (jaar: string | null | undefined): number => {
  if (!jaar) return 0.36; // default to most recent
  return BOX3_TARIEVEN[jaar] || 0.36;
};

/**
 * Key mapping from our category keys to AI output keys
 */
const CATEGORY_KEY_MAPPING: Record<string, string> = {
  aangifte_ib: "aangifte_ib",
  bankrekeningen: "bank",
  beleggingen: "beleggingen",
  vastgoed: "vastgoed",
  schulden: "schulden",
};

/**
 * Get document status from both new and legacy format
 */
export const getDocumentStatus = (
  result: Box3ValidationResult,
  categoryKey: string
): string => {
  // Try legacy format first (validatie object)
  if (result.validatie) {
    const legacyVal = result.validatie[categoryKey as keyof typeof result.validatie];
    if (legacyVal?.status) {
      return legacyVal.status;
    }
  }

  // Try new format (document_validatie)
  if (result.document_validatie) {
    const mappedKey = CATEGORY_KEY_MAPPING[categoryKey] || categoryKey;
    const newVal =
      result.document_validatie[mappedKey as keyof typeof result.document_validatie];
    if (newVal) {
      return newVal;
    }
  }

  // Default: ontbreekt
  return "ontbreekt";
};

/**
 * Get effective document status considering manual overrides
 * Manual overrides take precedence over AI-detected status
 */
export const getEffectiveDocumentStatus = (
  result: Box3ValidationResult,
  categoryKey: string,
  manualOverrides?: Box3ManualOverrides | null
): string => {
  // Check for manual override first
  const override = manualOverrides?.[categoryKey as keyof Omit<Box3ManualOverrides, 'extraValues'>];
  if (override?.status) {
    return override.status;
  }

  // Fall back to AI-detected status
  return getDocumentStatus(result, categoryKey);
};

/**
 * Check if a category has a manual override
 */
export const hasManualOverride = (
  categoryKey: string,
  manualOverrides?: Box3ManualOverrides | null
): boolean => {
  if (!manualOverrides) return false;
  const override = manualOverrides[categoryKey as keyof Omit<Box3ManualOverrides, 'extraValues'>];
  return override?.status !== undefined || override?.value !== undefined;
};

/**
 * Get manual override note for a category
 */
export const getOverrideNote = (
  categoryKey: string,
  manualOverrides?: Box3ManualOverrides | null
): string | null => {
  if (!manualOverrides) return null;
  const override = manualOverrides[categoryKey as keyof Omit<Box3ManualOverrides, 'extraValues'>];
  return override?.note || null;
};

/**
 * Get document feedback from legacy format
 */
export const getDocumentFeedback = (
  result: Box3ValidationResult,
  categoryKey: string
): string | null => {
  if (result.validatie) {
    const legacyVal = result.validatie[categoryKey as keyof typeof result.validatie];
    if (legacyVal?.feedback) {
      return legacyVal.feedback;
    }
  }
  return null;
};

/**
 * Get "gevonden_in" documents from legacy format
 */
export const getDocumentGevondenIn = (
  result: Box3ValidationResult,
  categoryKey: string
): string[] | null => {
  if (result.validatie) {
    const legacyVal = result.validatie[categoryKey as keyof typeof result.validatie];
    if (legacyVal?.gevonden_in) {
      return legacyVal.gevonden_in;
    }
  }
  return null;
};

/**
 * Calculate kansrijkheid (profitability) based on validation result
 * Now supports manual overrides for values
 */
export const berekenKansrijkheid = (
  result: Box3ValidationResult,
  belastingjaar: string | null | undefined,
  manualOverrides?: Box3ManualOverrides | null
): RendementBerekening => {
  const tarief = getBox3Tarief(belastingjaar);
  const data = result.gevonden_data?.werkelijk_rendement_input;
  const fiscus = result.gevonden_data?.fiscus_box3;
  const extraValues = manualOverrides?.extraValues;

  // Use manual override values if available, otherwise fall back to AI-extracted values
  const berekening: RendementBerekening = {
    bankRente: extraValues?.bank_rente_ontvangen ?? data?.bank_rente_ontvangen ?? null,
    beleggingenBegin: extraValues?.beleggingen_waarde_1jan ?? data?.beleggingen_waarde_1jan ?? null,
    beleggingenEind: extraValues?.beleggingen_waarde_31dec ?? data?.beleggingen_waarde_31dec ?? null,
    beleggingenDividend: extraValues?.beleggingen_dividend ?? data?.beleggingen_dividend ?? null,
    beleggingenMutatiesGevonden: data?.beleggingen_mutaties_gevonden ?? false,
    schuldenRente: extraValues?.schulden_rente_betaald ?? data?.schulden_rente_betaald ?? null,
    forfaitairRendement: null, // Must come from aangifte
    belastbaarInkomen: fiscus?.belastbaar_inkomen_na_drempel ?? null,
    werkelijkRendement: null,
    verschil: null,
    indicatieveTeruggave: null,
    isKansrijk: null,
    missendVoorBerekening: [],
    gebruiktTarief: tarief,
    gebruiktJaar: belastingjaar || null,
  };

  // Check what's missing for a complete calculation
  if (berekening.bankRente === null) {
    berekening.missendVoorBerekening.push("Ontvangen bankrente");
  }
  if (berekening.beleggingenBegin === null && berekening.beleggingenEind !== null) {
    berekening.missendVoorBerekening.push("Beginwaarde beleggingen (1 jan)");
  }
  if (berekening.beleggingenEind === null && berekening.beleggingenBegin !== null) {
    berekening.missendVoorBerekening.push("Eindwaarde beleggingen (31 dec)");
  }
  if (
    berekening.beleggingenBegin !== null &&
    berekening.beleggingenEind !== null &&
    !berekening.beleggingenMutatiesGevonden
  ) {
    berekening.missendVoorBerekening.push("Stortingen/onttrekkingen beleggingen");
  }
  if (berekening.belastbaarInkomen === null) {
    berekening.missendVoorBerekening.push("Belastbaar inkomen uit aangifte");
  }

  // Calculate actual return (simplified - without mutation correction)
  let werkelijk = 0;
  let heeftData = false;

  if (berekening.bankRente !== null) {
    werkelijk += berekening.bankRente;
    heeftData = true;
  }

  if (berekening.beleggingenDividend !== null) {
    werkelijk += berekening.beleggingenDividend;
    heeftData = true;
  }

  // Capital gains/losses (without mutation correction - indicative)
  if (berekening.beleggingenBegin !== null && berekening.beleggingenEind !== null) {
    const koersresultaat = berekening.beleggingenEind - berekening.beleggingenBegin;
    werkelijk += koersresultaat;
    heeftData = true;
  }

  // Deduct paid interest
  if (berekening.schuldenRente !== null) {
    werkelijk -= berekening.schuldenRente;
  }

  if (heeftData) {
    berekening.werkelijkRendement = werkelijk;

    // If we have belastbaar inkomen, we can compare
    if (berekening.belastbaarInkomen !== null && berekening.belastbaarInkomen > 0) {
      const geschatForfaitair = berekening.belastbaarInkomen;
      berekening.forfaitairRendement = geschatForfaitair;
      berekening.verschil = geschatForfaitair - werkelijk;

      if (berekening.verschil > 0) {
        berekening.indicatieveTeruggave = berekening.verschil * tarief;
        berekening.isKansrijk = true;
      } else {
        berekening.indicatieveTeruggave = 0;
        berekening.isKansrijk = false;
      }
    }
  }

  return berekening;
};

/**
 * Format currency in Dutch locale
 */
export const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(value);
};

/**
 * Strip HTML tags and convert to plain text for email copying
 */
export const stripHtmlToPlainText = (html: string): string => {
  if (!html) return "";

  return (
    html
      // Replace <br> and <br/> with newlines
      .replace(/<br\s*\/?>/gi, "\n")
      // Replace </p> with double newlines (paragraph breaks)
      .replace(/<\/p>/gi, "\n\n")
      // Replace other block-level closing tags with newlines
      .replace(/<\/(div|h[1-6]|li|tr)>/gi, "\n")
      // Replace <li> with bullet points
      .replace(/<li[^>]*>/gi, "• ")
      // Remove all remaining HTML tags
      .replace(/<[^>]*>/g, "")
      // Decode common HTML entities
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&euro;/g, "€")
      // Clean up excessive newlines (more than 2 in a row)
      .replace(/\n{3,}/g, "\n\n")
      // Trim whitespace
      .trim()
  );
};

/**
 * Extract belastingjaar from validation result (handles all formats)
 */
export const extractBelastingjaar = (
  result: Box3ValidationResult | null
): string | undefined => {
  if (!result) return undefined;

  // NEW FORMAT: jaren_data has the years as keys
  if (result.jaren_data) {
    const years = Object.keys(result.jaren_data).sort();
    if (years.length > 0) {
      return years[0]; // Return first year
    }
  }

  // LEGACY FORMAT
  const raw =
    result.gevonden_data?.algemeen?.belastingjaar || result.belastingjaar;
  return raw != null ? String(raw) : undefined;
};

/**
 * Extract all belastingjaren from validation result (for multi-year dossiers)
 */
export const extractAllBelastingjaren = (
  result: Box3ValidationResult | null
): string[] => {
  if (!result) return [];

  // NEW FORMAT: jaren_data has the years as keys
  if (result.jaren_data) {
    return Object.keys(result.jaren_data).sort();
  }

  // LEGACY FORMAT: single year
  const raw =
    result.gevonden_data?.algemeen?.belastingjaar || result.belastingjaar;
  return raw != null ? [String(raw)] : [];
};

/**
 * Check if validation result uses NEW "Senior Fiscaal Jurist" format
 */
export const isNewJuristFormat = (result: Box3ValidationResult | null): boolean => {
  if (!result) return false;
  return !!(result.jaren_data || result.betrokken_personen || result.dossier_meta);
};

/**
 * Check if validation result uses legacy format (old prompt)
 */
export const isNewFormat = (result: Box3ValidationResult | null): boolean => {
  if (!result) return false;
  // This now includes both old "new" format and the newest jurist format
  return !!(result.gevonden_data || result.global_status || result.jaren_data);
};

/**
 * Get mail data from validation result (handles both formats)
 */
export const getMailData = (
  result: Box3ValidationResult | null
): { onderwerp?: string; body?: string } | null => {
  if (!result) return null;
  return result.draft_mail || result.concept_mail || null;
};

/**
 * Get betrokken personen from validation result
 * Supports both new format (betrokken_personen) and legacy format (fiscale_partners)
 */
export const getBetrokkenPersonen = (
  result: Box3ValidationResult | null
): { id: string; naam: string | null; rol: string; geboortedatum?: string | null; bsn_mask?: string | null }[] => {
  if (!result) return [];

  // NEW FORMAT: betrokken_personen
  if (result.betrokken_personen && result.betrokken_personen.length > 0) {
    return result.betrokken_personen.map(p => ({
      id: p.id,
      naam: p.naam ?? null,
      rol: p.rol || "Onbekend",
      geboortedatum: p.geboortedatum,
      bsn_mask: p.bsn_mask,
    }));
  }

  // LEGACY FORMAT: fiscale_partners
  if (result.fiscale_partners?.partners && result.fiscale_partners.partners.length > 0) {
    return result.fiscale_partners.partners.map(p => ({
      id: p.id,
      naam: p.naam ?? null,
      rol: p.rol || "Onbekend",
    }));
  }

  return [];
};

/**
 * Check if dossier has partners (supports both formats)
 */
export const hasPartners = (result: Box3ValidationResult | null): boolean => {
  if (!result) return false;

  // NEW FORMAT
  if (result.betrokken_personen) {
    return result.betrokken_personen.length > 1;
  }

  // LEGACY FORMAT
  return result.fiscale_partners?.heeft_partner === true;
};

/**
 * Get jaar data from validation result (new format)
 */
export const getJaarData = (
  result: Box3ValidationResult | null,
  jaar: string
): {
  documentType?: string;
  datumDocument?: string | null;
  vermogensMix?: {
    bankEnSpaartegoeden?: number | null;
    overigeBezittingen?: number | null;
    onroerendeZakenWaarde?: number | null;
    schuldenBox3?: number | null;
    totaalBezittingen?: number | null;
    heffingsvrijVermogenTotaal?: number | null;
  };
  fiscaleVerdeling?: {
    grondslagSparenBeleggenTotaal?: number | null;
    aandeelPersoon1?: number | null;
    aandeelPersoon2?: number | null;
  };
  teBetalenTerugTeKrijgen?: {
    box3InkomenBerekend?: number | null;
    totaalTeBetalenAanslag?: number | null;
  };
} | null => {
  if (!result?.jaren_data?.[jaar]) return null;

  const jd = result.jaren_data[jaar];
  return {
    documentType: jd.document_type,
    datumDocument: jd.datum_document,
    vermogensMix: jd.vermogens_mix_totaal_huishouden ? {
      bankEnSpaartegoeden: jd.vermogens_mix_totaal_huishouden.bank_en_spaartegoeden,
      overigeBezittingen: jd.vermogens_mix_totaal_huishouden.overige_bezittingen,
      onroerendeZakenWaarde: jd.vermogens_mix_totaal_huishouden.onroerende_zaken_waarde,
      schuldenBox3: jd.vermogens_mix_totaal_huishouden.schulden_box_3,
      totaalBezittingen: jd.vermogens_mix_totaal_huishouden.totaal_bezittingen,
      heffingsvrijVermogenTotaal: jd.vermogens_mix_totaal_huishouden.heffingsvrij_vermogen_totaal,
    } : undefined,
    fiscaleVerdeling: jd.fiscale_verdeling ? {
      grondslagSparenBeleggenTotaal: jd.fiscale_verdeling.grondslag_sparen_beleggen_totaal,
      aandeelPersoon1: jd.fiscale_verdeling.aandeel_persoon_1,
      aandeelPersoon2: jd.fiscale_verdeling.aandeel_persoon_2,
    } : undefined,
    teBetalenTerugTeKrijgen: jd.te_betalen_terug_te_krijgen ? {
      box3InkomenBerekend: jd.te_betalen_terug_te_krijgen.box_3_inkomen_berekend,
      totaalTeBetalenAanslag: jd.te_betalen_terug_te_krijgen.totaal_te_betalen_aanslag,
    } : undefined,
  };
};

/**
 * Get global status from validation result (handles both formats)
 */
export const getGlobalStatus = (result: Box3ValidationResult | null): string | null => {
  if (!result) return null;

  // NEW FORMAT: dossier_meta.status_analyse
  if (result.dossier_meta?.status_analyse) {
    return result.dossier_meta.status_analyse;
  }

  // LEGACY FORMAT
  return result.global_status || null;
};

/**
 * Get aandachtspunten from validation result (new format only)
 */
export const getAandachtspunten = (result: Box3ValidationResult | null): string[] => {
  if (!result) return [];
  return result.aandachtspunten_voor_expert || [];
};
