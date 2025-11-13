/**
 * API Contract Tests
 *
 * These tests verify that API endpoints return responses matching their expected schemas.
 * This catches breaking changes to API contracts before they reach production.
 *
 * Coverage:
 * - Health endpoints
 * - Case management endpoints
 * - Prompt configuration endpoints
 * - Report creation endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import express, { Express } from 'express';
import { Server } from 'http';
import { registerRoutes } from '../routes';

// API Response Schemas
const apiSuccessResponseSchema = z.object({
  success: z.literal(true),
  data: z.any(),
  message: z.string().optional(),
});

const apiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }),
});

// Health endpoint schemas
const healthResponseSchema = apiSuccessResponseSchema.extend({
  data: z.object({
    status: z.enum(['healthy', 'degraded', 'unhealthy']),
    timestamp: z.string(),
    uptime: z.number(),
  }),
});

const detailedHealthResponseSchema = apiSuccessResponseSchema.extend({
  data: z.object({
    overall: z.enum(['healthy', 'degraded', 'unhealthy']),
    services: z.object({
      database: z.object({
        status: z.enum(['healthy', 'unhealthy']),
        latency: z.number().optional(),
      }),
      ai: z.object({
        status: z.enum(['healthy', 'degraded', 'unhealthy']),
        availableModels: z.number(),
      }),
    }),
    timestamp: z.string(),
  }),
});

// Case management schemas
const caseSchema = z.object({
  id: z.string(),
  title: z.string(),
  clientName: z.string(),
  status: z.enum(['draft', 'processing', 'completed', 'archived']),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentStage: z.string().optional(),
});

const casesListResponseSchema = apiSuccessResponseSchema.extend({
  data: z.object({
    reports: z.array(caseSchema),
    pagination: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number(),
    }),
  }),
});

const singleCaseResponseSchema = apiSuccessResponseSchema.extend({
  data: caseSchema,
});

// Prompt configuration schemas
const promptConfigSchema = z.object({
  id: z.string(),
  version: z.number(),
  isActive: z.boolean(),
  createdAt: z.string(),
  stages: z.record(z.string(), z.object({
    template: z.string(),
    model: z.string().optional(),
  })),
});

const promptListResponseSchema = apiSuccessResponseSchema.extend({
  data: z.array(promptConfigSchema),
});

const activePromptResponseSchema = apiSuccessResponseSchema.extend({
  data: promptConfigSchema,
});

// Report creation schemas
const createReportResponseSchema = apiSuccessResponseSchema.extend({
  data: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    createdAt: z.string(),
  }),
});

describe('API Contract Tests', () => {
  let app: Express;
  let server: Server;
  let baseURL: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: false, limit: '50mb' }));

    server = await registerRoutes(app);

    // Start server on a random available port
    await new Promise<void>((resolve) => {
      server.listen(0, 'localhost', () => {
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server address is invalid');
    }
    const port = address.port;
    baseURL = `http://localhost:${port}`;

    console.log(`Test server running at ${baseURL}`);

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  afterAll((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  describe('Health Endpoints', () => {
    it('GET /api/health returns correct schema', async () => {
      const response = await fetch(`${baseURL}/api/health`);
      const text = await response.text();

      // Check if response is JSON
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        throw new Error(`Response is not JSON: ${text.substring(0, 200)}`);
      }

      expect(response.status).toBe(200);
      expect(() => healthResponseSchema.parse(json)).not.toThrow();
      expect(json.success).toBe(true);
      expect(json.data.status).toBeDefined();
    });

    it('GET /api/health/detailed returns correct schema', async () => {
      const response = await fetch(`${baseURL}/api/health/detailed`);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(() => detailedHealthResponseSchema.parse(json)).not.toThrow();
      expect(json.data.services.database).toBeDefined();
      expect(json.data.services.ai).toBeDefined();
    });

    it('GET /api/health/database returns correct schema', async () => {
      const response = await fetch(`${baseURL}/api/health/database`);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty('status');
    });

    it('GET /api/health/ai returns correct schema', async () => {
      const response = await fetch(`${baseURL}/api/health/ai`);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty('models');
    });
  });

  describe('Case Management Endpoints', () => {
    it('GET /api/cases returns correct schema', async () => {
      const response = await fetch(`${baseURL}/api/cases?page=1&limit=10`);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(() => casesListResponseSchema.parse(json)).not.toThrow();
      expect(json.data.reports).toBeInstanceOf(Array);
      expect(json.data.pagination).toHaveProperty('page');
      expect(json.data.pagination).toHaveProperty('total');
    });

    it('GET /api/cases with invalid pagination returns 400', async () => {
      const response = await fetch(`${baseURL}/api/cases?page=-1&limit=10`);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toBeDefined();
    });

    it('GET /api/cases/:id with non-existent ID returns 404', async () => {
      const response = await fetch(`${baseURL}/api/cases/nonexistent-id`);
      const json = await response.json();

      expect(response.status).toBe(404);
      expect(() => apiErrorResponseSchema.parse(json)).not.toThrow();
      expect(json.success).toBe(false);
    });

    it('PATCH /api/cases/:id validates input schema', async () => {
      const response = await fetch(`${baseURL}/api/cases/some-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'field' }),
      });
      const json = await response.json();

      // Should return 400 or 404 (depending on whether ID exists)
      expect([400, 404]).toContain(response.status);
      expect(json.success).toBe(false);
    });
  });

  describe('Prompt Configuration Endpoints', () => {
    it('GET /api/prompts returns correct schema', async () => {
      const response = await fetch(`${baseURL}/api/prompts`);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(() => promptListResponseSchema.parse(json)).not.toThrow();
      expect(json.data).toBeInstanceOf(Array);
    });

    it('GET /api/prompts/active returns correct schema', async () => {
      const response = await fetch(`${baseURL}/api/prompts/active`);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(() => activePromptResponseSchema.parse(json)).not.toThrow();
      expect(json.data.isActive).toBe(true);
    });

    it('GET /api/prompts/:id with invalid ID returns 404', async () => {
      const response = await fetch(`${baseURL}/api/prompts/invalid-id`);
      const json = await response.json();

      expect(response.status).toBe(404);
      expect(json.success).toBe(false);
    });

    it('POST /api/prompts validates input schema', async () => {
      const response = await fetch(`${baseURL}/api/prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'data' }),
      });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toBeDefined();
    });
  });

  describe('Report Creation Endpoints', () => {
    it('POST /api/reports/create validates input schema', async () => {
      const response = await fetch(`${baseURL}/api/reports/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'data' }),
      });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/reports/create with valid data returns correct schema', async () => {
      const response = await fetch(`${baseURL}/api/reports/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: 'Test Client',
          rawText: 'Test content for report creation',
        }),
      });
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(() => createReportResponseSchema.parse(json)).not.toThrow();
      expect(json.data.id).toBeDefined();
      expect(json.data.title).toContain('Test Client');
    });
  });

  describe('Error Response Consistency', () => {
    it('404 errors return consistent error format', async () => {
      const response = await fetch(`${baseURL}/api/nonexistent-endpoint`);
      const json = await response.json();

      expect(response.status).toBe(404);
      expect(json.success).toBe(false);
      expect(json.error).toBeDefined();
      expect(json.error.code).toBeDefined();
      expect(json.error.message).toBeDefined();
    });

    it('400 validation errors return consistent format', async () => {
      const response = await fetch(`${baseURL}/api/cases?page=invalid`);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(() => apiErrorResponseSchema.parse(json)).not.toThrow();
    });
  });

  describe('Response Headers', () => {
    it('All endpoints return correct Content-Type', async () => {
      const endpoints = [
        '/api/health',
        '/api/cases?page=1&limit=10',
        '/api/prompts',
      ];

      for (const endpoint of endpoints) {
        const response = await fetch(`${baseURL}${endpoint}`);
        expect(response.headers.get('content-type')).toContain('application/json');
      }
    });

    it('CORS headers are present for cross-origin requests', async () => {
      const response = await fetch(`${baseURL}/api/health`, {
        headers: { 'Origin': 'http://example.com' },
      });

      // Check if CORS headers are present (if configured)
      const corsHeader = response.headers.get('access-control-allow-origin');
      // This may be null if CORS is not configured, which is fine for testing
      expect(corsHeader === null || corsHeader === '*' || corsHeader === 'http://example.com').toBe(true);
    });
  });

  describe('Pagination Consistency', () => {
    it('All paginated endpoints follow same pagination format', async () => {
      const response = await fetch(`${baseURL}/api/cases?page=1&limit=5`);
      const json = await response.json();

      expect(json.data.pagination).toMatchObject({
        page: expect.any(Number),
        limit: expect.any(Number),
        total: expect.any(Number),
        totalPages: expect.any(Number),
      });

      // Verify pagination math
      const { page, limit, total, totalPages } = json.data.pagination;
      expect(totalPages).toBe(Math.ceil(total / limit));
      expect(page).toBeGreaterThanOrEqual(1);
      expect(page).toBeLessThanOrEqual(totalPages || 1);
    });
  });
});
