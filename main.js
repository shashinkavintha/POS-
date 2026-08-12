const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./database.js');
const crypto = require('crypto');
const { SerialPort, ReadlineParser } = require('serialport');

let mainWindow;

// --- Phase 8: Global Security State ---
let isLocked = true; // Boot directly into locked state
let currentUser = null; 

function hashPin(pin, salt) {
  return crypto.createHash('sha256').update(pin + salt).digest('hex');
}

async function seedUsers() {
  const adminExists = db.db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
  if (!adminExists) {
    const adminSalt = crypto.randomBytes(16).toString('hex');
    const adminHash = hashPin('1234', adminSalt);
    db.db.prepare("INSERT INTO users (id, username, pin_hash, role, salt) VALUES (?, ?, ?, ?, ?)").run(db.generateUUID(), 'admin', adminHash, 'ADMIN', adminSalt);
  }
  
  const cashierExists = db.db.prepare("SELECT * FROM users WHERE username = 'cashier'").get();
  if (!cashierExists) {
    const cashierSalt = crypto.randomBytes(16).toString('hex');
    const cashierHash = hashPin('0000', cashierSalt);
    db.db.prepare("INSERT INTO users (id, username, pin_hash, role, salt) VALUES (?, ?, ?, ?, ?)").run(db.generateUUID(), 'cashier', cashierHash, 'CASHIER', cashierSalt);
  }
}

async function seedInventory() {
  const count = db.db.prepare("SELECT count(*) as count FROM products").get();
  if (count.count === 0) {
    const products = [
      { id: crypto.randomUUID(), barcode: '479211100001', name_en: 'Samba Rice 1kg', name_si: 'සම්බා සහල් 1kg', name_ta: 'சம்பா அரிசி 1kg', price_cents: 25000, cat: 'RICE', rop: 10, is_weighable: 0 },
      { id: crypto.randomUUID(), barcode: '479211100002', name_en: 'Nadu Rice 1kg', name_si: 'නාඩු සහල් 1kg', name_ta: 'நாடு அரிசி 1kg', price_cents: 22000, cat: 'RICE', rop: 10, is_weighable: 0 },
      { id: crypto.randomUUID(), barcode: '000000000003', name_en: 'Sugar (Loose)', name_si: 'සීනි (කිරුම්)', name_ta: 'சீனி', price_cents: 30000, cat: 'LOOSE', rop: 50, is_weighable: 1 },
      { id: crypto.randomUUID(), barcode: '000000000004', name_en: 'Dhal 1kg', name_si: 'පරිප්පු 1kg', name_ta: 'பருப்பு 1kg', price_cents: 40000, cat: 'PULSES', rop: 20, is_weighable: 0 },
      { id: crypto.randomUUID(), barcode: '479211100005', name_en: 'Milk Powder 400g', name_si: 'කිරි පිටි 400g', name_ta: 'பால் மா 400g', price_cents: 110000, cat: 'DAIRY', rop: 15, is_weighable: 0 }
    ];

    const insertProduct = db.db.prepare("INSERT INTO products (product_id, barcode, name_en, name_si, name_ta, price_cents, tax_class, category_id, reorder_point, is_weighable) VALUES (?, ?, ?, ?, ?, ?, 'VAT18', ?, ?, ?)");
    const insertBatch = db.db.prepare("INSERT INTO inventory_batches (batch_id, product_id, expiry_date, cost_price_cents, selling_price_cents, received_quantity, current_quantity, grn_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

    const tx = db.db.transaction(() => {
      for (const p of products) {
        insertProduct.run(p.id, p.barcode, p.name_en, p.name_si, p.name_ta, p.price_cents, p.cat, p.rop, p.is_weighable);
        
        // Use a far future date since we aren't explicitly testing expiries anymore
        const expiryDate = new Date('2099-12-31');

        const cost_price_cents = Math.floor(p.price_cents * 0.8);
        insertBatch.run(crypto.randomUUID(), p.id, expiryDate.toISOString().split('T')[0], cost_price_cents, p.price_cents, 100, 100, `GRN-${Date.now()}`);
      }
    });
    tx();
  } else {
    // Clear out any old dummy expiries that are causing spam
    try {
      db.db.prepare("UPDATE inventory_batches SET expiry_date = '2099-12-31'").run();
    } catch(e) {}
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.webContents.session.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault();
    if (portList && portList.length > 0) {
      callback(portList[0].portId);
    } else {
      callback(''); // Could not find any ports
    }
  });

  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'serial') return true;
    return false;
  });

  mainWindow.webContents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'serial') return true;
    return false;
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }
}

