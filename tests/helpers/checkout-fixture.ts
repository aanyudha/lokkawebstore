import type { Database } from '../../src/db/client.js';
import type { Catalog } from '../../src/modules/catalog/service.js';
import { createCheckout } from '../../src/modules/checkout/service.js';
import { createCustomerAddresses } from '../../src/modules/customer/addresses.js';
import { createFulfillment } from '../../src/modules/shipping/service.js';

export const sampleAddress = {
  label: 'Home',
  recipientName: 'Fixture Recipient',
  phone: '08123456789',
  addressLine1: 'Jalan Merdeka 10',
  district: 'Menteng',
  city: 'Jakarta Pusat',
  province: 'DKI Jakarta',
  postalCode: '10310',
  isDefault: 'on',
};

export async function configureCheckoutShipping(
  db: Database['db'],
  catalog: Catalog,
) {
  const fulfillment = createFulfillment(db, catalog);
  await fulfillment.save({
    name: 'Fixture origin',
    contactName: 'Dispatch',
    phone: '08123456789',
    addressLine1: 'Jalan Pengiriman 10',
    district: 'Menteng',
    city: 'Jakarta Pusat',
    province: 'DKI Jakarta',
    postalCode: '10310',
    countryCode: 'ID',
    status: 'active',
    isDefault: 'on',
  });
  return fulfillment.methods.save({
    code: 'STANDARD',
    name: 'Standard delivery',
    amountRupiah: '22000',
    status: 'active',
  });
}

export function saveCheckoutAddress(db: Database['db'], customerId: string) {
  return createCustomerAddresses(db).save(customerId, sampleAddress);
}

export async function reviewedCheckout(
  db: Database['db'],
  customerId: string,
  addressId: string,
  methodId: string,
) {
  const selection = { addressId, methodId };
  const reviewed = await createCheckout(db).review(customerId, selection);
  return {
    ...selection,
    revision: reviewed.cart!.revision,
    quote: reviewed.token,
  };
}
