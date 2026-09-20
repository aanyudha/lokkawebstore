import { FormError, type Form } from '../catalog/validation.js';

/**
 * Deterministic customer email normalization.
 *
 * Policy: trim surrounding whitespace and lowercase the whole address.
 *
 * We deliberately do NOT apply provider-specific transformations (for example
 * Gmail dot removal or plus-address stripping) because those can merge
 * genuinely distinct identities. The normalized value is what must stay
 * unique; the trimmed original is kept for display.
 */
export function normalizeCustomerEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length === 0 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw new FormError('email', 'account.error.emailInvalid');
  return email;
}

export function customerName(form: Form): string {
  const value = form.name;
  if (typeof value !== 'string')
    throw new FormError('name', 'account.error.nameRequired');
  const name = value.trim();
  if (name.length === 0 || name.length > 150)
    throw new FormError('name', 'account.error.nameRequired');
  return name;
}

export function customerEmail(form: Form): string {
  const value = form.email;
  if (typeof value !== 'string')
    throw new FormError('email', 'account.error.emailInvalid');
  return normalizeCustomerEmail(value);
}

/** Passwords are never trimmed or coerced; the raw string is validated. */
export function customerPassword(
  form: Form,
  field = 'password',
  min = 10,
  max = 128,
): string {
  const value = form[field];
  if (typeof value !== 'string' || value.length < min || value.length > max)
    throw new FormError(field, 'account.error.passwordLength');
  return value;
}

export function confirmPassword(form: Form, password: string): void {
  if (form.confirmPassword !== password)
    throw new FormError('confirmPassword', 'account.error.passwordMismatch');
}

/**
 * Open-redirect protection. Only same-site account paths are approved.
 *
 * Rejects absolute URLs, scheme-relative URLs (`//evil.test`), backslashes,
 * control characters and any path outside `/account` and `/id/akun`.
 */
export function safeReturnPath(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 200 ||
    value[0] !== '/' ||
    value[1] === '/' ||
    value[1] === '\\' ||
    value.includes('\\') ||
    [...value].some((char) => {
      const code = char.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })
  )
    return null;
  const pathname = value.split(/[?#]/)[0] ?? '';
  const approved = ['/account', '/id/akun'];
  if (
    !approved.some(
      (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
    )
  )
    return null;
  return value;
}
