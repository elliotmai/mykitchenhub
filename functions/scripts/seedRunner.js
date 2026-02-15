#!/usr/bin/env node

/**
 * Seed Data CLI Tool
 * 
 * Usage:
 *   npm run seed -- --user <userId> --action <action>
 * 
 * Actions:
 *   all        - Seed both inventory and recipes
 *   inventory  - Seed inventory items only
 *   recipes    - Seed recipes only
 *   clear      - Clear all test data
 *   clear-inv  - Clear inventory only
 *   clear-rec  - Clear recipes only
 * 
 * Examples:
 *   npm run seed -- --user abc123 --action all
 *   npm run seed -- --user abc123 --action inventory --count 30
 *   npm run seed -- --user abc123 --action clear
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require('../service-account.json'); // You'll need to download this from Firebase Console

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Import seed utilities
const { 
  seedInventory, 
  seedRecipes, 
  seedAll, 
  clearInventory,
  clearRecipes,
  clearAll 
} = require('../src/utils/seedData');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    const value = args[i + 1];
    params[key] = value;
  }
  
  return params;
}

// Main function
async function main() {
  const params = parseArgs();
  
  if (!params.user) {
    console.error('❌ Error: --user parameter is required');
    console.log('\nUsage: npm run seed -- --user <userId> --action <action>');
    console.log('\nAvailable actions:');
    console.log('  all        - Seed both inventory and recipes');
    console.log('  inventory  - Seed inventory items only');
    console.log('  recipes    - Seed recipes only');
    console.log('  clear      - Clear all test data');
    console.log('  clear-inv  - Clear inventory only');
    console.log('  clear-rec  - Clear recipes only');
    process.exit(1);
  }
  
  const userId = params.user;
  const action = params.action || 'all';
  const count = parseInt(params.count || '20');
  
  console.log(`\n🚀 MyKitchenHub Seed Tool`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`User ID: ${userId}`);
  console.log(`Action:  ${action}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  
  try {
    let result;
    
    switch (action) {
      case 'all':
        result = await seedAll(userId);
        console.log(`\n✅ Success! Seeded:`);
        console.log(`   📦 ${result.inventoryItems} inventory items`);
        console.log(`   📖 ${result.recipes} recipes`);
        break;
        
      case 'inventory':
        result = await seedInventory(userId, count);
        console.log(`\n✅ Success! Seeded ${result} inventory items`);
        break;
        
      case 'recipes':
        result = await seedRecipes(userId);
        console.log(`\n✅ Success! Seeded ${result} recipes`);
        break;
        
      case 'clear':
        result = await clearAll(userId);
        console.log(`\n✅ Success! Cleared:`);
        console.log(`   📦 ${result.inventoryCleared} inventory items`);
        console.log(`   📖 ${result.recipesCleared} recipes`);
        break;
        
      case 'clear-inv':
        result = await clearInventory(userId);
        console.log(`\n✅ Success! Cleared ${result} inventory items`);
        break;
        
      case 'clear-rec':
        result = await clearRecipes(userId);
        console.log(`\n✅ Success! Cleared ${result} recipes`);
        break;
        
      default:
        console.error(`❌ Unknown action: ${action}`);
        process.exit(1);
    }
    
    console.log(''); // Empty line
    process.exit(0);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main };
