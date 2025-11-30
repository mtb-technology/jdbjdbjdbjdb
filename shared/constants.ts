/**
 * Shared Constants
 *
 * Gedeelde constanten voor gebruik in client en server.
 * Voorkomt duplicatie van configuratie waarden.
 */

/**
 * Stage namen voor weergave in de UI
 * Mappen van stage ID naar Nederlandse weergavenaam
 */
export const STAGE_NAMES: Record<string, string> = {
  '1_informatiecheck': 'Informatie Check',
  '2_complexiteitscheck': 'Complexiteits Check',
  '3_generatie': 'Basis Rapport',
  '4a_BronnenSpecialist': 'Bronnen Review',
  '4b_FiscaalTechnischSpecialist': 'Fiscaal Technisch',
  '4c_ScenarioGatenAnalist': 'Scenario Analyse',
  '4e_DeAdvocaat': 'Juridisch Review',
  '4f_HoofdCommunicatie': 'Hoofd Communicatie',
  '6_change_summary': 'Wijzigingen Samenvatting'
} as const;

/**
 * Volgorde van stages in de workflow
 * Gebruikt voor cascading deletes en navigatie
 */
export const STAGE_ORDER = [
  '1_informatiecheck',
  '2_complexiteitscheck',
  '3_generatie',
  '4a_BronnenSpecialist',
  '4b_FiscaalTechnischSpecialist',
  '4c_ScenarioGatenAnalist',
  '4e_DeAdvocaat',
  '4f_HoofdCommunicatie'
] as const;

/**
 * Review stages (4a-4f) die feedback processing ondersteunen
 */
export const REVIEW_STAGES = [
  '4a_BronnenSpecialist',
  '4b_FiscaalTechnischSpecialist',
  '4c_ScenarioGatenAnalist',
  '4e_DeAdvocaat',
  '4f_HoofdCommunicatie'
] as const;

/**
 * Timeout waarden in milliseconden
 */
export const TIMEOUTS = {
  /** Stage execution timeout (5 minuten) */
  STAGE_EXECUTION: 300_000,
  /** Deep research timeout (30 minuten) */
  DEEP_RESEARCH: 1_800_000,
  /** File upload timeout (5 minuten) */
  FILE_UPLOAD: 300_000,
} as const;

/**
 * Helper functie om stage naam op te halen
 * @param stageId - De stage identifier
 * @returns De Nederlandse weergavenaam of de originele ID als fallback
 */
export function getStageName(stageId: string): string {
  return STAGE_NAMES[stageId] || stageId;
}

/**
 * Type voor concept report versions structuur
 */
export interface ConceptVersionsMap {
  latest?: { pointer: string; v: number };
  history?: Array<{ stageId: string; v: number; timestamp: string }>;
  [stageKey: string]: any;
}

/**
 * Extract de content uit een snapshot (ondersteunt beide formaten)
 * @param snapshot - Object met content property of directe string
 * @returns De content string of undefined
 */
function extractSnapshotContent(snapshot: any): string | undefined {
  if (!snapshot) return undefined;
  if (typeof snapshot === 'string' && snapshot.length > 0) return snapshot;
  if (typeof snapshot === 'object' && snapshot.content) return snapshot.content;
  return undefined;
}

/**
 * Haal de meest recente concept tekst op uit conceptReportVersions
 *
 * Zoeklogica (in volgorde):
 * 1. Volg de 'latest' pointer naar de juiste snapshot
 * 2. Fallback naar '3_generatie' (eerste rapport versie)
 * 3. Zoek naar enige snapshot (excl. reviewer stages 4a-4f)
 *
 * @param conceptVersions - Het conceptReportVersions object van een report
 * @returns De meest recente concept tekst, of lege string als niet gevonden
 */
export function getLatestConceptText(conceptVersions: ConceptVersionsMap | null | undefined): string {
  if (!conceptVersions) return '';

  // 1. Probeer de 'latest' pointer te volgen
  const latest = conceptVersions.latest;
  if (latest?.pointer) {
    const snapshot = conceptVersions[latest.pointer];
    const content = extractSnapshotContent(snapshot);
    if (content) return content;
  }

  // 2. Fallback: probeer '3_generatie' (het basis rapport)
  const stage3Content = extractSnapshotContent(conceptVersions['3_generatie']);
  if (stage3Content) return stage3Content;

  // 3. Zoek naar enige geldige snapshot (excl. metadata en reviewer stages)
  const foundEntry = Object.entries(conceptVersions).find(([key, value]) => {
    // Skip metadata keys en reviewer stages (bevatten geen concept)
    if (key === 'latest' || key === 'history' || key.startsWith('4')) return false;
    return extractSnapshotContent(value) !== undefined;
  });

  if (foundEntry) {
    return extractSnapshotContent(foundEntry[1]) || '';
  }

  return '';
}
