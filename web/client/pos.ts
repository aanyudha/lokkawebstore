import './styles/pos.css';

document.documentElement.dataset.assets = 'ready';
document.querySelectorAll('[data-pos-print-receipt]').forEach((button) => {
  button.addEventListener('click', () => window.print());
});

function formatRupiah(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const str = abs.toString();
  const groups: string[] = [];
  for (let i = str.length; i > 0; i -= 3) {
    const start = Math.max(0, i - 3);
    groups.unshift(str.slice(start, i));
  }
  return sign + 'Rp' + groups.join('.');
}

function toBigInt(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  return BigInt(value.replace(/[^0-9]/g, ''));
}

function escHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

interface VariantDataRaw {
  id: string;
  name: string;
  sku: string;
  price: string;
  stockQuantity: number;
  status: string;
}

interface ProductDataRaw {
  id: string;
  name: string;
  slug: string;
  status: string;
  categoryId: string | null;
  variants: VariantDataRaw[];
  primaryImage: {
    storageKey: string;
    width: number;
    height: number;
  } | null;
}

// ─── POS Login form ────────────────────────────
const posLogin = document.querySelector<HTMLFormElement>('[data-pos-login]');
if (posLogin) {
  const submit = posLogin.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  posLogin.addEventListener('submit', () => {
    if (submit) submit.disabled = true;
    posLogin.setAttribute('aria-busy', 'true');
  });
  window.addEventListener('pageshow', () => {
    if (submit) submit.disabled = false;
    posLogin.removeAttribute('aria-busy');
  });
}

// ─── POS Register ──────────────────────────────
const registerEl = document.querySelector<HTMLElement>('[data-pos-register]');
if (registerEl) {
  initRegister(registerEl);
}

