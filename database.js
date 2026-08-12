const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const os = require('os');

// Path to store the SQLite DB
const dbPath = path.join(os.homedir(), 'grocery_pos.db');

class PosDatabase {
  constructor() {
    this.db = new Database(dbPath, { verbose: console.log });
    this.init();
  }

  init() {
    // Create tables based on Blueprint (Phase 11 & 12)
    try {
      const custInfo = this.db.prepare("PRAGMA table_info(customers)").all();
      const hasId = custInfo.some(col => col.name === 'id');
      if (custInfo.length > 0 && !hasId) {
        this.db.exec("DROP TABLE customers;");
      }
      
      const shiftInfo = this.db.prepare("PRAGMA table_info(register_sessions)").all();
      const hasOpenedAt = shiftInfo.some(col => col.name === 'opened_at');
      if (shiftInfo.length > 0 && !hasOpenedAt) {
        this.db.exec("DROP TABLE register_sessions;");
      }
    } catch (e) {
      console.error("Migration check failed:", e);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        product_id TEXT PRIMARY KEY,
        barcode TEXT UNIQUE,
        name_en TEXT NOT NULL,
        name_si TEXT,
        name_ta TEXT,
        price_cents INTEGER,
        tax_class TEXT,
        category_id TEXT,
        is_weighable BOOLEAN DEFAULT 0,
        reorder_point DECIMAL(12, 3) DEFAULT 0.000,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_batches (
        batch_id TEXT PRIMARY KEY,
        product_id TEXT REFERENCES products(product_id),
        cost_price_cents INTEGER NOT NULL,
        selling_price_cents INTEGER NOT NULL,
        received_quantity DECIMAL(12, 3) NOT NULL,
        current_quantity DECIMAL(12, 3) NOT NULL,
        expiry_date DATE,
        received_date DATE DEFAULT CURRENT_DATE,
        grn_id TEXT,
        CHECK (current_quantity >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_fifo_lookup ON inventory_batches (product_id, expiry_date, current_quantity);

      CREATE TABLE IF NOT EXISTS stock_adjustments (
        adjustment_id TEXT PRIMARY KEY,
        batch_id TEXT,
        reason_code TEXT,
        quantity_adjusted DECIMAL(12, 3),
        adjusted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );



      CREATE TABLE IF NOT EXISTS audit_logs (
        log_id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        record_id TEXT,
        device_id TEXT,
        mac_address TEXT,
        app_version TEXT,
        user_id TEXT,
        metadata TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT,
        total_amount_cents INTEGER,
        payment_mode TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS order_items (
        order_id TEXT,
        product_id TEXT,
        batch_id TEXT,
        quantity DECIMAL(12, 3),
        price_cents INTEGER,
        PRIMARY KEY(order_id, product_id, batch_id)
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        operation_type TEXT CHECK(operation_type IN ('INSERT', 'UPDATE', 'DELETE')),
        is_processed INTEGER DEFAULT 0,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS qr_transactions (
          transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_id TEXT UNIQUE NOT NULL,
          merchant_id TEXT NOT NULL,
          terminal_id TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          transaction_type TEXT DEFAULT 'DYNAMIC',
          payload TEXT NOT NULL,
          status TEXT CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'TIMEOUT')),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS suspended_bills (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cart_json TEXT NOT NULL,
          total_amount_cents INTEGER NOT NULL,
          cashier_id TEXT NOT NULL,
          suspended_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        pin_hash TEXT NOT NULL,
        role TEXT CHECK(role IN ('CASHIER', 'ADMIN')),
        salt TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS tx_verification (
        tx_id TEXT PRIMARY KEY,
        amount_cents INTEGER,
        status TEXT DEFAULT 'PENDING'
      );

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mobile TEXT,
        credit_limit INTEGER DEFAULT 0,
        outstanding_cents INTEGER DEFAULT 0,
        last_settled_at TEXT
      );

      CREATE TABLE IF NOT EXISTS register_sessions (
        session_id TEXT PRIMARY KEY,
        cashier_id TEXT NOT NULL,
        opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
        closed_at TEXT,
        opening_balance_cents INTEGER,
        expected_cash_cents INTEGER,
        actual_cash_cents INTEGER,
        variance_cents INTEGER,
        is_closed INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT OR IGNORE INTO settings (key, value) VALUES 
        ('shop_name', 'SUPER GROCERY'),
        ('shop_address', 'Main Street, Polonnaruwa'),
        ('shop_phone', '077 123 4567');
    `);
    
    // Phase 8: Mock SQLCipher & Keytar logic
    // Retrieves hardware-bound key from DPAPI (Mocked)
    const mockDbKey = "hardware-bound-secret-key-12345"; 
    // CRITICAL: Apply PRAGMA key before any other operations (Mocked)
    this.db.exec(`PRAGMA key = '${mockDbKey}';`);
    this.db.exec(`PRAGMA cipher_compatibility = 4;`);
    
    // Continue with trigger creation
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS generate_order_uuid
      BEFORE INSERT ON orders
      FOR EACH ROW
      WHEN NEW.id IS NULL
      BEGIN
        UPDATE orders SET id = (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))
        WHERE rowid = NEW.rowid;
      END;
    `);

    // Migration: Add created_at to orders if missing
    try {
      this.db.prepare("ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP").run();
    } catch (err) {
      // Ignore if column already exists
    }

    // Migration: Add opening_balance_cents and is_closed to register_sessions if missing
    try {
      this.db.prepare("ALTER TABLE register_sessions ADD COLUMN opening_balance_cents INTEGER").run();
    } catch (err) {}
    try {
      this.db.prepare("ALTER TABLE register_sessions ADD COLUMN is_closed INTEGER DEFAULT 0").run();
    } catch (err) {}
  }

  async execute(query, params = []) {
    // better-sqlite3 is synchronous, but we keep the API async for IPC
    const stmt = this.db.prepare(query);
    if (query.trim().toUpperCase().startsWith('SELECT')) {
      return stmt.all(...params);
    } else {
      return stmt.run(...params);
    }
  }
  
  async executeTransaction(queries) {
    const transaction = this.db.transaction((qs) => {
      for (const q of qs) {
        this.db.prepare(q.sql).run(...(q.params || []));
      }
    });
    transaction(queries);
    return true;
  }

  generateUUID() {
    return uuidv4();
  }
}

module.exports = new PosDatabase();
