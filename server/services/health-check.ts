/**
 * Health Check Service voor system monitoring
 */

import type { 
  IHealthCheckService, 
  HealthCheckResult 
} from '@shared/types/services';
import { checkDatabaseConnection } from '../db';
import { AIModelFactory } from './ai-models/ai-model-factory';
import { SourceValidator } from './source-validator';
import { config } from '../config';

export class HealthCheckService implements IHealthCheckService {
  private readonly sourceValidator: SourceValidator;
  private readonly aiModelFactory: AIModelFactory;

  constructor() {
    this.sourceValidator = new SourceValidator();
    this.aiModelFactory = AIModelFactory.getInstance();
  }

  async checkDatabase(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const isHealthy = await checkDatabaseConnection();
      const responseTime = Date.now() - startTime;

      return {
        service: 'database',
        healthy: isHealthy,
        responseTime,
        details: {
          connectionPool: {
            min: config.database.connectionPool.min,
            max: config.database.connectionPool.max,
            idleTimeout: config.database.connectionPool.idleTimeoutMillis,
            connectionTimeout: config.database.connectionPool.connectionTimeoutMillis
          }
        },
        lastChecked: new Date()
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'database',
        healthy: false,
        responseTime,
        details: {
          error: error instanceof Error ? error.message : 'Onbekende database fout',
          errorType: error instanceof Error ? error.constructor.name : 'UnknownError'
        },
        lastChecked: new Date()
      };
    }
  }

  async checkAIServices(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];
    const supportedModels = this.aiModelFactory.getSupportedModels();

    // Check Google AI Service
    const googleModels = supportedModels.filter(model => 
      this.aiModelFactory.getModelInfo(model)?.provider === 'google'
    );
    
    if (googleModels.length > 0) {
      const startTime = Date.now();
      
      try {
        const handler = this.aiModelFactory.getHandler('gemini-2.5-flash');
        if (handler) {
          // Simple test prompt
          await handler.generateContent('Test connectie', { maxOutputTokens: 10 });
          
          results.push({
            service: 'google-ai',
            healthy: true,
            responseTime: Date.now() - startTime,
            details: {
              supportedModels: googleModels,
              provider: 'google'
            },
            lastChecked: new Date()
          });
        } else {
          throw new Error('Google AI handler niet gevonden');
        }
      } catch (error) {
        results.push({
          service: 'google-ai',
          healthy: false,
          responseTime: Date.now() - startTime,
          details: {
            error: error instanceof Error ? error.message : 'Onbekende Google AI fout',
            supportedModels: googleModels,
            provider: 'google'
          },
          lastChecked: new Date()
        });
      }
    }

    // Check OpenAI Service
    const openaiModels = supportedModels.filter(model => 
      this.aiModelFactory.getModelInfo(model)?.provider === 'openai'
    );
    
    if (openaiModels.length > 0) {
      const startTime = Date.now();
      
      try {
        const handler = this.aiModelFactory.getHandler('gpt-4o-mini');
        if (handler) {
          // Simple test prompt
          await handler.generateContent('Test connectie', { maxOutputTokens: 10 });
          
          results.push({
            service: 'openai',
            healthy: true,
            responseTime: Date.now() - startTime,
            details: {
              supportedModels: openaiModels,
              provider: 'openai'
            },
            lastChecked: new Date()
          });
        } else {
          throw new Error('OpenAI handler niet gevonden');
        }
      } catch (error) {
        results.push({
          service: 'openai',
          healthy: false,
          responseTime: Date.now() - startTime,
          details: {
            error: error instanceof Error ? error.message : 'Onbekende OpenAI fout',
            supportedModels: openaiModels,
            provider: 'openai'
          },
          lastChecked: new Date()
        });
      }
    }

    return results;
  }

  async checkExternalSources(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const stats = this.sourceValidator.getValidationStats();
      const allowedDomains = this.sourceValidator.getAllowedDomains();
      
      // Test connection to main government sources
      const testUrls = [
        'https://www.belastingdienst.nl',
        'https://wetten.overheid.nl',
        'https://www.rijksoverheid.nl'
      ];

      const testResults = await Promise.allSettled(
        testUrls.map(async (url) => {
          const isValid = await this.sourceValidator.validateSource(url);
          const isAccessible = isValid ? await this.sourceValidator.verifySourceAvailability(url) : false;
          return { url, isValid, isAccessible };
        })
      );

      const successCount = testResults.filter(result => 
        result.status === 'fulfilled' && result.value.isAccessible
      ).length;

      const isHealthy = successCount >= testUrls.length / 2; // At least 50% should be accessible

      return {
        service: 'external-sources',
        healthy: isHealthy,
        responseTime: Date.now() - startTime,
        details: {
          allowedDomains,
          testedUrls: testUrls.length,
          accessibleUrls: successCount,
          successRate: `${Math.round((successCount / testUrls.length) * 100)}%`,
          validationStats: stats,
          testResults: testResults.map(result => 
            result.status === 'fulfilled' ? result.value : { error: 'Test gefaald' }
          )
        },
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        service: 'external-sources',
        healthy: false,
        responseTime: Date.now() - startTime,
        details: {
          error: error instanceof Error ? error.message : 'Onbekende externe bron fout'
        },
        lastChecked: new Date()
      };
    }
  }

  async getOverallHealth(): Promise<{
    healthy: boolean;
    services: HealthCheckResult[];
    timestamp: Date;
  }> {
    const timestamp = new Date();
    
    try {
      // Run all health checks in parallel
      const [databaseResult, aiResults, sourcesResult] = await Promise.all([
        this.checkDatabase(),
        this.checkAIServices(),
        this.checkExternalSources()
      ]);

      const allResults = [databaseResult, ...aiResults, sourcesResult];
      const healthyCount = allResults.filter(result => result.healthy).length;
      const overallHealthy = healthyCount >= allResults.length * 0.8; // 80% healthy threshold

      return {
        healthy: overallHealthy,
        services: allResults,
        timestamp
      };
    } catch (error) {
      console.error('Overall health check failed:', error);
      
      return {
        healthy: false,
        services: [{
          service: 'health-check-system',
          healthy: false,
          responseTime: 0,
          details: {
            error: error instanceof Error ? error.message : 'Health check system fout'
          },
          lastChecked: timestamp
        }],
        timestamp
      };
    }
  }

  /**
   * Get health summary for monitoring dashboards
   */
  async getHealthSummary(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    services: Record<string, boolean>;
    lastUpdate: Date;
  }> {
    const startTime = process.uptime();
    const healthData = await this.getOverallHealth();
    
    const serviceStatus: Record<string, boolean> = {};
    healthData.services.forEach(service => {
      serviceStatus[service.service] = service.healthy;
    });

    let status: 'healthy' | 'degraded' | 'unhealthy';
    const healthyServices = healthData.services.filter(s => s.healthy).length;
    const totalServices = healthData.services.length;
    const healthRatio = healthyServices / totalServices;

    if (healthRatio >= 0.9) {
      status = 'healthy';
    } else if (healthRatio >= 0.6) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      uptime: Math.floor(startTime),
      services: serviceStatus,
      lastUpdate: healthData.timestamp
    };
  }
}