function initRegister(register: HTMLElement) {
  const root = document;
  const searchInput =
    register.querySelector<HTMLInputElement>('[data-pos-search]');
  const searchStatus = register.querySelector<HTMLElement>(
    '[data-pos-search-status]',
  );
  const productGrid = register.querySelector<HTMLElement>(
    '[data-pos-product-grid]',
  );
  const cartLines = register.querySelector<HTMLElement>(
    '[data-pos-cart-lines]',
  );
  const cartCount = register.querySelector<HTMLElement>(
    '[data-pos-cart-count]',
  );
  const subtotalEl = register.querySelector<HTMLElement>('[data-pos-subtotal]');
  const totalEl = register.querySelector<HTMLElement>('[data-pos-total]');
  const cancelBtn =
    register.querySelector<HTMLButtonElement>('[data-pos-cancel]');
  const payBtn = register.querySelector<HTMLButtonElement>('[data-pos-pay]');
  const paymentModal = root.querySelector<HTMLElement>(
    '[data-pos-payment-modal]',
  );
  const paymentDue = paymentModal?.querySelector<HTMLElement>(
    '[data-pos-payment-due]',
  );
  const cashInput = paymentModal?.querySelector<HTMLInputElement>(
    '[data-pos-cash-input]',
  );
  const changeEl =
    paymentModal?.querySelector<HTMLElement>('[data-pos-change]');
  const exactCashBtn = paymentModal?.querySelector<HTMLButtonElement>(
    '[data-pos-exact-cash]',
  );
  const completeBtn = paymentModal?.querySelector<HTMLButtonElement>(
    '[data-pos-complete-sale]',
  );
  const paymentError = paymentModal?.querySelector<HTMLElement>(
    '[data-pos-payment-error]',
  );
  const receiptModal = root.querySelector<HTMLElement>(
    '[data-pos-receipt-modal]',
  );
  const receiptContent = receiptModal?.querySelector<HTMLElement>(
    '[data-pos-receipt-content]',
  );
  const variantModal = root.querySelector<HTMLElement>(
    '[data-pos-variant-modal]',
  );
  const variantList = variantModal?.querySelector<HTMLElement>(
    '[data-pos-variant-list]',
  );
  const variantProductName = variantModal?.querySelector<HTMLElement>(
    '[data-pos-variant-product-name]',
  );
  const csrfInput =
    register.querySelector<HTMLInputElement>('input[name="csrf"]');

  const requiredElements = {
    searchInput,
    productGrid,
    cartLines,
    cartCount,
    subtotalEl,
    totalEl,
    cancelBtn,
    payBtn,
    paymentModal,
    paymentDue,
    cashInput,
    changeEl,
    completeBtn,
    receiptModal,
    receiptContent,
    variantModal,
    variantList,
    variantProductName,
    csrfInput,
  };
  for (const [name, el] of Object.entries(requiredElements)) {
    if (!el) {
      console.error('[POS] Missing required element:', name);
      return;
    }
  }

  type CartItem = {
    variantId: string;
    productId: string;
    productName: string;
    variantName: string;
    sku: string;
    price: bigint;
    quantity: number;
    stock: number;
  };

  type VariantData = {
    id: string;
    name: string;
    sku: string;
    price: bigint;
    stockQuantity: number;
    status: string;
  };

  type ProductData = {
    id: string;
    name: string;
    slug: string;
    status: string;
    categoryId: string | null;
    variants: VariantData[];
    primaryImage: {
      storageKey: string;
      width: number;
      height: number;
    } | null;
  };

  type SaleResultItem = {
    id: string;
    productName: string;
    variantName: string;
    sku: string;
    quantity: number;
    unitPrice: bigint;
    lineTotal: bigint;
  };

  type SaleResultData = {
    saleId: string;
    transactionNumber: string;
    subtotal: bigint;
    discountAmount: bigint;
    total: bigint;
    cashReceived: bigint;
    changeAmount: bigint;
    items: SaleResultItem[];
    completedAt: string;
  };

  let cart: CartItem[] = [];
  let allProducts: ProductData[] = [];
  let searchTimeout: ReturnType<typeof setTimeout>;

  function getCsrf(): string {
    return csrfInput!.value;
  }

  searchInput!.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => searchProducts(searchInput!.value), 200);
  });

  async function searchProducts(query: string) {
    if (searchStatus) searchStatus.textContent = 'Searching...';
    try {
      const res = await fetch(
        `/pos/api/products?q=${encodeURIComponent(query)}`,
      );
      const data = await res.json();
      const rawProducts = (data.products ?? []) as ProductDataRaw[];
      allProducts = rawProducts.map((p) => ({
        ...p,
        variants: p.variants.map((v) => ({
          ...v,
          price: toBigInt(v.price),
        })),
      }));
      renderProducts(allProducts);
      if (searchStatus) {
        searchStatus.textContent = allProducts.length
          ? `${allProducts.length} product${allProducts.length === 1 ? '' : 's'} found`
          : 'No products found';
      }
    } catch {
      if (searchStatus) searchStatus.textContent = 'Search failed';
    }
  }

  function renderProducts(products: ProductData[]) {
    if (!productGrid) return;
    if (!products.length) {
      productGrid.innerHTML =
        '<p class="pos-empty-catalog">No products found.</p>';
      return;
    }
    productGrid.innerHTML = '';
    for (const product of products) {
      const article = document.createElement('article');
      article.className = 'pos-product-card';
      article.setAttribute('role', 'listitem');
      const img = product.primaryImage
        ? `<img src="/media/catalog/${product.primaryImage.storageKey}/thumb.webp" alt="" width="80" height="80" loading="lazy" />`
        : '<div class="pos-product-placeholder">No image</div>';
      const hasVariants = product.variants.length > 1;
      const outOfStock = product.variants.every(
        (v: VariantData) => v.stockQuantity <= 0 || v.status !== 'active',
      );
      article.innerHTML = `
        ${img}
        <div class="pos-product-info">
          <h3>${escHtml(product.name)}</h3>
          ${
            hasVariants
              ? `<button type="button" class="pos-btn pos-btn-small pos-variant-select" data-product-id="${product.id}">${product.variants.length} variants</button>`
              : product.variants[0]
                ? `<span class="pos-product-price">${formatRupiah(toBigInt(product.variants[0].price))}</span>
                  <span class="pos-product-stock ${product.variants[0].stockQuantity <= 0 ? 'out-of-stock' : ''}">${product.variants[0].stockQuantity <= 0 ? 'OUT OF STOCK' : `Stock: ${product.variants[0].stockQuantity}`}</span>`
                : ''
          }
        </div>
      `;
      if (outOfStock) {
        article.classList.add('pos-out-of-stock');
      } else if (hasVariants) {
        const btn = article.querySelector('.pos-variant-select');
        btn?.addEventListener('click', () => openVariantModal(product));
      } else if (product.variants[0] && product.variants[0].stockQuantity > 0) {
        const v = product.variants[0];
        article.addEventListener('click', () =>
          addToCart({
            variantId: v.id,
            productId: product.id,
            productName: product.name,
            variantName: v.name,
            sku: v.sku,
            price: v.price,
            stock: v.stockQuantity,
          }),
        );
        article.style.cursor = 'pointer';
      }
      productGrid.appendChild(article);
    }
  }

  function openVariantModal(product: ProductData) {
    if (!variantProductName || !variantList || !variantModal) return;
    variantProductName.textContent = product.name;
    variantList.innerHTML = '';
    for (const v of product.variants) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pos-variant-option';
      btn.setAttribute('role', 'option');
      btn.disabled = v.stockQuantity <= 0 || v.status !== 'active';
      btn.innerHTML = `
        <span class="pos-variant-name">${escHtml(v.name)}</span>
        <span class="pos-variant-sku">${escHtml(v.sku)}</span>
        <span class="pos-variant-price">${formatRupiah(toBigInt(v.price))}</span>
        <span class="pos-variant-stock ${v.stockQuantity <= 0 ? 'out-of-stock' : ''}">${v.stockQuantity <= 0 ? 'OUT OF STOCK' : `Stock: ${v.stockQuantity}`}</span>
      `;
      if (v.stockQuantity > 0 && v.status === 'active') {
        btn.addEventListener('click', () => {
          addToCart({
            variantId: v.id,
            productId: product.id,
            productName: product.name,
            variantName: v.name,
            sku: v.sku,
            price: v.price,
            stock: v.stockQuantity,
          });
          closeVariantModal();
        });
      }
      variantList.appendChild(btn);
    }
    variantModal.hidden = false;
    variantList
      .querySelector<HTMLButtonElement>('button:not([disabled])')
      ?.focus();
  }

  function closeVariantModal() {
    if (variantModal) variantModal.hidden = true;
  }

  variantModal
    ?.querySelector('[data-pos-variant-close]')
    ?.addEventListener('click', closeVariantModal);
  variantModal
    ?.querySelector('[data-pos-variant-close-btn]')
    ?.addEventListener('click', closeVariantModal);

  function addToCart(item: Omit<CartItem, 'quantity'>) {
    const existing = cart.find((c) => c.variantId === item.variantId);
    if (existing) {
      if (existing.quantity < existing.stock) {
        existing.quantity++;
      }
    } else {
      cart.push({ ...item, quantity: 1 });
    }
    renderCart();
  }

  function updateQuantity(variantId: string, delta: number) {
    const item = cart.find((c) => c.variantId === variantId);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
      cart = cart.filter((c) => c.variantId !== variantId);
    } else if (item.quantity > item.stock) {
      item.quantity = item.stock;
    }
    renderCart();
  }

  function removeItem(variantId: string) {
    cart = cart.filter((c) => c.variantId !== variantId);
    renderCart();
  }

  function renderCart() {
    if (
      !cartLines ||
      !cartCount ||
      !subtotalEl ||
      !totalEl ||
      !cancelBtn ||
      !payBtn
    )
      return;
    if (!cart.length) {
      cartLines.innerHTML = '<p class="pos-empty-cart">No items in sale.</p>';
      cartCount.textContent = '0 items';
      subtotalEl.textContent = formatRupiah(0n);
      totalEl.textContent = formatRupiah(0n);
      cancelBtn.disabled = true;
      payBtn.disabled = true;
      return;
    }
    let subtotal = 0n;
    let totalQty = 0;
    cartLines.innerHTML = '';
    for (const item of cart) {
      const lineTotal = item.price * BigInt(item.quantity);
      subtotal += lineTotal;
      totalQty += item.quantity;
      const div = document.createElement('div');
      div.className = 'pos-cart-line';
      div.setAttribute('role', 'listitem');
      div.innerHTML = `
        <div class="pos-cart-line-info">
          <span class="pos-cart-line-name">${escHtml(item.productName)} / ${escHtml(item.variantName)}</span>
          <span class="pos-cart-line-sku">${escHtml(item.sku)}</span>
          <span class="pos-cart-line-unit">${formatRupiah(item.price)}</span>
        </div>
        <div class="pos-cart-line-controls">
          <button type="button" class="pos-qty-btn" data-action="decrease" data-variant="${item.variantId}" aria-label="Decrease quantity">&minus;</button>
          <span class="pos-qty-value" aria-label="Quantity">${item.quantity}</span>
          <button type="button" class="pos-qty-btn" data-action="increase" data-variant="${item.variantId}" aria-label="Increase quantity" ${item.quantity >= item.stock ? 'disabled' : ''}>+</button>
          <button type="button" class="pos-remove-btn" data-action="remove" data-variant="${item.variantId}" aria-label="Remove ${escHtml(item.variantName)}">&times;</button>
        </div>
        <div class="pos-cart-line-total">${formatRupiah(lineTotal)}</div>
      `;
      cartLines.appendChild(div);
    }
    cartCount.textContent = `${totalQty} item${totalQty === 1 ? '' : 's'}`;
    subtotalEl.textContent = formatRupiah(subtotal);
    totalEl.textContent = formatRupiah(subtotal);
    cancelBtn.disabled = false;
    payBtn.disabled = false;
  }

  cartLines!.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const variantId = target.getAttribute('data-variant');
    if (!variantId) return;
    const action = target.getAttribute('data-action');
    if (action === 'decrease') updateQuantity(variantId, -1);
    else if (action === 'increase') updateQuantity(variantId, 1);
    else if (action === 'remove') removeItem(variantId);
  });

  cancelBtn!.addEventListener('click', () => {
    if (!confirm('Cancel this sale?')) return;
    cart = [];
    renderCart();
  });

  payBtn!.addEventListener('click', () => {
    if (
      !cart.length ||
      !paymentModal ||
      !paymentDue ||
      !cashInput ||
      !changeEl ||
      !completeBtn
    )
      return;
    const subtotal = cart.reduce(
      (sum, item) => sum + item.price * BigInt(item.quantity),
      0n,
    );
    paymentDue.textContent = formatRupiah(subtotal);
    cashInput.value = '';
    changeEl.textContent = formatRupiah(0n);
    if (paymentError) {
      paymentError.textContent = '';
      paymentError.hidden = true;
    }
    completeBtn.disabled = true;
    paymentModal.hidden = false;
    cashInput.focus();
  });

  cashInput!.addEventListener('input', () => {
    const raw = cashInput!.value.replace(/[^0-9]/g, '');
    const cashVal = raw ? BigInt(raw) : 0n;
    const subtotal = cart.reduce(
      (sum, item) => sum + item.price * BigInt(item.quantity),
      0n,
    );
    const change = cashVal >= subtotal ? cashVal - subtotal : 0n;
    if (changeEl) changeEl.textContent = formatRupiah(change);
    if (completeBtn) completeBtn.disabled = cashVal < subtotal;
  });

  if (exactCashBtn) {
    exactCashBtn.addEventListener('click', () => {
      const subtotal = cart.reduce(
        (sum, item) => sum + item.price * BigInt(item.quantity),
        0n,
      );
      if (cashInput) {
        cashInput.value = subtotal.toString();
        cashInput.dispatchEvent(new Event('input'));
      }
    });
  }

  paymentModal
    ?.querySelector('[data-pos-payment-close]')
    ?.addEventListener('click', closePaymentModal);
  paymentModal
    ?.querySelector('[data-pos-payment-close-btn]')
    ?.addEventListener('click', closePaymentModal);

  function closePaymentModal() {
    if (paymentModal) paymentModal.hidden = true;
  }

  completeBtn!.addEventListener('click', async () => {
    if (!paymentModal || !cashInput || !completeBtn) return;
    const subtotal = cart.reduce(
      (sum, item) => sum + item.price * BigInt(item.quantity),
      0n,
    );
    const cashRaw = cashInput.value.replace(/[^0-9]/g, '');
    const cashVal = cashRaw ? BigInt(cashRaw) : 0n;
    if (cashVal < subtotal) return;

    completeBtn.disabled = true;
    completeBtn.textContent = 'Processing...';

    try {
      const res = await fetch('/pos/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          csrf: getCsrf(),
          items: JSON.stringify(
            cart.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
            })),
          ),
          cashTendered: String(cashVal),
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        if (paymentError) {
          paymentError.textContent = result.error || 'Sale failed';
          paymentError.hidden = false;
        }
        completeBtn.disabled = false;
        completeBtn.textContent = 'Complete sale';
        return;
      }
      showReceipt(result);
      cart = [];
      renderCart();
      closePaymentModal();
    } catch {
      if (paymentError) {
        paymentError.textContent = 'Sale failed. Please try again.';
        paymentError.hidden = false;
      }
      completeBtn.disabled = false;
      completeBtn.textContent = 'Complete sale';
    }
  });

  function showReceipt(sale: SaleResultData) {
    if (!receiptContent || !receiptModal) return;
    const itemsHtml = sale.items
      .map(
        (item: SaleResultItem) => `
        <tr>
          <td>${escHtml(item.productName)} / ${escHtml(item.variantName)}<br /><small>${escHtml(item.sku)}</small></td>
          <td>${item.quantity}</td>
          <td>${formatRupiah(toBigInt(item.unitPrice))}</td>
          <td>${formatRupiah(toBigInt(item.lineTotal))}</td>
        </tr>
      `,
      )
      .join('');
    receiptContent.innerHTML = `
      <div class="pos-receipt-meta">
        <p><strong>Transaction:</strong> ${escHtml(sale.transactionNumber)}</p>
        <p><strong>Date:</strong> ${new Date(sale.completedAt).toLocaleString('id-ID')}</p>
        <p><strong>Source:</strong> POS</p>
        <p><strong>Cashier:</strong> ${escHtml(document.querySelector('.pos-cashier-name')?.textContent ?? '')}</p>
      </div>
      <table class="pos-receipt-items">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div class="pos-receipt-totals">
        <div class="pos-receipt-row"><span>Subtotal</span><span>${formatRupiah(toBigInt(sale.subtotal))}</span></div>
        <div class="pos-receipt-row pos-receipt-total"><span>Total</span><span>${formatRupiah(toBigInt(sale.total))}</span></div>
        <div class="pos-receipt-row"><span>Cash received</span><span>${formatRupiah(toBigInt(sale.cashReceived))}</span></div>
        <div class="pos-receipt-row"><span>Change</span><span>${formatRupiah(toBigInt(sale.changeAmount))}</span></div>
      </div>
    `;
    receiptModal.hidden = false;
    receiptModal
      ?.querySelector('[data-pos-receipt-close]')
      ?.addEventListener('click', closeReceiptModal, { once: true });
    receiptModal
      ?.querySelector('[data-pos-new-sale]')
      ?.addEventListener('click', closeReceiptModal, { once: true });
  }

  function closeReceiptModal() {
    if (receiptModal) receiptModal.hidden = true;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (paymentModal && !paymentModal.hidden) closePaymentModal();
      else if (receiptModal && !receiptModal.hidden) closeReceiptModal();
      else if (variantModal && !variantModal.hidden) closeVariantModal();
    }
  });

  searchProducts('');
}
