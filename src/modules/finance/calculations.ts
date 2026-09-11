import { FormError, textField, type Form } from '../catalog/validation.js';

export const MAX_RUPIAH = 9223372036854775807n;
export function rupiah(form: Form, field: string, signed = false): bigint {
  const raw = textField(form, field, 20, true);
  if (!(signed ? /^-?\d+$/ : /^\d+$/).test(raw))
    throw new FormError(field, 'Use whole Rupiah digits only.');
  const value = BigInt(raw);
  if (value > MAX_RUPIAH || value < -MAX_RUPIAH)
    throw new FormError(field, 'Amount exceeds the supported Rupiah range.');
  return value;
}
export function ceilDiv(value: bigint, divisor: bigint): bigint {
  if (value < 0n || divisor <= 0n)
    throw new FormError('amount', 'Invalid allocation.');
  return (value + divisor - 1n) / divisor;
}
export function percentage(form: Form, field: string): number {
  const raw = textField(form, field, 9, true);
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(raw))
    throw new FormError(
      field,
      'Use a nonnegative percentage with at most two decimals.',
    );
  const [whole, fraction = ''] = raw.split('.');
  return Number(BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0')));
}
export function percentText(bps: bigint | number): string {
  const value = BigInt(bps);
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
export function month(value: string): string {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) ||
    value < '2000-01' ||
    value > '9999-12'
  )
    throw new FormError('periodMonth', 'Choose a valid month (2000–9999).');
  return `${value}-01`;
}
export function dateInput(
  form: Form,
  field: string,
  optional = false,
): string | null {
  const raw = textField(form, field, 10, !optional);
  if (!raw && optional) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
    !Number.isFinite(Date.parse(raw)) ||
    new Date(raw).toISOString().slice(0, 10) !== raw
  )
    throw new FormError(field, 'Choose a valid date.');
  month(raw.slice(0, 7));
  return raw;
}
type Recognizable = {
  active: boolean;
  startDate: string;
  endDate: string | null;
  amountRupiah: bigint;
  billingFrequency: 'MONTHLY' | 'ANNUAL' | 'ONE_TIME';
  recognitionMethod: 'SPREAD_MONTHLY' | 'CHARGE_IN_BILLING_PERIOD';
};
export function recognizedAmount(
  cost: Recognizable,
  periodMonth: string,
): bigint {
  const current = periodMonth.slice(0, 7);
  const start = cost.startDate.slice(0, 7);
  if (
    !cost.active ||
    current < start ||
    (cost.endDate && current > cost.endDate.slice(0, 7))
  )
    return 0n;
  const elapsed =
    (Number(current.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
    Number(current.slice(5)) -
    Number(start.slice(5));
  if (cost.billingFrequency === 'MONTHLY') return cost.amountRupiah;
  if (cost.billingFrequency === 'ONE_TIME')
    return elapsed === 0 ? cost.amountRupiah : 0n;
  const offset = BigInt(elapsed % 12);
  if (cost.recognitionMethod === 'CHARGE_IN_BILLING_PERIOD')
    return offset === 0n ? cost.amountRupiah : 0n;
  return cost.amountRupiah / 12n + (offset < cost.amountRupiah % 12n ? 1n : 0n);
}
export function periodTotals(
  opening: bigint,
  items: { recognizedAmountRupiah: bigint; sourceType: string }[],
  recovery: { amountRupiah: bigint }[],
  forecast: number,
) {
  const current = items
    .filter((i) => i.sourceType === 'RECURRING_COST')
    .reduce((s, i) => s + i.recognizedAmountRupiah, 0n);
  const adjustments = items
    .filter((i) => i.sourceType === 'MANUAL_ADJUSTMENT')
    .reduce((s, i) => s + i.recognizedAmountRupiah, 0n);
  const target = opening + current + adjustments;
  const recovered = recovery.reduce((s, i) => s + i.amountRupiah, 0n);
  const remaining = target > recovered ? target - recovered : 0n;
  return {
    opening,
    current,
    adjustments,
    target,
    recovered,
    remaining,
    perUnit: ceilDiv(remaining, BigInt(forecast)),
  };
}
export type PricingProfile = {
  method: 'TARGET_MARGIN' | 'MARKUP';
  profitBps: number;
  taxBps: number;
  roundingRupiah: bigint;
};
export const defaultProfile: PricingProfile = {
  method: 'TARGET_MARGIN',
  profitBps: 0,
  taxBps: 0,
  roundingRupiah: 1000n,
};
export function recommend(cost: bigint, profile: PricingProfile): bigint {
  const profit = BigInt(profile.profitBps),
    tax = BigInt(profile.taxBps);
  if (
    cost < 0n ||
    profit < 0n ||
    tax < 0n ||
    tax >= 10000n ||
    (profile.method === 'TARGET_MARGIN' && profit + tax >= 10000n) ||
    ![1n, 1000n, 5000n, 10000n].includes(profile.roundingRupiah)
  )
    throw new FormError(
      'profitPercent',
      'Margin plus reserve must be below 100%; check rounding and nonnegative inputs.',
    );
  const numerator =
    profile.method === 'TARGET_MARGIN'
      ? cost * 10000n
      : cost * (10000n + profit);
  const denominator =
    profile.method === 'TARGET_MARGIN' ? 10000n - profit - tax : 10000n - tax;
  return (
    ceilDiv(numerator, denominator * profile.roundingRupiah) *
    profile.roundingRupiah
  );
}
export function economics(price: bigint, cost: bigint, taxBps: number) {
  const reserve = ceilDiv(price * BigInt(taxBps), 10000n);
  const profit = price - cost - reserve;
  return {
    price,
    reserve,
    profit,
    margin: price > 0n ? percentText((profit * 10000n) / price) : null,
  };
}
