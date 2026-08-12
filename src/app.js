import './components/ProductGrid.js';
import './components/CartList.js';

import { PrinterManager } from './hardware/printer.js';
import { LankaQR } from './payments/lankaqr.js';
import { PricingEngine } from './core/PricingEngine.js';
import JsBarcode from 'jsbarcode';

// --- Global State ---
let cart = [];
let products = [];
let currentOrderId = '';
let currentWeight = 0;
let isOffline = false;
let pollingActive = false;

// Phase 8: Auth State
let currentLoggedInUser = null; 
let overrideActionType = null; // 'CLOSE_SHIFT' or 'OPEN_DRAWER'

const pricingEngine = new PricingEngine(18); // 18% VAT

// --- Scanner Buffer ---
let scannerBuffer = "";
let lastKeyTime = Date.now();

// --- DOM Elements ---
const mainGrid = document.getElementById('main-grid');
const activeCart = document.getElementById('active-cart');
const barcodeInput = document.getElementById('barcode-input');
const subtotalVal = document.getElementById('subtotal-val');
const taxVal = document.getElementById('tax-val');
const totalVal = document.getElementById('total-val');

// Modals
const checkoutModal = document.getElementById('checkout-modal');
const otpModal = document.getElementById('otp-modal');
const shiftCloseModal = document.getElementById('close-shift-modal');
const supervisorModal = document.getElementById('supervisor-modal');
const lockScreenModal = document.getElementById('lock-screen-modal');
const editQtyModal = document.getElementById('edit-qty-modal');
const shortcutsModal = document.getElementById('shortcuts-modal');
const btnHelpShortcuts = document.getElementById('btn-help-shortcuts');
const btnCloseShortcuts = document.getElementById('btn-close-shortcuts');
const recallBillModal = document.getElementById('recall-bill-modal');
const recallBillList = document.getElementById('recall-bill-list');
const btnCloseRecallModal = document.getElementById('btn-close-recall-modal');

// Auth UI
const loginUsernameInput = document.getElementById('login-username-input');
const loginPinInput = document.getElementById('login-pin-input');
const btnLoginSubmit = document.getElementById('btn-login-submit');
const lockScreenError = document.getElementById('lock-screen-error');
const lockScreenTitle = document.getElementById('lock-screen-title');

// Buttons & Inputs
const btnCheckout = document.getElementById('btn-checkout');
const btnCloseModal = document.getElementById('btn-close-modal');
const mdrFeeDisplay = document.getElementById('mdr-fee-display');

const paymentSelectionPhase = document.getElementById('payment-selection-phase');
const cashTenderPhase = document.getElementById('cash-tender-phase');
const checkoutSuccessPhase = document.getElementById('checkout-success-phase');
const tenderAmountInput = document.getElementById('tender-amount-input');
const changeDueDisplay = document.getElementById('change-due-display');
const btnConfirmCash = document.getElementById('btn-confirm-cash');
const chkOpenDrawerDigital = document.getElementById('chk-open-drawer-digital');
const successChangeText = document.getElementById('success-change-text');

const btnPayCash = document.getElementById('btn-pay-cash');
const btnPayQr = document.getElementById('btn-pay-qr');
const btnPayJustPay = document.getElementById('btn-pay-justpay');

const qrContainer = document.getElementById('qr-container');
const lankaqrCanvas = document.getElementById('lankaqr-canvas');

// Phase 10: Barcode UI
const btnPrintBarcode = document.getElementById('btn-print-barcode');
const barcodeModal = document.getElementById('barcode-modal');
const barcodeProductSelect = document.getElementById('barcode-product-select');
const barcodeWeightInput = document.getElementById('barcode-weight-input');
// const barcodePrintArea = document.getElementById('barcode-print-area');
const btnGenerateBarcode = document.getElementById('btn-generate-barcode');
const btnCancelBarcode = document.getElementById('btn-cancel-barcode');
const qrStatusText = document.getElementById('qr-status-text');
const btnConnectScale = document.getElementById('btn-connect-scale');
const btnOpenDrawer = document.getElementById('btn-open-drawer');
const supervisorModalTitle = document.getElementById('supervisor-modal-title');
const supervisorModalDesc = document.getElementById('supervisor-modal-desc');
const btnSyncNow = document.getElementById('btn-sync-now');
const btnHoldBill = document.getElementById('btn-hold-bill');
const btnRecallBill = document.getElementById('btn-recall-bill');
const btnCloseShift = document.getElementById('btn-close-shift');
const btnAdmin = document.getElementById('btn-admin');
const btnLogout = document.getElementById('btn-logout');

// Shift / Override
const otpInput = document.getElementById('otp-input');
const btnSubmitOtp = document.getElementById('btn-submit-otp');
const btnCancelOtp = document.getElementById('btn-cancel-otp');
const expectedCashVal = document.getElementById('close-shift-expected');
const actualCashInput = document.getElementById('close-shift-actual-input');
const btnSubmitShift = document.getElementById('btn-submit-close-shift');
const btnCancelShift = document.getElementById('btn-cancel-close-shift');
const supervisorPinInput = document.getElementById('supervisor-pin-input');
const varianceText = document.getElementById('variance-text');
const btnAuthorizeOverride = document.getElementById('btn-authorize-override');
const btnCancelOverride = document.getElementById('btn-cancel-override');
const editQtyInput = document.getElementById('edit-qty-input');
const btnSubmitQty = document.getElementById('btn-submit-qty');
const btnCancelQty = document.getElementById('btn-cancel-qty');

