import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from "@shared/schema";
import { config } from './config';
import { ServerError } from './middleware/errorHandler';
import { ERROR_CODES } from '@shared/errors';
import { logger } from './services/logger';

// Node.js 22+ has native WebSocket support, no need for ws package workaround

// Validate database configuration
if (!config.database.url) {
  throw ServerError.internal(
    'Database configuratie is niet compleet. DATABASE_URL ontbreekt.',
    { missingConfig: 'DATABASE_URL' }
  );
}

// Create connection pool with configuration
export const pool = new Pool({
  connectionString: config.database.url,
  min: config.database.connectionPool.min,
  max: config.database.connectionPool.max,
  idleTimeoutMillis: config.database.connectionPool.idleTimeoutMillis,
  connectionTimeoutMillis: config.database.connectionPool.connectionTimeoutMillis
});

// Create Drizzle instance
export const db = drizzle({ client: pool, schema });

// Connection health check
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await db.execute(`SELECT 1`);
    return true;
  } catch (error) {
    logger.error('db', 'Database connection check failed', {}, error instanceof Error ? error : undefined);
    return false;
  }
}

// Keep connection pool warm to avoid cold starts
// Neon serverless can have 1-2s latency on first connection after idle
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

export function startConnectionKeepAlive(intervalMs = 30000): void {
  if (keepAliveInterval) return;

  keepAliveInterval = setInterval(async () => {
    try {
      await db.execute(`SELECT 1`);
    } catch {
      // Ignore errors - connection will be re-established on next real query
    }
  }, intervalMs);

  logger.info('db', `Connection keep-alive started (every ${intervalMs}ms)`);
}

export function stopConnectionKeepAlive(): void {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    logger.info('db', 'Connection keep-alive stopped');
  }
}