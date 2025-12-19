/**
 * Shared Constants
 *
 * Gedeelde constanten voor gebruik in client en server.
 * Voorkomt duplicatie van configuratie waarden.
 *
 * @see docs/STAGES.md voor volledige stage documentatie
 */

// ═══════════════════════════════════════════════════════════════════════════
// STAGE TYPES - Type-safe stage identifiers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Alle mogelijke stage IDs in de workflow.
 *
 * BELANGRIJK: Als je een nieuwe stage toevoegt, update ook:
 * - STAGE_NAMES (hieronder)
 * - STAGE_ORDER (indien in workflow)
 * - shared/schema.ts → stageIdSchema
 * - shared/schema.ts → promptConfigSchema
 * - server/services/report-generator.ts → executeStage() switch
 *
 * @see docs/STAGES.md voor complete checklist
 */
export const ALL_STAGE_IDS = [
  '1a_informatiecheck',
  '1b_informatiecheck_email',
  '2_complexiteitscheck',
  '3_generatie',
  '4a_BronnenSpecialist',
  '4b_FiscaalTechnischSpecialist',
  '4c_ScenarioGatenAnalist',
  '4e_DeAdvocaat',
  '4f_HoofdCommunicatie',
  '6_change_summary',
  '7_fiscale_briefing',
  'editor',      // Helper stage - niet in STAGE_ORDER
  'adjustment',  // Helper stage - niet in STAGE_ORDER
] as const;

/** Type-safe stage ID - gebruik dit in plaats van `string` */
export type StageIdType = typeof ALL_STAGE_IDS[number];

/**
 * Type guard om te checken of een string een geldige stage ID is
 *
 * @example
 * ```typescript
 * if (isValidStageId(userInput)) {
 *   // TypeScript weet nu dat userInput een StageIdType is
 *   executeStage(userInput);
 * }
 * ```
 */
