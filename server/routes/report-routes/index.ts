/**
 * Report Routes - Main Entry Point
 *
 * This module combines all report-related route modules into a single
 * registration function. Each module handles a specific domain:
 *
 * - crud.ts: Basic CRUD, sources, prompt templates
 * - stages.ts: Stage execution, manual mode, deletion
 * - feedback.ts: Feedback preview and processing
 * - versions.ts: Concept versions, snapshots, document state
 * - export.ts: PDF, DOCX, JSON export/import
 * - adjustments.ts: Post-workflow report adjustments
 * - express-mode.ts: Automated bulk processing, deep research
 */

import type { Express } from "express";
import type { ReportRouteDependencies } from "./types";

// Import all route modules
import { registerCrudRoutes } from "./crud";
import { registerStageRoutes } from "./stages";
import { registerFeedbackRoutes } from "./feedback";
import { registerVersionRoutes } from "./versions";
import { registerExportRoutes } from "./export";
import { registerAdjustmentRoutes } from "./adjustments";
import { registerExpressModeRoutes } from "./express-mode";

/**
 * Register all report-related routes
 *
 * @param app Express application
 * @param dependencies Object containing required services
 */
export function registerReportRoutes(
  app: Express,
  dependencies: ReportRouteDependencies
): void {
  // Register all route modules
  // Order matters for route matching - more specific routes first

  // CRUD and basic operations
  registerCrudRoutes(app, dependencies);

  // Stage execution and management
  registerStageRoutes(app, dependencies);

  // Feedback processing
  registerFeedbackRoutes(app, dependencies);

  // Version management
  registerVersionRoutes(app, dependencies);

  // Export functionality
  registerExportRoutes(app, dependencies);

  // Post-workflow adjustments
  registerAdjustmentRoutes(app, dependencies);

  // Express mode and deep research
  registerExpressModeRoutes(app, dependencies);

  console.log("✅ Report routes registered (modular)");
}

// Re-export types for consumers
export type { ReportRouteDependencies } from "./types";
