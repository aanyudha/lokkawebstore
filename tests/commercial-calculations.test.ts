import { describe, expect, it } from 'vitest';
import {
  ceilDiv,
  dateInput,
  defaultProfile,
  economics,
  month,
  percentage,
  periodTotals,
  recognizedAmount,
  recommend,
  rupiah,
} from '../src/modules/finance/calculations.js';
import { formatIdr, variantInput } from '../src/modules/catalog/validation.js';
const variant = {
  name: 'M',
  sku: 'M',
  price: '695000',
  weightGrams: '450',
  stockQuantity: '0',
  sortOrder: '0',
  status: 'active',
};
const annual = {
  active: true,
  startDate: '2026-09-15',
  endDate: null,
  amountRupiah: 240005n,
  billingFrequency: 'ANNUAL' as const,
  recognitionMethod: 'SPREAD_MONTHLY' as const,
};
describe('integer financial calculations', () => {
  it.each([
    ['200000', 5000, 0, 'TARGET_MARGIN', '400000'],
    ['200000', 5000, 0, 'MARKUP', '300000'],
    ['200000', 5000, 50, 'TARGET_MARGIN', '404041'],
    ['200000', 5000, 50, 'MARKUP', '301508'],
  ] as const)(
    'cost %s profit %s reserve %s %s => %s',
    (cost, profitBps, taxBps, method, price) => {
      expect(
        recommend(BigInt(cost), {
          method,
          profitBps,
          taxBps,
          roundingRupiah: 1n,
        }),
      ).toBe(BigInt(price));
    },
  );
  it.each([1n, 1000n, 5000n, 10000n])(
    'rounds upward by %s',
    (roundingRupiah) => {
      const result = recommend(401010n, { ...defaultProfile, roundingRupiah });
      expect(result % roundingRupiah).toBe(0n);
      expect(result).toBeGreaterThanOrEqual(401010n);
      expect(result - 401010n).toBeLessThan(roundingRupiah);
    },
  );
  it('preserves amounts beyond JS Number precision', () => {
    expect(
      recommend(9007199254740993n, {
        ...defaultProfile,
        profitBps: 5000,
        roundingRupiah: 1n,
      }),
    ).toBe(18014398509481986n);
    expect(rupiah({ amount: '9223372036854775807' }, 'amount')).toBe(
      9223372036854775807n,
    );
  });
  it.each(['1.5', '1e6', '-1', 'Infinity', '9223372036854775808'])(
    'rejects invalid money %s',
    (amount) => expect(() => rupiah({ amount }, 'amount')).toThrow(),
  );
  it.each([
    [10000, 0],
    [9900, 100],
    [5000, 5000],
  ])('rejects margin plus reserve >= 100%', (profitBps, taxBps) =>
    expect(() =>
      recommend(1n, { ...defaultProfile, profitBps, taxBps }),
    ).toThrow(),
  );
  it('uses exact basis points and conservative reserve', () => {
    expect(percentage({ tax: '0.50' }, 'tax')).toBe(50);
    expect(percentage({ profit: '50.00' }, 'profit')).toBe(5000);
    expect(() => percentage({ tax: '0.005' }, 'tax')).toThrow();
    expect(economics(695000n, 210450n, 50)).toEqual({
      price: 695000n,
      reserve: 3475n,
      profit: 481075n,
      margin: '69.21',
    });
    expect(economics(1n, 2n, 1).profit).toBe(-2n);
    expect(economics(0n, 200n, 0).margin).toBeNull();
  });
  it('ceiling does not drift or divide by zero', () => {
    expect(ceilDiv(545000n, 100n)).toBe(5450n);
    expect(ceilDiv(545001n, 100n)).toBe(5451n);
    expect(() => ceilDiv(1n, 0n)).toThrow();
  });
  it('derives target, partial/full recovery and no negative carry', () => {
    const items = [
      { recognizedAmountRupiah: 470000n, sourceType: 'RECURRING_COST' },
      { recognizedAmountRupiah: 10000n, sourceType: 'MANUAL_ADJUSTMENT' },
      { recognizedAmountRupiah: -10000n, sourceType: 'MANUAL_ADJUSTMENT' },
    ];
    const partial = periodTotals(
      75000n,
      items,
      [{ amountRupiah: 400000n }],
      100,
    );
    expect(partial.target).toBe(545000n);
    expect(partial.remaining).toBe(145000n);
    expect(partial.perUnit).toBe(1450n);
    expect(
      periodTotals(75000n, items, [{ amountRupiah: 545000n }], 100).remaining,
    ).toBe(0n);
    expect(
      periodTotals(75000n, items, [{ amountRupiah: 600000n }], 100).remaining,
    ).toBe(0n);
  });
});
describe('recognition calendar', () => {
  it('spreads annual remainder in first cycle months and repeats deterministically', () => {
    let sum = 0n;
    for (let offset = 0; offset < 12; offset++) {
      const date = new Date(Date.UTC(2026, 8 + offset, 1))
        .toISOString()
        .slice(0, 10);
      const amount = recognizedAmount(annual, date);
      expect(amount).toBe(offset < 5 ? 20001n : 20000n);
      sum += amount;
    }
    expect(sum).toBe(annual.amountRupiah);
    expect(recognizedAmount(annual, '2027-09-01')).toBe(20001n);
  });
  it('recognizes monthly and one-time costs without daily proration', () => {
    expect(
      recognizedAmount(
        { ...annual, billingFrequency: 'MONTHLY' },
        '2026-09-01',
      ),
    ).toBe(240005n);
    expect(
      recognizedAmount(
        { ...annual, billingFrequency: 'ONE_TIME' },
        '2026-09-01',
      ),
    ).toBe(240005n);
    expect(
      recognizedAmount(
        { ...annual, billingFrequency: 'ONE_TIME' },
        '2026-10-01',
      ),
    ).toBe(0n);
  });
  it('charges annual billing anniversary only', () => {
    const cost = {
      ...annual,
      recognitionMethod: 'CHARGE_IN_BILLING_PERIOD' as const,
    };
    expect(recognizedAmount(cost, '2026-09-01')).toBe(240005n);
    expect(recognizedAmount(cost, '2026-10-01')).toBe(0n);
    expect(recognizedAmount(cost, '2027-09-01')).toBe(240005n);
  });
  it('honors inactive, start and inclusive end month', () => {
    expect(recognizedAmount(annual, '2026-08-01')).toBe(0n);
    expect(recognizedAmount({ ...annual, active: false }, '2026-09-01')).toBe(
      0n,
    );
    expect(
      recognizedAmount({ ...annual, endDate: '2026-09-15' }, '2026-09-01'),
    ).toBe(20001n);
    expect(
      recognizedAmount({ ...annual, endDate: '2026-09-15' }, '2026-10-01'),
    ).toBe(0n);
  });
  it.each(['2026-13', '2026-00', '26-09', '2026-9'])(
    'rejects malformed month %s',
    (value) => expect(() => month(value)).toThrow(),
  );
  it('rejects calendar rollover', () =>
    expect(() => dateInput({ date: '2026-02-30' }, 'date')).toThrow());
});
describe('variant commercial validation', () => {
  it('formats EN and ID without precision loss', () => {
    expect(formatIdr(695000n, 'en')).toBe('Rp695,000');
    expect(formatIdr(695000n, 'id')).toBe('Rp695.000');
    expect(formatIdr(9007199254740993n, 'en')).toBe('Rp9,007,199,254,740,993');
  });
  it('accepts positive active prices, weight and optional comparison', () =>
    expect(variantInput(variant).price).toBe(695000n));
  it.each(['695000', '694999'])('rejects compare-at %s', (compareAtPrice) =>
    expect(() => variantInput({ ...variant, compareAtPrice })).toThrow(),
  );
  it.each(['0', '', '1.5', '450 gram', '0.45kg'])(
    'rejects active gram weight %s',
    (weightGrams) =>
      expect(() => variantInput({ ...variant, weightGrams })).toThrow(),
  );
  it('permits incomplete inactive draft pricing and weight', () =>
    expect(
      variantInput({
        ...variant,
        status: 'inactive',
        price: '',
        weightGrams: '',
      }),
    ).toMatchObject({ price: 0n, weightGrams: 0 }));
});
