/**
 * Helper functions for handling stage results consistently
 * Ensures we always show the latest result when multiple runs exist
 */

/**
 * Get the latest result for a stage, handling cases where multiple results might exist
 */
export function getLatestStageResult(stageResults: Record<string, any>, stageKey: string): string | undefined {
  const result = stageResults[stageKey];
  
  if (typeof result === 'string') {
    return result;
  }
  
  if (Array.isArray(result)) {
    // If somehow we have an array, return the last entry
    return result[result.length - 1];
  }
  
  return undefined;
}

/**
 * Clean stage results to ensure each stage has only one result (the latest)
 */
export function cleanStageResults(stageResults: Record<string, any>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(stageResults)) {
    if (typeof value === 'string') {
      cleaned[key] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      // Take the last entry if we have an array
      cleaned[key] = value[value.length - 1];
    }
  }
  
  return cleaned;
}

/**
 * Merge new stage result with existing results, ensuring latest overwrites
 */
export function mergeStageResult(
  existingResults: Record<string, any>, 
  stageKey: string, 
  newResult: string
): Record<string, string> {
  const cleaned = cleanStageResults(existingResults);
  return {
    ...cleaned,
    [stageKey]: newResult
  };
}