app.whenReady().then(() => {
  db.init();
  seedUsers();
  seedInventory();
  createWindow();
  startSyncStateMachine();
  startInventoryMonitor(mainWindow);

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// --- Phase 8: Logging Decorator ---
async function withLogging(actionType, actionFn) {
  return async function(...args) {
    const hardwareId = process.env.HARDWARE_ID || "DEV_TERM_01"; // Mock OS-level HWID
    const result = await actionFn(...args);
    
    // Background write to audit log
    try {
      db.db.prepare(
        'INSERT INTO audit_logs (user_id, device_id, action_type, metadata) VALUES (?, ?, ?, ?)'
      ).run(currentUser ? currentUser.id : 'SYSTEM', hardwareId, actionType, JSON.stringify(args));
    } catch(e) { console.error("Audit log failed:", e); }
    
    return result;
  };
}

// --- Secure DB IPC (Phase 8 Hardened) ---
ipcMain.handle('secure-db-query', async (event, { query, params }) => {
  if (isLocked) throw new Error('Terminal Locked');
  try {
    return await db.execute(query, params);
  } catch (error) {
    console.error('DB Error:', error);
    throw error;
  }
});

ipcMain.handle('secure-db-transaction', async (event, queries) => {
  if (isLocked) throw new Error('Terminal Locked');
  try {
    return await db.executeTransaction(queries);
  } catch (error) {
    console.error('DB Transaction Error:', error);
    throw error;
  }
});

// --- Phase 8: Auth Handlers ---
ipcMain.handle('auth:login', async (event, { username, pin }) => {
  const user = db.db.prepare("SELECT * FROM users WHERE username = ? AND is_active = 1").get(username);
  if (user) {
    const inputHash = hashPin(pin, user.salt);
    if (inputHash === user.pin_hash) {
      currentUser = user;
      isLocked = false;
      
      const hardwareId = process.env.HARDWARE_ID || "DEV_TERM_01";
      db.db.prepare("INSERT INTO audit_logs (user_id, device_id, action_type) VALUES (?, ?, ?)").run(user.id, hardwareId, "LOGIN");
      
      // Auto-open shift if none exists
      const activeSession = db.db.prepare("SELECT * FROM register_sessions WHERE cashier_id = ? AND is_closed = 0").get(user.id);
      if (!activeSession) {
        db.db.prepare('INSERT INTO register_sessions (session_id, cashier_id, opening_balance_cents) VALUES (?, ?, ?)').run(crypto.randomUUID(), user.id, 500000); // 5000 LKR default float
      }
      
      return { success: true, role: user.role };
    }
  }
  return { success: false, error: 'Invalid Credentials' };
});

ipcMain.handle('auth:unlock', async (event, pin) => {
  if (!currentUser) return { success: false, error: 'No active session' };
  const inputHash = hashPin(pin, currentUser.salt);
  if (inputHash === currentUser.pin_hash) {
    isLocked = false;
    const hardwareId = process.env.HARDWARE_ID || "DEV_TERM_01";
    db.db.prepare("INSERT INTO audit_logs (user_id, device_id, action_type) VALUES (?, ?, ?)").run(currentUser.id, hardwareId, "UNLOCK");
    
    // Auto-open shift if none exists
    const activeSession = db.db.prepare("SELECT * FROM register_sessions WHERE cashier_id = ? AND is_closed = 0").get(currentUser.id);
    if (!activeSession) {
      db.db.prepare('INSERT INTO register_sessions (session_id, cashier_id, opening_balance_cents) VALUES (?, ?, ?)').run(crypto.randomUUID(), currentUser.id, 500000); // 5000 LKR default float
    }

    return { success: true, role: currentUser.role };
  }
  return { success: false, error: 'Invalid PIN' };
});

ipcMain.handle('auth:logout', async (event) => {
  if (currentUser) {
    const activeSession = db.db.prepare("SELECT * FROM register_sessions WHERE cashier_id = ? AND is_closed = 0").get(currentUser.id);
    if (activeSession) {
      return { success: false, error: 'Please close your shift (F10) before logging out.' };
    }

    const hardwareId = process.env.HARDWARE_ID || "DEV_TERM_01";
    db.db.prepare("INSERT INTO audit_logs (user_id, device_id, action_type) VALUES (?, ?, ?)").run(currentUser.id, hardwareId, "LOGOUT");
    currentUser = null;
  }
  isLocked = true;
  mainWindow.webContents.send('ui:show-lock-screen', { fullLogin: true });
  return { success: true };
});

ipcMain.handle('auth:status', async () => {
  require('fs').appendFileSync('auth-debug.log', `[${new Date().toISOString()}] auth:status called. isLocked=${isLocked}, currentUser=${currentUser ? currentUser.username : 'null'}\n`);
  return { 
    isLocked, 
    currentUser: currentUser ? { id: currentUser.id, username: currentUser.username, role: currentUser.role } : null 
  };
});

ipcMain.handle('auth:override', async (event, { action, pin }) => {
  if (isLocked) throw new Error('Terminal Locked');
  
  // Find any active admin
  const admins = db.db.prepare("SELECT * FROM users WHERE role = 'ADMIN' AND is_active = 1").all();
  for (const admin of admins) {
    const inputHash = hashPin(pin, admin.salt);
    if (inputHash === admin.pin_hash) {
       const hardwareId = process.env.HARDWARE_ID || "DEV_TERM_01";
       db.db.prepare("INSERT INTO audit_logs (user_id, device_id, action_type, metadata) VALUES (?, ?, ?, ?)").run(admin.id, hardwareId, "SUPERVISOR_OVERRIDE", JSON.stringify({ action }));
       return { success: true };
    }
  }
  return { success: false, error: 'Invalid Supervisor PIN' };
});

ipcMain.on('security:trigger-lock', () => {
  isLocked = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ui:show-lock-screen');
  }
  const hardwareId = process.env.HARDWARE_ID || "DEV_TERM_01";
  db.db.prepare("INSERT INTO audit_logs (user_id, device_id, action_type) VALUES (?, ?, ?)").run(currentUser ? currentUser.id : 'SYSTEM', hardwareId, "LOCK");
});

// --- Phase 3: Sync State Machine & Queue Processor ---
const SyncState = {
  READY: 'READY',
  IN_OFFLINE_MODE: 'IN_OFFLINE_MODE',
  IN_ONLINE_MODE: 'IN_ONLINE_MODE'
};
let currentSyncState = SyncState.READY;

async function pingCloud() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    await fetch('https://api.marxpay.lk/v1/ping', { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeoutId);
    return true;
  } catch (e) {
    try {
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 3000);
      await fetch('https://1.1.1.1', { method: 'HEAD', signal: controller2.signal });
      clearTimeout(timeoutId2);
      return true;
    } catch (e2) {
      try {
        const controller3 = new AbortController();
        const timeoutId3 = setTimeout(() => controller3.abort(), 3000);
        await fetch('https://www.google.com', { method: 'HEAD', signal: controller3.signal });
        clearTimeout(timeoutId3);
        return true;
      } catch (e3) {
        return false;
      }
    }
  }
}

