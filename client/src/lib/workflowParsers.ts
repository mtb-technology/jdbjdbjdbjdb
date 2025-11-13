/**
 * ## Workflow Parsers - De "Vertalers" van AI Output
 *
 * **Probleem**: AI modellen geven NIET altijd perfect geformatteerde JSON terug.
 *
 * Zelfs met de instructie "Return ONLY JSON", krijg je vaak:
 * - JSON wrapped in markdown: "```json\n{...}\n```"
 * - JSON met tekst ervoor: "Here's the analysis:\n\n{...}"
 * - JSON met escape characters of extra whitespace
 *
 * **Oplossing**: Deze parsers proberen ALLES om JSON te extracten uit rommel.
 *
 * ### Gebruik in de Pipeline:
 *
 * - **Stage 1** (Informatiecheck): Parseert `InformatieCheckOutput`
 *   → Bepaalt of pipeline mag doorgaan (COMPLEET vs INCOMPLEET)
 *
 * - **Stage 2** (Complexiteitscheck): Parseert `BouwplanData`
 *   → Extraheert fiscale thema's en bouwplan voor Stage 3
 *
 * ### Waarom Fallbacks Kritiek Zijn:
 *
 * Zonder fallbacks:
 * ```typescript
 * JSON.parse(aiOutput)  // Faalt als AI markdown wrappers gebruikt
 * → Pipeline crasht, rapport gaat verloren
 * ```
 *
 * Met fallbacks:
 * ```typescript
 * parseJSONWithFallbacks(aiOutput, pattern)
 * → Probeert 3 verschillende extractie methoden
 * → Pipeline blijft werken, zelfs met imperfecte AI output
 * ```
 *
 * @see {@link parseInformatieCheckOutput} voor Stage 1 parsing
 * @see {@link parseBouwplanData} voor Stage 2 parsing
 * @see {@link isInformatieCheckComplete} voor pipeline blokkeer logica
 */

import type { InformatieCheckOutput, BouwplanData } from "@shared/schema";

