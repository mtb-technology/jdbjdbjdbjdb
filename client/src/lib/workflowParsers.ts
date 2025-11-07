import type { InformatieCheckOutput, BouwplanData } from "@shared/schema";

/**
 * Attempts to parse JSON from various formats:
 * 1. Direct JSON
 * 2. Markdown code blocks (```json ... ```)
 * 3. Embedded JSON in text
 *
 * @param rawOutput - The raw string output from AI
 * @param jsonPattern - Optional regex pattern to find JSON in text
 * @returns Parsed object or null if parsing fails
 */
function parseJSONWithFallbacks<T>(
  rawOutput: string,
  jsonPattern?: RegExp
): T | null {
  if (!rawOutput?.trim()) {
    return null;
  }

  // Try 1: Direct JSON parse
  try {
    return JSON.parse(rawOutput) as T;
  } catch (error) {
    console.debug("Direct JSON parse failed, trying fallbacks...");
  }

  // Try 2: Extract from markdown code blocks
  const markdownMatch = rawOutput.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (markdownMatch) {
    try {
      return JSON.parse(markdownMatch[1]) as T;
    } catch (error) {
      console.error("Failed to parse JSON from markdown code block:", error);
    }
  }

  // Try 3: Find JSON object in text using custom pattern
  if (jsonPattern) {
    const patternMatch = rawOutput.match(jsonPattern);
    if (patternMatch) {
      try {
        return JSON.parse(patternMatch[0]) as T;
      } catch (error) {
        console.error("Failed to parse JSON from pattern match:", error);
      }
    }
  }

  return null;
}

/**
 * Parses the output from Stage 1 (Informatiecheck)
 *
 * @param rawOutput - Raw AI output string
 * @returns Parsed InformatieCheckOutput or null
 */
export function parseInformatieCheckOutput(rawOutput: string): InformatieCheckOutput | null {
  const jsonPattern = /\{[\s\S]*"status"\s*:\s*"(COMPLEET|INCOMPLEET)"[\s\S]*\}/;
  return parseJSONWithFallbacks<InformatieCheckOutput>(rawOutput, jsonPattern);
}

/**
 * Parses the output from Stage 2 (Complexiteitscheck/Bouwplan)
 *
 * @param rawOutput - Raw AI output string
 * @returns Parsed BouwplanData or null
 */
export function parseBouwplanData(rawOutput: string): BouwplanData | null {
  const jsonPattern = /\{[\s\S]*"fiscale_kernthemas"[\s\S]*\}/;
  return parseJSONWithFallbacks<BouwplanData>(rawOutput, jsonPattern);
}

/**
 * Checks if Stage 1 (Informatiecheck) is complete and allows progression to Stage 2
 *
 * @param stage1Output - Raw output from stage 1
 * @returns true if stage 1 is COMPLEET, false otherwise
 */
export function isInformatieCheckComplete(stage1Output: string | undefined): boolean {
  if (!stage1Output) {
    return false;
  }

  const parsed = parseInformatieCheckOutput(stage1Output);
  if (!parsed) {
    // Backward compatibility: if parsing fails, assume old format and allow progression
    return true;
  }

  return parsed.status === "COMPLEET";
}

/**
 * Gets a user-friendly message explaining why stage 2 is blocked
 *
 * @param stage1Output - Raw output from stage 1
 * @returns Block reason message or null if not blocked
 */
export function getStage2BlockReason(stage1Output: string | undefined): string | null {
  if (!stage1Output) {
    return "Stage 1 moet eerst worden uitgevoerd";
  }

  const parsed = parseInformatieCheckOutput(stage1Output);
  if (!parsed) {
    // Can't parse, assume OK (backward compatibility)
    return null;
  }

  if (parsed.status === "INCOMPLEET") {
    return "Stage 1 heeft ontbrekende informatie geconstateerd. Verstuur eerst de e-mail naar de klant en voer Stage 1 opnieuw uit na ontvangst van de informatie.";
  }

  return null;
}
