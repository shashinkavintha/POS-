// admin.js

document.addEventListener('DOMContentLoaded', () => {
  // Tab Navigation
  const navBtns = document.querySelectorAll('.nav-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active from all
      navBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(t => t.classList.add('hidden'));

      // Add active to clicked
      btn.classList.add('active');
      const tabId = `tab-${btn.getAttribute('data-tab')}`;
      document.getElementById(tabId).classList.remove('hidden');

      // Refresh data for the active tab
      refreshTab(btn.getAttribute('data-tab'));
    });
  });

  document.getElementById('btn-back-to-pos').addEventListener('click', () => {
    window.location.replace('index.html');
  });

  // Modals
  const settlementModal = document.getElementById('settlement-modal');
  const btnCancelSettlement = document.getElementById('btn-cancel-settlement');
  btnCancelSettlement.addEventListener('click', () => settlementModal.classList.add('hidden'));

  document.getElementById('btn-add-product').addEventListener('click', openAddProductModal);
  document.getElementById('btn-cancel-product').addEventListener('click', () => document.getElementById('product-modal').classList.add('hidden'));
  document.getElementById('product-form').addEventListener('submit', handleProductSubmit);

  document.getElementById('btn-add-batch').addEventListener('click', openGrnModal);
  document.getElementById('btn-cancel-grn').addEventListener('click', () => document.getElementById('grn-modal').classList.add('hidden'));
  document.getElementById('grn-form').addEventListener('submit', handleGrnSubmit);

  // Initialize
  refreshTab('dashboard');

  // Export CSV
  const btnExportCsv = document.getElementById('btn-export-csv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', async () => {
      btnExportCsv.disabled = true;
      const originalText = btnExportCsv.textContent;
      btnExportCsv.textContent = 'Exporting...';
      
      try {
        const res = await window.adminAPI.exportSalesCSV();
        if (res.success) {
          alert(`Successfully exported to:\n${res.filePath}`);
        } else {
          if (res.error !== 'Export canceled') {
            alert(`Failed to export: ${res.error}`);
          }
        }
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        btnExportCsv.textContent = originalText;
        btnExportCsv.disabled = false;
      }
    });
  }
});
let inventoryData = [];

async function refreshTab(tabName) {
  if (!window.adminAPI) {
    console.warn("Admin API not available in window. (Mocking data for development)");
    // Fallback UI or return
    return;
  }

  try {
    if (tabName === 'dashboard') await loadDashboard();
    if (tabName === 'inventory') await loadInventory();
    if (tabName === 'naya') await loadNayaPotha();
    if (tabName === 'shifts') await loadShifts();
    if (tabName === 'sales') await loadSales();
    if (tabName === 'settings') await loadSettings();
  } catch (error) {
    console.error(`Error loading ${tabName}:`, error);
  }
}

