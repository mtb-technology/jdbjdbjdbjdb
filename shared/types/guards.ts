/**
 * Runtime type guards en validators voor type safety
 */

import type { 
  Report, User, PromptConfig, AiConfig,
  DossierData, BouwplanData
} from '../schema';
import type { 
  ApiResponse, ApiErrorResponse, ApiSuccessResponse 
} from '../errors';

// ===== BASIC TYPE GUARDS =====

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isArray<T>(value: unknown, itemGuard?: (item: unknown) => item is T): value is T[] {
  if (!Array.isArray(value)) return false;
  if (!itemGuard) return true;
  return value.every(itemGuard);
}

export function hasProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, unknown> {
  return isObject(obj) && key in obj;
}

export function hasRequiredProperties<T extends Record<string, unknown>>(
  obj: unknown,
  requiredKeys: (keyof T)[]
): obj is T {
  if (!isObject(obj)) return false;
  return requiredKeys.every(key => key in obj);
}

// ===== API RESPONSE GUARDS =====

export function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  return isObject(value) && hasProperty(value, 'success') && isBoolean(value.success);
}

export function isApiSuccessResponse<T>(value: unknown): value is ApiSuccessResponse<T> {
  return (
    isApiResponse(value) && 
    value.success === true && 
    hasProperty(value, 'data')
  );
}

export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return (
    isApiResponse(value) && 
    value.success === false && 
    hasProperty(value, 'error') &&
    isObject(value.error) &&
    hasRequiredProperties(value.error, ['type', 'code', 'message', 'userMessage', 'timestamp'])
  );
}

// ===== DOMAIN MODEL GUARDS =====

export function isReport(value: unknown): value is Report {
  return (
    isObject(value) &&
    hasRequiredProperties(value, ['id', 'title', 'clientName', 'dossierData', 'bouwplanData', 'status']) &&
    isString(value.id) &&
    isString(value.title) &&
    isString(value.clientName) &&
    isObject(value.dossierData) &&
    isObject(value.bouwplanData) &&
    isString(value.status)
  );
}

export function isUser(value: unknown): value is User {
  return (
    isObject(value) &&
    hasRequiredProperties(value, ['id', 'username']) &&
    isString(value.id) &&
    isString(value.username)
  );
}

export function isDossierData(value: unknown): value is DossierData {
  return (
    isObject(value) &&
    hasProperty(value, 'klant') &&
    hasProperty(value, 'fiscale_gegevens') &&
    isObject(value.klant) &&
    isObject(value.fiscale_gegevens) &&
    hasRequiredProperties(value.klant, ['naam', 'situatie']) &&
    hasRequiredProperties(value.fiscale_gegevens, ['vermogen', 'inkomsten']) &&
    isString(value.klant.naam) &&
    isString(value.klant.situatie) &&
    isNumber(value.fiscale_gegevens.vermogen) &&
    isNumber(value.fiscale_gegevens.inkomsten)
  );
}

export function isBouwplanData(value: unknown): value is BouwplanData {
  return (
    isObject(value) &&
    hasProperty(value, 'structuur') &&
    isObject(value.structuur) &&
    hasRequiredProperties(value.structuur, ['inleiding', 'knelpunten', 'scenario_analyse', 'vervolgstappen']) &&
    isBoolean(value.structuur.inleiding) &&
    isArray(value.structuur.knelpunten, isString) &&
    isBoolean(value.structuur.scenario_analyse) &&
    isBoolean(value.structuur.vervolgstappen)
  );
}

export function isAiConfig(value: unknown): value is AiConfig {
  return (
    isObject(value) &&
    hasProperty(value, 'provider') &&
    hasProperty(value, 'model') &&
    isString(value.provider) &&
    isString(value.model) &&
    ['google', 'openai'].includes(value.provider)
  );
}

export function isPromptConfig(value: unknown): value is PromptConfig {
  return (
    isObject(value) &&
    hasRequiredProperties(value, [
      '1_informatiecheck',
      '2_complexiteitscheck', 
      '3_generatie',
      '4a_BronnenSpecialist',
      '4b_FiscaalTechnischSpecialist',
      '4c_ScenarioGatenAnalist',
      '4d_DeVertaler',
      '4e_DeAdvocaat',
      '4f_DeKlantpsycholoog',
      '5_feedback_verwerker',
      'final_check'
    ])
  );
}

// ===== VALIDATION HELPERS =====

export function assertIsString(value: unknown, fieldName: string): string {
  if (!isString(value)) {
    throw new Error(`Verwacht dat ${fieldName} een string is, maar kreeg ${typeof value}`);
  }
  return value;
}

export function assertIsNumber(value: unknown, fieldName: string): number {
  if (!isNumber(value)) {
    throw new Error(`Verwacht dat ${fieldName} een nummer is, maar kreeg ${typeof value}`);
  }
  return value;
}

export function assertIsObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error(`Verwacht dat ${fieldName} een object is, maar kreeg ${typeof value}`);
  }
  return value;
}

export function assertHasProperty<K extends string>(
  obj: unknown,
  key: K,
  fieldName: string
): Record<K, unknown> {
  if (!hasProperty(obj, key)) {
    throw new Error(`Verwacht dat ${fieldName} de eigenschap '${key}' heeft`);
  }
  return obj;
}

// ===== SAFE PARSING UTILITIES =====

export function safeParse<T>(
  data: unknown,
  guard: (value: unknown) => value is T,
  fallback: T
): T {
  try {
    return guard(data) ? data : fallback;
  } catch {
    return fallback;
  }
}

export function safeParseJson<T>(
  jsonString: string,
  guard: (value: unknown) => value is T,
  fallback: T
): T {
  try {
    const parsed = JSON.parse(jsonString);
    return guard(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// ===== VALIDATION PIPELINE =====

export class ValidationPipeline<T> {
  private validators: Array<(value: unknown) => value is T> = [];
  private transforms: Array<(value: T) => T> = [];

  addValidator(validator: (value: unknown) => value is T): this {
    this.validators.push(validator);
    return this;
  }

  addTransform(transform: (value: T) => T): this {
    this.transforms.push(transform);
    return this;
  }

  validate(value: unknown): { success: boolean; data?: T; errors: string[] } {
    const errors: string[] = [];
    
    for (const validator of this.validators) {
      if (!validator(value)) {
        errors.push(`Validatie gefaald voor validator ${validator.name || 'onbekend'}`);
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    let result = value as T;
    try {
      for (const transform of this.transforms) {
        result = transform(result);
      }
      return { success: true, data: result, errors: [] };
    } catch (error) {
      return { 
        success: false, 
        errors: [`Transformatie gefaald: ${error instanceof Error ? error.message : 'Onbekende fout'}`] 
      };
    }
  }
}