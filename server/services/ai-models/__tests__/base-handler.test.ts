import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseAIHandler, AIModelResponse, AIModelParameters } from '../base-handler';
import { AIError } from '../../../../shared/errors';
import type { AiConfig } from '../../../../shared/schema';

// Mock implementation for testing
class MockAIHandler extends BaseAIHandler {
  public mockResponse: AIModelResponse | undefined;
  public mockError: Error | undefined;
  public callCount = 0;

  constructor() {
    super('Mock AI', 'test-api-key');
  }

  async callInternal(prompt: string, config: AiConfig, options?: AIModelParameters & { signal?: AbortSignal }): Promise<AIModelResponse> {
    this.callCount++;
    
    if (options?.signal?.aborted) {
      throw new DOMException('Operation was aborted', 'AbortError');
    }

    if (this.mockError) {
      throw this.mockError;
    }

    return this.mockResponse || {
      content: 'Mock response',
      duration: 100,
      usage: { tokens: 50 }
    };
  }

  validateParameters(config: AiConfig): void {
    // Mock validation - can be overridden in tests
  }

  getSupportedParameters(): string[] {
    return ['temperature', 'topP', 'maxOutputTokens'];
  }

  // Expose protected methods for testing
  public testValidatePrompt(prompt: string) {
    return this.validatePrompt(prompt);
  }

  public testValidateConfig(config: AiConfig) {
    return this.validateConfig(config);
  }

  public testValidateOptions(options?: AIModelParameters) {
    return this.validateOptions(options);
  }

  public testGetCircuitBreakerStatus() {
    return this.getCircuitBreakerStatus();
  }
}

