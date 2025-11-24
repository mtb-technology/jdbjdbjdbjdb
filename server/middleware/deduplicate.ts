/**
 * Request Deduplication Middleware
 *
 * Prevents duplicate concurrent requests from being processed.
 * Useful for expensive operations like AI stage execution.
 */

import type { Request, Response, NextFunction } from 'express';
import { createApiSuccessResponse } from '@shared/errors';

// Track active requests - using Map for better performance
const activeRequests = new Map<string, Promise<any>>();

/**
 * Configuration options for deduplication middleware.
 */
export interface DeduplicateOptions {
  /**
   * Function to generate a unique key for the request.
   * Default: `${req.method}:${req.path}?${req.query}`
   */
  keyFn?: (req: Request) => string;

  /**
   * Maximum time to wait for a duplicate request (ms).
   * Default: 120000 (2 minutes)
   */
  timeout?: number;

  /**
   * Whether to return the cached result or just block.
   * Default: true (return cached result)
   */
  returnCachedResult?: boolean;
}

/**
 * Middleware that prevents duplicate concurrent requests.
 *
 * @param options - Configuration options
 * @returns Express middleware function
 *
 * @example
 * ```ts
 * // Basic usage with default key
 * app.post("/api/reports/:id/stage/:stage",
 *   deduplicateRequests(),
 *   asyncHandler(async (req, res) => { ... })
 * );
 *
 * // Custom key function
 * app.post("/api/reports/:id/stage/:stage",
 *   deduplicateRequests({
 *     keyFn: (req) => `${req.params.id}-${req.params.stage}`
 *   }),
 *   asyncHandler(async (req, res) => { ... })
 * );
 * ```
 */
export function deduplicateRequests(options: DeduplicateOptions = {}) {
  const {
    keyFn = (req) => `${req.params.id}-${req.params.stage}`,
    timeout = 120000,
    returnCachedResult = true
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    const requestKey = keyFn(req);

    // Check if this request is already being processed
    if (activeRequests.has(requestKey)) {
      console.log(`🔄 [Deduplicate] Request already in progress: ${requestKey}`);

      if (!returnCachedResult) {
        // Just block the duplicate request
        res.status(429).json({
          message: "Request already in progress",
          requestKey
        });
        return;
      }

      // Wait for the existing request to complete
      try {
        const existingPromise = activeRequests.get(requestKey)!;

        // Add timeout to prevent infinite waiting
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Deduplication timeout')), timeout);
        });

        await Promise.race([existingPromise, timeoutPromise]);

        // Fetch the updated data after the original request completed
        // For stage execution, we'll return a generic success message
        res.json(createApiSuccessResponse(
          { message: "Request was already processed" },
          "Deze stap is al uitgevoerd door een eerdere request"
        ));
        return;
      } catch (error) {
        // If the original request failed or timed out, allow this one through
        console.warn(`⚠️ [Deduplicate] Original request failed, allowing duplicate through: ${requestKey}`);
        activeRequests.delete(requestKey);
        // Continue to next middleware
      }
    }

    // Create a promise for this request execution
    let resolveRequest: () => void;
    let rejectRequest: (error: any) => void;

    const requestPromise = new Promise<void>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });

    // Store the promise
    activeRequests.set(requestKey, requestPromise);

    // Wrap the response methods to clean up when done
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const originalStatus = res.status.bind(res);

    let isCompleted = false;
    const cleanup = () => {
      if (!isCompleted) {
        isCompleted = true;
        activeRequests.delete(requestKey);
        console.log(`✅ [Deduplicate] Request completed: ${requestKey}`);
      }
    };

    // Override res.json to clean up after response
    res.json = function(body: any) {
      cleanup();
      resolveRequest!();
      return originalJson(body);
    };

    // Override res.send to clean up after response
    res.send = function(body: any) {
      cleanup();
      resolveRequest!();
      return originalSend(body);
    };

    // Override res.status to track status codes
    res.status = function(code: number) {
      if (code >= 400) {
        // On error status, reject the promise
        cleanup();
        rejectRequest!(new Error(`Request failed with status ${code}`));
      }
      return originalStatus(code);
    };

    // Handle errors
    const errorHandler = (error: any) => {
      cleanup();
      rejectRequest!(error);
    };

    // Attach error handler
    res.on('error', errorHandler);
    res.on('close', () => {
      if (!isCompleted) {
        console.log(`🔌 [Deduplicate] Client disconnected: ${requestKey}`);
        cleanup();
        // Reject the promise silently - don't throw since the client is gone
        if (rejectRequest) {
          try {
            rejectRequest(new Error('Response closed'));
          } catch (e) {
            // Ignore - client already disconnected
            console.log(`🔌 [Deduplicate] Cleanup error ignored: ${e instanceof Error ? e.message : 'unknown'}`);
          }
        }
      }
    });

    // Continue to next middleware
    next();
  };
}

/**
 * Clears all active request tracking.
 * Useful for testing or cleanup.
 */
export function clearActiveRequests(): void {
  activeRequests.clear();
}

/**
 * Gets the count of active requests.
 * Useful for monitoring.
 */
export function getActiveRequestCount(): number {
  return activeRequests.size;
}

/**
 * Gets all active request keys.
 * Useful for debugging.
 */
export function getActiveRequestKeys(): string[] {
  return Array.from(activeRequests.keys());
}