// Phase 11: Naya Potha
const nayaModal = document.getElementById('naya-modal');
const nayaNicInput = document.getElementById('naya-nic-input');
const btnSubmitNaya = document.getElementById('btn-submit-naya');
const btnCancelNaya = document.getElementById('btn-cancel-naya');

// --- Phase 8: Auth / Security Logic ---
function setupSecurityListeners() {
  if (window.posSecurity) {
    window.posSecurity.onShowLockScreen((data) => {
      lockScreenModal.classList.remove('hidden');
      loginPinInput.value = '';
      if (data && data.fullLogin) {
        currentLoggedInUser = null;
        loginUsernameInput.value = '';
        btnAdmin.style.display = 'none';
        loginUsernameInput.style.display = 'block';
        lockScreenTitle.textContent = 'Login';
        loginUsernameInput.focus();
      } else {
        loginUsernameInput.style.display = 'none';
        lockScreenTitle.textContent = `Unlock Session (${currentLoggedInUser})`;
        loginPinInput.focus();
      }
    });
  }

  btnLoginSubmit.addEventListener('click', handleLoginSubmit);
  loginPinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLoginSubmit();
  });
  loginUsernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginPinInput.focus();
  });
}

async function handleLoginSubmit() {
  lockScreenError.textContent = "";
  const username = loginUsernameInput.value.trim();
  const pin = loginPinInput.value.trim();

  if (!window.posSecurity) {
    // Development fallback
    lockScreenModal.classList.add('hidden');
    currentLoggedInUser = "dev";
    return;
  }

  try {
    if (!currentLoggedInUser) {
      // Initial Login
      const result = await window.posSecurity.authenticateUser({ username, pin });
      if (result.success) {
        currentLoggedInUser = username;
        lockScreenModal.classList.add('hidden');
        if (result.role === 'ADMIN') {
          btnAdmin.style.display = 'block';
        } else {
          btnAdmin.style.display = 'none';
        }
        barcodeInput.focus();
        await loadProducts(); // Phase 10 fix: load products AFTER unlock
      } else {
        lockScreenError.textContent = result.error;
      }
    } else {
      // Unlock
      const result = await window.posSecurity.unlockSession(pin);
      if (result.success) {
        lockScreenModal.classList.add('hidden');
        if (result.role === 'ADMIN') {
          btnAdmin.style.display = 'block';
        } else {
          btnAdmin.style.display = 'none';
        }
        barcodeInput.focus();
        await loadProducts(); // Ensure products are loaded if they were missed
      } else {
        lockScreenError.textContent = result.error;
      }
    }
  } catch (err) {
    lockScreenError.textContent = "Auth Error: " + err.message;
  }
}

// --- Initialization ---
function init() {
  setupSecurityListeners();
  setupEventListeners();
  updateCartUI();
  setupSyncListeners();
  
  const onReady = async () => {
    // Check if security module is active
    if (window.posSecurity) {
      try {
        const auth = await window.posSecurity.getAuthStatus();
        
        // Remove debug auth dump
        const errField = document.getElementById('lock-screen-error');
        if (errField) errField.textContent = "";
        
        if (!auth.isLocked && auth.currentUser) {
          // Already logged in
          currentLoggedInUser = auth.currentUser.username;
          lockScreenModal.classList.add('hidden');
          if (auth.currentUser.role === 'ADMIN') {
            btnAdmin.style.display = 'inline-block';
          }
          await loadProducts();
        } else {
          // Needs login/unlock
          lockScreenModal.classList.remove('hidden');
          if (auth.currentUser) {
            currentLoggedInUser = auth.currentUser.username;
            loginUsernameInput.style.display = 'none';
            document.getElementById('lock-screen-title').textContent = `Unlock Session (${currentLoggedInUser})`;
            loginPinInput.focus();
          } else {
            loginUsernameInput.focus();
          }
        }
      } catch (err) {
        lockScreenModal.classList.remove('hidden');
        document.getElementById('lock-screen-error').textContent = "Auth Status Error: " + err.message;
      }
    } else {
      await loadProducts(); // Load directly if no security module
    }
    // Phase 10: Listen for Inventory Alerts
    let lastAlertMsg = "";
    let lastAlertTime = 0;
    
    if (window.posAPI) {
      window.posAPI.onCriticalAlert((alertData) => {
        const { emergencyExpiries, lowStockItems } = alertData;
        let msg = "CRITICAL INVENTORY ALERT\n\n";
        if (emergencyExpiries && emergencyExpiries.length > 0) {
           msg += `Emergency Expiry (<48h): ${emergencyExpiries.map(e => e.name_en).join(', ')}\n`;
        }
        if (lowStockItems && lowStockItems.length > 0) {
           msg += `Low Stock (ROP): ${lowStockItems.map(l => l.name_en).join(', ')}\n`;
        }
        
        if (msg === "CRITICAL INVENTORY ALERT\n\n") return;

        const now = Date.now();
        // Show alert only if the items changed, or every 1 hour as a reminder
        if (msg !== lastAlertMsg || now - lastAlertTime > 3600000) { 
          lastAlertMsg = msg;
          lastAlertTime = now;
          alert(msg); 
        }
      });
    } else {
      mainGrid.setProducts(products);
    }
  };
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
}

async function loadProducts() {
  if (window.posAPI) {
    try {
      products = await window.posAPI.executeDB("SELECT * FROM products", []);
      // Map name_en as name for backwards compatibility with ProductGrid and cart
      products = products.map(p => ({ ...p, name: p.name_en }));
      mainGrid.setProducts(products);
    } catch (err) {
      console.error("Failed to load products:", err);
    }
  } else {
    mainGrid.setProducts(products);
  }
}