describe('BaseAIHandler', () => {
  let handler: MockAIHandler;
  let mockConfig: AiConfig;

  beforeEach(() => {
    handler = new MockAIHandler();
    mockConfig = {
      model: 'test-model',
      provider: 'openai',
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 1000
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Input Validation', () => {
    describe('Prompt validation', () => {
      it('should validate normal prompts', () => {
        expect(() => handler.testValidatePrompt('Hello, how are you?')).not.toThrow();
      });

      it('should reject empty prompts', () => {
        expect(() => handler.testValidatePrompt('')).toThrow(AIError);
        expect(() => handler.testValidatePrompt('   ')).toThrow('empty or only whitespace');
      });

      it('should reject non-string prompts', () => {
        expect(() => handler.testValidatePrompt(null as any)).toThrow('must be a non-empty string');
        expect(() => handler.testValidatePrompt(123 as any)).toThrow('must be a non-empty string');
      });

      it('should reject prompts that are too long', () => {
        const longPrompt = 'a'.repeat(1000001); // 1MB + 1
        expect(() => handler.testValidatePrompt(longPrompt)).toThrow('exceeds maximum length');
      });

      it('should detect and reject malicious content', () => {
        const maliciousPrompts = [
          '<script>alert("xss")</script>',
          'javascript:alert("xss")',
          '<iframe src="evil.com"></iframe>',
          'data:text/html,<script>alert(1)</script>',
          '<object data="evil.swf"></object>',
          'onclick="alert(1)"'
        ];

        maliciousPrompts.forEach(prompt => {
          expect(() => handler.testValidatePrompt(prompt)).toThrow('potentially malicious content');
        });
      });

      it('should normalize and detect encoded malicious content', () => {
        const encodedPrompts = [
          '&lt;script&gt;alert("xss")&lt;/script&gt;',
          '&#60;script&#62;alert("xss")&#60;/script&#62;',
          '%3Cscript%3Ealert("xss")%3C/script%3E'
        ];

        encodedPrompts.forEach(prompt => {
          expect(() => handler.testValidatePrompt(prompt)).toThrow('potentially malicious content');
        });
      });
    });

    describe('Config validation', () => {
      it('should validate correct config', () => {
        expect(() => handler.testValidateConfig(mockConfig)).not.toThrow();
      });

      it('should reject invalid config object', () => {
        expect(() => handler.testValidateConfig(null as any)).toThrow('must be a valid object');
        expect(() => handler.testValidateConfig('invalid' as any)).toThrow('must be a valid object');
      });

      it('should reject missing required fields', () => {
        expect(() => handler.testValidateConfig({ ...mockConfig, model: '' })).toThrow('Model name is required');
        expect(() => handler.testValidateConfig({ ...mockConfig, provider: '' as any })).toThrow('Provider is required');
      });

      it('should reject unsupported providers', () => {
        expect(() => handler.testValidateConfig({ ...mockConfig, provider: 'unsupported' as any })).toThrow('Unsupported provider');
      });

      it('should validate numeric parameters', () => {
        expect(() => handler.testValidateConfig({ ...mockConfig, temperature: -0.1 })).toThrow('Temperature must be between');
        expect(() => handler.testValidateConfig({ ...mockConfig, temperature: 2.1 })).toThrow('Temperature must be between');
        expect(() => handler.testValidateConfig({ ...mockConfig, topP: -0.1 })).toThrow('TopP must be between');
        expect(() => handler.testValidateConfig({ ...mockConfig, topP: 1.1 })).toThrow('TopP must be between');
      });

      it('should validate reasoning parameter', () => {
        expect(() => handler.testValidateConfig({ 
          ...mockConfig, 
          reasoning: { effort: 'invalid' as any } 
        })).toThrow('Invalid reasoning effort');

        expect(() => handler.testValidateConfig({ 
          ...mockConfig, 
          reasoning: 'invalid' as any 
        })).toThrow('Reasoning parameter must be an object');
      });
    });

    describe('Options validation', () => {
      it('should validate correct options', () => {
        const options = {
          jobId: 'test-job-123',
          useWebSearch: true,
          useGrounding: false,
          timeout: 5000
        };
        expect(() => handler.testValidateOptions(options)).not.toThrow();
      });

      it('should reject invalid boolean parameters', () => {
        expect(() => handler.testValidateOptions({ useWebSearch: 'true' as any })).toThrow('useWebSearch must be a boolean');
        expect(() => handler.testValidateOptions({ useGrounding: 'false' as any })).toThrow('useGrounding must be a boolean');
      });

      it('should validate jobId format', () => {
        expect(() => handler.testValidateOptions({ jobId: '' })).toThrow('jobId must be a non-empty string');
        expect(() => handler.testValidateOptions({ jobId: 123 as any })).toThrow('jobId must be a non-empty string');
        expect(() => handler.testValidateOptions({ jobId: 'a'.repeat(101) })).toThrow('jobId must be less than 100 characters');
      });
    });
  });

  describe('Retry Logic', () => {
    it('should retry on retryable errors', async () => {
      handler.mockError = AIError.networkError('test', new Error('Network error'));
      
      try {
        await handler.call('test prompt', mockConfig);
      } catch (error) {
        expect(handler.callCount).toBe(4); // 1 initial + 3 retries
      }
    });

    it('should not retry on non-retryable errors', async () => {
      handler.mockError = AIError.invalidInput('Invalid input');
      
      try {
        await handler.call('test prompt', mockConfig);
      } catch (error) {
        expect(handler.callCount).toBe(1); // Only initial attempt
      }
    });

    it('should succeed after retry', async () => {
      let attemptCount = 0;
      handler.callInternal = vi.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount <= 2) {
          throw AIError.networkError('test', new Error('Network error'));
        }
        return { content: 'Success after retry', duration: 100 };
      });

      const result = await handler.call('test prompt', mockConfig);
      expect(result.content).toBe('Success after retry');
      expect(attemptCount).toBe(3);
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout on slow responses', async () => {
      handler.callInternal = vi.fn().mockImplementation(async (prompt, config, options) => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ content: 'Late response', duration: 1000 }), 2000);
        });
      });

      await expect(handler.call('test prompt', mockConfig, { timeout: 500 })).rejects.toThrow('timeout');
    });

    it('should respect custom timeout values', async () => {
      const startTime = Date.now();
      
      handler.callInternal = vi.fn().mockImplementation(async () => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ content: 'Response', duration: 100 }), 1000);
        });
      });

      try {
        await handler.call('test prompt', mockConfig, { timeout: 800 });
      } catch (error) {
        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(1000); // Should timeout before 1000ms
        expect(error).toBeInstanceOf(AIError);
      }
    });

    it('should handle aborted signals', async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);

      handler.callInternal = vi.fn().mockImplementation(async (prompt, config, options) => {
        if (options?.signal?.aborted) {
          throw new DOMException('Operation was aborted', 'AbortError');
        }
        return new Promise((resolve) => {
          setTimeout(() => resolve({ content: 'Response', duration: 100 }), 200);
        });
      });

      await expect(handler.call('test prompt', mockConfig, { timeout: 50 })).rejects.toThrow('timeout');
    });
  });

  describe('Circuit Breaker', () => {
    it('should start in closed state', () => {
      const status = handler.testGetCircuitBreakerStatus();
      expect(status.state).toBe('closed');
      expect(status.failures).toBe(0);
    });

    it('should open after threshold failures', async () => {
      handler.mockError = AIError.networkError('test', new Error('Network error'));
      
      // Cause 5 failures to trip the circuit breaker
      for (let i = 0; i < 5; i++) {
        try {
          await handler.call('test prompt', mockConfig);
        } catch (error) {
          // Expected to fail
        }
      }

      const status = handler.testGetCircuitBreakerStatus();
      expect(status.state).toBe('open');
      expect(status.failures).toBe(5);
    });

    it('should reject requests when circuit breaker is open', async () => {
      // Force circuit breaker to open state
      handler.mockError = AIError.networkError('test', new Error('Network error'));
      
      for (let i = 0; i < 5; i++) {
        try {
          await handler.call('test prompt', mockConfig);
        } catch (error) {
          // Expected to fail
        }
      }

      // Next call should be rejected immediately due to open circuit
      await expect(handler.call('test prompt', mockConfig)).rejects.toThrow('Circuit breaker is open');
    });

    it('should transition to half-open after recovery timeout', async () => {
      // Mock short recovery timeout for testing
      (handler as any).recoveryTimeout = 100;
      
      // Trip the circuit breaker
      handler.mockError = AIError.networkError('test', new Error('Network error'));
      for (let i = 0; i < 5; i++) {
        try {
          await handler.call('test prompt', mockConfig);
        } catch (error) {
          // Expected to fail
        }
      }

      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Clear the error for the next call
      handler.mockError = undefined;
      handler.mockResponse = { content: 'Recovery test', duration: 100 };

      const result = await handler.call('test prompt', mockConfig);
      expect(result.content).toBe('Recovery test');
    });
  });

  describe('Response Validation', () => {
    it('should validate successful responses', async () => {
      handler.mockResponse = {
        content: 'Valid response',
        duration: 150,
        usage: { tokens: 25 }
      };

      const result = await handler.call('test prompt', mockConfig);
      expect(result.content).toBe('Valid response');
      expect(result.duration).toBe(150);
    });

    it('should handle empty responses', async () => {
      handler.mockResponse = {
        content: '',
        duration: 100
      };

      const result = await handler.call('test prompt', mockConfig);
      expect(result.content).toBe('');
    });

    it('should fix invalid duration values', async () => {
      handler.mockResponse = {
        content: 'Test response',
        duration: -50 // Invalid negative duration
      };

      const result = await handler.call('test prompt', mockConfig);
      expect(result.duration).toBe(0); // Should be fixed to 0
    });
  });

  describe('Error Enhancement', () => {
    it('should enhance network errors', async () => {
      const networkError = new Error('ENOTFOUND');
      networkError.name = 'NetworkError';
      (networkError as any).code = 'ENOTFOUND';
      
      handler.mockError = networkError;

      try {
        await handler.call('test prompt', mockConfig);
      } catch (error) {
        expect(error).toBeInstanceOf(AIError);
        expect((error as AIError).isRetryable).toBe(true);
      }
    });

    it('should enhance timeout errors', async () => {
      const timeoutError = new Error('Operation timed out');
      timeoutError.name = 'AbortError';
      
      handler.mockError = timeoutError;

      try {
        await handler.call('test prompt', mockConfig);
      } catch (error) {
        expect(error).toBeInstanceOf(AIError);
        expect((error as AIError).message).toContain('timeout');
      }
    });

    it('should sanitize sensitive data in errors', async () => {
      const errorWithApiKey = new Error('API call failed with key sk-1234567890abcdef');
      handler.mockError = errorWithApiKey;

      try {
        await handler.call('test prompt', mockConfig);
      } catch (error) {
        expect((error as AIError).message).not.toContain('sk-1234567890abcdef');
        expect((error as AIError).message).toContain('sk-***');
      }
    });
  });

  describe('Config Merging', () => {
    it('should merge options with config correctly', () => {
      const config = { ...mockConfig, temperature: 0.5 };
      const options = { temperature: 0.8, topP: 0.95 };
      
      const merged = (handler as any).mergeConfigWithOptions(config, options);
      
      expect(merged.temperature).toBe(0.8); // Options should override
      expect(merged.topP).toBe(0.95); // Options should override
      expect(merged.model).toBe(mockConfig.model); // Original should remain
    });

    it('should not modify original config when merging', () => {
      const originalConfig = { ...mockConfig, temperature: 0.5 };
      const options = { temperature: 0.8 };
      
      (handler as any).mergeConfigWithOptions(originalConfig, options);
      
      expect(originalConfig.temperature).toBe(0.5); // Should remain unchanged
    });
  });
});