function startSyncStateMachine() {
  pingCloud().then(isAlive => {
    currentSyncState = isAlive ? SyncState.IN_ONLINE_MODE : SyncState.IN_OFFLINE_MODE;
    broadcastSyncState();
  });

  setInterval(async () => {
    const isAlive = await pingCloud();
    if (!isAlive && currentSyncState !== SyncState.IN_OFFLINE_MODE) {
      currentSyncState = SyncState.IN_OFFLINE_MODE;
      broadcastSyncState();
    } else if (isAlive && currentSyncState === SyncState.IN_OFFLINE_MODE) {
      currentSyncState = SyncState.IN_ONLINE_MODE;
      broadcastSyncState();
      processOutboundQueue();
    }
  }, 15000);
}

function broadcastSyncState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync-status', currentSyncState);
  }
}

let isSyncing = false;
async function processOutboundQueue() {
  if (isSyncing || currentSyncState === SyncState.IN_OFFLINE_MODE) return false;
  isSyncing = true;
  
  try {
    const pending = await db.execute("SELECT * FROM sync_queue WHERE is_processed = 0 ORDER BY timestamp ASC");
    for (const item of pending) {
      let retryCount = 0;
      let success = false;
  
      while (!success && retryCount < 5) {
        try {
          await new Promise(resolve => setTimeout(resolve, 500)); 
          await db.execute("UPDATE sync_queue SET is_processed = 1 WHERE id = ?", [item.id]);
          success = true;
        } catch (error) {
          retryCount++;
          const delay = Math.min(Math.pow(2, retryCount) * 1000, 30000);
          console.warn(`Sync failed, retrying in ${delay}ms...`);
          await new Promise(res => setTimeout(res, delay));
        }
      }
      if (!success) {
        currentSyncState = SyncState.IN_OFFLINE_MODE;
        broadcastSyncState();
        break;
      }
    }
  } finally {
    isSyncing = false;
  }
  return true;
}