function updateCartUI() {
  activeCart.setItems(cart);
  const totals = pricingEngine.calculateTotal(cart, 0); 
  
  subtotalVal.textContent = (totals.subTotalCents / 100).toFixed(2);
  const taxCents = totals.finalPayableCents - totals.subTotalCents;
  taxVal.textContent = (taxCents / 100).toFixed(2);
  totalVal.textContent = (totals.finalPayableCents / 100).toFixed(2);
}

// --- Sync state ---
function setupSyncListeners() {
  if (window.syncAPI) {
    window.syncAPI.onSyncStatusUpdate((state) => {
      isOffline = (state === 'IN_OFFLINE_MODE');
      if (state === 'IN_ONLINE_MODE' || state === 'READY') {
        btnSyncNow.style.backgroundColor = '#26a69a'; // Default Subtle Mint
        btnSyncNow.textContent = 'Sync: Online';
        btnPayQr.disabled = false;
        btnPayJustPay.disabled = false;
      } else if (state === 'IN_OFFLINE_MODE') {
        btnSyncNow.style.backgroundColor = '#cf6679'; // Red / Danger
        btnSyncNow.textContent = 'Sync: Offline';
        btnPayQr.disabled = true;
        btnPayJustPay.disabled = true;
      }
    });

    btnSyncNow.addEventListener('click', async () => {
      const originalText = btnSyncNow.textContent;
      const originalColor = btnSyncNow.style.backgroundColor;
      btnSyncNow.disabled = true;
      btnSyncNow.textContent = 'Syncing...';
      btnSyncNow.style.backgroundColor = '#ffb300'; // Amber
      
      const res = await window.syncAPI.manualSync();
      
      btnSyncNow.disabled = false;
      if (res.success) {
        btnSyncNow.textContent = 'Synced ✅';
        btnSyncNow.style.backgroundColor = '#26a69a';
      } else {
        btnSyncNow.textContent = 'Sync Failed';
        btnSyncNow.style.backgroundColor = '#cf6679';
      }
      setTimeout(() => { 
        // Sync status listener will eventually correct it, but we can reset
        if (!isOffline) {
          btnSyncNow.textContent = 'Sync: Online';
          btnSyncNow.style.backgroundColor = '#26a69a';
        } else {
          btnSyncNow.textContent = 'Sync: Offline';
          btnSyncNow.style.backgroundColor = '#cf6679';
        }
      }, 2000);
    });
  }
}

