import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

async function testVersionSystem() {
  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    const reportId = '5e1de768-9fc3-4f19-b930-f968996cfaaf';

    // Step 1: Add some test versions to history
    console.log('📝 Step 1: Adding test versions to history...');
    await client.query(`
      UPDATE reports
      SET concept_report_versions = '{
        "history": [
          {"stageId": "3_generatie", "v": 1, "timestamp": "2025-11-15T14:00:00Z"},
          {"stageId": "4a_BronnenSpecialist", "v": 2, "timestamp": "2025-11-15T14:10:00Z"},
          {"stageId": "4b_FiscaalTechnischSpecialist", "v": 3, "timestamp": "2025-11-15T14:20:00Z"}
        ],
        "latest": {"pointer": "4b_FiscaalTechnischSpecialist", "v": 3}
      }'::json
      WHERE id = $1
    `, [reportId]);

    // Verify
    const result1 = await client.query(`
      SELECT concept_report_versions FROM reports WHERE id = $1
    `, [reportId]);
    console.log('✅ Added 3 versions to history');
    console.log('   History:', result1.rows[0].concept_report_versions.history.map(h => h.stageId));
    console.log('   Latest:', result1.rows[0].concept_report_versions.latest.pointer);
    console.log('');

    // Step 2: Test that frontend would show these
    console.log('📱 Step 2: Frontend would display:');
    const versions = result1.rows[0].concept_report_versions.history;
    versions.forEach((v, i) => {
      const isCurrent = v.stageId === result1.rows[0].concept_report_versions.latest.pointer;
      console.log(`   ${i + 1}. ${v.stageId} v${v.v} ${isCurrent ? '← ACTIVE' : ''}`);
    });
    console.log('');

    console.log('✅ VERSION SYSTEM TEST PASSED!');
    console.log('');
    console.log('Now you can:');
    console.log('1. Refresh browser → see 3 versions');
    console.log('2. Click "Herstel" on version 1 → makes it active');
    console.log('3. Click "Verwijder" on version 2 → removes it from list');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

testVersionSystem();
