/**
 * Centralized validation service met strikte type safety
 */

import { z, ZodError } from 'zod';
import { 
  dossierSchema, 
  bouwplanSchema, 
  aiConfigSchema, 
  promptConfigSchema,
  insertUserSchema 
} from '@shared/schema';
import type {
  DossierData,
  BouwplanData, 
  AiConfig,
  PromptConfig,
  InsertUser
} from '@shared/schema';
import type { 
  IValidationService, 
  ValidationResult 
} from '@shared/types/services';
import { 
  isDossierData,
  isBouwplanData,
  isAiConfig,
  isPromptConfig,
  ValidationPipeline 
} from '@shared/types/guards';
import { ServerError } from '../middleware/errorHandler';
import { ERROR_CODES } from '@shared/errors';

export class ValidationService implements IValidationService {
  private readonly pipelines: Map<string, ValidationPipeline<any>> = new Map();

  constructor() {
    this.initializePipelines();
  }

  private initializePipelines(): void {
    // Dossier validation pipeline
    const dossierPipeline = new ValidationPipeline<DossierData>()
      .addValidator(isDossierData)
      .addTransform((data) => ({
        ...data,
        klant: {
          ...data.klant,
          naam: data.klant.naam.trim(),
          situatie: data.klant.situatie.trim()
        }
      }));
    this.pipelines.set('dossier', dossierPipeline);

    // Bouwplan validation pipeline
    const bouwplanPipeline = new ValidationPipeline<BouwplanData>()
      .addValidator(isBouwplanData)
      .addTransform((data) => ({
        ...data,
        structuur: {
          ...data.structuur,
          knelpunten: data.structuur.knelpunten.map(k => k.trim()).filter(k => k.length > 0)
        }
      }));
    this.pipelines.set('bouwplan', bouwplanPipeline);

    // AI Config validation pipeline
    const aiConfigPipeline = new ValidationPipeline<AiConfig>()
      .addValidator(isAiConfig)
      .addTransform((data) => ({
        ...data,
        temperature: Math.round(data.temperature * 100) / 100, // Round to 2 decimals
        topP: Math.round(data.topP * 100) / 100,
      }));
    this.pipelines.set('aiConfig', aiConfigPipeline);
  }

  validateDossier(data: any): ValidationResult<DossierData> {
    try {
      // First validate with Zod schema
      const zodResult = dossierSchema.safeParse(data);
      if (!zodResult.success) {
        return this.formatZodErrors<DossierData>(zodResult.error);
      }

      // Then use runtime validation pipeline
      const pipeline = this.pipelines.get('dossier');
      if (!pipeline) {
        throw new Error('Dossier validation pipeline niet gevonden');
      }

      const pipelineResult = pipeline.validate(zodResult.data);
      if (!pipelineResult.success) {
        return {
          success: false,
          errors: pipelineResult.errors.map(error => ({
            field: 'unknown',
            message: error,
            code: 'RUNTIME_VALIDATION_FAILED'
          }))
        };
      }

      return {
        success: true,
        data: pipelineResult.data,
        errors: []
      };
    } catch (error) {
      return {
        success: false,
        errors: [{
          field: 'general',
          message: error instanceof Error ? error.message : 'Onbekende validatiefout',
          code: 'VALIDATION_ERROR'
        }]
      };
    }
  }

  validateBouwplan(data: any): ValidationResult<BouwplanData> {
    try {
      const zodResult = bouwplanSchema.safeParse(data);
      if (!zodResult.success) {
        return this.formatZodErrors<BouwplanData>(zodResult.error);
      }

      const pipeline = this.pipelines.get('bouwplan');
      if (!pipeline) {
        throw new Error('Bouwplan validation pipeline niet gevonden');
      }

      const pipelineResult = pipeline.validate(zodResult.data);
      if (!pipelineResult.success) {
        return {
          success: false,
          errors: pipelineResult.errors.map(error => ({
            field: 'unknown',
            message: error,
            code: 'RUNTIME_VALIDATION_FAILED'
          }))
        };
      }

      return {
        success: true,
        data: pipelineResult.data,
        errors: []
      };
    } catch (error) {
      return {
        success: false,
        errors: [{
          field: 'general',
          message: error instanceof Error ? error.message : 'Onbekende validatiefout',
          code: 'VALIDATION_ERROR'
        }]
      };
    }
  }

  validateAiConfig(data: any): ValidationResult<AiConfig> {
    try {
      const zodResult = aiConfigSchema.safeParse(data);
      if (!zodResult.success) {
        return this.formatZodErrors<AiConfig>(zodResult.error);
      }

      const pipeline = this.pipelines.get('aiConfig');
      if (!pipeline) {
        throw new Error('AI Config validation pipeline niet gevonden');
      }

      const pipelineResult = pipeline.validate(zodResult.data);
      if (!pipelineResult.success) {
        return {
          success: false,
          errors: pipelineResult.errors.map(error => ({
            field: 'unknown',
            message: error,
            code: 'RUNTIME_VALIDATION_FAILED'
          }))
        };
      }

      return {
        success: true,
        data: pipelineResult.data,
        errors: []
      };
    } catch (error) {
      return {
        success: false,
        errors: [{
          field: 'general',
          message: error instanceof Error ? error.message : 'Onbekende validatiefout',
          code: 'VALIDATION_ERROR'
        }]
      };
    }
  }