// --- Event Listeners ---
function setupEventListeners() {
  mainGrid.addEventListener('product-selected', (e) => addToCart(e.detail));
  
  activeCart.addEventListener('update-quantity', (e) => {
    updateQuantity(e.detail.id, e.detail.action);
  });

  barcodeInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = products.filter(p => 
      p.name.toLowerCase().includes(query) || 
      (p.sku && p.sku.toLowerCase().includes(query))
    );
    mainGrid.setProducts(filtered);
  });

  document.addEventListener('keydown', async (e) => {
    // Prevent actions if locked
    if (!lockScreenModal.classList.contains('hidden')) return;

    const isSpecialKey = ['Escape', 'F1', 'F2', 'F5', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].includes(e.key);
    if (e.target.tagName === 'INPUT' && e.target.id !== 'barcode-input' && !isSpecialKey) return;

    const currentTime = Date.now();
    const isScannerInput = (currentTime - lastKeyTime < 30);

    if (!isScannerInput) {
      scannerBuffer = "";
    }

    if (e.key === 'Enter') {
      if (scannerBuffer.length > 2) {
        const product = products.find(p => p.sku === scannerBuffer);
        if (product) addToCart(product);
        else alert(`Product not found for Barcode: ${scannerBuffer}`);
        scannerBuffer = "";
        barcodeInput.value = ""; 
      } else if (!checkoutModal.classList.contains('hidden') && otpModal.classList.contains('hidden') && shiftCloseModal.classList.contains('hidden') && supervisorModal.classList.contains('hidden')) {
        e.preventDefault();
        processPayment('CASH');
      }
    } else if (e.key.length === 1) { 
      scannerBuffer += e.key;
    }
    lastKeyTime = currentTime;

    // Shortcuts
    if (e.key === 'F1') { 
      e.preventDefault(); 
      shortcutsModal.classList.remove('hidden'); 
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      shortcutsModal.classList.add('hidden');
      barcodeModal.classList.add('hidden');
      recallBillModal.classList.add('hidden');
      if (nayaModal) nayaModal.classList.add('hidden');
      if (otpModal) otpModal.classList.add('hidden');
      if (supervisorModal) supervisorModal.classList.add('hidden');
      if (shiftCloseModal) shiftCloseModal.classList.add('hidden');
      closeCheckoutModal();
      barcodeInput.value = "";
      scannerBuffer = "";
    }
    if (e.key === 'F2') { e.preventDefault(); barcodeInput.focus(); }
    if (e.key === 'F3') { e.preventDefault(); handleEditQuantity(); }
    if (e.key === 'F4') {
      e.preventDefault();
      const weight = currentWeight > 0 ? currentWeight : 1; 
      addToCart({ ...products[2], price_cents: products[2].price_cents, actualWeight: weight, isWeightBased: true, name: `Sugar (${weight.toFixed(3)}kg)` });
    }
    if (e.key === 'F5') { 
      e.preventDefault(); 
      if (!checkoutModal.classList.contains('hidden')) {
        btnPayCash.click();
      } else {
        btnConnectScale.click();
      }
    }
    if (e.key === 'F7') { e.preventDefault(); handleHoldBill(); }
    if (e.key === 'F8') { e.preventDefault(); handleRecallBill(); }
    if (e.key === 'F10') { e.preventDefault(); openShiftClose(); }
    if (e.key === 'F11') { 
      e.preventDefault();
      // Manual open drawer (No Sale)
      PrinterManager.openDrawer();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      if (window.posSecurity) window.posSecurity.triggerLock();
    }
    if (e.key === 'F11') { e.preventDefault(); handleOpenDrawerRequest(); }
    if (e.key === 'F12') { e.preventDefault(); openCheckoutModal(); }
  });

  btnConnectScale.addEventListener('click', async () => {
    try {
      const res = await window.hardwareAPI.connectScale();
      if (res.success) {
        btnConnectScale.style.backgroundColor = '#00e676';
        btnConnectScale.style.color = '#000';
        btnConnectScale.style.border = 'none';
        btnConnectScale.textContent = 'Scale: Connected';
        if (res.mock) {
          console.warn("Connected to MOCK Scale");
        }
      } else {
        alert("Failed to connect scale: " + res.error);
      }
    } catch (err) {
      alert("Error connecting scale: " + err.message);
    }
  });

  if (window.hardwareAPI) {
    window.hardwareAPI.onScaleWeight((weightInGrams) => {
      const weightInKg = weightInGrams / 1000;
      currentWeight = weightInKg;
      btnConnectScale.textContent = `Scale: ${weightInKg.toFixed(3)}kg`;
      
      // Auto-fill loose item modal if it is open
      if (!barcodeModal.classList.contains('hidden')) {
        barcodeWeightInput.value = weightInGrams;
        updateLooseItemCalculation();
      }
    });
  }

  if (btnOpenDrawer) btnOpenDrawer.addEventListener('click', handleOpenDrawerRequest);
  btnHoldBill.addEventListener('click', handleHoldBill);
  btnRecallBill.addEventListener('click', handleRecallBill);
  btnCloseShift.addEventListener('click', openShiftClose);
  btnAdmin.addEventListener('click', () => {
    window.location.href = 'admin.html';
  });
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      if (window.posSecurity) {
        const res = await window.posSecurity.logout();
        if (res && !res.success) {
          alert(res.error);
        }
      }
    });
  }

  btnCheckout.addEventListener('click', openCheckoutModal);
  btnCloseModal.addEventListener('click', closeCheckoutModal);

  btnHelpShortcuts.addEventListener('click', () => {
    shortcutsModal.classList.remove('hidden');
  });
  btnCloseShortcuts.addEventListener('click', () => {
    shortcutsModal.classList.add('hidden');
  });
  btnCloseRecallModal.addEventListener('click', () => {
    recallBillModal.classList.add('hidden');
  });
  
  btnPayQr.addEventListener('click', () => {
    if (isOffline) return alert("Cannot generate LankaQR in Offline Mode");
    generateLankaQR();
  });
  
  btnPayJustPay.addEventListener('click', () => {
    if (isOffline) return alert("Cannot process JustPay in Offline Mode");
    handleJustPayPayment();
  });
  
  btnPayCash.addEventListener('click', () => {
    paymentSelectionPhase.classList.add('hidden');
    cashTenderPhase.classList.remove('hidden');
    tenderAmountInput.value = '';
    tenderAmountInput.focus();
    changeDueDisplay.textContent = 'Rs. 0.00';
    btnConfirmCash.disabled = true;
  });

  tenderAmountInput.addEventListener('input', () => {
    const totals = pricingEngine.calculateTotal(cart);
    const totalCents = totals.finalPayableCents;
    const tendered = parseFloat(tenderAmountInput.value) || 0;
    const tenderedCents = Math.round(tendered * 100);
    
    if (tenderedCents >= totalCents) {
      const changeCents = tenderedCents - totalCents;
      changeDueDisplay.textContent = `Rs. ${(changeCents / 100).toFixed(2)}`;
      changeDueDisplay.style.color = '#00e676'; // Green
      btnConfirmCash.disabled = false;
    } else {
      changeDueDisplay.textContent = `Rs. 0.00`;
      changeDueDisplay.style.color = '#ff5252'; // Red
      btnConfirmCash.disabled = true;
    }
  });

  tenderAmountInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !btnConfirmCash.disabled) {
      btnConfirmCash.click();
    }
  });

  btnConfirmCash.addEventListener('click', () => processPayment('CASH'));

  btnSubmitShift.addEventListener('click', handleShiftCloseSubmit);
  btnCancelShift.addEventListener('click', () => shiftCloseModal.classList.add('hidden'));
  btnAuthorizeOverride.addEventListener('click', handleSupervisorOverride);
  btnCancelOverride.addEventListener('click', () => supervisorModal.classList.add('hidden'));

  // Phase 11: Naya Potha Modal
  if (btnSubmitNaya) btnSubmitNaya.addEventListener('click', handleNayaSaleSubmit);
  if (btnCancelNaya) btnCancelNaya.addEventListener('click', () => nayaModal.classList.add('hidden'));
  if (nayaNicInput) {
    nayaNicInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleNayaSaleSubmit();
    });
  }

  // Phase 10: Loose Item Modal
  btnPrintBarcode.addEventListener('click', openBarcodeModal);
  btnCancelBarcode.addEventListener('click', () => {
    barcodeModal.classList.add('hidden');
  });
  btnGenerateBarcode.addEventListener('click', generateAndPrintBarcode);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F9') { e.preventDefault(); openBarcodeModal(); }
  });
  
  barcodeWeightInput.addEventListener('input', updateLooseItemCalculation);
  barcodeProductSelect.addEventListener('change', updateLooseItemCalculation);
  barcodeWeightInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') generateAndPrintBarcode();
  });
}

