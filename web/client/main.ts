import './styles/main.css';

// Asset readiness marker
document.documentElement.dataset.assets = 'ready';

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

// ─── Variant picker ──────────────────────────
document
  .querySelectorAll<HTMLInputElement>('.variant-picker input')
  .forEach((input) => {
    input.addEventListener('change', () => {
      const price = document.querySelector('[data-variant-price]');
      const info = document.querySelector('[data-variant-info]');
      if (price) price.textContent = input.dataset.price ?? '';
      if (info) {
        info.setAttribute('aria-live', 'polite');
        info.textContent = `SKU: ${input.dataset.sku} · ${input.dataset.stock}`;
      }
    });
  });
