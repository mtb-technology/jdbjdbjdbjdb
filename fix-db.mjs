import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

async function fixDatabase() {
  try {
    await client.connect();
    console.log('Connected to database');

    // Clear the history array for this report
    const result = await client.query(`
      UPDATE reports
      SET concept_report_versions = '{"history": []}'::json
      WHERE id = '5e1de768-9fc3-4f19-b930-f968996cfaaf'
      RETURNING id, concept_report_versions
    `);

    console.log('Updated report:', result.rows[0]);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

fixDatabase();
