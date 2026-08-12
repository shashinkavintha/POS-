class ProductGrid extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.products = [];
  }

  setProducts(products) {
    this.products = products;
    this.render();
  }

  getColorForProduct(name) {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('dhal') || lowerName.includes('parippu')) return '#ffeb3b'; // Yellow
    if (lowerName.includes('sugar') || lowerName.includes('seeni')) return '#e0e0e0'; // Light Gray
    if (lowerName.includes('leaf') || lowerName.includes('gotukola')) return '#4caf50'; // Green
    if (lowerName.includes('rice') || lowerName.includes('samba') || lowerName.includes('nadu')) return '#ffcc80'; // Light Orange
    if (lowerName.includes('milk')) return '#bbdefb'; // Light Blue
    return 'var(--border-color)'; // Default
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 1rem;
          padding: 1rem 0;
          overflow-y: auto;
          max-height: calc(100vh - 180px);
        }
        .card {
          background-color: #1e1e1e;
          border: 1px solid #2d2d2d; 
          border-radius: 12px;
          padding: 16px;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
          transition: transform 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;
          position: relative;
          overflow: hidden;
          text-align: center;
          cursor: pointer;
          min-height: 120px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .card:hover {
          transform: translateY(-3px);
          background-color: #282828;
          border-color: #444;
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
        }
        .card:active {
          transform: scale(0.97);
          transition: transform 0.1s ease;
        }
        .price {
          color: #ffffff;
          font-weight: bold;
          margin-top: 0.5rem;
          font-size: 1.2rem;
        }
        .name {
          color: #aaaaaa;
          font-size: 1.1rem;
          font-weight: 500;
        }
      </style>
      <div class="grid">
        ${this.products.map(p => {
          const color = this.getColorForProduct(p.name);
          return `
          <div class="card" data-id="${p.product_id}">
            <div class="name">${p.name}</div>
            <div class="price">Rs. ${(p.price_cents / 100).toFixed(2)}</div>
          </div>
          `;
        }).join('')}
      </div>
    `;

    this.shadowRoot.querySelectorAll('.card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        const product = this.products.find(p => p.product_id === id);
        this.dispatchEvent(new CustomEvent('product-selected', {
          detail: product,
          bubbles: true,
          composed: true
        }));
      });
    });
  }
}

customElements.define('product-grid', ProductGrid);
