/**
 * Analyze Tables
 *
 * Updates table statistics so PostgreSQL can use indexes effectively
 */

import { pool } from '../server/db';

async function analyzeTables() {
  console.log('📊 Analyzing tables to update statistics...\n');

  const client = await pool.connect();

  try {
    const tables = ['reports', 'jobs', 'follow_up_sessions', 'follow_up_threads', 'prompt_configs'];

    for (const table of tables) {
      console.log(`  ⚙️  Analyzing ${table}...`);
      await client.query(`ANALYZE ${table};`);
      console.log(`  ✅ ${table} analyzed`);
    }

    console.log('\n✅ All tables analyzed!');
    console.log('\n💡 PostgreSQL can now use indexes effectively for queries.');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

analyzeTables();