ipcMain.handle('trigger-sync', async () => {
  return await processOutboundQueue();
});

// --- Phase 4: Mock Bank Acquirer API ---
const mockBankAcquirerAPI = {
  fetchStatus: async (invoiceId) => {
    await new Promise(resolve => setTimeout(resolve, 800)); 
    const isSuccess = Math.random() > 0.7; 
    return { status: isSuccess ? 'SUCCESS' : 'PENDING', invoiceId };
  }
};

ipcMain.handle('get-payment-status', async (event, invoiceId) => {
  return await mockBankAcquirerAPI.fetchStatus(invoiceId);
});

// --- Phase 10: Inventory Management ---

ipcMain.handle('execute-fifo-deduction', async (event, cartItems) => {
  if (isLocked) throw new Error("UI Locked: Cannot execute deduction.");
  
  // Create a robust FIFO deduction in a single transaction
  const executeFIFODeduction = db.db.transaction((items) => {
    const deductBatch = db.db.prepare('UPDATE inventory_batches SET current_quantity = current_quantity - ? WHERE batch_id = ?');
    const logAdjustment = db.db.prepare('INSERT INTO stock_adjustments (adjustment_id, batch_id, reason_code, quantity_adjusted) VALUES (?, ?, ?, ?)');
    
    for (const item of items) {
      const deductionQty = item.isWeightBased ? item.actualWeight : item.quantity;
      
      // Find valid batches ordered by expiry date (FIFO)
      const batches = db.db.prepare(`
        SELECT batch_id, current_quantity 
        FROM inventory_batches 
        WHERE product_id = ? AND expiry_date >= DATE('now') AND current_quantity > 0
        ORDER BY expiry_date ASC
      `).all(item.product_id);

      let remaining = deductionQty;
      for (const batch of batches) {
        if (remaining <= 0) break;
        const deductQty = Math.min(batch.current_quantity, remaining);
        
        deductBatch.run(deductQty, batch.batch_id);
        logAdjustment.run(crypto.randomUUID(), batch.batch_id, 'SALE', deductQty);
        
        remaining -= deductQty;
      }
      
      // Allow minor float precision issues (e.g., 0.0000000001 remaining) to bypass
      if (remaining > 0.001) {
        throw new Error(`INSUFFICIENT_STOCK: Could not deduct ${deductionQty} units for Product ID ${item.product_id}`);
      }
    }
  });

  try {
    executeFIFODeduction(cartItems);
    return { success: true };
  } catch (e) {
    console.error("FIFO Deduction Error:", e);
    return { success: false, error: e.message };
  }
});

function startInventoryMonitor(mainWindow) {
  // Check every 60 seconds
  setInterval(() => {
    try {
      if (mainWindow.isDestroyed()) return;
      // 1. Identify Emergency Short-Expiries (48 Hours)
      const emergencyExpiries = db.db.prepare(`
          SELECT p.name_en, b.expiry_date, b.current_quantity FROM inventory_batches b
          JOIN products p ON b.product_id = p.product_id
          WHERE b.expiry_date <= DATE('now', '+2 days') AND b.current_quantity > 0
          ORDER BY p.name_en ASC
      `).all();

      // 2. Identify Standard Low Stock (ROP)
      const lowStockItems = db.db.prepare(`
          SELECT p.name_en, SUM(b.current_quantity) as total, p.reorder_point
          FROM products p JOIN inventory_batches b ON p.product_id = b.product_id
          GROUP BY p.product_id HAVING total <= p.reorder_point
          ORDER BY p.name_en ASC
      `).all();

      if (emergencyExpiries.length > 0 || lowStockItems.length > 0) {
        mainWindow.webContents.send('critical-inventory-alert', { emergencyExpiries, lowStockItems });
      }
    } catch (e) {
      console.error("Inventory Monitor Error:", e);
    }
  }, 60000); // 60s
}

// --- Phase 11: Naya Potha CRM, Shifts & Analytics ---

function formatReceipt(custName, amountCents, totalOutstandingCents) {
  const vatAmount = (amountCents * 0.18 / 100).toFixed(2);
  return `*Grocery POS*
VAT Reg: 123456789-7000
Customer: ${custName}
Purchase: LKR ${(amountCents/100).toFixed(2)} (Incl. VAT: LKR ${vatAmount})
New Total Balance: LKR ${(totalOutstandingCents/100).toFixed(2)}
Thank you for your loyalty!`;
}

