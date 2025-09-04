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
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Settings successfully synced to production!');
      console.log(`📝 Details: ${JSON.stringify(result, null, 2)}`);
    } else {
      const errorText = await response.text();
      console.error('❌ Failed to sync settings to production:');
      console.error(`Status: ${response.status} ${response.statusText}`);
      console.error(`Error: ${errorText}`);
    }
    
  } catch (error) {
    console.error('❌ Error during sync:', error.message);
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