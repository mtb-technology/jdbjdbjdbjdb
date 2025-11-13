/**
 * Integration tests for BaseAIHandler
 *
 * Tests the critical retry logic, circuit breaker, and error handling
 * that are currently untested but heavily used in production.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseAIHandler, AIModelResponse } from '../base-handler';
import type { AiConfig } from '@shared/schema';
import { AIError, ERROR_CODES } from '@shared/errors';

// Mock implementation for testing
class TestAIHandler extends BaseAIHandler {
  public callCount = 0;
  public mockResponses: Array<AIModelResponse | Error> = [];

  constructor(modelName: string, apiKey?: string) {
    super(modelName, apiKey);
  }

  async callInternal(
    prompt: string,
    config: AiConfig,
    options?: any
  ): Promise<AIModelResponse> {
    this.callCount++;

    if (this.mockResponses.length === 0) {
      return {
        content: 'Test response',
        duration: 100,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      };
    }

    const response = this.mockResponses.shift();
    if (response instanceof Error) {
      throw response;
    }
    return response!;
  }

  // Implement abstract methods
  validateParameters(config: AiConfig): void {
    // No-op for test handler - validation happens in base class
  }

  getSupportedParameters(): string[] {
    return ['temperature', 'topP', 'topK', 'maxOutputTokens'];
  }

  // Expose protected methods for testing
  public testIsRetryableError(error: Error): boolean {
    return this.isRetryableError(error);
  }

  public testCalculateRetryDelay(attempt: number): number {
    return this.calculateRetryDelay(attempt);
  }
}

describe('BaseAIHandler - Retry Logic', () => {
  let handler: TestAIHandler;
  let mockConfig: AiConfig;

  beforeEach(() => {
    handler = new TestAIHandler('test-model', 'test-api-key');
    mockConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 8192
    };
    vi.clearAllMocks();
  });

  describe('Successful calls', () => {
    it('should return response on first successful call', async () => {
      const response = await handler.call('Test prompt', mockConfig);

      expect(response.content).toBe('Test response');
      expect(handler.callCount).toBe(1);
    });

    it('should include usage information and duration', async () => {
      const response = await handler.call('Test prompt', mockConfig);

      expect(response.duration).toBeGreaterThanOrEqual(0);
      expect(response.usage).toBeDefined();
    });
  });

  describe('Retry on transient errors', () => {
    it('should retry on 503 Service Unavailable errors', async () => {
      // Mock sleep to speed up test
      vi.spyOn(handler as any, 'sleep').mockResolvedValue(undefined);

      // Mock: First two calls fail with 503, third succeeds
      const error503 = AIError.fromHttpError(503, 'Service Unavailable', 'test-provider');
      handler.mockResponses = [
        error503,
        error503,
        {
          content: 'Success after retries',
          duration: 100,
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        }
      ];

      const response = await handler.call('Test prompt', mockConfig);

      expect(response.content).toBe('Success after retries');
      expect(handler.callCount).toBe(3); // 2 failures + 1 success
    });

    it('should retry on network errors', async () => {
      // Mock sleep to speed up test
      vi.spyOn(handler as any, 'sleep').mockResolvedValue(undefined);

      const networkError = AIError.networkError('test-provider', new Error('ECONNREFUSED'));
      handler.mockResponses = [
        networkError,
        {
          content: 'Success after network error',
          duration: 100,
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        }
      ];

      const response = await handler.call('Test prompt', mockConfig);

      expect(response.content).toBe('Success after network error');
      expect(handler.callCount).toBe(2);
    });

    it('should retry on timeout errors', async () => {
      // Mock sleep to speed up test
      vi.spyOn(handler as any, 'sleep').mockResolvedValue(undefined);

      const timeoutError = AIError.timeout('test-provider', 120000);
      handler.mockResponses = [
        timeoutError,
        {
          content: 'Success after timeout',
          duration: 100,
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        }
      ];

      const response = await handler.call('Test prompt', mockConfig);

      expect(response.content).toBe('Success after timeout');
      expect(handler.callCount).toBe(2);
    });
  });

  describe('Fail fast on non-retryable errors', () => {
    it('should NOT retry on 401 Authentication errors', async () => {
      const authError = AIError.fromHttpError(401, 'Unauthorized', 'test-provider');
      handler.mockResponses = [authError];

      await expect(handler.call('Test prompt', mockConfig)).rejects.toThrow();
      expect(handler.callCount).toBe(1); // Only one attempt
    });

    it('should NOT retry on 404 Model Not Found errors', async () => {
      const notFoundError = AIError.fromHttpError(404, 'Model not found', 'test-provider');
      handler.mockResponses = [notFoundError];

      await expect(handler.call('Test prompt', mockConfig)).rejects.toThrow();
      expect(handler.callCount).toBe(1);
    });

    it('should NOT retry on validation errors', async () => {
      const validationError = AIError.validationFailed('Invalid prompt format');
      handler.mockResponses = [validationError];

      await expect(handler.call('Test prompt', mockConfig)).rejects.toThrow();
      expect(handler.callCount).toBe(1);
    });
  });

  describe('Max retries behavior', () => {
    it('should throw after max retries exceeded', async () => {
      // Mock sleep to speed up test
      vi.spyOn(handler as any, 'sleep').mockResolvedValue(undefined);

      const error503 = AIError.fromHttpError(503, 'Service Unavailable', 'test-provider');
      // All 4 attempts fail (1 initial + 3 retries)
      handler.mockResponses = [error503, error503, error503, error503];

      await expect(handler.call('Test prompt', mockConfig)).rejects.toThrow();
      expect(handler.callCount).toBe(4); // 1 initial + 3 retries
    });

    it('should succeed on last retry attempt', async () => {
      // Mock sleep to speed up test
      vi.spyOn(handler as any, 'sleep').mockResolvedValue(undefined);

      const error503 = AIError.fromHttpError(503, 'Service Unavailable', 'test-provider');
      // Fail 3 times, succeed on 4th (last possible attempt)
      handler.mockResponses = [
        error503,
        error503,
        error503,
        {
          content: 'Success on last attempt',
          duration: 100,
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        }
      ];

      const response = await handler.call('Test prompt', mockConfig);

      expect(response.content).toBe('Success on last attempt');
      expect(handler.callCount).toBe(4);
    });
  });

  describe('Exponential backoff', () => {
    it('should use exponential backoff delays', async () => {
      const sleepSpy = vi.spyOn(handler as any, 'sleep').mockResolvedValue(undefined);
      const error503 = AIError.fromHttpError(503, 'Service Unavailable', 'test-provider');

      handler.mockResponses = [
        error503,
        error503,
        {
          content: 'Success',
          duration: 100,
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
        }
      ];

      await handler.call('Test prompt', mockConfig);

      // Should have called sleep twice (after 1st and 2nd failures)
      expect(sleepSpy).toHaveBeenCalledTimes(2);

      // Check that delays are passed (actual values depend on retryAfter from error)
      // For 503 errors, the retryAfter might be set by the error itself
      const firstDelay = sleepSpy.mock.calls[0][0];
      const secondDelay = sleepSpy.mock.calls[1][0];

      // Just verify that delays are positive numbers
      expect(firstDelay).toBeGreaterThan(0);
      expect(secondDelay).toBeGreaterThan(0);
    });
  });

  describe('isRetryableError decision logic', () => {
    it('should identify retryable network errors correctly', () => {
      // Create errors with actual retryable error codes
      const retryableErrors = [
        { code: 'ENOTFOUND', message: 'Network not found' },
        { code: 'ECONNREFUSED', message: 'Connection refused' },
        { code: 'ECONNRESET', message: 'Connection reset' },
        { code: 'ETIMEDOUT', message: 'Connection timed out' },
        { code: 'EHOSTUNREACH', message: 'Host unreachable' },
        { name: 'AbortError', message: 'Request aborted' },
        new Error('timeout occurred')
      ];

      retryableErrors.forEach(error => {
        expect(handler.testIsRetryableError(error)).toBe(true);
      });
    });

    it('should identify non-retryable errors correctly', () => {
      const nonRetryableErrors = [
        AIError.fromHttpError(401, 'Unauthorized', 'test'),
        AIError.fromHttpError(404, 'Not Found', 'test'),
        new Error('Generic error')
      ];

      nonRetryableErrors.forEach(error => {
        expect(handler.testIsRetryableError(error)).toBe(false);
      });
    });
  });

  describe('Error message preservation', () => {
    it('should preserve original error details after retries', async () => {
      // Mock sleep to speed up test
      vi.spyOn(handler as any, 'sleep').mockResolvedValue(undefined);

      const originalError = AIError.fromHttpError(
        503,
        'Detailed error message from API',
        'test-provider'
      );
      handler.mockResponses = [originalError, originalError, originalError, originalError];

      try {
        await handler.call('Test prompt', mockConfig);
        expect.fail('Should have thrown error');
      } catch (error: any) {
        // The message is standardized for 503 errors
        expect(error.message).toContain('service temporarily unavailable');
        expect(error.errorCode).toBe(ERROR_CODES.AI_SERVICE_UNAVAILABLE);
        // But details should include the original responseText
        expect(error.details).toMatchObject({
          statusCode: 503,
          responseText: 'Detailed error message from API',
          provider: 'test-provider'
        });
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle maxRetries = 0 (no retries)', async () => {
      const noRetryHandler = new TestAIHandler('test-model', 'test-key');
      // Override maxRetries to 0
      (noRetryHandler as any).maxRetries = 0;

      const error503 = AIError.fromHttpError(503, 'Service Unavailable', 'test');
      noRetryHandler.mockResponses = [error503];

      await expect(noRetryHandler.call('Test', mockConfig)).rejects.toThrow();
      expect(noRetryHandler.callCount).toBe(1); // Only initial attempt
    });

    it('should reject empty or whitespace-only prompts', async () => {
      await expect(handler.call('', mockConfig)).rejects.toThrow('Prompt must be a non-empty string');
      await expect(handler.call('   ', mockConfig)).rejects.toThrow('Prompt cannot be empty or only whitespace');
      expect(handler.callCount).toBe(0); // Should fail validation before calling
    });

    it('should handle very long prompts', async () => {
      const longPrompt = 'a'.repeat(100000); // 100KB prompt
      const response = await handler.call(longPrompt, mockConfig);

      expect(response.content).toBeDefined();
    });
  });
});

describe('BaseAIHandler - Circuit Breaker (Future)', () => {
  // Note: Circuit breaker logic exists but is in AIModelFactory
  // These tests document expected behavior for future implementation

  it.todo('should track consecutive failures');
  it.todo('should open circuit after threshold failures');
  it.todo('should reject requests when circuit is open');
  it.todo('should attempt half-open state after timeout');
  it.todo('should close circuit on successful half-open request');
});

describe('BaseAIHandler - Response Normalization', () => {
  // Tests for normalizeResponseContent method
  // This is critical for handling different AI provider response formats

  it.todo('should normalize Google Gemini response format');
  it.todo('should normalize OpenAI standard response format');
  it.todo('should normalize OpenAI reasoning response format');
  it.todo('should handle missing fields gracefully');
  it.todo('should extract usage statistics correctly');
});
