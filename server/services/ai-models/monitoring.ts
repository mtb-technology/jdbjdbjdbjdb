export interface AIMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalDuration: number;
  averageResponseTime: number;
  errorsByType: Record<string, number>;
  circuitBreakerStates: Record<string, string>;
  lastRequestTime?: number;
  lastErrorTime?: number;
}

export interface RequestMetrics {
  model: string;
  provider: string;
  duration: number;
  success: boolean;
  errorType?: string;
  promptLength: number;
  responseLength: number;
  tokensUsed?: number;
  timestamp: number;
  jobId?: string;
}

export class AIMonitoringService {
  private static instance: AIMonitoringService;
  private metrics: Map<string, AIMetrics> = new Map();
  private recentRequests: RequestMetrics[] = [];
  private readonly maxRecentRequests = 1000;

  static getInstance(): AIMonitoringService {
    if (!AIMonitoringService.instance) {
      AIMonitoringService.instance = new AIMonitoringService();
    }
    return AIMonitoringService.instance;
  }

  recordRequest(request: RequestMetrics): void {
    const modelKey = `${request.provider}-${request.model}`;
    const metrics = this.getOrCreateMetrics(modelKey);

    // Update counters
    metrics.totalRequests++;
    if (request.success) {
      metrics.successfulRequests++;
    } else {
      metrics.failedRequests++;
      if (request.errorType) {
        metrics.errorsByType[request.errorType] = (metrics.errorsByType[request.errorType] || 0) + 1;
      }
      metrics.lastErrorTime = request.timestamp;
    }

    // Update duration metrics
    metrics.totalDuration += request.duration;
    metrics.averageResponseTime = metrics.totalDuration / metrics.totalRequests;
    metrics.lastRequestTime = request.timestamp;

    // Store recent request
    this.recentRequests.push(request);
    if (this.recentRequests.length > this.maxRecentRequests) {
      this.recentRequests.shift();
    }

    // Log structured metrics
    this.logStructuredMetrics(request, metrics);
  }

  updateCircuitBreakerState(model: string, state: string): void {
    const modelKey = model;
    const metrics = this.getOrCreateMetrics(modelKey);
    metrics.circuitBreakerStates[model] = state;

    if (state !== 'closed') {
      console.warn(`🔧 Circuit breaker state changed`, {
        model,
        state,
        timestamp: new Date().toISOString(),
        type: 'circuit_breaker_state_change'
      });
    }
  }

  getMetrics(model?: string): AIMetrics | Record<string, AIMetrics> {
    if (model) {
      return this.metrics.get(model) || this.createEmptyMetrics();
    }
    return Object.fromEntries(this.metrics.entries());
  }

  getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: Record<string, any>;
    timestamp: string;
  } {
    const now = Date.now();
    const recentRequests = this.recentRequests.filter(r => now - r.timestamp < 300000); // Last 5 minutes
    
    if (recentRequests.length === 0) {
      return {
        status: 'healthy',
        details: { message: 'No recent requests to analyze' },
        timestamp: new Date().toISOString()
      };
    }

    const successRate = recentRequests.filter(r => r.success).length / recentRequests.length;
    const averageResponseTime = recentRequests.reduce((sum, r) => sum + r.duration, 0) / recentRequests.length;
    
    const circuitBreakerIssues = Object.values(this.getAllCircuitBreakerStates())
      .filter(state => state === 'open').length;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (successRate < 0.5 || circuitBreakerIssues > 2) {
      status = 'unhealthy';
    } else if (successRate < 0.8 || averageResponseTime > 30000 || circuitBreakerIssues > 0) {
      status = 'degraded';
    }

    return {
      status,
      details: {
        successRate: Math.round(successRate * 100) / 100,
        averageResponseTime: Math.round(averageResponseTime),
        recentRequestCount: recentRequests.length,
        circuitBreakerIssues,
        modelsWithIssues: this.getModelsWithIssues()
      },
      timestamp: new Date().toISOString()
    };
  }

  getPerformanceStats(): {
    requestVolume: { timeWindow: string; count: number }[];
    errorRates: { model: string; errorRate: number }[];
    responseTimePercentiles: { p50: number; p95: number; p99: number };
  } {
    const now = Date.now();
    const timeWindows = [
      { label: '1min', duration: 60000 },
      { label: '5min', duration: 300000 },
      { label: '15min', duration: 900000 },
      { label: '1hour', duration: 3600000 }
    ];

    const requestVolume = timeWindows.map(window => ({
      timeWindow: window.label,
      count: this.recentRequests.filter(r => now - r.timestamp < window.duration).length
    }));

    const errorRates: { model: string; errorRate: number }[] = [];
    for (const [model, metrics] of Array.from(this.metrics.entries())) {
      errorRates.push({
        model,
        errorRate: metrics.totalRequests > 0 ? metrics.failedRequests / metrics.totalRequests : 0
      });
    }

    const recentDurations = this.recentRequests
      .filter(r => now - r.timestamp < 300000)
      .map(r => r.duration)
      .sort((a, b) => a - b);

    const responseTimePercentiles = {
      p50: this.getPercentile(recentDurations, 0.5),
      p95: this.getPercentile(recentDurations, 0.95),
      p99: this.getPercentile(recentDurations, 0.99)
    };

    return {
      requestVolume,
      errorRates,
      responseTimePercentiles
    };
  }

  private getOrCreateMetrics(modelKey: string): AIMetrics {
    if (!this.metrics.has(modelKey)) {
      this.metrics.set(modelKey, this.createEmptyMetrics());
    }
    return this.metrics.get(modelKey)!;
  }

  private createEmptyMetrics(): AIMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalDuration: 0,
      averageResponseTime: 0,
      errorsByType: {},
      circuitBreakerStates: {}
    };
  }

  private getAllCircuitBreakerStates(): Record<string, string> {
    const states: Record<string, string> = {};
    for (const [model, metrics] of Array.from(this.metrics.entries())) {
      Object.assign(states, metrics.circuitBreakerStates);
    }
    return states;
  }

  private getModelsWithIssues(): string[] {
    const modelsWithIssues: string[] = [];
    for (const [model, metrics] of Array.from(this.metrics.entries())) {
      const errorRate = metrics.totalRequests > 0 ? metrics.failedRequests / metrics.totalRequests : 0;
      if (errorRate > 0.2 || Object.values(metrics.circuitBreakerStates).includes('open')) {
        modelsWithIssues.push(model);
      }
    }
    return modelsWithIssues;
  }

  private getPercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil(sortedArray.length * percentile) - 1;
    return sortedArray[Math.max(0, index)];
  }

  private logStructuredMetrics(request: RequestMetrics, metrics: AIMetrics): void {
    const logData = {
      type: 'ai_request_metrics',
      model: request.model,
      provider: request.provider,
      duration: request.duration,
      success: request.success,
      errorType: request.errorType,
      promptLength: request.promptLength,
      responseLength: request.responseLength,
      tokensUsed: request.tokensUsed,
      jobId: request.jobId,
      timestamp: new Date(request.timestamp).toISOString(),
      aggregated: {
        totalRequests: metrics.totalRequests,
        successRate: metrics.totalRequests > 0 ? metrics.successfulRequests / metrics.totalRequests : 0,
        averageResponseTime: Math.round(metrics.averageResponseTime)
      }
    };

    if (request.success) {
      console.log(`📊 AI Request Completed`, logData);
    } else {
      console.error(`❌ AI Request Failed`, logData);
    }

    // Log warning for degraded performance
    if (metrics.averageResponseTime > 15000) {
      console.warn(`⚠️ Slow response time detected`, {
        type: 'performance_warning',
        model: `${request.provider}-${request.model}`,
        averageResponseTime: Math.round(metrics.averageResponseTime),
        threshold: 15000,
        timestamp: new Date().toISOString()
      });
    }

    // Log error rate warnings
    const errorRate = metrics.failedRequests / metrics.totalRequests;
    if (metrics.totalRequests >= 10 && errorRate > 0.3) {
      console.error(`🚨 High error rate detected`, {
        type: 'error_rate_warning',
        model: `${request.provider}-${request.model}`,
        errorRate: Math.round(errorRate * 100) / 100,
        totalRequests: metrics.totalRequests,
        failedRequests: metrics.failedRequests,
        timestamp: new Date().toISOString()
      });
    }
  }
}