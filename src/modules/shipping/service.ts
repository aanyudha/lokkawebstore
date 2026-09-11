import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { fulfillmentOrigins, vendors } from '../../db/schema/index.js';
import type { Catalog } from '../catalog/service.js';
import {
  choice,
  FormError,
  id,
  textField,
  type Form,
} from '../catalog/validation.js';

export function createFulfillment(db: Database['db'], catalog: Catalog) {
  async function vendorId() {
    const [vendor] = await db
      .select()
      .from(vendors)
      .where(eq(vendors.slug, 'lokka'));
    if (!vendor)
      throw new FormError('vendor', 'LOKKA vendor is not configured.');
    return vendor.id;
  }
  async function list() {
    return db
      .select()
      .from(fulfillmentOrigins)
      .where(eq(fulfillmentOrigins.vendorId, await vendorId()))
      .orderBy(asc(fulfillmentOrigins.name));
  }
  return {
    list,
    async save(form: Form, originId?: string) {
      const vendor = await vendorId();
      const coordinate = (field: string, limit: number) => {
        const raw = textField(form, field, 20);
        if (!raw) return null;
        if (
          !/^-?\d{1,3}(\.\d{1,8})?$/.test(raw) ||
          Math.abs(Number(raw)) > limit
        )
          throw new FormError(field, 'Enter a valid decimal coordinate.');
        return raw;
      };
      const values = {
        name: textField(form, 'name', 200, true),
        contactName: textField(form, 'contactName', 200, true),
        phone: textField(form, 'phone', 30, true),
        addressLine1: textField(form, 'addressLine1', 300, true),
        addressLine2: textField(form, 'addressLine2', 300) || null,
        district: textField(form, 'district', 150, true),
        city: textField(form, 'city', 150, true),
        province: textField(form, 'province', 150, true),
        postalCode: textField(form, 'postalCode', 5, true),
        countryCode: choice(form, 'countryCode', ['ID']),
        latitude: coordinate('latitude', 90),
        longitude: coordinate('longitude', 180),
        isDefault: form.isDefault === 'on',
        status: choice(form, 'status', ['active', 'inactive']),
        updatedAt: new Date(),
      };
      if (!/^\+?[0-9 ()-]{6,30}$/.test(values.phone))
        throw new FormError('phone', 'Enter a valid contact phone number.');
      if (!/^\d{5}$/.test(values.postalCode))
        throw new FormError('postalCode', 'Use five postal-code digits.');
      if ((values.latitude === null) !== (values.longitude === null))
        throw new FormError(
          'latitude',
          'Provide both coordinates or leave both blank.',
        );
      if (values.isDefault && values.status !== 'active')
        throw new FormError('status', 'The default origin must be active.');
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(724026)`);
        if (values.isDefault)
          await tx
            .update(fulfillmentOrigins)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(eq(fulfillmentOrigins.vendorId, vendor));
        const [row] = originId
          ? await tx
              .update(fulfillmentOrigins)
              .set(values)
              .where(
                and(
                  eq(fulfillmentOrigins.id, id(originId)),
                  eq(fulfillmentOrigins.vendorId, vendor),
                ),
              )
              .returning()
          : await tx
              .insert(fulfillmentOrigins)
              .values({ ...values, vendorId: vendor })
              .returning();
        if (!row) throw new FormError('id', 'Fulfillment origin not found.');
        return row;
      });
    },
    async resolve(productId: string, variantId: string, quantity: number) {
      if (
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        quantity > 2147483647
      )
        throw new FormError(
          'quantity',
          'Quantity must be a positive whole number.',
        );
      const product = await catalog.product(productId);
      const { variants } = await catalog.relations([productId]);
      const variant = variants.find((v) => v.id === id(variantId));
      if (
        product.status !== 'active' ||
        !variant ||
        variant.status !== 'active' ||
        variant.price <= 0n ||
        variant.weightGrams <= 0 ||
        !variant.sku ||
        variant.stockQuantity < quantity
      )
        throw new FormError(
          'variant',
          'Variant is not ready to ship or has insufficient stock.',
        );
      const origin = (await list()).find(
        (o) => o.isDefault && o.status === 'active',
      );
      if (!origin)
        throw new FormError('origin', 'Fulfillment origin not configured.');
      return {
        productId: product.id,
        variantId: variant.id,
        sku: variant.sku,
        quantity,
        priceRupiah: variant.price.toString(),
        weightGrams: variant.weightGrams,
        availableStock: variant.stockQuantity,
        fulfillmentOrigin: origin,
      };
    },
  };
}