// --- Cart Logic ---
function addToCart(product) {
  const existing = cart.find(item => item.product_id === product.product_id && item.name === product.name);
  if (existing) existing.quantity += 1;
  else cart.push({ ...product, quantity: 1, isWeightBased: product.isWeightBased || false, actualWeight: product.actualWeight || 1 });
  updateCartUI();
}

function updateQuantity(id, action) {
  const item = cart.find(i => i.product_id === id);
  if (item) {
    if (action === 'increase') item.quantity += 1;
    else if (action === 'decrease') {
      item.quantity -= 1;
      if (item.quantity <= 0) cart = cart.filter(i => i.product_id !== id);
    }
    updateCartUI();
  }
}

// --- Phase 10: Loose Item Adder ---
function openBarcodeModal() {
  barcodeModal.classList.remove('hidden');
  barcodeProductSelect.innerHTML = '';
  document.getElementById('loose-item-eq').textContent = '0g x Rs. 0.00 =';
  document.getElementById('loose-item-tot').textContent = 'Rs. 0.00';
  
  // Only show loose/weighable items
  const looseItems = products.filter(p => p.category_id === 'LOOSE' || p.category_id === 'PULSES' || p.category_id === 'RICE');
  for (const item of looseItems) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.sku ? `${item.name_en} (${item.sku})` : item.name_en;
    // Store price in data attribute for easy access
    opt.dataset.price = item.price_cents / 100;
    barcodeProductSelect.appendChild(opt);
  }
  
  // If scale is connected and has a valid weight, auto-fill it
  if (currentWeight > 0) {
    barcodeWeightInput.value = (currentWeight * 1000).toFixed(0);
  } else {
    barcodeWeightInput.value = '';
  }
  
  updateLooseItemCalculation();
  barcodeWeightInput.focus();
}

function updateLooseItemCalculation() {
  const productId = barcodeProductSelect.value;
  const weightGrams = parseFloat(barcodeWeightInput.value) || 0;
  
  const eqEl = document.getElementById('loose-item-eq');
  const totEl = document.getElementById('loose-item-tot');
  
  if (!productId) {
    eqEl.textContent = '0g x Rs. 0.00 =';
    totEl.textContent = 'Rs. 0.00';
    return;
  }
  
  const product = products.find(p => String(p.id) === String(productId));
  if (!product) return;
  
  const pricePerKg = product.price_cents / 100;
  const weightKg = weightGrams / 1000;
  const total = pricePerKg * weightKg;
  
  eqEl.textContent = `${weightGrams}g x Rs. ${pricePerKg.toFixed(2)} =`;
  totEl.textContent = `Rs. ${total.toFixed(2)}`;
}

function generateAndPrintBarcode() { // Renamed logically to addLooseItemToCart, but keeping function name for bindings
  const productId = barcodeProductSelect.value;
  const weightGrams = parseFloat(barcodeWeightInput.value);
  
  if (!productId || isNaN(weightGrams) || weightGrams <= 0) {
    return alert("Weight must be greater than 0g. Please check the scale.");
  }
  
  const product = products.find(p => String(p.id) === String(productId));
  if (!product) return alert("Product not found.");
  
  const weightKg = weightGrams / 1000;
  
  // Add directly to cart
  addToCart({
    ...product,
    actualWeight: weightKg,
    isWeightBased: true,
    name: `${product.name_en} (${weightKg >= 1 ? weightKg.toFixed(2) + 'kg' : weightGrams + 'g'})`
  });
  
  barcodeModal.classList.add('hidden');
  barcodeWeightInput.value = '';
  barcodeInput.focus();
}

function handleEditQuantity() {
  if (cart.length === 0) return alert("Cart is empty.");
  
  // By default, edit the last added item in the cart
  const lastItem = cart[cart.length - 1];
  
  editQtyModal.classList.remove('hidden');
  editQtyInput.value = lastItem.quantity;
  editQtyInput.focus();
  editQtyInput.select();

  const submitHandler = () => {
    const newQty = parseInt(editQtyInput.value, 10);
    if (!isNaN(newQty) && newQty > 0) {
      lastItem.quantity = newQty;
      updateCartUI();
    } else if (newQty === 0) {
      cart = cart.filter(i => i.id !== lastItem.id);
      updateCartUI();
    }
    cleanup();
  };
  
  const cancelHandler = () => { cleanup(); };
  
  const keyHandler = (e) => {
    if (e.key === 'Enter') submitHandler();
    if (e.key === 'Escape') cancelHandler();
  };

  function cleanup() {
    editQtyModal.classList.add('hidden');
    btnSubmitQty.removeEventListener('click', submitHandler);
    btnCancelQty.removeEventListener('click', cancelHandler);
    editQtyInput.removeEventListener('keydown', keyHandler);
    barcodeInput.focus();
  }

  btnSubmitQty.addEventListener('click', submitHandler);
  btnCancelQty.addEventListener('click', cancelHandler);
  editQtyInput.addEventListener('keydown', keyHandler);
}

// --- Phase 11: Naya Potha Flow ---
function openNayaModal() {
  if (cart.length === 0) return alert("Cart is empty.");
  nayaModal.classList.remove('hidden');
  checkoutModal.classList.add('hidden'); // Ensure checkout is hidden
  nayaNicInput.value = '';
  nayaNicInput.focus();
}

