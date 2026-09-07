import './styles/main.css';
document.documentElement.dataset.assets = 'ready';
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
