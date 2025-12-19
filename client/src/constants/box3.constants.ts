/**
 * Box 3 Constants
 *
 * Forfaitaire rendementen en tarieven per belastingjaar.
 * Bron: Belastingdienst - deze percentages worden jaarlijks vastgesteld.
 */

/**
 * Forfaitaire rendementen per vermogenscategorie
 */
export interface ForfaitaireRendementen {
  spaargeld: number; // Categorie I: Banktegoeden
  beleggingen: number; // Categorie II: Overige bezittingen (aandelen, obligaties, etc.)
  schulden: number; // Categorie III: Schulden (aftrekbaar percentage)
  heffingsvrijVermogen: number; // Drempelbedrag per persoon
}

export const FORFAITAIRE_RENDEMENTEN: Record<string, ForfaitaireRendementen> = {
  "2017": {
    spaargeld: 1.63,
    beleggingen: 5.39,
    schulden: 3.43,
    heffingsvrijVermogen: 25000,
  },
  "2018": {
    spaargeld: 0.36,
    beleggingen: 5.38,
    schulden: 3.2,
    heffingsvrijVermogen: 30000,
  },
  "2019": {
    spaargeld: 0.08,
    beleggingen: 5.59,
    schulden: 3.0,
    heffingsvrijVermogen: 30360,
  },
  "2020": {
    spaargeld: 0.04,
    beleggingen: 5.28,
    schulden: 2.74,
    heffingsvrijVermogen: 30846,
  },
  "2021": {
    spaargeld: 0.03,
    beleggingen: 5.69,
    schulden: 2.46,
    heffingsvrijVermogen: 50000,
  },
  "2022": {
    spaargeld: 0.0,
    beleggingen: 5.53,
    schulden: 2.28,
    heffingsvrijVermogen: 50650,
  },
  "2023": {
    spaargeld: 0.36,
    beleggingen: 6.17,
    schulden: 2.46,
    heffingsvrijVermogen: 57000,
  },
  "2024": {
    spaargeld: 1.03,
    beleggingen: 6.04,
    schulden: 2.47,
    heffingsvrijVermogen: 57000,
  },
};

/**
 * Box 3 tarief per jaar (belastingpercentage over het forfaitaire rendement)
 * Source: https://www.rijksoverheid.nl/onderwerpen/inkomstenbelasting/box-3
 */
export const BOX3_TARIEVEN: Record<string, number> = {
  "2017": 0.30,
  "2018": 0.30,
  "2019": 0.30,
  "2020": 0.30,
  "2021": 0.31,
  "2022": 0.31,
  "2023": 0.32,
  "2024": 0.36,
  "2025": 0.36,
};

/**
 * De 5 document categorieën die we uitvragen
 */
export interface DocumentCategory {
  key: string;
  label: string;
  description: string;
  waarom: string;
  icon: string; // Icon name as string, component will map it
}

export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  {
    key: "aangifte_ib",
    label: "Aangifte inkomstenbelasting",
    description:
      "De PDF van de ingediende aangifte van het betreffende jaar.",
    waarom:
      "Dit is ons startpunt om te zien hoe de Belastingdienst uw vermogen nu heeft berekend.",
    icon: "FileText",
  },
  {
    key: "bankrekeningen",
    label: "Bankrekeningen (Rente & Valuta)",
    description:
      "Een overzicht van de daadwerkelijk ontvangen rente en eventuele valutaresultaten.",
    waarom:
      "Wij moeten aantonen dat uw werkelijk ontvangen spaarrente lager is dan het forfaitaire rendement.",
    icon: "Banknote",
  },
  {
    key: "beleggingen",
    label: "Beleggingen",
    description:
      "Overzicht met beginstand (1 jan), eindstand (31 dec), stortingen/onttrekkingen en dividenden.",
    waarom:
      "Door de begin- en eindstand te vergelijken berekenen we uw exacte vermogensgroei.",
    icon: "TrendingUp",
  },
  {
    key: "vastgoed",
    label: "Vastgoed & overige bezittingen",
    description:
      "De WOZ-waarde op 1 januari van het jaar én het jaar erna (T+1). Bij verhuur: huuroverzicht.",
    waarom:
      "Voor vastgoed telt waardestijging plus eventuele huurinkomsten als totaalrendement.",
    icon: "Building",
  },
  {
    key: "schulden",
    label: "Schulden",
    description: "Een overzicht van de schulden en de betaalde rente.",
    waarom: "Betaalde rente vermindert uw netto rendement.",
    icon: "Calculator",
  },
];

/**
 * Category key to label mapping
 */
export const CATEGORY_LABELS: Record<string, string> = {
  aangifte_ib: "Aangifte inkomstenbelasting",
  bankrekeningen: "Bankrekeningen",
  beleggingen: "Beleggingen",
  vastgoed: "Vastgoed & overige bezittingen",
  schulden: "Schulden",
};

/**
 * LocalStorage keys for persisting prompts
 */
export const STORAGE_KEY_SYSTEM_PROMPT = "box3-validator-system-prompt"; // Legacy
export const STORAGE_KEY_PROMPTS = "box3-validator-prompts"; // New multi-prompt structure

// =============================================================================
// BOX3 BUSINESS LOGIC CONSTANTS
// =============================================================================

/**
 * Minimum indicative refund to be considered profitable
 * Below this amount, the cost of filing an objection exceeds the potential benefit
 */
export const MINIMUM_PROFITABLE_AMOUNT_EUR = 250;

/**
 * Request timeout for AI processing (5 minutes)
 * Used for validation and revalidation requests that involve LLM processing
 */
export const BOX3_AI_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Maximum file size for Box3 uploads (25MB)
 * Lower than general upload limit due to vision processing constraints
 */
export const BOX3_MAX_FILE_SIZE_MB = 25;
export const BOX3_MAX_FILE_SIZE_BYTES = BOX3_MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * Maximum number of files per upload
 */
export const BOX3_MAX_FILES_PER_UPLOAD = 10;