// --- Dashboard ---
async function loadDashboard() {
  const stats = await window.adminAPI.getDashboardStats();
  if (stats.success) {
    document.getElementById('stat-revenue').textContent = `LKR ${(stats.data.todayRevenueCents / 100).toFixed(2)}`;
    document.getElementById('stat-profit').textContent = `LKR ${(stats.data.todayProfitCents / 100).toFixed(2)}`;
    document.getElementById('stat-low-stock').textContent = stats.data.lowStockCount;
    const expiringEl = document.getElementById('stat-expiring');
    if (expiringEl) expiringEl.textContent = stats.data.expiringSoonCount || 0;

    const tbody = document.getElementById('pnl-table-body');
    tbody.innerHTML = '';
    stats.data.productPnL.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.name_en}</td>
        <td>${item.units_sold}</td>
        <td>LKR ${(item.gross_rev / 100).toFixed(2)}</td>
        <td class="text-green">LKR ${(item.net_profit_cents / 100).toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

// --- Inventory ---
async function loadInventory() {
  const inventory = await window.adminAPI.getInventory();
  if (inventory.success) {
    inventoryData = inventory.data;
    const tbody = document.getElementById('inventory-table-body');
    const grnSelect = document.getElementById('grn-product-select');
    tbody.innerHTML = '';
    grnSelect.innerHTML = '<option value="">-- Select Product --</option>';

    inventoryData.forEach(item => {
      // Add to GRN dropdown if active
      if (item.is_active) {
        const opt = document.createElement('option');
        opt.value = item.product_id;
        opt.textContent = item.name_en + (item.barcode ? ` (${item.barcode})` : '');
        grnSelect.appendChild(opt);
      }

      const isLow = item.total_qty <= item.reorder_point;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.name_en}</td>
        <td>${item.barcode || '-'}</td>
        <td><span class="${isLow ? 'text-red' : ''}">${item.total_qty.toFixed(2)}</span> (Min: ${item.reorder_point})</td>
        <td>LKR ${(item.avg_selling_price_cents / 100).toFixed(2)}</td>
        <td><span style="color: ${item.is_active ? 'var(--green)' : 'var(--red)'}">${item.is_active ? 'Active' : 'Inactive'}</span></td>
        <td>
          <button class="btn-small btn-edit-prod" data-id="${item.product_id}" style="background: var(--bg-lighter); color: #fff; margin-right: 5px;">Edit</button>
          <button class="btn-small btn-toggle-prod" data-id="${item.product_id}" style="background: ${item.is_active ? 'var(--danger-color)' : 'var(--green)'}; color: #fff;">
            ${item.is_active ? 'Disable' : 'Enable'}
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-edit-prod').forEach(btn => {
      btn.addEventListener('click', (e) => openEditProductModal(e.target.getAttribute('data-id')));
    });
    
    document.querySelectorAll('.btn-toggle-prod').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        if (confirm("Are you sure you want to change this product's status?")) {
          await window.adminAPI.toggleProductStatus(e.target.getAttribute('data-id'));
          loadInventory();
        }
      });
    });
  }
}

// --- Product CRUD Functions ---
function openAddProductModal() {
  document.getElementById('product-form').reset();
  document.getElementById('product-id').value = '';
  document.getElementById('prod-barcode').value = '';
  document.getElementById('prod-price').value = '';
  document.getElementById('prod-tax-class').value = 'NONE';
  document.getElementById('prod-reorder').value = '';
  document.getElementById('product-modal-title').textContent = 'Add New Product';
  document.getElementById('product-modal').classList.remove('hidden');
}

function openEditProductModal(productId) {
  const item = inventoryData.find(i => i.product_id === productId);
  if (!item) return;
  document.getElementById('product-id').value = item.product_id;
  document.getElementById('prod-name-en').value = item.name_en;
  document.getElementById('prod-name-si').value = item.name_si || '';
  document.getElementById('prod-name-ta').value = item.name_ta || '';
  document.getElementById('prod-barcode').value = item.barcode || '';
  document.getElementById('prod-price').value = item.price_cents ? (item.price_cents / 100).toFixed(2) : '';
  document.getElementById('prod-tax-class').value = item.tax_class || 'NONE';
  document.getElementById('prod-reorder').value = item.reorder_point || '';
  document.getElementById('prod-weighable').checked = item.is_weighable === 1;
  
  document.getElementById('product-modal-title').textContent = 'Edit Product';
  document.getElementById('product-modal').classList.remove('hidden');
}

async function handleProductSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('product-id').value;
  const data = {
    product_id: id,
    name_en: document.getElementById('prod-name-en').value,
    name_si: document.getElementById('prod-name-si').value,
    name_ta: document.getElementById('prod-name-ta').value,
    barcode: document.getElementById('prod-barcode').value,
    price_cents: Math.round(parseFloat(document.getElementById('prod-price').value || 0) * 100),
    tax_class: document.getElementById('prod-tax-class').value,
    reorder_point: parseFloat(document.getElementById('prod-reorder').value || 0),
    is_weighable: document.getElementById('prod-weighable').checked
  };

  let res;
  if (id) {
    res = await window.adminAPI.updateProduct(data);
  } else {
    res = await window.adminAPI.createProduct(data);
  }

  if (res.success) {
    document.getElementById('product-modal').classList.add('hidden');
    loadInventory();
  } else {
    alert("Error saving product: " + res.error);
  }
}

// --- GRN Functions ---
function openGrnModal() {
  document.getElementById('grn-form').reset();
  document.getElementById('grn-qty').placeholder = "Received Quantity";
  document.getElementById('grn-modal').classList.remove('hidden');
}

