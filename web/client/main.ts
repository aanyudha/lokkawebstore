import './styles/main.css';

// Asset readiness marker
document.documentElement.dataset.assets = 'ready';

// Keep the existing logo fallback compatible with the strict CSP.
document
  .querySelectorAll<HTMLImageElement>('.site-header .brand-logo, .account-logo')
  .forEach((brandLogo) => {
    const fallback = () => {
      brandLogo.src = '/images/lokka_logo.png';
      brandLogo.width = 140;
      brandLogo.height = 70;
    };
    if (brandLogo.complete && !brandLogo.naturalWidth) fallback();
    else brandLogo.addEventListener('error', fallback, { once: true });
  });

// ─── Mobile menu toggle ──────────────────────
const toggle = document.querySelector('[data-menu-toggle]');
if (toggle) {
  const drawer = document.getElementById(
    toggle.getAttribute('aria-controls') ?? '',
  );
  if (drawer) {
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      drawer.hidden = expanded;
    });
    // Escape closes drawer
    document.addEventListener('keydown', (e) => {
      if (
        e.key === 'Escape' &&
        toggle.getAttribute('aria-expanded') === 'true'
      ) {
        toggle.setAttribute('aria-expanded', 'false');
        drawer.hidden = true;
      }
    });
  }
}

// ─── Password visibility toggles ─────────────
document
  .querySelectorAll<HTMLButtonElement>('[data-password-toggle]')
  .forEach((button) => {
    const field = button.closest('.password-field');
    const input = field?.querySelector<HTMLInputElement>(
      '[data-password-input]',
    );
    if (!input) return;
    const showLabel = button.dataset.labelShow ?? button.textContent ?? '';
    const hideLabel = button.dataset.labelHide ?? showLabel;
    button.addEventListener('click', () => {
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(reveal));
      button.setAttribute('aria-label', reveal ? hideLabel : showLabel);
      button.textContent = reveal ? hideLabel : showLabel;
    });
  });

// ─── Variant picker ──────────────────────────
document
  .querySelectorAll<HTMLInputElement>('.variant-picker input')
  .forEach((input) => {
    input.addEventListener('change', () => {
      const price = document.querySelector('[data-variant-price]');
      const quantity =
        document.querySelector<HTMLInputElement>('#product-quantity');
      const addButton =
        document.querySelector<HTMLButtonElement>('[data-add-to-cart]');
      if (quantity) {
        const stockKnown = input.dataset.stockKnown === 'true';
        quantity.max = String(
          Math.max(Number(input.dataset.quantity || '0'), 1),
        );
        if (addButton)
          addButton.disabled =
            !stockKnown || Number(input.dataset.quantity || '0') <= 0;
      }
      const info = document.querySelector('[data-variant-info]');
      if (price) price.textContent = input.dataset.price ?? '';
      const compare = document.querySelector<HTMLElement>(
        '[data-variant-compare]',
      );
      if (compare) {
        compare.textContent = input.dataset.compare ?? '';
        compare.hidden = !input.dataset.compare;
      }
      if (info) {
        info.setAttribute('aria-live', 'polite');
        info.textContent = `SKU: ${input.dataset.sku} · ${input.dataset.stock}`;
      }
    });
  });
