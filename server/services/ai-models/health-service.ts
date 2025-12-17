/**
 * AI Health Service
 *
 * Provides health checking for AI services (Google AI, OpenAI).
 * Simplified version - just validates API keys and tracks basic health status.
 */

import { AIError, isAIError, getErrorCategory } from "@shared/errors";
import { GoogleAIHandler } from "./google-handler";
import { OpenAIStandardHandler } from "./openai-standard-handler";
import type { AiConfig } from "@shared/schema";

export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime?: number;
  error?: string;
  lastChecked: number;
}

export interface SystemHealthStatus {
  overall: 'healthy' | 'unhealthy' | 'degraded';
  services: HealthCheckResult[];
  timestamp: number;
  summary: {
    total: number;
    healthy: number;
    unhealthy: number;
    degraded: number;
  };
}

export class AIHealthService {
  private lastHealthCheck: Map<string, HealthCheckResult> = new Map();
  private healthCheckInterval: number = 300000; // 5 minutes (was 1 minute - reduced API costs)
  private healthCheckTimeout: number = 10000; // 10 seconds
  private healthCheckIntervalId?: NodeJS.Timeout; // Track interval for cleanup

  constructor() {
    // No dependencies needed
  }

  // Validate API key by making a minimal test call
  async validateAPIKey(provider: string, apiKey: string): Promise<{ valid: boolean; error?: string; responseTime?: number }> {
    const startTime = Date.now();
    
    try {
      let handler: GoogleAIHandler | OpenAIStandardHandler;
      let testConfig: AiConfig;

      if (provider === 'google') {
        handler = new GoogleAIHandler(apiKey);
        testConfig = {
          provider: 'google',
          model: 'gemini-2.5-flash', // Use configured model
          temperature: 0.1,
          topP: 0.9,
          topK: 20,
          maxOutputTokens: 50
        };
      } else if (provider === 'openai') {
        handler = new OpenAIStandardHandler(apiKey);
        testConfig = {
          provider: 'openai',
          model: 'gpt-4o-mini', // Use configured model
          temperature: 0.1,
          topP: 0.9,
          topK: 20,
          maxOutputTokens: 50
        };
      } else {
        return { valid: false, error: `Unsupported provider: ${provider}` };
      }

      // Make a minimal test call
      const response = await handler.call("Hi", testConfig, { 
        jobId: `health-check-${provider}-${Date.now()}` 
      });
      
      const responseTime = Date.now() - startTime;
      
      return {
        valid: true,
        responseTime
      };

    } catch (error: any) {
      const responseTime = Date.now() - startTime;

      // Use typed error category detection instead of string matching
      const errorCategory = getErrorCategory(error);
      let errorMessage = error.message || 'Unknown error';

      if (isAIError(error)) {
        // Map error categories to user-friendly messages
        switch (errorCategory) {
          case 'authentication':
            errorMessage = 'Invalid API key';
            break;
          case 'network':
            errorMessage = 'Network connectivity issue';
            break;
          case 'rate_limit':
            errorMessage = 'Rate limit exceeded (key may be valid)';
            break;
          default:
            // Keep the original error message for other cases
            break;
        }
      }

      return {
        valid: false,
        error: errorMessage,
        responseTime
      };
    }
  }