document.getElementById('grn-product-select').addEventListener('change', (e) => {
  const item = inventoryData.find(i => i.product_id === e.target.value);
  const qtyInput = document.getElementById('grn-qty');
  if (item && item.is_weighable) {
    qtyInput.placeholder = "Received Quantity (KG)";
  } else {
    qtyInput.placeholder = "Received Quantity (Units)";
  }
});

async function handleGrnSubmit(e) {
  e.preventDefault();
  const data = {
    product_id: document.getElementById('grn-product-select').value,
    cost_price_cents: Math.round(parseFloat(document.getElementById('grn-cost').value) * 100),
    selling_price_cents: Math.round(parseFloat(document.getElementById('grn-sell').value) * 100),
    quantity: parseFloat(document.getElementById('grn-qty').value),
    expiry_date: document.getElementById('grn-expiry').value || null
  };

  const res = await window.adminAPI.receiveStock(data);
  if (res.success) {
    document.getElementById('grn-modal').classList.add('hidden');
    loadInventory();
  } else {
    alert("Error receiving stock: " + res.error);
  }
}

// --- Naya Potha ---
let currentSettleCustomerId = null;
async function loadNayaPotha() {
  const credits = await window.adminAPI.getCustomerBalances();
  if (credits.success) {
    const tbody = document.getElementById('naya-table-body');
    tbody.innerHTML = '';
    credits.data.forEach(customer => {
      const balance = customer.outstanding_cents / 100;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${customer.id}</td>
        <td class="text-amber" style="font-weight: bold;">LKR ${balance.toFixed(2)}</td>
        <td>${customer.last_updated || 'N/A'}</td>
        <td>
          <button class="btn-settle" data-id="${customer.id}" data-name="${customer.name || customer.id}" data-max="${balance}">Settle</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-settle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        const name = e.target.getAttribute('data-name');
        openSettlementModal(id, name);
      });
    });
  }
}

function openSettlementModal(customerId, customerName) {
  currentSettleCustomerId = customerId;
  document.getElementById('settlement-modal').classList.remove('hidden');
  document.getElementById('settle-customer-name').textContent = `Customer: ${customerName}`;
  const input = document.getElementById('settle-amount-input');
  input.value = '';
  input.focus();
}

document.getElementById('btn-submit-settlement').addEventListener('click', async () => {
  const amountLKR = parseFloat(document.getElementById('settle-amount-input').value);
  if (!amountLKR || amountLKR <= 0) return alert("Invalid amount.");

  const amountCents = Math.round(amountLKR * 100);
  
  if (window.adminAPI) {
    const res = await window.adminAPI.settleCredit({ customerId: currentSettleCustomerId, amountCents });
    if (res.success) {
      alert("Credit Settled Successfully!");
      document.getElementById('settlement-modal').classList.add('hidden');
      loadNayaPotha();
    } else {
      alert("Settlement Failed: " + res.error);
    }
  }
});

function formatLocalTime(utcDateStr) {
  if (!utcDateStr) return '';
  const d = new Date(utcDateStr + 'Z');
  return isNaN(d) ? utcDateStr : d.toLocaleString();
}

