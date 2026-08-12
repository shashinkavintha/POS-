const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'grocery_pos.db');
console.log('Connecting to database at:', dbPath);

try {
  const db = new Database(dbPath);
  
  console.log('Dropping conflicting tables...');
  db.exec('DROP TABLE IF EXISTS customers;');
  db.exec('DROP TABLE IF EXISTS register_sessions;');
  
  console.log('Successfully cleared old tables! You can now run npm start.');
} catch (err) {
  console.error('Error:', err.message);
}
