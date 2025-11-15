// Cleanup script for report 5e1de768-9fc3-4f19-b930-f968996cfaaf
// Run this in browser console on http://localhost:3000

async function cleanupHistory() {
  const baseUrl = 'http://localhost:3000';
  const reportId = '5e1de768-9fc3-4f19-b930-f968996cfaaf';

  // Get CSRF token
  const csrfResponse = await fetch(`${baseUrl}/api/csrf-token`);
  const csrfData = await csrfResponse.json();
  const csrfToken = csrfData.data.token;

  console.log('Got CSRF token:', csrfToken);

  // Delete all versions by deleting the earliest stage
  // This will cascade delete everything
  const response = await fetch(`${baseUrl}/api/reports/${reportId}/stage/3_generatie`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken
    }
  });

  const result = await response.json();
  console.log('Delete result:', result);

  return result;
}

cleanupHistory().then(r => console.log('Done:', r)).catch(e => console.error('Error:', e));
