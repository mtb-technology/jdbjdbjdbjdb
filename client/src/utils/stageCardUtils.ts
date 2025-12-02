/**
 * Stage Card Utility Functions
 *
 * Pure utility functions for workflow stage cards.
 * Extracted from WorkflowStageCard.tsx lines 98-139.
 */

/**
 * Generate output preview (first ~120 chars, cleaned)
 */
export function getOutputPreview(
  output: string | undefined,
  stageKey: string
): string | null {
  if (!output) return null;

  // Clean markdown and special chars
  let cleaned = output
    .replace(/^#+\s*/gm, "") // Remove headers
    .replace(/\*\*/g, "") // Remove bold
    .replace(/\n+/g, " ") // Replace newlines with spaces
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();

  // Stage-specific preview extraction
  if (stageKey === "1_informatiecheck") {
    const klantMatch = cleaned.match(/Klant[^:]*:\s*([^,\n]+)/i);
    if (klantMatch) {
      return `Klant: ${klantMatch[1].trim().substring(0, 60)}`;
    }
  }

  // Default: first 120 chars
  if (cleaned.length > 120) {
    return cleaned.substring(0, 120) + "...";
  }
  return cleaned.length > 10 ? cleaned : null;
}

/**
 * Stage-specific result labels
 */
const RESULT_LABELS: Record<string, string> = {
  "1_informatiecheck": "Dossieranalyse",
  "2_complexiteitscheck": "Bouwplan",
  "3_generatie": "Concept rapport",
  "4a_BronnenSpecialist": "Bronnen feedback",
  "4b_FiscaalTechnischSpecialist": "Fiscale feedback",
  "4c_ScenarioGatenAnalist": "Scenario feedback",
  "4e_DeAdvocaat": "Juridische feedback",
  "4f_HoofdCommunicatie": "Communicatie feedback",
  "6_change_summary": "Wijzigingsoverzicht",
};

/**
 * Get result label for a stage
 */
export function getResultLabel(stageKey: string): string {
  return RESULT_LABELS[stageKey] || "Resultaat";
}

/**
 * Stages that support manual mode
 */
const MANUAL_MODE_STAGES = [
  "3_generatie",
  "4a_BronnenSpecialist",
  "4b_FiscaalTechnischSpecialist",
];

/**
 * Check if a stage supports manual mode
 */
export function supportsManualMode(stageKey: string): boolean {
  return MANUAL_MODE_STAGES.includes(stageKey);
}

/**
 * Get card border/background classes based on status
 */
export function getStatusCardClasses(status: string): string {
  const classMap: Record<string, string> = {
    completed: "border-jdb-success/30 bg-green-50/30 dark:bg-green-950/10",
    feedback_ready:
      "border-orange-400/50 bg-orange-50/40 dark:bg-orange-950/20 shadow-md",
    processing:
      "border-jdb-blue-primary/30 bg-jdb-blue-light/30 dark:bg-jdb-blue-primary/10 shadow-lg",
    blocked: "border-jdb-warning/30 bg-amber-50/30 dark:bg-amber-950/10",
    error: "border-jdb-danger/30 bg-red-50/30 dark:bg-red-950/10",
  };
  return classMap[status] || "";
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
