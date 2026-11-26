import { expect, it, vi } from 'vitest';
import {
  JntRateProvider,
  readShippingRateSettings,
} from '../src/modules/shipping/jnt-rate-provider.js';
import { jntFixtureEnv } from './helpers/checkout-fixture.js';

it('starts with manual rates when J&T configuration is absent or unusable', () => {
  expect(readShippingRateSettings({})).toEqual({
    shippingRateMode: 'disabled',
    jntRate: null,
  });
  expect(readShippingRateSettings({ SHIPPING_RATE_PROVIDER: 'jnt' })).toEqual({
    shippingRateMode: 'jnt_unavailable',
    jntRate: null,
  });
  expect(
    readShippingRateSettings({
      ...jntFixtureEnv,
      JNT_TARIFF_DESTINATION_CODES: '{',
    }),
  ).toEqual({ shippingRateMode: 'jnt_unavailable', jntRate: null });
  expect(readShippingRateSettings(jntFixtureEnv).shippingRateMode).toBe('jnt');
});

it('emits fixed reason codes for mapping, timeout, rejection and empty tariffs', async () => {
  const config = readShippingRateSettings(jntFixtureEnv).jntRate!;
  const transport = vi.fn<typeof fetch>();
  const diagnostic = vi.fn();
  const provider = new JntRateProvider(config, transport, diagnostic);
  const shipment = {
    origin: { province: 'DKI Jakarta', city: 'Jakarta Pusat' },
    destination: {
      province: 'DKI Jakarta',
      city: 'Jakarta Pusat',
      district: 'Menteng',
      postalCode: '10310',
    },
    weightGrams: 650n,
  };
  expect(
    await provider.rates({
      ...shipment,
      destination: { ...shipment.destination, district: null },
    }),
  ).toEqual([]);
  expect(
    await provider.rates({
      ...shipment,
      origin: { ...shipment.origin, city: 'Unmapped' },
    }),
  ).toEqual([]);
  expect(transport).not.toHaveBeenCalled();
  transport.mockRejectedValueOnce(
    new DOMException('sensitive upstream detail', 'TimeoutError'),
  );
  transport.mockRejectedValueOnce(new Error('sensitive network detail'));
  transport.mockResolvedValueOnce(
    Response.json({ is_success: 'true', content: '[]' }),
  );
  for (let i = 0; i < 3; i++)
    expect(await provider.rates(shipment)).toEqual([]);
  expect(diagnostic.mock.calls).toEqual([
    ['destination_unmapped'],
    ['origin_unmapped'],
    ['tariff_timeout'],
    ['tariff_request_failed'],
    ['no_usable_tariff'],
  ]);
});
