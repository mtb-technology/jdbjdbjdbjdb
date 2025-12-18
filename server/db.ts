import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";
import { config } from './config';
import { ServerError } from './middleware/errorHandler';
import { ERROR_CODES } from '@shared/errors';
import { logger } from './services/logger';

neonConfig.webSocketConstructor = ws;

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