async function handleNayaSaleSubmit() {
  const customerId = nayaNicInput.value.trim();
  if (!customerId) return alert("Please enter Customer NIC or Mobile.");
  
  if (!window.posAPI || !window.posAPI.processCreditSale) {
     return alert("Database API not available for Naya Sale.");
  }
  const totals = pricingEngine.calculateTotal(cart);
  const totalCents = totals.finalPayableCents;
  
  try {
    const res = await window.posAPI.processCreditSale({
      nicNumber: nayaNicInput.value,
      amountCents: totalCents,
      customerName: 'Walk-in'
    });
    if (res.success) {
      alert("Credit Sale (Naya) recorded successfully.");
      nayaModal.classList.add('hidden');
      closeCheckoutModal();
      cart = [];
      updateCartUI();
    } else {
      alert("Naya Sale Failed: " + res.error);
    }
  } catch(e) {
    alert("Error saving Naya Sale.");
  }
}

// --- Hold Bill Logic ---
async function handleHoldBill() {
  if (cart.length === 0) return alert("Cart is empty.");
  if (!window.posAPI) return alert("Database API not available.");
  
  const totals = pricingEngine.calculateTotal(cart);
  const totalCents = totals.finalPayableCents;
  
  await window.posAPI.executeDB(
    "INSERT INTO suspended_bills (cart_json, total_amount_cents, cashier_id) VALUES (?, ?, ?)",
    [JSON.stringify(cart), totalCents, "CASHIER_01"]
  );
  
  cart = [];
  updateCartUI();
  alert("Bill Suspended Successfully.");
}

async function handleRecallBill() {
  if (!window.posAPI) return alert("Database API not available.");
  
  const result = await window.posAPI.executeDB("SELECT * FROM suspended_bills ORDER BY suspended_at DESC");
  if (result && result.length > 0) {
    recallBillList.innerHTML = '';
    result.forEach(bill => {
      const parsedCart = JSON.parse(bill.cart_json);
      const itemCount = parsedCart.length;
      
      const itemDiv = document.createElement('div');
      itemDiv.className = 'bill-list-item';
      
      const infoDiv = document.createElement('div');
      infoDiv.innerHTML = `
        <div style="font-weight: bold; font-size: 1.1rem; margin-bottom: 5px;">Time: ${new Date(bill.suspended_at.replace(' ', 'T') + 'Z').toLocaleTimeString('en-US')}</div>
        <div style="color: #aaa; font-size: 0.9rem;">Items: ${itemCount} | Total: Rs. ${(bill.total_amount_cents / 100).toFixed(2)}</div>
      `;
      
      const actionsDiv = document.createElement('div');
      actionsDiv.style.display = 'flex';
      actionsDiv.style.gap = '10px';
      
      const resumeBtn = document.createElement('button');
      resumeBtn.className = 'btn-sys-sync';
      resumeBtn.style.padding = '8px 16px';
      resumeBtn.textContent = 'Resume';
      resumeBtn.onclick = async () => {
        cart = parsedCart;
        updateCartUI();
        await window.posAPI.executeDB("DELETE FROM suspended_bills WHERE id = ?", [bill.id]);
        recallBillModal.classList.add('hidden');
      };
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-danger';
      deleteBtn.style.padding = '8px 16px';
      deleteBtn.textContent = 'Delete';
      deleteBtn.onclick = async () => {
        if(confirm("Are you sure you want to discard this suspended bill?")) {
           await window.posAPI.executeDB("DELETE FROM suspended_bills WHERE id = ?", [bill.id]);
           handleRecallBill(); // Refresh list
        }
      };
      
      actionsDiv.appendChild(resumeBtn);
      actionsDiv.appendChild(deleteBtn);
      
      itemDiv.appendChild(infoDiv);
      itemDiv.appendChild(actionsDiv);
      recallBillList.appendChild(itemDiv);
    });
    
    recallBillModal.classList.remove('hidden');
  } else {
    recallBillModal.classList.add('hidden');
    alert("No suspended bills found.");
  }
}

// --- Shift Close Logic ---
let expectedCashCents = 0; 
let actualCashCentsCache = 0;

async function openShiftClose() {
  if (cart.length > 0) {
    alert("Please complete, hold, or clear the current bill before closing the shift");
    return;
  }

  shiftCloseModal.classList.remove('hidden');
  actualCashInput.value = '';
  actualCashInput.focus();
  
  if (window.posAPI && window.posAPI.getExpectedCash) {
    const res = await window.posAPI.getExpectedCash();
    if (res.success) {
      expectedCashCents = res.expectedCashCents;
    } else {
      expectedCashCents = 0;
    }
  } else {
    expectedCashCents = 500000; // 5000 LKR in cents (Mock)
  }
  
  expectedCashVal.textContent = `LKR ${(expectedCashCents / 100).toFixed(2)}`;
}

function handleShiftCloseSubmit() {
  const actualCashLKR = parseFloat(actualCashInput.value || 0);
  actualCashCentsCache = Math.round(actualCashLKR * 100);
  const varianceCents = Math.abs(expectedCashCents - actualCashCentsCache);
  
  shiftCloseModal.classList.add('hidden');
  
  // Phase 11 rule: variance > 10,000 cents (Rs 100) triggers override
  if (varianceCents > 10000) {
    overrideActionType = 'CLOSE_SHIFT';
    supervisorModalTitle.textContent = "Supervisor Override Required";
    varianceText.textContent = `Variance exceeds Rs. 100 (Variance: LKR ${(varianceCents / 100).toFixed(2)})`;
    supervisorModalDesc.textContent = "Please enter Supervisor PIN to authorize shift closure.";
    supervisorModal.classList.remove('hidden');
    supervisorPinInput.value = '';
    supervisorPinInput.focus();
  } else {
    commitSessionClose();
  }
}

