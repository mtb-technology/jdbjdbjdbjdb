/**
 * Prompt Configuration Routes
 *
 * Manages AI prompt configurations, backup/restore functionality,
 * and prompt template generation.
 */

import type { Express, Request, Response } from "express";
import { promises as fs } from "fs";
import * as path from "path";
import { z } from "zod";
import { storage } from "../storage";
import { insertPromptConfigSchema } from "@shared/schema";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { HTTP_STATUS } from "../config/constants";

export function registerPromptRoutes(app: Express): void {
  /**
   * GET /api/prompts
   *
   * Get all prompt configurations.
   *
   * Response: Array of prompt configuration objects
   */
  app.get("/api/prompts", async (req, res) => {
    try {
      const prompts = await storage.getAllPromptConfigs();
      res.json(createApiSuccessResponse(prompts));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error fetching prompt configs:", message);
      res.status(HTTP_STATUS.INTERNAL_ERROR).json(
        createApiErrorResponse("DatabaseError", ERROR_CODES.DATABASE_ERROR, message, "Fout bij ophalen prompt configuraties")
      );
    }
  });

  /**
   * GET /api/prompts/active
   *
   * Get the currently active prompt configuration.
   * No caching to prevent stale IDs.
   *
   * Response: Active prompt configuration object
   */
  app.get("/api/prompts/active", async (req, res) => {
    try {
      const activeConfig = await storage.getActivePromptConfig();
      // No caching to prevent stale IDs
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.json(createApiSuccessResponse(activeConfig));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error fetching active prompt config:", message);
      res.status(HTTP_STATUS.INTERNAL_ERROR).json(
        createApiErrorResponse("DatabaseError", ERROR_CODES.DATABASE_ERROR, message, "Fout bij ophalen actieve prompt configuratie")
      );
    }
  });

  /**
   * POST /api/prompts
   *
   * Create a new prompt configuration.
   * If marked as active, deactivates all other configurations.
   *
   * Request body: { name, config, isActive }
   * Response: Created prompt configuration
   */
  app.post("/api/prompts", async (req, res) => {
    try {
      const validatedData = insertPromptConfigSchema.parse(req.body);

      // Deactivate all other configs if this one is set as active
      if (validatedData.isActive) {
        const allConfigs = await storage.getAllPromptConfigs();
        for (const config of allConfigs) {
          if (config.isActive) {
            await storage.updatePromptConfig(config.id, { isActive: false });
          }
        }
      }

      const promptConfig = await storage.createPromptConfig(validatedData);
      res.json(createApiSuccessResponse(promptConfig, "Prompt configuratie succesvol aangemaakt"));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error creating prompt config:", message);
      if (error instanceof z.ZodError) {
        res.status(HTTP_STATUS.BAD_REQUEST).json(
          createApiErrorResponse("ValidationError", ERROR_CODES.VALIDATION_FAILED, "Validation failed", "Validatiefout in prompt configuratie", { errors: error.errors })
        );
      } else {
        res.status(HTTP_STATUS.INTERNAL_ERROR).json(
          createApiErrorResponse("DatabaseError", ERROR_CODES.DATABASE_ERROR, message, "Fout bij aanmaken prompt configuratie")
        );
      }
    }
  });

  /**
   * PUT /api/prompts/:id
   *
   * Update an existing prompt configuration.
   * If marked as active, deactivates all other configurations.
   *
   * Request body: Partial prompt configuration
   * Response: Updated prompt configuration
   */
  app.put("/api/prompts/:id", async (req, res) => {
    try {
      const updates = req.body;

      // Deactivate all other configs if this one is set as active
      if (updates.isActive) {
        const allConfigs = await storage.getAllPromptConfigs();
        for (const config of allConfigs) {
          if (config.isActive && config.id !== req.params.id) {
            await storage.updatePromptConfig(config.id, { isActive: false });
          }
        }
      }

      const updatedConfig = await storage.updatePromptConfig(req.params.id, updates);
      if (!updatedConfig) {
        res.status(HTTP_STATUS.NOT_FOUND).json(
          createApiErrorResponse("NotFound", ERROR_CODES.REPORT_NOT_FOUND, "Prompt config not found", "Prompt configuratie niet gevonden")
        );
        return;
      }
      res.json(createApiSuccessResponse(updatedConfig, "Prompt configuratie succesvol bijgewerkt"));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error updating prompt config:", message);
      res.status(HTTP_STATUS.INTERNAL_ERROR).json(
        createApiErrorResponse("DatabaseError", ERROR_CODES.DATABASE_ERROR, message, "Fout bij bijwerken prompt configuratie")
      );
    }
  });

  /**
   * GET /api/prompts/backup
   *
   * Download a backup of all prompt configurations.
   * Also creates an automatic server-side backup (keeps last 10).
   *
   * Response: JSON file download with all configurations
   */
  app.get("/api/prompts/backup", async (req, res) => {
    try {
      const configs = await storage.getAllPromptConfigs();
      const activeConfig = configs.find(c => c.isActive);

      // Maak ook een automatische backup op de server
      const backupData = {
        backup_date: new Date().toISOString(),
        version: "2.0",
        prompt_configs: configs
      };

      // Sla backup op in JSON file
      const backupDir = path.join(process.cwd(), 'backups');
      await fs.mkdir(backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `prompts-backup-${timestamp}.json`);
      await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));

      // Behoud alleen laatste 10 backups
      const files = await fs.readdir(backupDir);
      const backupFiles = files.filter(f => f.startsWith('prompts-backup-')).sort();
      if (backupFiles.length > 10) {
        for (const oldFile of backupFiles.slice(0, backupFiles.length - 10)) {
          await fs.unlink(path.join(backupDir, oldFile));
        }
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="prompt-backup.json"');
      res.json(backupData);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error creating backup:", message);
      res.status(HTTP_STATUS.INTERNAL_ERROR).json(
        createApiErrorResponse("BackupError", ERROR_CODES.INTERNAL_SERVER_ERROR, message, "Backup failed")
      );
    }
  });

  /**
   * POST /api/prompts/restore
   *
   * Restore prompt configurations from backup.
   * Creates automatic backup of current state before restoring.
   *
   * Request body: Backup data (array or wrapped object)
   * Response: Restore statistics { restored, created }
   */
  app.post("/api/prompts/restore", async (req, res) => {
    try {
      // Accepteer beide formaten: met of zonder wrapper
      const data = req.body;
      let prompt_configs;

      if (data.prompt_configs && Array.isArray(data.prompt_configs)) {
        // Nieuw format met metadata
        prompt_configs = data.prompt_configs;
      } else if (Array.isArray(data)) {
        // Oud format - direct array
        prompt_configs = data;
      } else {
        res.status(HTTP_STATUS.BAD_REQUEST).json(
          createApiErrorResponse("ValidationError", ERROR_CODES.VALIDATION_FAILED, "Invalid backup format", "Ongeldig backup formaat")
        );
        return;
      }

      // Maak eerst een backup van huidige staat
      const currentConfigs = await storage.getAllPromptConfigs();
      const backupDir = path.join(process.cwd(), 'backups');
      await fs.mkdir(backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const autoBackupPath = path.join(backupDir, `auto-backup-before-restore-${timestamp}.json`);
      await fs.writeFile(autoBackupPath, JSON.stringify({
        backup_date: new Date().toISOString(),
        type: 'auto-before-restore',
        prompt_configs: currentConfigs
      }, null, 2));

      // Restore from backup
      let restored = 0;
      let created = 0;

      for (const config of prompt_configs) {
        // Strip timestamp fields to avoid date conversion issues - let DB handle these automatically
        const { createdAt, updatedAt, ...cleanConfig } = config;

        if (config.id) {
          // Probeer eerst te updaten
          const existing = await storage.getPromptConfig(config.id);
          if (existing) {
            await storage.updatePromptConfig(config.id, cleanConfig);
            restored++;
          } else {
            // Als het niet bestaat, maak het aan
            await storage.createPromptConfig(cleanConfig);
            created++;
          }
        } else {
          // Zonder ID, altijd nieuwe aanmaken
          await storage.createPromptConfig(cleanConfig);
          created++;
        }
      }

      res.json(createApiSuccessResponse({
        message: `Restore voltooid: ${restored} bijgewerkt, ${created} aangemaakt`,
        restored,
        created
      }, "Backup restore succesvol voltooid"));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error restoring backup:", message);
      res.status(HTTP_STATUS.INTERNAL_ERROR).json(
        createApiErrorResponse("RestoreError", ERROR_CODES.INTERNAL_SERVER_ERROR, message, "Restore failed: " + message)
      );
    }
  });


  /**
   * GET /api/prompt-templates/:stageKey
   *
   * Get a prompt template for a specific stage (for new cases without existing report).
   *
   * Query params: rawText, clientName
   * Response: { prompt: string }
   */
  app.get("/api/prompt-templates/:stageKey", async (req, res) => {
    try {
      const { stageKey } = req.params;
      const { rawText, clientName } = req.query;

      // Get active prompt configuration
      const promptConfig = await storage.getActivePromptConfig();
      if (!promptConfig?.config?.[stageKey as keyof typeof promptConfig.config]) {
        res.status(HTTP_STATUS.NOT_FOUND).json(
          createApiErrorResponse("NotFound", ERROR_CODES.REPORT_NOT_FOUND, "Prompt template not found", "Prompt template niet gevonden voor deze stap")
        );
        return;
      }

      const stageConfig = promptConfig.config[stageKey as keyof typeof promptConfig.config] as any;
      const prompt = stageConfig?.prompt || "";

      // Create the current date
      const currentDate = new Date().toLocaleDateString('nl-NL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      // Create a template prompt
      const templatePrompt = `${prompt}

### Datum: ${currentDate}`;

      res.json(createApiSuccessResponse({ prompt: templatePrompt }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error fetching prompt template:", message);
      res.status(HTTP_STATUS.INTERNAL_ERROR).json(
        createApiErrorResponse("DatabaseError", ERROR_CODES.DATABASE_ERROR, message, "Fout bij ophalen prompt template")
      );
    }
  });
}