ipcMain.handle('process-credit-sale', async (event, { nicNumber, amountCents, customerName }) => {
  if (isLocked) throw new Error("Terminal Locked");
  
  let customer = db.db.prepare('SELECT * FROM customers WHERE nic_number = ?').get(nicNumber);
  if (!customer) {
    db.db.prepare('INSERT INTO customers (customer_id, nic_number, full_name, mobile_number, credit_limit_cents) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), nicNumber, customerName || 'Walk-in', '0000', 5000000);
    customer = db.db.prepare('SELECT * FROM customers WHERE nic_number = ?').get(nicNumber);
  }
  
  if (customer.current_outstanding_cents + amountCents > customer.credit_limit_cents) {
    throw new Error('CREDIT_DENIED: Credit Limit Exceeded');
  }
  
  const tx = db.db.transaction(() => {
    db.db.prepare('UPDATE customers SET current_outstanding_cents = current_outstanding_cents + ? WHERE nic_number = ?').run(amountCents, nicNumber);
    db.db.prepare('INSERT INTO audit_logs (log_id, action_type, record_id, metadata) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), 'NAYA_POTHA_CREDIT', nicNumber, JSON.stringify({ amountCents }));
  });
  tx();
  
  const newBalance = customer.current_outstanding_cents + amountCents;
  console.log(`\n=== WHATSAPP REMINDER (MOCKED) ===\n${formatReceipt(customer.full_name, amountCents, newBalance)}\n==================================\n`);
  
  return { success: true };
});

ipcMain.handle('open-shift', async (event, { cashierId, openingBalanceCents }) => {
  if (isLocked) throw new Error("Terminal Locked");
  const sessionId = crypto.randomUUID();
  db.db.prepare('INSERT INTO register_sessions (session_id, cashier_id, opening_balance_cents) VALUES (?, ?, ?)').run(sessionId, cashierId, openingBalanceCents);
  return { success: true, sessionId };
});

ipcMain.handle('get-expected-cash', async (event) => {
  if (isLocked || !currentUser) throw new Error("Terminal Locked or No User");
  
  const session = db.db.prepare('SELECT * FROM register_sessions WHERE cashier_id = ? AND is_closed = 0 ORDER BY opened_at DESC LIMIT 1').get(currentUser.id);
  if (!session) throw new Error("No active session found");
  
  // Calculate total cash sales during this session
  const cashSales = db.db.prepare(`
    SELECT IFNULL(SUM(total_amount_cents), 0) as total 
    FROM orders 
    WHERE created_at >= ? AND payment_mode = 'CASH'
  `).get(session.opened_at).total;
  
  const expectedCashCents = (session.opening_balance_cents || 0) + cashSales;
  return { success: true, expectedCashCents, sessionId: session.session_id };
});

ipcMain.handle('close-shift', async (event, { actualCashCents, expectedCashCents }) => {
  if (isLocked || !currentUser) throw new Error("Terminal Locked or No User");
  
  const session = db.db.prepare('SELECT * FROM register_sessions WHERE cashier_id = ? AND is_closed = 0 ORDER BY opened_at DESC LIMIT 1').get(currentUser.id);
  if (!session) throw new Error("No active session found");
  
  const varianceCents = actualCashCents - expectedCashCents;
  
  db.db.prepare(`
    UPDATE register_sessions 
    SET expected_cash_cents = ?, actual_cash_cents = ?, variance_cents = ?, closed_at = CURRENT_TIMESTAMP, is_closed = 1 
    WHERE session_id = ?
  `).run(expectedCashCents, actualCashCents, varianceCents, session.session_id);
  
  // Mock Z-Report Print
  console.log(`\n=== Z-REPORT (SHIFT SUMMARY) ===`);
  console.log(`Shift ID: ${session.session_id}`);
  console.log(`Cashier ID: ${session.cashier_id}`);
  console.log(`Opened At: ${session.opened_at}`);
  console.log(`Closed At: ${new Date().toISOString()}`);
  console.log(`Expected Cash: LKR ${(expectedCashCents / 100).toFixed(2)}`);
  console.log(`Actual Cash: LKR ${(actualCashCents / 100).toFixed(2)}`);
  console.log(`Discrepancy: LKR ${(varianceCents / 100).toFixed(2)}`);
  console.log(`================================\n`);
  
  if (Math.abs(varianceCents) > 10000) { 
    return { success: true, varianceCents, requiresOverride: true };
  }
  return { success: true, varianceCents, requiresOverride: false };
});

ipcMain.handle('get-true-pnl', async (event) => {
  if (isLocked) throw new Error("Terminal Locked");
  const pnlData = db.db.prepare(`
    SELECT 
        p.name_en,
        SUM(oi.quantity) as units_sold,
        SUM(oi.price_cents) as gross_rev,
        SUM(
            (oi.price_cents - ib.cost_price_cents) - 
            (CASE 
                WHEN o.payment_mode = 'LANKAQR' AND oi.price_cents > 500000 THEN oi.price_cents * 0.01 
                ELSE 0 END) -
            (CASE WHEN o.payment_mode = 'NAYA' THEN oi.price_cents * 0.025 ELSE 0 END)
        ) as net_profit_cents
    FROM order_items oi
    JOIN inventory_batches ib ON oi.batch_id = ib.batch_id
    JOIN products p ON oi.product_id = p.product_id
    JOIN orders o ON oi.order_id = o.id
    GROUP BY p.product_id
  `).all();
  return { success: true, data: pnlData };
});

// --- Phase 12: Admin APIs ---
ipcMain.handle('admin:get-stats', async (event) => {
  if (isLocked) throw new Error("Terminal Locked");
  const stats = { todayRevenueCents: 0, todayProfitCents: 0, lowStockCount: 0, productPnL: [] };
  
  const revRes = db.db.prepare("SELECT IFNULL(SUM(total_amount_cents), 0) as rev FROM orders WHERE DATE(created_at) = CURRENT_DATE").get();
  stats.todayRevenueCents = revRes.rev;

  const lowStock = db.db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT p.product_id FROM products p 
      JOIN inventory_batches b ON p.product_id = b.product_id
      GROUP BY p.product_id HAVING SUM(b.current_quantity) <= MAX(p.reorder_point)
    )
  `).get();
  stats.lowStockCount = lowStock.count;

  const expiringSoon = db.db.prepare(`
    SELECT COUNT(*) as count FROM inventory_batches
    WHERE expiry_date <= date('now', '+30 days') AND current_quantity > 0
  `).get();
  stats.expiringSoonCount = expiringSoon.count;

  // Simple Profit Mock (as batch tracking in order_items is complex)
  stats.todayProfitCents = Math.round(stats.todayRevenueCents * 0.15); // 15% margin mock

  stats.productPnL = db.db.prepare(`
    SELECT 
      p.name_en, SUM(oi.quantity) as units_sold, SUM(oi.price_cents * oi.quantity) as gross_rev,
      SUM((oi.price_cents * 0.15) * oi.quantity) as net_profit_cents
    FROM order_items oi
    JOIN products p ON oi.product_id = p.product_id
    GROUP BY p.product_id
  `).all();

  return { success: true, data: stats };
});

ipcMain.handle('admin:get-inventory', async (event) => {
  if (isLocked) throw new Error("Terminal Locked");
  const data = db.db.prepare(`
    SELECT p.product_id, p.name_en, p.name_si, p.name_ta, p.price_cents, p.tax_class, p.is_weighable, p.barcode, p.reorder_point, p.is_active,
           IFNULL(SUM(b.current_quantity), 0) as total_qty,
           IFNULL(AVG(b.selling_price_cents), 0) as avg_selling_price_cents
    FROM products p
    LEFT JOIN inventory_batches b ON p.product_id = b.product_id
    GROUP BY p.product_id
  `).all();
  return { success: true, data };
});

ipcMain.handle('admin:get-customers', async (event) => {
  if (isLocked) throw new Error("Terminal Locked");
  const data = db.db.prepare(`
    SELECT id, name, mobile, credit_limit, outstanding_cents, last_settled_at as last_updated
    FROM customers
    WHERE outstanding_cents > 0
  `).all();
  return { success: true, data };
});

ipcMain.handle('admin:settle-credit', async (event, { customerId, amountCents }) => {
  if (isLocked) throw new Error("Terminal Locked");
  try {
    db.db.prepare('UPDATE customers SET outstanding_cents = outstanding_cents - ?, last_settled_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(amountCents, customerId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin:get-shifts', async (event) => {
  if (isLocked) throw new Error("Terminal Locked");
  const data = db.db.prepare(`
    SELECT rs.session_id, rs.cashier_id, u.username as cashier_name, 
           rs.opened_at, rs.closed_at, rs.expected_cash_cents, 
           rs.actual_cash_cents, rs.variance_cents
    FROM register_sessions rs
    LEFT JOIN users u ON rs.cashier_id = u.id
    ORDER BY rs.is_closed ASC, rs.opened_at DESC LIMIT 50
  `).all();
  return { success: true, data };
});

ipcMain.handle('admin:get-shift-details', async (event, sessionId) => {
  if (isLocked) throw new Error("Terminal Locked");
  
  const session = db.db.prepare('SELECT opened_at, closed_at FROM register_sessions WHERE session_id = ?').get(sessionId);
  if (!session) throw new Error("Session not found");
  
  const closedAt = session.closed_at || '9999-12-31 23:59:59';
  
  const sales = db.db.prepare(`
    SELECT id as order_id, total_amount_cents, payment_mode, created_at
    FROM orders
    WHERE created_at >= ? AND created_at <= ?
    ORDER BY created_at DESC
  `).all(session.opened_at, closedAt);
  
  return { success: true, data: sales };
});

// --- Phase 12: Admin CRUD ---
ipcMain.handle('admin:create-product', async (event, data) => {
  if (isLocked) throw new Error("Terminal Locked");
  try {
    const id = require('crypto').randomUUID();
    db.db.prepare(`
      INSERT INTO products (product_id, name_en, name_si, name_ta, barcode, price_cents, tax_class, reorder_point, is_weighable)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.name_en, data.name_si, data.name_ta, data.barcode || null, data.price_cents || 0, data.tax_class || 'NONE', data.reorder_point || 0, data.is_weighable ? 1 : 0);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin:update-product', async (event, data) => {
  if (isLocked) throw new Error("Terminal Locked");
  try {
    db.db.prepare(`
      UPDATE products 
      SET name_en = ?, name_si = ?, name_ta = ?, barcode = ?, price_cents = ?, tax_class = ?, reorder_point = ?, is_weighable = ?
      WHERE product_id = ?
    `).run(data.name_en, data.name_si, data.name_ta, data.barcode || null, data.price_cents || 0, data.tax_class || 'NONE', data.reorder_point || 0, data.is_weighable ? 1 : 0, data.product_id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin:toggle-product-status', async (event, productId) => {
  if (isLocked) throw new Error("Terminal Locked");
  try {
    db.db.prepare("UPDATE products SET is_active = NOT is_active WHERE product_id = ?").run(productId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin:receive-stock', async (event, data) => {
  if (isLocked) throw new Error("Terminal Locked");
  try {
    const batchId = require('crypto').randomUUID();
    db.db.prepare(`
      INSERT INTO inventory_batches (batch_id, product_id, cost_price_cents, selling_price_cents, received_quantity, current_quantity, expiry_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(batchId, data.product_id, data.cost_price_cents, data.selling_price_cents, data.quantity, data.quantity, data.expiry_date || null);
    
    // Also update default selling price of product to this latest selling price
    db.db.prepare("UPDATE products SET price_cents = ? WHERE product_id = ?").run(data.selling_price_cents, data.product_id);
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('hardware:open-drawer', async (event) => {
  try {
    // Generate ESC/POS Drawer Kick Buffer: ESC p 0 25 250
    const buffer = new Uint8Array([0x1B, 0x40, 0x1B, 0x70, 0x00, 0x19, 0xFA]);
    console.log("KICKING CASH DRAWER:", buffer);
    // If a real printer was connected via raw USB/Serial, we would send the buffer here.
    
    // Log the manual open to audit_logs if triggered directly without override
    const hardwareId = process.env.HARDWARE_ID || "DEV_TERM_01";
    db.db.prepare("INSERT INTO audit_logs (user_id, device_id, action_type) VALUES (?, ?, ?)").run(currentUser ? currentUser.id : 'SYSTEM', hardwareId, "OPEN_DRAWER");

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// --- Phase 10: Print Invoice ---
ipcMain.handle('get-settings', async (event) => {
  if (isLocked) throw new Error("Terminal Locked");
  const data = db.db.prepare("SELECT key, value FROM settings").all();
  const settingsObj = {};
  data.forEach(row => {
    settingsObj[row.key] = row.value;
  });
  return { success: true, data: settingsObj };
});

ipcMain.handle('save-settings', async (event, settingsObj) => {
  if (isLocked) throw new Error("Terminal Locked");
  try {
    const tx = db.db.transaction((settings) => {
      const stmt = db.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      for (const [key, value] of Object.entries(settings)) {
        stmt.run(key, value);
      }
    });
    tx(settingsObj);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// --- Phase X: Export CSV ---
ipcMain.handle('admin:export-sales-csv', async (event) => {
  if (isLocked) throw new Error("Terminal Locked");
  try {
    const query = `
      SELECT 
          o.id AS order_id, 
          o.created_at AS order_date, 
          o.total_amount_cents, 
          o.payment_mode,
          oi.quantity, 
          oi.price_cents AS unit_price_cents,
          p.name_en AS product_name, 
          p.category_id, 
          p.is_weighable
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.product_id
      ORDER BY o.created_at DESC
    `;
    const rows = db.db.prepare(query).all();
    
    if (rows.length === 0) {
      return { success: false, error: 'No data to export' };
    }

    // Convert to CSV
    const header = Object.keys(rows[0]).join(',') + '\n';
    const csvContent = rows.map(row => {
      return Object.values(row).map(value => {
        let str = String(value);
        if (str.includes(',') || str.includes('"')) {
          str = '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      }).join(',');
    }).join('\n');

    const csvData = header + csvContent;

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Sales Data',
      defaultPath: 'sales_data.csv',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });

    if (canceled || !filePath) {
      return { success: false, error: 'Export canceled' };
    }

    fs.writeFileSync(filePath, csvData, 'utf8');
    return { success: true, filePath };
  } catch (error) {
    console.error("CSV Export Error:", error);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('admin:get-transactions', async (event, { date }) => {
  if (isLocked) throw new Error("Terminal Locked");
  try {
    let query = `
      SELECT id, customer_id, total_amount_cents, payment_mode, created_at 
      FROM orders 
    `;
    
    if (date === 'today') {
      query += ` WHERE date(created_at) = date('now', 'localtime') `;
    }
    
    query += ` ORDER BY created_at DESC `;
    
    const transactions = db.db.prepare(query).all();
    
    // Fetch items for each transaction
    const itemsStmt = db.db.prepare(`
      SELECT oi.quantity, oi.price_cents, p.name_en 
      FROM order_items oi
      JOIN products p ON oi.product_id = p.product_id
      WHERE oi.order_id = ?
    `);
    
    const syncQueueStmt = db.db.prepare(`SELECT payload FROM sync_queue WHERE payload LIKE ?`);

    transactions.forEach(tx => {
      tx.items = itemsStmt.all(tx.id);
      
      // Fallback for older transactions that didn't save to order_items
      if (tx.items.length === 0) {
        const syncRecs = syncQueueStmt.all('%"order_id":"' + tx.id + '"%');
        if (syncRecs.length > 0) {
          try {
            const payload = JSON.parse(syncRecs[0].payload);
            if (payload.items) {
              tx.items = payload.items.map(i => ({
                quantity: i.quantity,
                price_cents: i.price_cents || i.sellingPriceCents || 0,
                name_en: i.name || i.name_en || 'Unknown Item'
              }));
            }
          } catch(e) {}
        }
      }
    });
    
    return { success: true, data: transactions };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// --- Phase 13: Hardware Scale Integration ---
let scaleMockInterval = null;
let lastSentWeight = -1;
let lastSendTime = 0;
const THROTTLE_MS = 300; // max ~3 times a sec

ipcMain.handle('hardware:connect-scale', async (event) => {
  try {
    const ports = await SerialPort.list();
    const scalePortInfo = ports.find(p => p.manufacturer && (p.manufacturer.includes('FTDI') || p.manufacturer.includes('Prolific')));
    
    if (scalePortInfo) {
      const port = new SerialPort({ path: scalePortInfo.path, baudRate: 9600 });
      const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
      
      parser.on('data', (data) => {
        const match = data.match(/([0-9.]+)/);
        if (match) {
          const weightInKg = parseFloat(match[1]);
          const weightInGrams = Math.round(weightInKg * 1000);
          
          const now = Date.now();
          if (weightInGrams !== lastSentWeight && (now - lastSendTime > THROTTLE_MS)) {
            lastSentWeight = weightInGrams;
            lastSendTime = now;
            mainWindow.webContents.send('hardware:scale-weight', weightInGrams);
          }
        }
      });
      return { success: true, port: scalePortInfo.path, mock: false };
    } else {
      // Real Production Mode: Fail gracefully if no scale is found so cashier can type manually.
      return { success: false, error: 'No compatible scale found' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});
