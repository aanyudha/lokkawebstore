export class FormError extends Error {
  statusCode = 422;
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
  }
}
export type Form = Record<string, unknown>;
export function textField(
  form: Form,
  field: string,
  max = 200,
  required = false,
): string {
  const value = form[field];
  if (value !== undefined && typeof value !== 'string')
    throw new FormError(field, 'Nilai tidak valid.');
  const result = (value as string | undefined)?.trim() ?? '';
  if ((required && !result) || result.length > max)
    throw new FormError(
      field,
      `Isi ${field} dengan benar (maksimum ${max} karakter).`,
    );
  return result;
}
export function id(value: unknown, field = 'id'): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new FormError(field, 'ID tidak valid.');
  return value;
}
export function integer(form: Form, field: string, min = 0): number {
  const value = textField(form, field, 10, true);
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > 2147483647)
    throw new FormError(field, `Harus bilangan bulat minimal ${min}.`);
  return Number(value);
}
export function choice<T extends string>(
  form: Form,
  field: string,
  choices: readonly T[],
): T {
  const value = textField(form, field);
  if (!choices.includes(value as T))
    throw new FormError(field, 'Pilihan tidak valid.');
  return value as T;
}
export function slug(form: Form, name: string): string {
  const value =
    textField(form, 'slug', 150) ||
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 150)
    throw new FormError(
      'slug',
      'Gunakan huruf kecil, angka, dan tanda hubung.',
    );
  return value;
}
export function money(
  form: Form,
  field: string,
  optional = false,
): bigint | null {
  const value = textField(form, field, 19, !optional);
  if (!value && optional) return null;
  if (!/^[1-9]\d*$/.test(value) || BigInt(value) > 9223372036854775807n)
    throw new FormError(field, 'Masukkan Rupiah bulat lebih dari nol.');
  return BigInt(value);
}
export function formatIdr(value: bigint, locale = 'id') {
  return `Rp${new Intl.NumberFormat(locale === 'id' ? 'id-ID' : 'en-US', { maximumFractionDigits: 0 }).format(value)}`;
}
export function variantInput(form: Form) {
  const status = choice(form, 'status', ['active', 'inactive']);
  const price =
    status === 'inactive' && (!form.price || form.price === '0')
      ? 0n
      : money(form, 'price')!;
  const compareAtPrice = money(form, 'compareAtPrice', true);
  if (compareAtPrice !== null && compareAtPrice <= price)
    throw new FormError(
      'compareAtPrice',
      'Compare-at price must be greater than selling price.',
    );
  const sku = textField(form, 'sku', 80, true);
  if (!/^[A-Za-z0-9._-]+$/.test(sku))
    throw new FormError(
      'sku',
      'SKU hanya huruf, angka, titik, garis bawah dan tanda hubung.',
    );
  return {
    name: textField(form, 'name', 150, true),
    sku,
    price,
    compareAtPrice,
    weightGrams: integer(
      { ...form, weightGrams: form.weightGrams || '0' },
      'weightGrams',
      status === 'active' ? 1 : 0,
    ),
    stockQuantity: integer(form, 'stockQuantity'),
    sortOrder: integer({ sortOrder: '0', ...form }, 'sortOrder'),
    status,
  };
}
export function databaseError(error: unknown): never {
  let current = error;
  for (let i = 0; i < 3 && current instanceof Error; i++) {
    if ('code' in current && current.code === '23505')
      throw new FormError(
        'slug',
        'Slug atau SKU sudah digunakan. Gunakan nilai unik.',
      );
    current = current.cause;
  }
  throw error;
}
