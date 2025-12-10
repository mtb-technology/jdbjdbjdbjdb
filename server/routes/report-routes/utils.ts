/**
 * Shared utilities for report routes
 */

/**
 * Helper function to parse JSON that may be wrapped in markdown code blocks
 * Handles responses like: ```json\n{...}\n```
 */
export function parseJsonWithMarkdown(text: string): any {
  // First try direct parse
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      return JSON.parse(jsonMatch[1].trim());
    }
    // Try to find a JSON object in the text
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }
    // Re-throw if nothing worked
    throw new Error('No valid JSON found in response');
  }
}
