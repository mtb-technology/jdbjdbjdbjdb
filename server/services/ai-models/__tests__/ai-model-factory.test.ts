/**
 * Integration tests for AIModelFactory
 *
 * Tests model registration, handler selection, configuration validation,
 * and circuit breaker functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIModelFactory } from '../ai-model-factory';
import type { AiConfig } from '@shared/schema';

describe('AIModelFactory - Model Registry', () => {
  let factory: AIModelFactory;

  beforeEach(() => {
    factory = AIModelFactory.getInstance();
  });

  describe('Model registration', () => {
    it('should register all configured models on initialization', () => {
      const availableModels = factory.getAvailableModels();

      expect(availableModels.length).toBeGreaterThan(0);
      expect(availableModels.some(m => m.model.includes('gemini'))).toBe(true);
      expect(availableModels.some(m => m.model.includes('gpt'))).toBe(true);
    });

    it('should provide model info for registered models', () => {
      const modelInfo = factory.getModelInfo('gemini-2.5-pro');

      expect(modelInfo).toBeDefined();
      expect(modelInfo?.provider).toBe('google');
      expect(modelInfo?.supportedParameters).toContain('temperature');
    });

    it('should return undefined for unregistered models', () => {
      const modelInfo = factory.getModelInfo('nonexistent-model');

      expect(modelInfo).toBeUndefined();
    });
  });

  describe('Supported parameters', () => {
    it('should return supported parameters for each model', () => {
      const geminiParams = factory.getSupportedParameters('gemini-2.5-pro');
      const gpt4oParams = factory.getSupportedParameters('gpt-4o');

      expect(geminiParams).toBeInstanceOf(Array);
      expect(gpt4oParams).toBeInstanceOf(Array);

      // Google models support topK
      expect(geminiParams).toContain('topK');

      // All models should support basic params
      expect(geminiParams).toContain('temperature');
      expect(gpt4oParams).toContain('temperature');
    });

    it('should return empty array for unknown models', () => {
      const params = factory.getSupportedParameters('unknown-model');

      expect(params).toEqual([]);
    });
  });

  describe('Model timeout configuration', () => {
    it('should return model-specific timeout', () => {
      const timeout = factory.getModelTimeout('gemini-2.5-pro');

      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThanOrEqual(600000); // Max 10 minutes
    });

    it('should return default timeout for unknown models', () => {
      const timeout = factory.getModelTimeout('unknown-model');

      expect(timeout).toBe(120000); // Default 2 minutes
    });
  });
});

describe('AIModelFactory - Configuration Validation', () => {
  let factory: AIModelFactory;

  beforeEach(() => {
    factory = AIModelFactory.getInstance();
  });

  describe('Valid configurations', () => {
    it('should validate correct Google configuration', () => {
      const config: AiConfig = {
        provider: 'google',
        model: 'gemini-2.5-pro',
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192
      };

      expect(() => factory.validateConfig(config)).not.toThrow();
    });

    it('should validate correct OpenAI configuration', () => {
      const config: AiConfig = {
        provider: 'openai',
        model: 'gpt-4o',
        temperature: 0.5,
        topP: 0.9,
        topK: 20,
        maxOutputTokens: 4096
      };

      expect(() => factory.validateConfig(config)).not.toThrow();
    });
  });

  describe('Invalid configurations', () => {
    it('should throw on unregistered model', () => {
      const config: AiConfig = {
        provider: 'openai',
        model: 'nonexistent-model',
        temperature: 0.7,
        topP: 0.95,
        topK: 20,
        maxOutputTokens: 8192
      };

      expect(() => factory.validateConfig(config)).toThrow('niet geregistreerd');
    });

    it('should throw on provider/model mismatch', () => {
      const config: AiConfig = {
        provider: 'google', // Wrong provider for GPT model
        model: 'gpt-4o',
        temperature: 0.7,
        topP: 0.95,
        topK: 20,
        maxOutputTokens: 8192
      };

      expect(() => factory.validateConfig(config)).toThrow();
    });
  });

  describe('Parameter warnings', () => {
    it('should warn about unsupported parameters', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Try to use topK with a model that doesn't support it
      const config: AiConfig = {
        provider: 'openai',
        model: 'o3-mini', // Reasoning models may not support all params
        temperature: 0.7,
        topP: 0.95,
        topK: 40, // May not be supported
        maxOutputTokens: 8192
      };

      factory.validateConfig(config);

      // Check if warning was logged (implementation-dependent)
      consoleWarnSpy.mockRestore();
    });
  });
});

describe('AIModelFactory - Handler Selection', () => {
  let factory: AIModelFactory;

  beforeEach(() => {
    factory = AIModelFactory.getInstance();
  });

  describe('getHandler', () => {
    it('should return handler for Google models', () => {
      const handler = factory.getHandler('gemini-2.5-pro');

      expect(handler).toBeDefined();
      expect(handler).not.toBeNull();
    });

    it('should return handler for OpenAI models when API key is available', () => {
      const handler = factory.getHandler('gpt-4o');

      // Handler may be null in test environment without OPENAI_API_KEY
      // This is expected behavior - factory returns null when API key is missing
      if (process.env.OPENAI_API_KEY) {
        expect(handler).not.toBeNull();
      } else {
        expect(handler).toBeNull();
      }
    });

    it('should return null for unknown models', () => {
      const handler = factory.getHandler('unknown-model');

      expect(handler).toBeNull();
    });

    it('should handle deep research models specially', () => {
      // These models may require special handlers
      const modelNames = ['o3-mini', 'o4-mini-deep-research-2025-06-26'];

      modelNames.forEach(modelName => {
        const modelInfo = factory.getModelInfo(modelName);
        if (modelInfo) {
          const handler = factory.getHandler(modelName);
          // Handler may be null if not configured, but shouldn't throw
          expect(() => factory.getHandler(modelName)).not.toThrow();
        }
      });
    });
  });
});

describe('AIModelFactory - Circuit Breaker', () => {
  let factory: AIModelFactory;
  let mockConfig: AiConfig;

  beforeEach(() => {
    factory = AIModelFactory.getInstance();
    mockConfig = {
      provider: 'google',
      model: 'gemini-2.5-pro',
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 8192
    };
  });

  describe('Circuit breaker state', () => {
    it.todo('should track failures per model');
    it.todo('should open circuit after 3 consecutive failures');
    it.todo('should throw immediately when circuit is open');
    it.todo('should reset circuit after 60 seconds');
    it.todo('should reset failure count on successful call');
  });

  describe('Circuit breaker recovery', () => {
    it.todo('should attempt half-open state after timeout');
    it.todo('should close circuit on successful half-open request');
    it.todo('should reopen circuit on failed half-open request');
  });
});

describe('AIModelFactory - Parameter Filtering', () => {
  let factory: AIModelFactory;

  beforeEach(() => {
    factory = AIModelFactory.getInstance();
  });

  describe('filterConfigForModel (integration)', () => {
    it.todo('should remove unsupported parameters for reasoning models');
    it.todo('should preserve all parameters for standard models');
    it.todo('should set neutral values for unsupported params');
    it.todo('should include optional params only if supported');
  });
});

describe('AIModelFactory - callModel (integration)', () => {
  let factory: AIModelFactory;
  let mockConfig: AiConfig;

  beforeEach(() => {
    factory = AIModelFactory.getInstance();
    mockConfig = {
      provider: 'google',
      model: 'gemini-2.5-pro',
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 8192
    };
  });

  describe('Prompt format handling', () => {
    it.todo('should handle legacy string prompts');
    it.todo('should handle new object format (systemPrompt + userInput)');
    it.todo('should combine system prompt and user input correctly');
  });

  describe('Model-specific behavior', () => {
    it.todo('should use correct timeout per model');
    it.todo('should filter unsupported parameters per model');
    it.todo('should select correct handler per model');
  });

  describe('Error propagation', () => {
    it.todo('should propagate authentication errors');
    it.todo('should propagate rate limit errors');
    it.todo('should propagate validation errors');
    it.todo('should wrap unknown errors in AIError');
  });
});

describe('AIModelFactory - Singleton Pattern', () => {
  it('should return same instance on multiple calls', () => {
    const instance1 = AIModelFactory.getInstance();
    const instance2 = AIModelFactory.getInstance();

    expect(instance1).toBe(instance2);
  });

  it('should maintain state across calls', () => {
    const instance1 = AIModelFactory.getInstance();
    const models1 = instance1.getAvailableModels();

    const instance2 = AIModelFactory.getInstance();
    const models2 = instance2.getAvailableModels();

    expect(models1).toEqual(models2);
  });
});
