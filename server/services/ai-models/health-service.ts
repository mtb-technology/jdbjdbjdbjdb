import { AIError } from "@shared/errors";
import { GoogleAIHandler } from "./google-handler";
import { OpenAIStandardHandler } from "./openai-standard-handler";
import { AIMonitoringService } from "./monitoring";
import type { AIMetrics } from "./monitoring";
import type { AiConfig } from "@shared/schema";

export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime?: number;
  error?: string;
  lastChecked: number;
  metadata?: {
    apiKeyValid?: boolean;
    circuitBreakerState?: string;
    errorRate?: number;
    avgResponseTime?: number;
  };
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
  private monitoring: AIMonitoringService;
  private lastHealthCheck: Map<string, HealthCheckResult> = new Map();
  private healthCheckInterval: number = 60000; // 1 minute
  private healthCheckTimeout: number = 10000; // 10 seconds

  constructor(monitoring: AIMonitoringService) {
    this.monitoring = monitoring;
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
      
      // Parse specific error types based on message content
      let errorMessage = error.message || 'Unknown error';
      if (error instanceof AIError) {
        if (errorMessage.includes('authentication') || errorMessage.includes('API key')) {
          errorMessage = 'Invalid API key';
        } else if (errorMessage.includes('network') || errorMessage.includes('ENOTFOUND')) {
          errorMessage = 'Network connectivity issue';
        } else if (errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
          errorMessage = 'Rate limit exceeded (key may be valid)';
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
    const startTime = Date.now();
    const serviceKey = provider;

    try {
      // Validate API key with timeout
      const keyValidation = await Promise.race([
        this.validateAPIKey(provider, apiKey),
        new Promise<{ valid: boolean; error: string }>((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), this.healthCheckTimeout)
        )
      ]);

      // Get monitoring metrics for this service
      const allMetrics = this.monitoring.getMetrics() as Record<string, AIMetrics>;
      
      // Find metrics for this provider's models
      const providerMetrics = Object.entries(allMetrics)
        .filter(([key]) => key.startsWith(`${provider}-`));
      
      let avgResponseTime = 0;
      let errorRate = 0;
      let totalRequests = 0;
      let totalErrors = 0;

      providerMetrics.forEach(([_, serviceMetrics]) => {
        totalRequests += serviceMetrics.totalRequests;
        totalErrors += serviceMetrics.failedRequests;
        if (serviceMetrics.averageResponseTime > 0) {
          avgResponseTime += serviceMetrics.averageResponseTime;
        }
      });

      if (providerMetrics.length > 0) {
        avgResponseTime = avgResponseTime / providerMetrics.length;
        errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
      }

      // Get circuit breaker state for primary model
      const primaryModelKey = provider === 'google' ? 'google-gemini-2.5-flash' : 'openai-gpt-4o-mini';
      const primaryMetrics = allMetrics[primaryModelKey];
      const circuitBreakerState = primaryMetrics?.circuitBreakerStates?.[primaryModelKey] || 'closed';

      // Determine overall health status
      let status: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
      
      if (!keyValidation.valid) {
        status = 'unhealthy';
      } else if (circuitBreakerState === 'open') {
        status = 'unhealthy';
      } else if (circuitBreakerState === 'half-open' || errorRate > 10) {
        status = 'degraded';
      }

      const result: HealthCheckResult = {
        service: `${provider.charAt(0).toUpperCase() + provider.slice(1)} AI`,
        status,
        responseTime: 'responseTime' in keyValidation ? keyValidation.responseTime : undefined,
        error: keyValidation.error,
        lastChecked: Date.now(),
        metadata: {
          apiKeyValid: keyValidation.valid,
          circuitBreakerState,
          errorRate: Math.round(errorRate * 100) / 100,
          avgResponseTime: Math.round(avgResponseTime)
        }
      };

      this.lastHealthCheck.set(serviceKey, result);
      return result;

    } catch (error: any) {
      const result: HealthCheckResult = {
        service: `${provider.charAt(0).toUpperCase() + provider.slice(1)} AI`,
        status: 'unhealthy',
        error: error.message || 'Health check failed',
        lastChecked: Date.now(),
        metadata: {
          apiKeyValid: false
        }
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
    setInterval(async () => {
      try {
        await this.getSystemHealth();
        console.log(`🔍 Periodic health check completed at ${new Date().toISOString()}`);
      } catch (error) {
        console.error(`❌ Periodic health check failed:`, error);
      }
    }, this.healthCheckInterval);
  }

  // Enhanced API key validation that integrates with existing validation
  static async validateAllAPIKeys(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const config = process.env;

    const healthService = new AIHealthService(new AIMonitoringService());

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