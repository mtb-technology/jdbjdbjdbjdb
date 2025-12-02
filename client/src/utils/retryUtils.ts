/**
 * Retry Utilities
 *
 * Utility functions for retry logic with exponential backoff.
 */

/**
 * Check if an error is retryable based on status code or error code
 */
export const isRetryableError = (err: unknown): boolean => {
  if (err && typeof err === "object") {
    const errorObj = err as { status?: number; code?: string };
    return (
      errorObj.status === 503 || // Service Unavailable
      errorObj.status === 429 || // Rate Limited
      errorObj.code === "AI_SERVICE_UNAVAILABLE" ||
      errorObj.code === "AI_RATE_LIMITED"
    );
  }
  return false;
};

/**
 * Retry a function with exponential backoff and jitter
 *
 * @param fn - The async function to retry
 * @param maxAttempts - Maximum number of retry attempts (default: 3)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @returns The result of the function
 * @throws The last error if all attempts fail
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      // Check if we should retry based on error type
      if (isRetryableError(error)) {
        if (attempt === maxAttempts) {
          throw error; // Last attempt failed
        }

        // Calculate delay with exponential backoff: 1s, 2s, 4s
        const delay = baseDelay * Math.pow(2, attempt - 1);

        // Add jitter (0-30% random variation) to prevent thundering herd problem
        // If multiple users retry at the same time, jitter spreads out the retries
        const jitter = Math.random() * delay * 0.3;
        const finalDelay = Math.round(delay + jitter);

        console.log(
          `🔄 Retry attempt ${attempt}/${maxAttempts} after ${finalDelay}ms delay (base: ${delay}ms + jitter: ${Math.round(jitter)}ms)`
        );
        await new Promise((resolve) => setTimeout(resolve, finalDelay));
        continue;
      }

      throw error; // Don't retry other types of errors
    }
  }
  throw new Error("Max retry attempts reached");
}

/**
 * Get user-friendly error message based on error code
 */
export function getErrorMessage(errorCode: string | undefined): {
  title: string;
  description: string;
  action: string | null;
} {
  switch (errorCode) {
    case "AI_SERVICE_UNAVAILABLE":
      return {
        title: "AI Service niet beschikbaar",
        description:
          "De AI service is momenteel niet beschikbaar. Het systeem heeft het maximaal aantal pogingen gedaan om je verzoek te verwerken.",
        action:
          "Wacht een paar minuten en probeer het opnieuw. Als het probleem aanhoudt, neem dan contact op met support.",
      };
    case "AI_RATE_LIMITED":
      return {
        title: "Snelheidslimiet bereikt",
        description:
          "Je hebt teveel verzoeken gedaan in korte tijd. Het systeem heeft geprobeerd je verzoek opnieuw te verwerken.",
        action: "Wacht ongeveer 1 minuut voordat je het opnieuw probeert.",
      };
    case "AI_AUTHENTICATION_FAILED":
      return {
        title: "AI authenticatie probleem",
        description:
          "Er is een probleem met de authenticatie van de AI service.",
        action: "Dit is een configuratie probleem. Neem contact op met support.",
      };
    case "VALIDATION_FAILED":
      return {
        title: "Ongeldige invoer",
        description: "Je invoer voldoet niet aan de verwachte criteria.",
        action: "Controleer je instructies en probeer het opnieuw.",
      };
    default:
      return {
        title: "Feedback verwerking gefaald",
        description: "Er ging iets mis bij het verwerken van je instructies.",
        action: null,
      };
  }
}
