const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('posAPI', {
  executeDB: (query, params) => {
    return ipcRenderer.invoke('secure-db-query', { query, params });
  },
  executeTransaction: (queries) => {
    return ipcRenderer.invoke('secure-db-transaction', queries);
  },
  executeFIFODeduction: (cartItems) => {
    return ipcRenderer.invoke('execute-fifo-deduction', cartItems);
  },
  onCriticalAlert: (callback) => {
    ipcRenderer.on('critical-inventory-alert', (event, data) => callback(data));
  },
  processCreditSale: (data) => ipcRenderer.invoke('process-credit-sale', data),
  openShift: (data) => ipcRenderer.invoke('open-shift', data),
  closeShift: (data) => ipcRenderer.invoke('close-shift', data),
  getTruePnL: () => ipcRenderer.invoke('get-true-pnl'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getExpectedCash: () => ipcRenderer.invoke('get-expected-cash')
});

contextBridge.exposeInMainWorld('syncAPI', {
  manualSync: () => ipcRenderer.invoke('trigger-sync'),
  onSyncStatusUpdate: (callback) => {
    ipcRenderer.on('sync-status', (event, state) => callback(state));
  }
});

contextBridge.exposeInMainWorld('lankaPay', {
  checkStatus: (id) => ipcRenderer.invoke('get-payment-status', id)
});

// Phase 8: Secure Auth & Audit Bridge
contextBridge.exposeInMainWorld('posSecurity', {
  authenticateUser: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  requestOverride: (action, pin) => ipcRenderer.invoke('auth:override', { action, pin }),
  triggerLock: () => ipcRenderer.send('security:trigger-lock'),
  onShowLockScreen: (callback) => {
    ipcRenderer.on('ui:show-lock-screen', (e, data) => callback(data));
  },
  unlockSession: (pin) => ipcRenderer.invoke('auth:unlock', pin),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getAuthStatus: () => ipcRenderer.invoke('auth:status')
});

// Phase 12: Admin Dashboard Bridge
contextBridge.exposeInMainWorld('adminAPI', {
  getDashboardStats: () => ipcRenderer.invoke('admin:get-stats'),
  getInventory: () => ipcRenderer.invoke('admin:get-inventory'),
  getCustomerBalances: () => ipcRenderer.invoke('admin:get-customers'),
  settleCredit: (data) => ipcRenderer.invoke('admin:settle-credit', data),
  getShiftLogs: () => ipcRenderer.invoke('admin:get-shifts'),
  getShiftDetails: (sessionId) => ipcRenderer.invoke('admin:get-shift-details', sessionId),
  exportSalesCSV: () => ipcRenderer.invoke('admin:export-sales-csv'),
  
  createProduct: (data) => ipcRenderer.invoke('admin:create-product', data),
  updateProduct: (data) => ipcRenderer.invoke('admin:update-product', data),
  toggleProductStatus: (id) => ipcRenderer.invoke('admin:toggle-product-status', id),
  receiveStock: (data) => ipcRenderer.invoke('admin:receive-stock', data),
  
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settingsObj) => ipcRenderer.invoke('save-settings', settingsObj),
  getTransactions: (params) => ipcRenderer.invoke('admin:get-transactions', params)
});

// Phase 13: Hardware Scale Integration
contextBridge.exposeInMainWorld('hardwareAPI', {
  connectScale: () => ipcRenderer.invoke('hardware:connect-scale'),
  onScaleWeight: (callback) => ipcRenderer.on('hardware:scale-weight', (event, weight) => callback(weight)),
  openDrawer: () => ipcRenderer.invoke('hardware:open-drawer')
});