  validatePromptConfig(data: any): ValidationResult<PromptConfig> {
    try {
      const zodResult = promptConfigSchema.safeParse(data);
      if (!zodResult.success) {
        return this.formatZodErrors<PromptConfig>(zodResult.error);
      }

      // Additional business logic validation
      if (!this.validatePromptConfigBusinessRules(zodResult.data)) {
        return {
          success: false,
          errors: [{
            field: 'config',
            message: 'Prompt configuratie voldoet niet aan business regels',
            code: 'BUSINESS_RULE_VIOLATION'
          }]
        };
      }

      return {
        success: true,
        data: zodResult.data,
        errors: []
      };
    } catch (error) {
      return {
        success: false,
        errors: [{
          field: 'general',
          message: error instanceof Error ? error.message : 'Onbekende validatiefout',
          code: 'VALIDATION_ERROR'
        }]
      };
    }
  }

  validateUserInput(data: any): ValidationResult<InsertUser> {
    try {
      const zodResult = insertUserSchema.safeParse(data);
      if (!zodResult.success) {
        return this.formatZodErrors<InsertUser>(zodResult.error);
      }

      // Additional security validation
      if (!this.validateUserSecurityRules(zodResult.data)) {
        return {
          success: false,
          errors: [{
            field: 'security',
            message: 'Gebruikersinvoer voldoet niet aan beveiligingsregels',
            code: 'SECURITY_VIOLATION'
          }]
        };
      }

      return {
        success: true,
        data: zodResult.data,
        errors: []
      };
    } catch (error) {
      return {
        success: false,
        errors: [{
          field: 'general',
          message: error instanceof Error ? error.message : 'Onbekende validatiefout',
          code: 'VALIDATION_ERROR'
        }]
      };
    }
  }

  /**
   * Formats Zod errors into ValidationResult format
   */
  private formatZodErrors<T>(zodError: ZodError): ValidationResult<T> {
    const errors = zodError.errors.map(err => ({
      field: err.path.join('.') || 'unknown',
      message: err.message,
      code: err.code.toUpperCase()
    }));

    return {
      success: false,
      errors
    };
  }

  /**
   * Validates prompt config business rules
   */
  private validatePromptConfigBusinessRules(config: PromptConfig): boolean {
    // Check that all required stages have prompts
    const requiredStages = [
      '1_informatiecheck',
      '2_complexiteitscheck', 
      '3_generatie'
    ];

    for (const stage of requiredStages) {
      const stageConfig = config[stage as keyof PromptConfig];
      if (typeof stageConfig === 'object' && stageConfig !== null) {
        if ('prompt' in stageConfig && (!stageConfig.prompt || stageConfig.prompt.trim().length < 10)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Validates user security rules
   */
  private validateUserSecurityRules(user: InsertUser): boolean {
    // Password strength check
    if (user.password.length < 8) return false;
    if (!/[A-Z]/.test(user.password)) return false; // At least one uppercase
    if (!/[a-z]/.test(user.password)) return false; // At least one lowercase
    if (!/[0-9]/.test(user.password)) return false; // At least one number

    // Username checks
    if (user.username.length < 3) return false;
    if (!/^[a-zA-Z0-9_-]+$/.test(user.username)) return false; // Only alphanumeric, underscore, dash

    return true;
  }

  /**
   * Validates multiple objects with the same schema
   */
  async validateBatch<T>(
    data: any[],
    validationMethod: (item: any) => ValidationResult<T>
  ): Promise<{ valid: T[], invalid: Array<{ index: number, errors: ValidationResult<T>['errors'] }> }> {
    const valid: T[] = [];
    const invalid: Array<{ index: number, errors: ValidationResult<T>['errors'] }> = [];

    for (let i = 0; i < data.length; i++) {
      const result = validationMethod(data[i]);
      if (result.success && result.data) {
        valid.push(result.data);
      } else {
        invalid.push({ index: i, errors: result.errors });
      }
    }

    return { valid, invalid };
  }

  /**
   * Create validation error for API responses
   */
  createValidationError(errors: ValidationResult<any>['errors']): ServerError {
    const message = errors.map(e => `${e.field}: ${e.message}`).join(', ');
    return ServerError.validation(
      'Validatie gefaald',
      'De opgegeven gegevens zijn niet geldig. Controleer uw invoer.',
      { validationErrors: errors }
    );
  }
}