import { describe, it, expect } from 'vitest';
import { AIError } from '../../../shared/errors';

describe('AI Error Handling', () => {
  describe('AIError Factory Methods', () => {
    it('should create timeout errors correctly', () => {
      const error = AIError.timeout('test-model', 5000);
      
      expect(error).toBeInstanceOf(AIError);
      expect(error.message).toContain('timeout');
      expect(error.message).toContain('test-model');
      expect(error.isRetryable).toBe(true);
      expect(error.retryAfter).toBe(5000);
    });

    it('should create network errors correctly', () => {
      const originalError = new Error('Connection refused');
      const error = AIError.networkError('test-provider', originalError);
      
      expect(error).toBeInstanceOf(AIError);
      expect(error.message).toContain('Network error');
      expect(error.message).toContain('test-provider');
      expect(error.isRetryable).toBe(true);
      expect(error.retryAfter).toBe(5000);
    });

    it('should create rate limit errors correctly', () => {
      const error = AIError.rateLimited('test-model', 60000);
      
      expect(error).toBeInstanceOf(AIError);
      expect(error.message).toContain('rate limit');
      expect(error.isRetryable).toBe(true);
      expect(error.retryAfter).toBe(60000);
    });

    it('should create validation errors correctly', () => {
      const error = AIError.validationFailed('Invalid parameter', { param: 'temperature' });
      
      expect(error).toBeInstanceOf(AIError);
      expect(error.message).toBe('Invalid parameter');
      expect(error.isRetryable).toBe(false);
      expect(error.details).toEqual({ param: 'temperature' });
    });

    it('should create input errors correctly', () => {
      const error = AIError.invalidInput('Prompt too long');
      
      expect(error).toBeInstanceOf(AIError);
      expect(error.message).toBe('Prompt too long');
      expect(error.isRetryable).toBe(false);
    });

    it('should create circuit breaker errors correctly', () => {
      const error = AIError.circuitBreakerOpen('test-provider', 'Too many failures');
      
      expect(error).toBeInstanceOf(AIError);
      expect(error.message).toContain('Circuit breaker is open');
      expect(error.isRetryable).toBe(true);
      expect(error.retryAfter).toBe(30000);
    });

    it('should create invalid response errors correctly', () => {
      const error = AIError.invalidResponse('test-model', 'Empty response received');
      
      expect(error).toBeInstanceOf(AIError);
      expect(error.message).toContain('Empty response received');
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('HTTP Error Conversion', () => {
    it('should handle 401 errors as non-retryable', () => {
      const error = AIError.fromHttpError(401, 'Unauthorized', 'test-model');
      
      expect(error.isRetryable).toBe(false);
      expect(error.message).toContain('Unauthorized');
    });

    it('should handle 404 errors as non-retryable', () => {
      const error = AIError.fromHttpError(404, 'Not Found', 'test-model');
      
      expect(error.isRetryable).toBe(false);
    });

    it('should handle 429 errors as retryable', () => {
      const error = AIError.fromHttpError(429, 'Rate limited', 'test-model');
      
      expect(error.isRetryable).toBe(true);
      expect(error.retryAfter).toBe(60000); // Default retry after
    });

    it('should handle 500 errors as retryable', () => {
      const error = AIError.fromHttpError(500, 'Internal Server Error', 'test-model');
      
      expect(error.isRetryable).toBe(true);
      expect(error.retryAfter).toBe(5000);
    });

    it('should handle 502/503 errors as retryable', () => {
      const error502 = AIError.fromHttpError(502, 'Bad Gateway', 'test-model');
      const error503 = AIError.fromHttpError(503, 'Service Unavailable', 'test-model');
      
      expect(error502.isRetryable).toBe(true);
      expect(error503.isRetryable).toBe(true);
    });

    it('should handle unknown status codes appropriately', () => {
      const error = AIError.fromHttpError(418, "I'm a teapot", 'test-model');
      
      expect(error.isRetryable).toBe(false); // Unknown codes default to non-retryable
    });
  });

  describe('Error Properties', () => {
    it('should maintain error details', () => {
      const details = { 
        requestId: 'req-123', 
        timestamp: new Date().toISOString(),
        additionalInfo: 'test data'
      };
      
      const error = AIError.validationFailed('Test error', details);
      
      expect(error.details).toEqual(details);
    });

    it('should have correct error codes', () => {
      const timeoutError = AIError.timeout('test', 1000);
      const networkError = AIError.networkError('test', new Error('test'));
      const validationError = AIError.validationFailed('test');
      
      expect(timeoutError.errorCode).toBe('AI_TIMEOUT');
      expect(networkError.errorCode).toBe('AI_NETWORK_ERROR');
      expect(validationError.errorCode).toBe('VALIDATION_FAILED');
    });

    it('should be serializable', () => {
      const error = AIError.timeout('test-model', 5000);
      const serialized = JSON.stringify(error);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.message).toBe(error.message);
      expect(parsed.errorCode).toBe(error.errorCode);
      expect(parsed.isRetryable).toBe(error.isRetryable);
      expect(parsed.retryAfter).toBe(error.retryAfter);
    });
  });
});