/**
 * **CORE UTILITY**: Robust JSON parser met meerdere fallback strategieën
 *
 * Probeert in volgorde:
 * 1. Direct JSON.parse() (snelste, voor perfect geformatteerde output)
 * 2. Extract uit markdown code blocks (```json ... ```)
 * 3. Regex pattern matching (voor JSON embedded in tekst)
 *
 * ### Voorbeelden van AI Output die wordt gehandled:
 *
 * **Format 1: Direct JSON** (ideaal):
 * ```
 * {"status":"COMPLEET","dossier":{...}}
 * ```
 *
 * **Format 2: Markdown wrapped** (veel modellen doen dit):
 * ```
 * ```json
 * {"status":"COMPLEET","dossier":{...}}
 * ```
 * ```
 *
 * **Format 3: Embedded in tekst**:
 * ```
 * Based on the analysis, here is the result:
 *
 * {"status":"COMPLEET","dossier":{...}}
 *
 * This indicates the file is complete.
 * ```
 *
 * @param rawOutput - De ruwe string output van AI model
 * @param jsonPattern - Optional regex om JSON in tekst te vinden
 * @returns Geparsed object of null (bij alle fallbacks gefaald)
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
    // Silent fallback to markdown/pattern extraction
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

  // Try 4: Find first complete JSON object by looking for balanced braces
  // This handles cases where there are multiple JSON objects in the text
  const firstBraceIndex = rawOutput.indexOf('{');
  if (firstBraceIndex !== -1) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = firstBraceIndex; i < rawOutput.length; i++) {
      const char = rawOutput[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') depth++;
        if (char === '}') depth--;

        if (depth === 0) {
          // Found complete JSON object
          const jsonStr = rawOutput.substring(firstBraceIndex, i + 1);
          try {
            return JSON.parse(jsonStr) as T;
          } catch (error) {
            // Not valid JSON, continue searching
            break;
          }
        }
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
  const result = parseJSONWithFallbacks<BouwplanData>(rawOutput, jsonPattern);

  // Validate that the result has the required fiscale_kernthemas key
  if (result && 'fiscale_kernthemas' in result) {
    return result;
  }

  return null;
}

/**
 * **KRITIEKE BLOKKEER LOGICA**: Bepaalt of de pipeline mag doorgaan naar Stage 2
 *
 * Dit is de "poortwachter" functie die voorkomt dat incomplete rapporten
 * door de pipeline gaan.
 *
 * ### Gedrag:
 *
 * **Scenario A: Stage 1 output = COMPLEET**
 * ```typescript
 * isInformatieCheckComplete(stage1Output) === true
 * → UI: Stage 2 button is ENABLED ✅
 * → Pipeline kan doorgaan
 * ```
 *
 * **Scenario B: Stage 1 output = INCOMPLEET**
 * ```typescript
 * isInformatieCheckComplete(stage1Output) === false
 * → UI: Stage 2 button is DISABLED ❌
 * → Gebruiker moet e-mail versturen en Stage 1 opnieuw runnen
 * ```
 *
 * **Scenario C: Stage 1 niet uitgevoerd**
 * ```typescript
 * isInformatieCheckComplete(undefined) === false
 * → UI: Stage 2 button is DISABLED ❌
 * ```
 *
 * **Scenario D: Parse failure** (backward compatibility)
 * ```typescript
 * // Stage 1 output kon niet worden geparsed als JSON
 * isInformatieCheckComplete(oldFormatOutput) === true
 * → Assume old format en sta progressie toe
 * → Voorkomt dat oude rapporten breken
 * ```
 *
 * @param stage1Output - Raw AI output van Stage 1 (Informatiecheck)
 * @returns true als pipeline mag doorgaan, false als geblokkeerd
 *
 * @see {@link getStage2BlockReason} voor gebruikersvriendelijke blokkeer message
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
 * **UI HELPER**: Geeft gebruikersvriendelijke uitleg waarom Stage 2 geblokkeerd is
 *
 * Deze functie wordt gebruikt om duidelijke foutmeldingen te tonen in de UI.
 *
 * ### Return Values:
 *
 * - `null`: Stage 2 is NIET geblokkeerd (groen licht)
 * - `string`: Stage 2 IS geblokkeerd + uitleg waarom
 *
 * ### Voorbeelden:
 *
 * ```typescript
 * // Stage 1 niet uitgevoerd
 * getStage2BlockReason(undefined)
 * → "Stage 1 moet eerst worden uitgevoerd"
 *
 * // Stage 1 = INCOMPLEET
 * getStage2BlockReason(incompletOutput)
 * → "Stage 1 heeft ontbrekende informatie geconstateerd..."
 *
 * // Stage 1 = COMPLEET
 * getStage2BlockReason(compleetOutput)
 * → null (geen blokkade)
 * ```
 *
 * @param stage1Output - Raw AI output van Stage 1
 * @returns Blokkeer reden (string) of null (niet geblokkeerd)
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
    return "Stage 1 heeft status INCOMPLEET: ontbrekende informatie geconstateerd. Verstuur eerst de e-mail naar de klant en voer Stage 1 opnieuw uit na ontvangst van de informatie.";
  }

  return null;
}

/**
 * Extracts the summary (samenvatting_onderwerp) from Stage 1 output
 *
 * @param stage1Output - Raw output from stage 1
 * @returns Summary string or null if not available
 */
export function getSamenvattingFromStage1(stage1Output: string | undefined): string | null {
  if (!stage1Output) {
    return null;
  }

  const parsed = parseInformatieCheckOutput(stage1Output);
  if (!parsed || parsed.status !== "COMPLEET" || !parsed.dossier) {
    return null;
  }

  return parsed.dossier.samenvatting_onderwerp || null;
}
