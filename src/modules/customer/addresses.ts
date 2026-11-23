import { and, asc, desc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { customerAddresses, customers } from '../../db/schema/index.js';
import { FormError, id, textField, type Form } from '../catalog/validation.js';

type Address = typeof customerAddresses.$inferSelect;
export function addressSnapshot(address: Address) {
  return {
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    subdistrict: address.subdistrict,
    district: address.district,
    city: address.city,
    province: address.province,
    postalCode: address.postalCode,
    countryCode: address.countryCode,
  };
}

export function createCustomerAddresses(
  db: Pick<Database['db'], 'select' | 'transaction'>,
) {
  const owned = (customerId: string, addressId: string) =>
    and(
      eq(customerAddresses.customerId, customerId),
      eq(customerAddresses.id, addressId),
    );

  return {
    list(customerId: string) {
      return db
        .select()
        .from(customerAddresses)
        .where(eq(customerAddresses.customerId, customerId))
        .orderBy(
          desc(customerAddresses.isDefault),
          asc(customerAddresses.createdAt),
          asc(customerAddresses.id),
        );
    },
    async selected(customerId: string, addressId: string, lock = false) {
      const query = db
        .select()
        .from(customerAddresses)
        .where(owned(customerId, addressId));
      const [address] = await (lock ? query.for('share') : query);
      return address ?? null;
    },
    async save(customerId: string, form: Form, addressId?: string) {
      const values = {
        label: textField(form, 'label', 80) || null,
        recipientName: textField(form, 'recipientName', 150, true),
        phone: textField(form, 'phone', 30, true),
        addressLine1: textField(form, 'addressLine1', 300, true),
        addressLine2: textField(form, 'addressLine2', 300) || null,
        subdistrict: textField(form, 'subdistrict', 120) || null,
        district: textField(form, 'district', 120) || null,
        city: textField(form, 'city', 120, true),
        province: textField(form, 'province', 120, true),
        postalCode: textField(form, 'postalCode', 5, true),
        countryCode: 'ID' as const,
        updatedAt: new Date(),
      };
      if (
        !/^\+?[0-9 ()-]+$/.test(values.phone) ||
        !/^\d{6,15}$/.test(values.phone.replace(/\D/g, ''))
      )
        throw new FormError('phone', 'shop.error.addressPhone');
      if (!/^\d{5}$/.test(values.postalCode))
        throw new FormError('postalCode', 'shop.error.addressPostal');
      return db.transaction(async (tx) => {
        await tx
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.id, customerId))
          .for('no key update');
        const address = addressId
          ? (
              await tx
                .select()
                .from(customerAddresses)
                .where(owned(customerId, id(addressId)))
            )[0]
          : undefined;
        if (addressId && !address)
          throw new FormError('id', 'shop.error.address');
        const isDefault =
          form.isDefault === 'on' || address?.isDefault === true;
        if (isDefault) {
          await tx
            .update(customerAddresses)
            .set({ isDefault: false, updatedAt: values.updatedAt })
            .where(
              and(
                eq(customerAddresses.customerId, customerId),
                eq(customerAddresses.isDefault, true),
              ),
            );
        }
        const [saved] = address
          ? await tx
              .update(customerAddresses)
              .set({ ...values, isDefault })
              .where(owned(customerId, address.id))
              .returning()
          : await tx
              .insert(customerAddresses)
              .values({ ...values, customerId, isDefault })
              .returning();
        return saved!;
      });
    },
  };
}
