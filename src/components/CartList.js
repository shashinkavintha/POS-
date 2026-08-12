class CartList extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.items = [];
  }

  setItems(items) {
    this.items = items;
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        .cart-container {
          flex: 1;
          overflow-y: auto;
          padding: 1rem;
        }
        .cart-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 0;
          border-bottom: 1px solid var(--border-color, #333);
        }
        .item-info {
          flex: 2;
        }
        .item-name {
          font-weight: bold;
        }
        .item-qty-controls {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .btn-qty {
          background-color: #333;
          color: white;
          border: none;
          border-radius: 6px;
          width: 40px;
          height: 40px;
          cursor: pointer;
          font-size: 1.4rem;
          transition: background-color 0.2s ease;
        }
        .btn-qty:hover {
          background-color: #555;
        }
        .item-subtotal {
          flex: 1;
          text-align: right;
          color: #ffffff;
        }
      </style>
      <div class="cart-container">
        ${this.items.length === 0 ? `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #aaa; text-align: center; margin-top: 2rem;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 64px; height: 64px; margin-bottom: 1rem; opacity: 0.5;">
              <circle cx="9" cy="21" r="1"></circle>
              <circle cx="20" cy="21" r="1"></circle>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
            </svg>
            <p style="margin: 0; font-size: 1.1rem; line-height: 1.6;">Your cart is empty!<br>Press [F2] to scan items</p>
          </div>
        ` : this.items.map(item => `
          <div class="cart-item">
            <div class="item-info">
              <div class="item-name">${item.name}</div>
              <div class="item-price">Rs. ${(item.price_cents / 100).toFixed(2)} x ${item.quantity}</div>
            </div>
            <div class="item-qty-controls">
              <button class="btn-qty minus" data-id="${item.product_id}">-</button>
              <span>${item.quantity}</span>
              <button class="btn-qty plus" data-id="${item.product_id}">+</button>
            </div>
            <div class="item-subtotal">
              Rs. ${((item.price_cents * item.quantity) / 100).toFixed(2)}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    this.shadowRoot.querySelectorAll('.btn-qty').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        const action = e.target.classList.contains('plus') ? 'increase' : 'decrease';
        this.dispatchEvent(new CustomEvent('update-quantity', {
          detail: { id, action },
          bubbles: true,
          composed: true
        }));
      });
    });
  }
}

customElements.define('cart-list', CartList);
