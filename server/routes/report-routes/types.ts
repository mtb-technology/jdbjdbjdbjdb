/**
 * Shared types and dependencies for report routes
 *
 * This module centralizes imports and type definitions used across
 * all report route modules.
 */

import type { Express, Request, Response } from "express";
import type { ReportGenerator } from "../../services/report-generator";
import type { ReportProcessor } from "../../services/report-processor";
import type { SourceValidator } from "../../services/source-validator";
import type { SSEHandler } from "../../services/streaming/sse-handler";
import type { StreamingSessionManager } from "../../services/streaming/streaming-session-manager";

/**
 * Dependencies injected into route modules
 */
export interface ReportRouteDependencies {
  reportGenerator: ReportGenerator;
  reportProcessor: ReportProcessor;
  sourceValidator: SourceValidator;
  sseHandler: SSEHandler;
  sessionManager: StreamingSessionManager;
}

/**
 * Route module signature - each module exports a function with this signature
 */
export type RouteModule = (
  app: Express,
  dependencies: ReportRouteDependencies
) => void;

// Re-export commonly used types
export type { Express, Request, Response };