// --- Shifts ---
async function loadShifts() {
  const shifts = await window.adminAPI.getShiftLogs();
  if (shifts.success) {
    const tbody = document.getElementById('shifts-table-body');
    tbody.innerHTML = '';
    shifts.data.forEach(shift => {
      let varianceText = '';
      let varianceClass = '';
      
      const varianceLKR = shift.variance_cents ? (shift.variance_cents / 100) : 0;
      
      if (varianceLKR === 0) {
        varianceText = 'LKR 0.00';
        varianceClass = 'text-green';
      } else if (varianceLKR > 0) {
        varianceText = `LKR +${varianceLKR.toFixed(2)} (Overage)`;
        varianceClass = 'text-overage'; // Amber
      } else {
        varianceText = `LKR ${varianceLKR.toFixed(2)} (Shortage)`;
        varianceClass = 'text-shortage'; // Red Bold
      }
      
      const isOverride = Math.abs(shift.variance_cents) > 10000;
      
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.onclick = () => openShiftDetails(shift.session_id);
      
      tr.innerHTML = `
        <td>${shift.cashier_name || shift.cashier_id}</td>
        <td>${formatLocalTime(shift.opened_at)}</td>
        <td>${shift.closed_at ? formatLocalTime(shift.closed_at) : '<span class="text-amber">Active</span>'}</td>
        <td>LKR ${(shift.expected_cash_cents / 100).toFixed(2)}</td>
        <td>LKR ${shift.actual_cash_cents != null ? (shift.actual_cash_cents / 100).toFixed(2) : '-'}</td>
        <td class="${varianceClass}">${varianceText} ${isOverride ? '⚠️' : ''}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

async function openShiftDetails(sessionId) {
  const drawer = document.getElementById('shift-details-drawer');
  const tbody = document.getElementById('shift-details-body');
  
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading...</td></tr>';
  drawer.classList.remove('hidden');
  
  const details = await window.adminAPI.getShiftDetails(sessionId);
  if (details.success) {
    tbody.innerHTML = '';
    if (details.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No sales during this shift.</td></tr>';
    } else {
      details.data.forEach(order => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>#${order.order_id}</td>
          <td>${formatLocalTime(order.created_at)}</td>
          <td>LKR ${(order.total_amount_cents / 100).toFixed(2)}</td>
          <td>${order.payment_mode}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btnCloseDrawer = document.getElementById('btn-close-drawer');
  if (btnCloseDrawer) {
    btnCloseDrawer.addEventListener('click', () => {
      document.getElementById('shift-details-drawer').classList.add('hidden');
    });
  }
});

// --- Settings ---
async function loadSettings() {
  const res = await window.adminAPI.getSettings();
  if (res.success) {
    document.getElementById('setting-shop-name').value = res.data.shop_name || '';
    document.getElementById('setting-shop-address').value = res.data.shop_address || '';
    document.getElementById('setting-shop-phone').value = res.data.shop_phone || '';
  }
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const settingsObj = {
    shop_name: document.getElementById('setting-shop-name').value,
    shop_address: document.getElementById('setting-shop-address').value,
    shop_phone: document.getElementById('setting-shop-phone').value
  };
  const res = await window.adminAPI.saveSettings(settingsObj);
  if (res.success) {
    alert("Settings saved successfully!");
  } else {
    alert("Failed to save settings: " + res.error);
  }
});

// --- Sales History ---
let currentSalesData = [];
async function loadSales(filter = 'today') {
  if (!window.adminAPI || !window.adminAPI.getTransactions) return;
  const res = await window.adminAPI.getTransactions({ date: filter });
  if (res.success) {
    currentSalesData = res.data;
    const tbody = document.getElementById('sales-table-body');
    tbody.innerHTML = '';
    res.data.forEach((tx, index) => {
      const dateStr = tx.created_at.endsWith('Z') ? tx.created_at : tx.created_at.replace(' ', 'T') + 'Z';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${tx.id}</td>
        <td>${new Date(dateStr).toLocaleString()}</td>
        <td style="font-weight: bold; color: var(--green);">LKR ${(tx.total_amount_cents / 100).toFixed(2)}</td>
        <td><span style="background: var(--bg-lighter); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">${tx.payment_mode}</span></td>
        <td>${tx.customer_id || '-'}</td>
        <td><button class="btn-small btn-view-sales" data-index="${index}">Items</button></td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-view-sales').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = e.target.getAttribute('data-index');
        openSalesDetailsModal(currentSalesData[idx]);
      });
    });
  }
}

function openSalesDetailsModal(tx) {
  document.getElementById('sd-invoice-id').textContent = tx.id;
  const tbody = document.getElementById('sd-items-body');
  tbody.innerHTML = '';
  
  if (tx.items && tx.items.length > 0) {
    tx.items.forEach(item => {
      const priceLKR = item.price_cents / 100;
      const totalLKR = priceLKR * item.quantity;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.name_en}</td>
        <td>${item.quantity}</td>
        <td>LKR ${priceLKR.toFixed(2)}</td>
        <td style="font-weight: bold;">LKR ${totalLKR.toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    });
  } else {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No items found (Legacy order)</td></tr>`;
  }
  
  document.getElementById('sales-details-modal').classList.remove('hidden');
}

document.getElementById('btn-close-sales-details').addEventListener('click', () => {
  document.getElementById('sales-details-modal').classList.add('hidden');
});

const salesFilter = document.getElementById('sales-filter');
if (salesFilter) {
  salesFilter.addEventListener('change', (e) => {
    loadSales(e.target.value);
  });
}
