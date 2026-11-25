import type { ShippingAddressSnapshot } from '../../db/schema/index.js';

export type RateLocation = Pick<
  ShippingAddressSnapshot,
  'province' | 'city' | 'district' | 'postalCode'
>;

export type ShippingRateRequest = {
  origin: Pick<RateLocation, 'province' | 'city'>;
  destination: RateLocation;
  weightGrams: bigint;
};

export type ShippingRate = {
  id: string;
  quoteSource: string;
  courierCode: string | null;
  courierName: string | null;
  serviceCode: string;
  serviceName: string;
  etaText: string | null;
  amountRupiah: bigint;
};

export interface ShippingRateProvider {
  rates(request: ShippingRateRequest): Promise<ShippingRate[]>;
}

export function createShippingRateService(providers: ShippingRateProvider[]) {
  return {
    enabled: providers.length > 0,
    async rates(request: ShippingRateRequest) {
      const results = await Promise.allSettled(
        providers.map((provider) => provider.rates(request)),
      );
      return results
        .flatMap((result) =>
          result.status === 'fulfilled' ? result.value : [],
        )
        .sort((a, b) =>
          a.amountRupiah === b.amountRupiah
            ? a.id.localeCompare(b.id)
            : a.amountRupiah < b.amountRupiah
              ? -1
              : 1,
        );
    },
  };
}