async function handleSupervisorOverride() {
  const pin = supervisorPinInput.value.trim();
  
  if (window.posSecurity) {
    const res = await window.posSecurity.requestOverride(overrideActionType, pin);
    if (res.success) {
      supervisorModal.classList.add('hidden');
      if (overrideActionType === 'CLOSE_SHIFT') {
        commitSessionClose();
      } else if (overrideActionType === 'OPEN_DRAWER') {
        executeOpenDrawer();
      }
    } else {
      alert("Invalid Supervisor PIN");
    }
  } else {
    // Mock override
    if (pin === '9999') {
      supervisorModal.classList.add('hidden');
      if (overrideActionType === 'CLOSE_SHIFT') {
        commitSessionClose();
      } else if (overrideActionType === 'OPEN_DRAWER') {
        executeOpenDrawer();
      }
    } else {
      alert("Invalid Dev PIN");
    }
  }
}

async function commitSessionClose() {
  const varianceCents = actualCashCentsCache - expectedCashCents;
  
  if (window.posAPI && window.posAPI.closeShift) {
    const res = await window.posAPI.closeShift({ actualCashCents: actualCashCentsCache, expectedCashCents });
    if (res.success) {
      alert("Shift Closed Successfully! Z-Report printed.");
      if (window.posSecurity) window.posSecurity.logout();
    } else {
      alert("Failed to close shift: " + res.error);
    }
  } else {
    alert("Shift Closed (Mock). Z-Report printed.");
    if (window.posSecurity) window.posSecurity.logout();
  }
}

// --- WhatsApp API Mock ---
async function mockSendToWhatsAppAPI(mobile, cartData) {
  setTimeout(() => {
    const message = `
*රිසිට්පත - Super Grocery*
--------------------------
මුළු මුදල: රු. ${cartData.total}
ස්තූතියි!`;
    console.log(`[WhatsApp API MOCK] Sending receipt to ${mobile}:\n${message}`);
  }, 0);
}


// --- Payment Logic ---
function openCheckoutModal() {
  if (cart.length === 0) return;
  currentOrderId = `ORD-${Date.now()}`;
  checkoutModal.classList.remove('hidden');
  
  // Reset phases
  paymentSelectionPhase.classList.remove('hidden');
  cashTenderPhase.classList.add('hidden');
  checkoutSuccessPhase.classList.add('hidden');
  qrContainer.classList.add('hidden');
  
  pollingActive = false;
  
  const totals = pricingEngine.calculateTotal(cart);
  const totalLKR = totals.finalPayableCents / 100;
  const mdr = LankaQR.getMDRFee(totalLKR, 'DOMESTIC'); 
  
  if (totalLKR <= 5000) {
    mdrFeeDisplay.textContent = `0% Transaction Fee Applied`;
    mdrFeeDisplay.style.color = "#00e676";
  } else {
    mdrFeeDisplay.textContent = `MDR Fee: LKR ${mdr.toFixed(2)} (1%)`;
    mdrFeeDisplay.style.color = "#ff9800";
  }
}

function closeCheckoutModal() {
  checkoutModal.classList.add('hidden');
  pollingActive = false;
}

async function generateLankaQR() {
  const totals = pricingEngine.calculateTotal(cart);
  const totalLKR = totals.finalPayableCents / 100;
  const tlvString = LankaQR.generateLankaQR(totalLKR, currentOrderId);
  
  import('qrcode').then(QRCode => {
    QRCode.toCanvas(lankaqrCanvas, tlvString, { width: 200, margin: 1, color: { dark: '#000000', light: '#ffffff' } }, async (error) => {
      if (error) console.error(error);
      qrContainer.classList.remove('hidden');
      qrStatusText.textContent = "Waiting for customer to scan...";
      
      if (window.posAPI) {
        await window.posAPI.executeDB(
          "INSERT INTO qr_transactions (invoice_id, merchant_id, terminal_id, amount_cents, transaction_type, payload, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [currentOrderId, "000211", "TERM-01", totals.finalPayableCents, "DYNAMIC", tlvString, "PENDING"]
        );
      }
      startPolling(currentOrderId, 'LANKAQR');
    });
  });
}

function requestOTPInput() {
  return new Promise((resolve) => {
    otpModal.classList.remove('hidden');
    otpInput.value = '';
    otpInput.focus();

    const submitHandler = () => { cleanup(); resolve(otpInput.value); };
    const cancelHandler = () => { cleanup(); resolve(null); };
    const keyHandler = (e) => {
      if (e.key === 'Enter') submitHandler();
      if (e.key === 'Escape') cancelHandler();
    };

    function cleanup() {
      otpModal.classList.add('hidden');
      btnSubmitOtp.removeEventListener('click', submitHandler);
      btnCancelOtp.removeEventListener('click', cancelHandler);
      otpInput.removeEventListener('keydown', keyHandler);
    }

    btnSubmitOtp.addEventListener('click', submitHandler);
    btnCancelOtp.addEventListener('click', cancelHandler);
    otpInput.addEventListener('keydown', keyHandler);
  });
}

async function handleJustPayPayment() {
  const totals = pricingEngine.calculateTotal(cart);
  const total = totals.finalPayableCents / 100;
  
  if (total > 50000) return alert("LIMIT_EXCEEDED: Transaction exceeds Rs. 50,000 JustPay limit.");
  if (total > 10000) {
    const otpValue = await requestOTPInput();
    if (!otpValue) return alert("OTP_CANCELLED: OTP verification required.");
  }

  qrContainer.classList.remove('hidden');
  lankaqrCanvas.style.display = 'none';
  qrStatusText.textContent = "Processing JustPay transaction...";
  
  startPolling(currentOrderId, 'JUSTPAY');
}

