export type ProductState = { status: string; name?: string; slug?: string };
export type VariantState = {
  status: string;
  sku: string;
  price: bigint;
  stockKnown: boolean;
  stockQuantity: number;
  weightGrams?: number | null;
};
export function isOperationalVariant(
  variant: Pick<VariantState, 'status' | 'sku' | 'price'>,
): boolean {
  return (
    variant.status === 'active' &&
    variant.price > 0n &&
    /^[A-Za-z0-9._-]+$/.test(variant.sku)
  );
}
export function canSellInPos(
  product: ProductState | undefined,
  variant: VariantState | undefined,
  quantity = 1,
): boolean {
  return (
    !!product &&
    product.status === 'active' &&
    !!variant &&
    isOperationalVariant(variant) &&
    variant.stockKnown &&
    Number.isSafeInteger(quantity) &&
    quantity > 0 &&
    variant.stockQuantity >= quantity
  );
}
export function canSellInWebstore(
  product: ProductState | undefined,
  variant: VariantState | undefined,
  quantity = 1,
): boolean {
  return (
    canSellInPos(product, variant, quantity) &&
    !!product?.name?.trim() &&
    !!product.slug?.trim() &&
    Number.isSafeInteger(variant?.weightGrams) &&
    (variant?.weightGrams ?? 0) > 0
  );
}
export function readinessBadges(
  product: ProductState,
  variants: VariantState[],
): string[] {
  const badges = [
    variants.some((v) => canSellInPos(product, v))
      ? 'POS Ready'
      : 'POS Incomplete',
    variants.some((v) => canSellInWebstore(product, v))
      ? 'Webstore Ready'
      : 'Webstore Incomplete',
  ];
  if (variants.some((v) => !v.stockKnown)) badges.push('Stock Unknown');
  if (
    variants.length &&
    variants.every((v) => v.stockKnown && v.stockQuantity === 0)
  )
    badges.push('Out of Stock');
  if (variants.some((v) => !v.weightGrams)) badges.push('Weight Missing');
  return badges;
}
