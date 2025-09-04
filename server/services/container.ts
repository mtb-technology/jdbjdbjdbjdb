/**
 * Dependency Injection Container voor type-safe service management
 */

import type { IServiceContainer } from '@shared/types/services';

export class ServiceContainer implements IServiceContainer {
  private static instance: ServiceContainer;
  private services: Map<string, any> = new Map();
  private singletons: Map<string, any> = new Map();
  private factories: Map<string, () => any> = new Map();

  private constructor() {}

  static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer();
    }
    return ServiceContainer.instance;
  }

  /**
   * Register een service factory
   */
  register<T>(key: string, factory: () => T): void {
    if (this.factories.has(key)) {
      throw new Error(`Service '${key}' is al geregistreerd`);
    }
    this.factories.set(key, factory);
  }

  /**
   * Register een singleton service factory
   */
  registerSingleton<T>(key: string, factory: () => T): void {
    if (this.factories.has(key)) {
      throw new Error(`Service '${key}' is al geregistreerd`);
    }
    this.factories.set(key, factory);
    // Mark as singleton
    this.singletons.set(key, null);
  }

  /**
   * Register een concrete instance
   */
  registerInstance<T>(key: string, instance: T): void {
    if (this.services.has(key)) {
      throw new Error(`Service instance '${key}' is al geregistreerd`);
    }
    this.services.set(key, instance);
  }

  /**
   * Resolve een service
   */
  resolve<T>(key: string): T {
    // Check if we have a concrete instance
    if (this.services.has(key)) {
      return this.services.get(key) as T;
    }

    // Check if it's a singleton that's already been created
    if (this.singletons.has(key)) {
      const existing = this.singletons.get(key);
      if (existing !== null) {
        return existing as T;
      }
    }

    // Create new instance from factory
    const factory = this.factories.get(key);
    if (!factory) {
      throw new Error(`Service '${key}' is niet geregistreerd`);
    }

    const instance = factory() as T;

    // Store singleton instances
    if (this.singletons.has(key)) {
      this.singletons.set(key, instance);
    }

    return instance;
  }

  /**
   * Check if service is registered
   */
  isRegistered(key: string): boolean {
    return this.services.has(key) || this.factories.has(key);
  }

  /**
   * Get all registered service keys
   */
  getRegisteredServices(): string[] {
    const serviceKeys: string[] = [];
    const factoryKeys: string[] = [];
    
    this.services.forEach((_, key) => serviceKeys.push(key));
    this.factories.forEach((_, key) => factoryKeys.push(key));
    
    const allKeys = [...serviceKeys, ...factoryKeys];
    return allKeys.filter((key, index) => allKeys.indexOf(key) === index);
  }

  /**
   * Clear all services (useful for testing)
   */
  clear(): void {
    this.services.clear();
    this.singletons.clear();
    this.factories.clear();
  }

  /**
   * Create a scoped container (child container)
   */
  createScope(): ServiceContainer {
    const scopedContainer = new ServiceContainer();
    
    // Copy all factories from parent
    this.factories.forEach((factory, key) => {
      scopedContainer.factories.set(key, factory);
    });
    
    // Copy singleton instances from parent
    this.singletons.forEach((instance, key) => {
      if (instance !== null) {
        scopedContainer.singletons.set(key, instance);
      }
    });

    return scopedContainer;
  }
}

// Service Keys (Type-safe service resolution)
export const SERVICE_KEYS = {
  STORAGE: 'storage',
  AI_MODEL_FACTORY: 'aiModelFactory',
  REPORT_GENERATOR: 'reportGenerator',
  SOURCE_VALIDATOR: 'sourceValidator',
  VALIDATION: 'validation',
  CONFIGURATION: 'configuration',
  LOGGING: 'logging',
  HEALTH_CHECK: 'healthCheck'
} as const;

export type ServiceKey = typeof SERVICE_KEYS[keyof typeof SERVICE_KEYS];

// Type-safe service resolution
export function getService<T>(key: ServiceKey): T {
  return ServiceContainer.getInstance().resolve<T>(key);
}

// Decorator for automatic dependency injection
export function Injectable(key: ServiceKey) {
  return function <T extends new (...args: any[]) => any>(constructor: T) {
    ServiceContainer.getInstance().registerSingleton(key, () => new constructor());
    return constructor;
  };
}

// Property decorator for dependency injection
export function Inject(key: ServiceKey) {
  return function (target: any, propertyKey: string) {
    Object.defineProperty(target, propertyKey, {
      get: () => getService(key),
      enumerable: true,
      configurable: true
    });
  };
}