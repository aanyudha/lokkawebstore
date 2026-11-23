import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  fulfillmentOrigins,
  shippingMethods,
  vendors,
} from '../../db/schema/index.js';
import {
  choice,
  FormError,
  id,
  textField,
  type Form,
} from '../catalog/validation.js';
import { rupiah } from '../finance/calculations.js';

export function createShippingMethods(
  db: Pick<Database['db'], 'select' | 'insert' | 'update'>,
) {
  return {
    list(activeOnly = false) {
      return db
        .select()
        .from(shippingMethods)
        .where(activeOnly ? eq(shippingMethods.active, true) : undefined)
        .orderBy(asc(shippingMethods.name), asc(shippingMethods.code));
    },
    async origin(lock = false) {
      const query = db
        .select({
          id: fulfillmentOrigins.id,
          updatedAt: fulfillmentOrigins.updatedAt,
        })
        .from(fulfillmentOrigins)
        .innerJoin(vendors, eq(vendors.id, fulfillmentOrigins.vendorId))
        .where(
          and(
            eq(vendors.slug, 'lokka'),
            eq(fulfillmentOrigins.isDefault, true),
            eq(fulfillmentOrigins.status, 'active'),
          ),
        );
      const [origin] = await (lock
        ? query.for('share', { of: fulfillmentOrigins })
        : query);
      return origin ?? null;
    },
    async selected(methodId: string, lock = false) {
      const query = db
        .select()
        .from(shippingMethods)
        .where(
          and(
            eq(shippingMethods.id, methodId),
            eq(shippingMethods.active, true),
          ),
        );
      const [method] = await (lock ? query.for('share') : query);
      return method ?? null;
    },
    async save(form: Form, methodId?: string) {
      const values = {
        name: textField(form, 'name', 120, true),
        description: textField(form, 'description', 250) || null,
        amountRupiah: rupiah(form, 'amountRupiah'),
        active: choice(form, 'status', ['active', 'inactive']) === 'active',
        updatedAt: new Date(),
      };
      if (methodId) {
        const [saved] = await db
          .update(shippingMethods)
          .set(values)
          .where(eq(shippingMethods.id, id(methodId)))
          .returning();
        if (!saved) throw new FormError('id', 'Shipping method not found.');
        return saved;
      }
      const code = textField(form, 'code', 40, true).toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code))
        throw new FormError(
          'code',
          'Use letters, digits, hyphens or underscores for the shipping code.',
        );
      const [saved] = await db
        .insert(shippingMethods)
        .values({ ...values, code })
        .onConflictDoNothing({ target: shippingMethods.code })
        .returning();
      if (!saved)
        throw new FormError('code', 'This shipping code already exists.');
      return saved;
    },
  };
}