  // Perform health check for a specific service
  async checkServiceHealth(provider: string, apiKey: string): Promise<HealthCheckResult> {
    const serviceKey = provider;

    try {
      // Validate API key with timeout
      const keyValidation = await Promise.race([
        this.validateAPIKey(provider, apiKey),
        new Promise<{ valid: boolean; error: string }>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), this.healthCheckTimeout)
        )
      ]);

      // Determine health status based on API key validation
      let status: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

      if (!keyValidation.valid) {
        // Rate limit errors mean key is probably valid but temporarily blocked
        // Check for rate limit in the error message (this comes from our own typed error messages)
        if (keyValidation.error?.toLowerCase().includes('rate limit')) {
          status = 'degraded';
        } else {
          status = 'unhealthy';
        }
      }

      const result: HealthCheckResult = {
        service: `${provider.charAt(0).toUpperCase() + provider.slice(1)} AI`,
        status,
        responseTime: 'responseTime' in keyValidation ? keyValidation.responseTime : undefined,
        error: keyValidation.error,
        lastChecked: Date.now()
      };

      this.lastHealthCheck.set(serviceKey, result);
      return result;

    } catch (error: any) {
      const result: HealthCheckResult = {
        service: `${provider.charAt(0).toUpperCase() + provider.slice(1)} AI`,
        status: 'unhealthy',
        error: error.message || 'Health check failed',
        lastChecked: Date.now()
      };

      this.lastHealthCheck.set(serviceKey, result);
      return result;
    }
  }

  // Get comprehensive system health status
  async getSystemHealth(): Promise<SystemHealthStatus> {
    const services: HealthCheckResult[] = [];
    
    // Check all configured services
    const config = process.env;
    
    if (config.GOOGLE_AI_API_KEY) {
      const googleHealth = await this.checkServiceHealth('google', config.GOOGLE_AI_API_KEY);
      services.push(googleHealth);
    }
    
    if (config.OPENAI_API_KEY) {
      const openaiHealth = await this.checkServiceHealth('openai', config.OPENAI_API_KEY);
      services.push(openaiHealth);
    }

    // Calculate summary
    const summary = {
      total: services.length,
      healthy: services.filter(s => s.status === 'healthy').length,
      unhealthy: services.filter(s => s.status === 'unhealthy').length,
      degraded: services.filter(s => s.status === 'degraded').length
    };

    // Determine overall status
    let overall: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
    if (summary.unhealthy > 0) {
      overall = summary.total === summary.unhealthy ? 'unhealthy' : 'degraded';
    } else if (summary.degraded > 0) {
      overall = 'degraded';
    }

    return {
      overall,
      services,
      timestamp: Date.now(),
      summary
    };
  }

  // Get cached health status (faster for frequent checks)
  getCachedHealth(): SystemHealthStatus {
    const services: HealthCheckResult[] = [];
    
    // Get cached results  
    this.lastHealthCheck.forEach((result, key) => {
      services.push(result);
    });

    // If cache is empty or stale, return unhealthy status
    if (services.length === 0) {
      return {
        overall: 'unhealthy',
        services: [],
        timestamp: Date.now(),
        summary: {
          total: 0,
          healthy: 0,
          unhealthy: 0,
          degraded: 0
        }
      };
    }

    // Check for stale data (older than 5 minutes)
    const fiveMinutesAgo = Date.now() - 300000;
    const staleServices = services.filter(s => s.lastChecked < fiveMinutesAgo);
    
    const summary = {
      total: services.length,
      healthy: services.filter(s => s.status === 'healthy').length,
      unhealthy: services.filter(s => s.status === 'unhealthy').length,
      degraded: services.filter(s => s.status === 'degraded').length
    };

    let overall: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
    
    // If data is stale, mark as degraded
    if (staleServices.length > 0) {
      overall = 'degraded';
    } else if (summary.unhealthy > 0) {
      overall = summary.total === summary.unhealthy ? 'unhealthy' : 'degraded';
    } else if (summary.degraded > 0) {
      overall = 'degraded';
    }

    return {
      overall,
      services,
      timestamp: Date.now(),
      summary
    };
  }

  // Start periodic health checks
  startPeriodicHealthChecks(): void {
    // Prevent duplicate intervals - only start if not already running
    if (this.healthCheckIntervalId) {
      console.log('⚠️ Periodic health checks already running, skipping duplicate start');
      return;
    }

    this.healthCheckIntervalId = setInterval(async () => {
      try {
        await this.getSystemHealth();
        console.log(`🔍 Periodic health check completed at ${new Date().toISOString()}`);
      } catch (error) {
        console.error(`❌ Periodic health check failed:`, error);
      }
    }, this.healthCheckInterval);

    console.log(`✅ Started periodic health checks (interval: ${this.healthCheckInterval}ms)`);
  }

  // Stop periodic health checks - call on server shutdown
  stopPeriodicHealthChecks(): void {
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = undefined;
      console.log('🛑 Stopped periodic health checks');
    }
  }

  // Check if periodic health checks are running
  isPeriodicHealthChecksRunning(): boolean {
    return this.healthCheckIntervalId !== undefined;
  }

  // Enhanced API key validation that integrates with existing validation
  static async validateAllAPIKeys(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const config = process.env;

    const healthService = new AIHealthService();

    // Check Google AI key if provided
    if (config.GOOGLE_AI_API_KEY) {
      const result = await healthService.validateAPIKey('google', config.GOOGLE_AI_API_KEY);
      if (!result.valid) {
        errors.push(`Google AI API key validation failed: ${result.error}`);
      }
    }

    // Check OpenAI key if provided
    if (config.OPENAI_API_KEY) {
      const result = await healthService.validateAPIKey('openai', config.OPENAI_API_KEY);
      if (!result.valid) {
        errors.push(`OpenAI API key validation failed: ${result.error}`);
      }
    }

    // Require at least one valid key
    if (!config.GOOGLE_AI_API_KEY && !config.OPENAI_API_KEY) {
      errors.push('At least one AI API key (OPENAI_API_KEY or GOOGLE_AI_API_KEY) must be configured');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}