/**
 * File Upload Constants
 *
 * Centralized limits for file uploads across the application.
 */

export const UPLOAD_LIMITS = {
  /** Maximum file size in MB */
  MAX_FILE_SIZE_MB: 50,
  /** Maximum file size in bytes */
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024,
  /** Maximum total upload size in MB */
  MAX_TOTAL_SIZE_MB: 100,
  /** Maximum total upload size in bytes */
  MAX_TOTAL_SIZE_BYTES: 100 * 1024 * 1024,
} as const;

/**
 * Error message for oversized files (Dutch)
 */
export function getOversizedFilesMessage(rejectedNames: string): string {
  return `Maximum grootte is ${UPLOAD_LIMITS.MAX_FILE_SIZE_MB}MB per bestand. Geweigerd: ${rejectedNames}`;
}
