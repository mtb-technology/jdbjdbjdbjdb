/**
 * Prompt Utilities
 *
 * Centralized utilities for working with prompts in different formats.
 * Supports both legacy string format and new structured format.
 */

/**
 * Normalizes a prompt from various formats to a single string format.
 *
 * Supports:
 * - String format (legacy): Returns as-is
 * - Object format with systemPrompt + userInput: Combines both
 * - Generic object format: Returns JSON stringified
 *
 * @param rawPrompt - The prompt in any supported format
 * @returns Normalized string representation of the prompt
 *
 * @example
 * ```ts
 * // String input
 * normalizePromptToString("Hello world") // => "Hello world"
 *
 * // Structured input
 * normalizePromptToString({
 *   systemPrompt: "You are a helpful assistant",
 *   userInput: "What is AI?"
 * }) // => "You are a helpful assistant\n\n### USER INPUT:\nWhat is AI?"
 *
 * // Generic object
 * normalizePromptToString({ foo: "bar" }) // => '{"foo":"bar"}'
 * ```
 */
export function normalizePromptToString(
  rawPrompt: string | { systemPrompt: string; userInput: string } | Record<string, any> | null | undefined
): string {
  // Handle null/undefined
  if (!rawPrompt) {
    return '';
  }

  // Handle string format (most common - legacy)
  if (typeof rawPrompt === 'string') {
    return rawPrompt;
  }

  // Handle structured prompt format (new format with system + user)
  if (
    typeof rawPrompt === 'object' &&
    'systemPrompt' in rawPrompt &&
    'userInput' in rawPrompt &&
    typeof rawPrompt.systemPrompt === 'string' &&
    typeof rawPrompt.userInput === 'string'
  ) {
    return `${rawPrompt.systemPrompt}\n\n### USER INPUT:\n${rawPrompt.userInput}`;
  }

  // Handle generic object format - fallback to JSON
  if (typeof rawPrompt === 'object') {
    return JSON.stringify(rawPrompt, null, 2);
  }

  // Fallback for unexpected types
  return String(rawPrompt);
}

/**
 * Checks if a prompt object is in the structured format.
 *
 * @param prompt - The prompt to check
 * @returns True if the prompt has systemPrompt and userInput properties
 */
export function isStructuredPrompt(
  prompt: any
): prompt is { systemPrompt: string; userInput: string } {
  return (
    typeof prompt === 'object' &&
    prompt !== null &&
    'systemPrompt' in prompt &&
    'userInput' in prompt &&
    typeof prompt.systemPrompt === 'string' &&
    typeof prompt.userInput === 'string'
  );
}

/**
 * Extracts the user input portion from a prompt.
 *
 * @param prompt - The prompt in any format
 * @returns The user input portion, or the entire string if not structured
 */
export function extractUserInput(
  prompt: string | { systemPrompt: string; userInput: string } | Record<string, any>
): string {
  if (isStructuredPrompt(prompt)) {
    return prompt.userInput;
  }

  if (typeof prompt === 'string') {
    return prompt;
  }

  return JSON.stringify(prompt, null, 2);
}

/**
 * Extracts the system prompt portion from a prompt.
 *
 * @param prompt - The prompt in any format
 * @returns The system prompt portion, or empty string if not structured
 */
export function extractSystemPrompt(
  prompt: string | { systemPrompt: string; userInput: string } | Record<string, any>
): string {
  if (isStructuredPrompt(prompt)) {
    return prompt.systemPrompt;
  }

  return '';
}