async function startPolling(invoiceId, method) {
  if (!window.lankaPay) return;
  
  pollingActive = true;
  const startTime = Date.now();
  const TIMEOUT_MS = 120000;

  while (pollingActive && (Date.now() - startTime < TIMEOUT_MS)) {
    if (isOffline) {
      qrStatusText.textContent = "Network dropped. Polling suspended.";
      pollingActive = false;
      return;
    }

    try {
      const result = await window.lankaPay.checkStatus(invoiceId);
      if (result.status === 'SUCCESS') {
        qrStatusText.textContent = "Payment Successful!";
        qrStatusText.style.color = "#00e676";
        pollingActive = false;
        
        await window.posAPI.executeDB("UPDATE qr_transactions SET status = 'SUCCESS' WHERE invoice_id = ?", [invoiceId]);
        setTimeout(() => processPayment(method), 1000);
        return;
      }
    } catch (e) {
      console.error("Polling error:", e);
    }
    
    await new Promise(r => setTimeout(r, 3000));
  }
  
  if (pollingActive) {
    qrStatusText.textContent = "TIMEOUT: No payment received.";
    qrStatusText.style.color = "#ff5252";
    await window.posAPI.executeDB("UPDATE qr_transactions SET status = 'TIMEOUT' WHERE invoice_id = ?", [invoiceId]);
    pollingActive = false;
  }
}

async function processPayment(method) {
  const totals = pricingEngine.calculateTotal(cart);
  const totalCents = totals.finalPayableCents;
  
  if (window.posAPI) {
    // Phase 10: Deduct stock via FIFO first
    const deductionResult = await window.posAPI.executeFIFODeduction(cart);
    if (!deductionResult.success) {
       alert("Checkout failed: " + deductionResult.error);
       return;
    }
    
    const syncId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({ order_id: currentOrderId, total_cents: totalCents, method, items: cart });
    
    const customerInput = document.getElementById('checkout-customer-input');
    const customerId = customerInput && customerInput.value.trim() ? customerInput.value.trim() : null;
    
    const queries = [
      {
        sql: "INSERT INTO orders (id, customer_id, total_amount_cents, payment_mode) VALUES (?, ?, ?, ?)",
        params: [currentOrderId, customerId, totalCents, method]
      },
      {
        sql: "INSERT INTO sync_queue (id, payload, operation_type, timestamp) VALUES (?, ?, 'INSERT', ?)",
        params: [syncId, payload, timestamp]
      }
    ];

    cart.forEach(item => {
      queries.push({
        sql: "INSERT INTO order_items (order_id, product_id, batch_id, quantity, price_cents) VALUES (?, ?, ?, ?, ?)",
        params: [currentOrderId, item.product_id, 'NA', item.quantity, item.price_cents]
      });
    });

    await window.posAPI.executeTransaction(queries);
  }

  const openDrawer = method === 'CASH' || chkOpenDrawerDigital.checked;
  const tendered = method === 'CASH' ? (parseFloat(tenderAmountInput.value) || 0) : 0;
  try {
    let settings = {};
    if (window.posAPI && window.posAPI.getSettings) {
      const res = await window.posAPI.getSettings();
      if (res.success) settings = res.data;
    }
    const printBuffer = await PrinterManager.printReceipt(currentOrderId, cart, totalCents / 100, openDrawer, tendered, settings);
  } catch (err) {
    console.error("Printer Error:", err);
  }

  // Phase 4: UI Reset & Delay
  paymentSelectionPhase.classList.add('hidden');
  cashTenderPhase.classList.add('hidden');
  qrContainer.classList.add('hidden');
  checkoutSuccessPhase.classList.remove('hidden');

  if (openDrawer) {
    successChangeText.textContent = "Drawer Opened.";
  } else {
    successChangeText.textContent = "Receipt Printed.";
  }

  // Clear cart and wait for 3 seconds before closing
  cart = [];
  updateCartUI();
  
  setTimeout(() => {
    closeCheckoutModal();
    if (lankaqrCanvas) lankaqrCanvas.style.display = 'block';
    if (barcodeInput) barcodeInput.focus();
  }, 3000);
}

async function handleOpenDrawerRequest() {
  if (currentLoggedInUser && currentLoggedInUser.role === 'ADMIN') {
    // Admin can open instantly
    await executeOpenDrawer();
  } else {
    // Cashier needs supervisor override
    overrideActionType = 'OPEN_DRAWER';
    supervisorModalTitle.textContent = "Supervisor Override Required";
    varianceText.textContent = "Manual Cash Drawer Open (No Sale)";
    supervisorModalDesc.textContent = "Please enter Supervisor PIN to authorize drawer opening.";
    supervisorModal.classList.remove('hidden');
    supervisorPinInput.value = '';
    supervisorPinInput.focus();
  }
}

async function executeOpenDrawer() {
  try {
    if (window.hardwareAPI && window.hardwareAPI.openDrawer) {
      const res = await window.hardwareAPI.openDrawer();
      if (!res.success) {
        console.error("Failed to open drawer:", res.error);
        alert("Failed to open drawer: " + res.error);
      } else {
        // Show visual confirmation on the UI
        alert("✅ Cash Drawer Kicked Open Successfully!");
      }
    }
  } catch (err) {
    console.error("Error opening drawer:", err);
  }
}

init();
