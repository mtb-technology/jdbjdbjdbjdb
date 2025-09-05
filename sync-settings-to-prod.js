#!/usr/bin/env node

/**
 * Script to sync settings from dev to production
 * Usage: node sync-settings-to-prod.js [PRODUCTION_URL]
 * 
 * This script will:
 * 1. Read the dev settings backup
 * 2. Send them to the production server's restore endpoint
 * 3. Create a backup of prod settings before making changes
 */

const fs = require('fs');
const path = require('path');

async function syncSettingsToProd(productionUrl) {
  try {
    console.log('🔄 Starting settings sync from dev to production...');
    
    // Read the dev settings backup
    const backupFile = 'dev-settings-backup.json';
    if (!fs.existsSync(backupFile)) {
      console.error('❌ Error: dev-settings-backup.json not found!');
      console.log('Please run the backup export first.');
      return;
    }
    
    const devSettings = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    console.log(`📊 Found ${devSettings.prompt_configs.length} configurations to sync`);
    
    // Prepare the restore request
    const restoreEndpoint = `${productionUrl}/api/prompts/restore`;
    
    console.log(`🚀 Sending settings to production: ${restoreEndpoint}`);
    
    const response = await fetch(restoreEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(devSettings)
    });
    
    if (!response.ok) {
      // Handle non-2xx HTTP responses
      let errorText = 'Unknown error';
      try {
        errorText = await response.text();
      } catch (parseError) {
        errorText = `Failed to read error response: ${parseError.message}`;
      }
      
      console.error('❌ Failed to sync settings to production:');
      console.error(`Status: ${response.status} ${response.statusText}`);
      console.error(`Error: ${errorText}`);
      return;
    }
    
    // Handle successful response
    try {
      const result = await response.json();
      console.log('✅ Settings successfully synced to production!');
      console.log(`📝 Details: ${JSON.stringify(result, null, 2)}`);
    } catch (jsonError) {
      console.log('✅ Settings successfully synced to production!');
      console.warn('⚠️ Warning: Could not parse response JSON, but sync appears successful');
      console.warn(`JSON Parse Error: ${jsonError.message}`);
    }
    
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error('❌ Network error: Could not connect to production server');
      console.error('Please check the production URL and your internet connection');
    } else if (error instanceof SyntaxError) {
      console.error('❌ JSON parsing error:', error.message);
      console.error('Please check the dev-settings-backup.json file format');
    } else {
      console.error('❌ Unexpected error during sync:', error.message);
    }
    console.error('Full error details:', error);
  }
}

// Get production URL from command line argument
const productionUrl = process.argv[2];

if (!productionUrl) {
  console.log('📋 Usage: node sync-settings-to-prod.js [PRODUCTION_URL]');
  console.log('📋 Example: node sync-settings-to-prod.js https://your-app.replit.app');
  console.log('');
  console.log('ℹ️  This script will sync all settings from dev-settings-backup.json to production');
  console.log('ℹ️  Production will automatically backup its current settings before restoring');
  process.exit(1);
}

// Run the sync
syncSettingsToProd(productionUrl);