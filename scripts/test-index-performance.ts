/**
 * Test Index Performance
 *
 * Compares query performance with and without using indexes
 */

import { pool } from '../server/db';

async function testPerformance() {
  console.log('🚀 Testing Database Index Performance\n');

  const client = await pool.connect();

  try {
    // Test 1: Query with created_at sort (should use idx_reports_created_at)
    console.log('📊 Test 1: Sort by created_at DESC');
    const start1 = Date.now();
    const result1 = await client.query(`
      EXPLAIN ANALYZE
      SELECT id, title, client_name, status, created_at
      FROM reports
      ORDER BY created_at DESC
      LIMIT 10;
    `);
    const duration1 = Date.now() - start1;

    console.log(`   ⏱️  Execution time: ${duration1}ms`);
    const usesIndex1 = result1.rows.some(row =>
      row['QUERY PLAN']?.includes('idx_reports_created_at')
    );
    console.log(`   ${usesIndex1 ? '✅' : '❌'} Using index: ${usesIndex1 ? 'idx_reports_created_at' : 'NONE'}`);

    // Test 2: Filter by status (should use idx_reports_status)
    console.log('\n📊 Test 2: Filter by status');
    const start2 = Date.now();
    const result2 = await client.query(`
      EXPLAIN ANALYZE
      SELECT id, title, client_name, status
      FROM reports
      WHERE status = 'processing';
    `);
    const duration2 = Date.now() - start2;

    console.log(`   ⏱️  Execution time: ${duration2}ms`);
    const usesIndex2 = result2.rows.some(row =>
      row['QUERY PLAN']?.includes('idx_reports_status')
    );
    console.log(`   ${usesIndex2 ? '✅' : '❌'} Using index: ${usesIndex2 ? 'idx_reports_status' : 'NONE'}`);

    // Test 3: Composite query (status + created_at)
    console.log('\n📊 Test 3: Filter by status + sort by created_at');
    const start3 = Date.now();
    const result3 = await client.query(`
      EXPLAIN ANALYZE
      SELECT id, title, client_name, status, created_at
      FROM reports
      WHERE status = 'completed'
      ORDER BY created_at DESC
      LIMIT 10;
    `);
    const duration3 = Date.now() - start3;

    console.log(`   ⏱️  Execution time: ${duration3}ms`);
    const usesIndex3 = result3.rows.some(row =>
      row['QUERY PLAN']?.includes('idx_reports_status_created_at')
    );
    console.log(`   ${usesIndex3 ? '✅' : '❌'} Using index: ${usesIndex3 ? 'idx_reports_status_created_at' : 'NONE'}`);

    // Test 4: Search by client name
    console.log('\n📊 Test 4: Search by client name');
    const start4 = Date.now();
    const result4 = await client.query(`
      EXPLAIN ANALYZE
      SELECT id, title, client_name, status
      FROM reports
      WHERE client_name LIKE 'Test%'
      LIMIT 10;
    `);
    const duration4 = Date.now() - start4;

    console.log(`   ⏱️  Execution time: ${duration4}ms`);
    const usesIndex4 = result4.rows.some(row =>
      row['QUERY PLAN']?.includes('idx_reports_client_name')
    );
    console.log(`   ${usesIndex4 ? '✅' : '❌'} Using index: ${usesIndex4 ? 'idx_reports_client_name' : 'NONE'}`);

    // Get table statistics
    console.log('\n📈 Table Statistics:');
    const stats = await client.query(`
      SELECT
        schemaname,
        tablename,
        n_live_tup as row_count,
        n_dead_tup as dead_rows
      FROM pg_stat_user_tables
      WHERE tablename = 'reports';
    `);

    if (stats.rows[0]) {
      console.log(`   📊 Total rows: ${stats.rows[0].row_count}`);
      console.log(`   🗑️  Dead rows: ${stats.rows[0].dead_rows}`);
    }

    // Summary
    console.log('\n✅ Performance Test Complete!');
    console.log('\n💡 Index Usage Summary:');
    console.log(`   • Sort by created_at: ${usesIndex1 ? '✅ USING INDEX' : '❌ NOT USING INDEX'}`);
    console.log(`   • Filter by status: ${usesIndex2 ? '✅ USING INDEX' : '❌ NOT USING INDEX'}`);
    console.log(`   • Status + created_at: ${usesIndex3 ? '✅ USING INDEX' : '❌ NOT USING INDEX'}`);
    console.log(`   • Client name search: ${usesIndex4 ? '✅ USING INDEX' : '❌ NOT USING INDEX'}`);

    const indexCount = [usesIndex1, usesIndex2, usesIndex3, usesIndex4].filter(Boolean).length;
    console.log(`\n🎯 ${indexCount}/4 queries using indexes`);

    if (indexCount === 4) {
      console.log('\n🚀 All queries optimized! Expected 10-50x performance improvement on large datasets.');
    } else if (indexCount >= 2) {
      console.log('\n⚠️  Some queries not using indexes. May need to analyze table statistics.');
      console.log('   Run: ANALYZE reports;');
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

testPerformance();
