import './styles/admin.css';
import './styles/investor-report.css';

document.documentElement.dataset.assets = 'ready';
const sidebar = document.querySelector<HTMLElement>('#admin-sidebar');
const trigger = document.querySelector<HTMLButtonElement>(
  '[data-drawer-trigger]',
);
const closeButton = document.querySelector<HTMLButtonElement>(
  '[data-drawer-close]',
);
const backdrop = document.querySelector<HTMLButtonElement>(
  '[data-drawer-backdrop]',
);
const workspace = document.querySelector<HTMLElement>('[data-admin-workspace]');
if (sidebar && trigger && closeButton && backdrop && workspace) {
  const compact = window.matchMedia('(max-width: 1023px)');
  let open = false;
  const setOpen = (value: boolean, returnFocus = true) => {
    open = value && compact.matches;
    trigger.setAttribute('aria-expanded', String(open));
    sidebar.hidden = compact.matches && !open;
    backdrop.hidden = !open;
    workspace.inert = open;
    document.body.classList.toggle('drawer-open', open);
    if (open) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
      closeButton.focus();
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
      if (returnFocus) trigger.focus();
    }
  };
  const resize = () => {
    const hadFocus = sidebar.contains(document.activeElement);
    trigger.hidden = !compact.matches;
    closeButton.hidden = !compact.matches;
    setOpen(false, compact.matches && hadFocus);
  };
  trigger.addEventListener('click', () => setOpen(!open));
  closeButton.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (event) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
    if (event.key === 'Tab') {
      const targets = [
        ...sidebar.querySelectorAll<HTMLElement>(
          'a[href], button:not([hidden])',
        ),
      ];
      const first = targets[0];
      const last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  compact.addEventListener('change', resize);
  resize();
}
const passwordToggle = document.querySelector<HTMLButtonElement>(
  '[data-admin-password]',
);
const password = document.querySelector<HTMLInputElement>('#admin-password');
if (passwordToggle && password) {
  passwordToggle.hidden = false;
  passwordToggle.addEventListener('click', () => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    passwordToggle.setAttribute('aria-pressed', String(visible));
    passwordToggle.textContent = visible ? 'Hide' : 'Show';
  });
}
const login = document.querySelector<HTMLFormElement>('[data-admin-login]');
const submit = document.querySelector<HTMLButtonElement>('[data-login-submit]');
const progress = document.querySelector<HTMLElement>('[data-login-progress]');
if (login && submit && progress) {
  login.addEventListener('submit', () => {
    submit.disabled = true;
    login.setAttribute('aria-busy', 'true');
    progress.hidden = false;
  });
  window.addEventListener('pageshow', () => {
    submit.disabled = false;
    login.removeAttribute('aria-busy');
    progress.hidden = true;
  });
}

const financeForm = document.querySelector<HTMLFormElement>(
  '[data-finance-transaction]',
);
if (financeForm) {
  const direction =
    financeForm.querySelector<HTMLSelectElement>('[name="direction"]');
  const category =
    financeForm.querySelector<HTMLSelectElement>('[name="category"]');
  const refreshCategories = () => {
    const template = document.querySelector<HTMLTemplateElement>(
      `template[data-finance-categories="${direction?.value}"]`,
    );
    if (!category || !template) return;
    const previous = category.value;
    category.replaceChildren(template.content.cloneNode(true));
    category.value = [...category.options].some(
      (option) => option.value === previous,
    )
      ? previous
      : '';
  };
  direction?.addEventListener('change', refreshCategories);
  window.addEventListener('pageshow', refreshCategories);
}

for (const state of document.querySelectorAll<HTMLSelectElement>(
  '[data-stock-state]',
)) {
  const quantity = state.form?.querySelector<HTMLInputElement>(
    '[data-stock-quantity]',
  );
  if (!quantity) continue;
  const update = () => {
    quantity.required = state.value === 'true';
    if (state.value === 'false') quantity.value = '';
  };
  state.addEventListener('change', update);
  quantity.addEventListener('input', () => {
    if (quantity.value !== '') {
      state.value = 'true';
      quantity.required = true;
    }
  });
  update();
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-print-report]',
)) {
  button.addEventListener('click', () => window.print());
}

for (const scope of document.querySelectorAll<HTMLElement>(
  '[data-bulk-scope]',
)) {
  scope
    .querySelector<HTMLInputElement>('[data-select-all]')
    ?.addEventListener('change', (event) => {
      const selected = (event.currentTarget as HTMLInputElement).checked;
      for (const checkbox of scope.querySelectorAll<HTMLInputElement>(
        'input[name="selected"]',
      ))
        checkbox.checked = selected;
    });
  const form = scope.querySelector<HTMLFormElement>('[data-bulk-stock]');
  if (form) {
    const save = form.querySelector<HTMLButtonElement>('[data-bulk-save]');
    if (save) save.hidden = false;
    form.addEventListener('submit', () => {
      for (const old of form.querySelectorAll('[data-bulk-value]'))
        old.remove();
      for (const selected of scope.querySelectorAll<HTMLInputElement>(
        'input[name="selected"]:checked',
      )) {
        const row = scope.querySelector<HTMLElement>(
          `[data-stock-row="${selected.value}"]`,
        );
        for (const [name, selector] of [
          ['stockKnown', '[data-stock-state]'],
          ['stockQuantity', '[data-stock-quantity]'],
        ]) {
          const control = row?.querySelector<
            HTMLInputElement | HTMLSelectElement
          >(selector!);
          if (!control) continue;
          const hidden = document.createElement('input');
          hidden.type = 'hidden';
          hidden.name = `${name}_${selected.value}`;
          hidden.value = control.value;
          hidden.dataset.bulkValue = '';
          form.append(hidden);
        }
      }
    });
  }
}
