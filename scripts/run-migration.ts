/**
 * Migration Runner
 *
 * Runs SQL migrations against the database
 * Usage: npx tsx scripts/run-migration.ts migrations/0001_add_performance_indexes.sql
 */

import { pool } from '../server/db';
import fs from 'fs';
import path from 'path';

async function runMigration(migrationFile: string) {
  const filePath = path.resolve(process.cwd(), migrationFile);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Migration file not found: ${filePath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(filePath, 'utf-8');

  console.log(`📄 Running migration: ${path.basename(migrationFile)}`);
  console.log(`📍 File: ${filePath}\n`);

  try {
    const client = await pool.connect();

    try {
      // Split by semicolon to get individual statements
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => {
          // Remove empty statements and comment-only statements
          if (!s) return false;
          // Remove pure comment lines
          const lines = s.split('\n').filter(line => {
            const trimmed = line.trim();
            return trimmed && !trimmed.startsWith('--');
          });
          return lines.length > 0;
        });

      console.log(`🔧 Executing ${statements.length} SQL statements...\n`);

      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        if (!statement) continue;

        // Extract index name from CREATE INDEX statement for logging
        const indexNameMatch = statement.match(/CREATE INDEX (?:IF NOT EXISTS )?(\w+)/i);
        const indexName = indexNameMatch ? indexNameMatch[1] : `statement ${i + 1}`;

        try {
          console.log(`  ⚙️  Creating index: ${indexName}`);
          await client.query(statement);
          console.log(`  ✅ Success: ${indexName}`);
        } catch (error: any) {
          // If index already exists, that's okay
          if (error.code === '42P07') {
            console.log(`  ⚠️  Already exists: ${indexName}`);
          } else {
            throw error;
          }
        }
      }

      console.log(`\n✅ Migration completed successfully!`);

      // Verify indexes were created
      console.log(`\n🔍 Verifying indexes...`);
      const result = await client.query(`
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        AND tablename IN ('reports', 'jobs', 'follow_up_sessions')
        ORDER BY tablename, indexname;
      `);

      console.log(`\n📊 Current indexes:`);
      result.rows.forEach(row => {
        console.log(`  • ${row.tablename}.${row.indexname}`);
      });

      console.log(`\n✅ Total indexes: ${result.rows.length}`);

    } finally {
      client.release();
    }

  } catch (error: any) {
    console.error(`\n❌ Migration failed:`, error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Get migration file from command line argument
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('Usage: npx tsx scripts/run-migration.ts <migration-file>');
  console.error('Example: npx tsx scripts/run-migration.ts migrations/0001_add_performance_indexes.sql');
  process.exit(1);
}

runMigration(migrationFile);