export function isValidStageId(id: string): id is StageIdType {
  return ALL_STAGE_IDS.includes(id as StageIdType);
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE CLASSIFICATIONS - Begrijp wat elke stage doet
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stage types met hun gedrag:
 *
 * - **analyzer**: Analyseert input, produceert JSON (geen rapport tekst)
 * - **generator**: Genereert rapport content (Stage 3)
 * - **reviewer**: Reviewt rapport, produceert feedback/changeProposals
 * - **processor**: Past feedback toe op rapport (editor stage)
 * - **summarizer**: Samenvat wijzigingen/briefing
 */
export type StageType = 'analyzer' | 'generator' | 'reviewer' | 'processor' | 'summarizer';

/**
 * Classificatie per stage - welk type gedrag heeft deze stage?
 *
 * Dit helpt developers begrijpen wat een stage doet zonder de code te lezen.
 */
export const STAGE_TYPES: Record<StageIdType, StageType> = {
  '1a_informatiecheck': 'analyzer',
  '1b_informatiecheck_email': 'analyzer',
  '2_complexiteitscheck': 'analyzer',
  '3_generatie': 'generator',
  '4a_BronnenSpecialist': 'reviewer',
  '4b_FiscaalTechnischSpecialist': 'reviewer',
  '4c_ScenarioGatenAnalist': 'reviewer',
  '4e_DeAdvocaat': 'reviewer',
  '4f_HoofdCommunicatie': 'reviewer',
  '6_change_summary': 'summarizer',
  '7_fiscale_briefing': 'summarizer',
  'editor': 'processor',
  'adjustment': 'processor',
} as const;

/**
 * Helper: Is dit een reviewer stage?
 */
export function isReviewerStage(stageId: string): boolean {
  return isValidStageId(stageId) && STAGE_TYPES[stageId] === 'reviewer';
}

/**
 * Helper: Produceert deze stage rapport content?
 * (generator en processor stages doen dit)
 */
export function producesReportContent(stageId: string): boolean {
  if (!isValidStageId(stageId)) return false;
  const type = STAGE_TYPES[stageId];
  return type === 'generator' || type === 'processor';
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE NAMES & ORDER - UI en workflow
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stage namen voor weergave in de UI
 * Mappen van stage ID naar Nederlandse weergavenaam
 */
export const STAGE_NAMES: Record<StageIdType, string> = {
  '1a_informatiecheck': 'Informatie Analyse',
  '1b_informatiecheck_email': 'Email Generatie',
  '2_complexiteitscheck': 'Complexiteits Check',
  '3_generatie': 'Basis Rapport',
  '4a_BronnenSpecialist': 'Bronnen Review',
  '4b_FiscaalTechnischSpecialist': 'Fiscaal Technisch',
  '4c_ScenarioGatenAnalist': 'Scenario Analyse',
  '4e_DeAdvocaat': 'Juridisch Review',
  '4f_HoofdCommunicatie': 'Hoofd Communicatie',
  '6_change_summary': 'Wijzigingen Samenvatting',
  '7_fiscale_briefing': 'Fiscale Briefing',
  'editor': 'Feedback Verwerker',
  'adjustment': 'Rapport Aanpasser',
} as const;

/**
 * Volgorde van stages in de workflow
 *
 * LET OP: Dit bevat NIET alle stages!
 * - 'editor' en 'adjustment' zijn helper stages (niet in workflow)
 * - '6_change_summary' en '7_fiscale_briefing' zijn optioneel/apart
 *
 * Gebruikt voor:
 * - Cascading deletes (verwijder alle stages NA een bepaalde stage)
 * - UI navigatie (welke stage is volgende?)
 * - Workflow validatie (mag deze stage nu draaien?)
 */
export const STAGE_ORDER = [
  '1a_informatiecheck',
  '1b_informatiecheck_email', // Only runs if 1a returns INCOMPLEET
  '2_complexiteitscheck',
  '3_generatie',
  '4a_BronnenSpecialist',
  '4b_FiscaalTechnischSpecialist',
  '4c_ScenarioGatenAnalist',
  '4e_DeAdvocaat',
  '4f_HoofdCommunicatie'
] as const;

/** Type voor stages die in de workflow order zitten */
export type WorkflowStageId = typeof STAGE_ORDER[number];

/**
 * Review stages (4a-4f) die feedback processing ondersteunen
 *
 * Deze stages:
 * - Produceren feedback JSON (niet rapport tekst)
 * - Hebben changeProposals output
 * - Kunnen "Process Feedback" actie triggeren → roept 'editor' stage aan
 */
export const REVIEW_STAGES = [
  '4a_BronnenSpecialist',
  '4b_FiscaalTechnischSpecialist',
  '4c_ScenarioGatenAnalist',
  '4e_DeAdvocaat',
  '4f_HoofdCommunicatie'
] as const;

/** Type voor reviewer stage IDs */
export type ReviewerStageId = typeof REVIEW_STAGES[number];

// NOTE: Timeouts zijn verplaatst naar server/config/constants.ts
// Dit bestand bevat alleen shared constanten voor client EN server (stage names, etc.)
// Server-side timeouts horen niet in shared code.
// @see server/config/constants.ts voor TIMEOUTS

/**
 * Helper functie om stage naam op te halen
 * @param stageId - De stage identifier
 * @returns De Nederlandse weergavenaam of de originele ID als fallback
 */
export function getStageName(stageId: string): string {
  if (isValidStageId(stageId)) {
    return STAGE_NAMES[stageId];
  }
  return stageId;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONCEPT REPORT VERSIONING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ## ConceptReportVersions - Het Versie Tracking Systeem
 *
 * Dit is het **meest complexe data model** in de codebase. Hier is hoe het werkt:
 *
 * ### Structuur
 *
 * ```typescript
 * conceptReportVersions = {
 *   // Stage snapshots - elk bevat een volledige rapport versie
 *   "3_generatie": { v: 1, content: "...", createdAt: "..." },
 *   "4a_BronnenSpecialist": { v: 2, content: "...", from: "3_generatie" },
 *
 *   // Metadata
 *   latest: { pointer: "4a_BronnenSpecialist", v: 2 },  // Wijst naar nieuwste
 *   history: [{ stageId: "3_generatie", v: 1, timestamp: "..." }, ...]
 * }
 * ```
 *
 * ### Invarianten (MOETEN altijd waar zijn)
 *
 * 1. `latest.pointer` wijst naar een bestaande stage key
 * 2. `latest.v` is de hoogste versie nummer
 * 3. Elke snapshot heeft `from` die naar vorige stage wijst (behalve "3_generatie")
 * 4. `history` array is chronologisch gesorteerd
 *
 * ### Waarom reviewers GEEN snapshot krijgen
 *
 * Stages 4a-4f zijn reviewers. Ze produceren FEEDBACK, niet rapport tekst.
 * Hun output gaat naar `stageResults[stageId]`, niet naar conceptVersions.
 *
 * Pas na "Process Feedback" wordt de feedback toegepast en krijgt de stage
 * een snapshot in conceptVersions (met het GEWIJZIGDE rapport).
 *
 * @see docs/STAGES.md voor complete uitleg
 */
export interface ConceptVersionsMap {
  /** Pointer naar de meest recente versie */
  latest?: { pointer: string; v: number };
  /** Chronologische geschiedenis van alle versies */
  history?: Array<{ stageId: string; v: number; timestamp: string }>;
  /** Stage snapshots - dynamische keys */
  [stageKey: string]: any;
}

/**
 * Snapshot van een concept rapport op een bepaald moment
 */
export interface ConceptSnapshot {
  /** Versie nummer (incrementeert per stage) */
  v: number;
  /** De volledige rapport tekst op dit moment */
  content: string;
  /** Van welke stage deze versie is afgeleid (behalve bij "3_generatie") */
  from?: string;
  /** Timestamp van creatie */
  createdAt?: string;
  /** De feedback die verwerkt is om deze versie te maken */
  processedFeedback?: string;
}

/**
 * Extract de content uit een snapshot (ondersteunt beide formaten)
 *
 * Sommige legacy data heeft snapshots als plain strings in plaats van objects.
 * Deze functie handelt beide gevallen af.
 *
 * @param snapshot - Object met content property of directe string
 * @returns De content string of undefined
 */
function extractSnapshotContent(snapshot: any): string | undefined {
  if (!snapshot) return undefined;
  // Legacy format: snapshot is direct een string
  if (typeof snapshot === 'string' && snapshot.length > 0) return snapshot;
  // Modern format: snapshot is object met content property
  if (typeof snapshot === 'object' && snapshot.content) return snapshot.content;
  return undefined;
}

/**
 * Valideer de integriteit van conceptReportVersions
 *
 * Gebruik dit in debug/development om te checken of de data consistent is.
 *
 * @param conceptVersions - Het conceptReportVersions object
 * @returns Array van waarschuwingen (leeg = geen problemen)
 *
 * @example
 * ```typescript
 * const warnings = validateConceptVersions(report.conceptReportVersions);
 * if (warnings.length > 0) {
 *   console.warn('ConceptVersions inconsistencies:', warnings);
 * }
 * ```
 */
export function validateConceptVersions(conceptVersions: ConceptVersionsMap | null | undefined): string[] {
  const warnings: string[] = [];

  if (!conceptVersions) {
    return ['conceptVersions is null/undefined'];
  }

  const { latest, history, ...snapshots } = conceptVersions;

  // Check 1: latest.pointer wijst naar bestaande snapshot
  if (latest?.pointer) {
    if (!snapshots[latest.pointer]) {
      warnings.push(`latest.pointer "${latest.pointer}" wijst naar non-existent snapshot`);
    }
  }

  // Check 2: Version nummers zijn consistent
  if (latest?.v) {
    const maxV = Math.max(0, ...Object.values(snapshots)
      .filter(s => s && typeof s === 'object' && typeof s.v === 'number')
      .map((s: any) => s.v));
    if (latest.v !== maxV) {
      warnings.push(`latest.v (${latest.v}) komt niet overeen met hoogste snapshot v (${maxV})`);
    }
  }

  // Check 3: "from" chains zijn valide
  for (const [key, snapshot] of Object.entries(snapshots)) {
    if (snapshot && typeof snapshot === 'object' && snapshot.from) {
      if (key !== '3_generatie' && !snapshots[snapshot.from]) {
        warnings.push(`Snapshot "${key}" heeft from="${snapshot.from}" die niet bestaat`);
      }
    }
  }

  return warnings;
}

/**
 * Haal de meest recente concept tekst op uit conceptReportVersions
 *
 * ## Zoeklogica (in volgorde):
 *
 * 1. Volg de 'latest' pointer naar de juiste snapshot
 * 2. Fallback naar '3_generatie' (eerste rapport versie)
 * 3. Zoek naar enige snapshot (excl. reviewer stages 4a-4f)
 *
 * ## Waarom skippen we 4a-4f snapshots in fallback?
 *
 * Reviewer stages produceren GEEN rapport tekst, alleen feedback.
 * Als ze een snapshot hebben, is dat het resultaat van "Process Feedback" -
 * maar we willen daar niet blind naar fallbacken.
 *
 * @param conceptVersions - Het conceptReportVersions object van een report
 * @returns De meest recente concept tekst, of lege string als niet gevonden
 *
 * @example
 * ```typescript
 * const reportText = getLatestConceptText(report.conceptReportVersions);
 * if (!reportText) {
 *   console.warn('Geen rapport tekst gevonden - is Stage 3 al uitgevoerd?');
 * }
 * ```
 */
export function getLatestConceptText(conceptVersions: ConceptVersionsMap | null | undefined): string {
  if (!conceptVersions) return '';

  // 1. Probeer de 'latest' pointer te volgen (skip stage 7 briefing)
  const latest = conceptVersions.latest;
  if (latest?.pointer && !latest.pointer.startsWith('7')) {
    const snapshot = conceptVersions[latest.pointer];
    const content = extractSnapshotContent(snapshot);
    if (content) return content;
  }

  // 2. Fallback: probeer '3_generatie' (het basis rapport)
  const stage3Content = extractSnapshotContent(conceptVersions['3_generatie']);
  if (stage3Content) return stage3Content;

  // 3. Zoek naar enige geldige snapshot (excl. metadata, reviewer stages, en briefing)
  const foundEntry = Object.entries(conceptVersions).find(([key, value]) => {
    // Skip metadata keys, reviewer stages (4*), en fiscale briefing (7*)
    if (key === 'latest' || key === 'history' || key.startsWith('4') || key.startsWith('7')) return false;
    return extractSnapshotContent(value) !== undefined;
  });

  if (foundEntry) {
    return extractSnapshotContent(foundEntry[1]) || '';
  }

  return '';
}

// ═══════════════════════════════════════════════════════════════════════════
// BOX3 VALIDATOR CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Box3 module constants - shared between client and server
 */
export const BOX3_CONSTANTS = {
  /**
   * Minimum indicative refund (EUR) to be considered profitable.
   * Below this amount, the cost of filing an objection exceeds the potential benefit.
   */
  MINIMUM_PROFITABLE_AMOUNT: 250,

  /**
   * Request timeout for AI processing (ms) - 5 minutes.
   * Used for validation and revalidation requests that involve LLM processing.
   */
  AI_TIMEOUT_MS: 5 * 60 * 1000,

  /**
   * Maximum file size for uploads (bytes) - 25MB.
   * Lower than general upload limit due to vision processing constraints.
   */
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,

  /**
   * Maximum file size for uploads (MB) - for display purposes.
   */
  MAX_FILE_SIZE_MB: 25,

  /**
   * Maximum number of files per upload request.
   */
  MAX_FILES_PER_UPLOAD: 10,

  /**
   * Allowed file types for Box3 uploads.
   */
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'text/plain',
    'application/octet-stream', // For .pdf and .txt with incorrect mime
    'image/jpeg',
    'image/png',
  ] as const,

  /**
   * Allowed file extensions for Box3 uploads.
   */
  ALLOWED_EXTENSIONS: ['pdf', 'txt', 'jpg', 'jpeg', 'png'] as const,

  /**
   * Box 3 tax rates per year (decimal form, e.g., 0.36 = 36%)
   * Source: https://www.rijksoverheid.nl/onderwerpen/inkomstenbelasting/box-3
   */
  TAX_RATES: {
    '2025': 0.36,
    '2024': 0.36,
    '2023': 0.32,
    '2022': 0.31,
    '2021': 0.31,
    '2020': 0.30,
    '2019': 0.30,
    '2018': 0.30,
    '2017': 0.30,
  } as Record<string, number>,
} as const;
