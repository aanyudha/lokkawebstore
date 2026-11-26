import { createHash } from 'node:crypto';
import { MAX_RUPIAH } from '../finance/calculations.js';
import type { ShippingRate, ShippingRateProvider } from './rates.js';

function readJntRateConfig(env: NodeJS.ProcessEnv) {
  function required(key: string) {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  }
  const endpoint = required('JNT_TARIFF_URL');
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      throw new Error();
  } catch {
    throw new Error('JNT_TARIFF_URL must be an HTTPS tariff endpoint.');
  }
  function mapping(key: string, fields: number) {
    const input = required(key);
    try {
      const entries: unknown = JSON.parse(input);
      if (!entries || typeof entries !== 'object' || Array.isArray(entries))
        throw new Error();
      const entriesMap = new Map<string, string>();
      for (const [location, code] of Object.entries(entries)) {
        const parts = location.split('|');
        if (
          parts.length !== fields ||
          parts.some((part) => !part.trim()) ||
          (fields === 4 && !/^\d{5}$/.test(parts[3]!.trim())) ||
          typeof code !== 'string' ||
          !/^[A-Z0-9][A-Z0-9 _-]{0,119}$/.test(code)
        )
          throw new Error();
        const normalized = locationKey(parts);
        if (entriesMap.has(normalized)) throw new Error();
        entriesMap.set(normalized, code);
      }
      if (!entriesMap.size) throw new Error();
      return entriesMap;
    } catch {
      throw new Error(`Invalid ${key}`);
    }
  }
  return {
    endpoint,
    customerName: required('JNT_TARIFF_CUSTOMER_NAME'),
    key: required('JNT_TARIFF_KEY'),
    originCodes: mapping('JNT_TARIFF_ORIGIN_CODES', 2),
    destinationCodes: mapping('JNT_TARIFF_DESTINATION_CODES', 4),
  };
}

export function readShippingRateSettings(env: NodeJS.ProcessEnv) {
  const mode = env.SHIPPING_RATE_PROVIDER ?? 'disabled';
  if (mode === 'disabled')
    return { shippingRateMode: 'disabled' as const, jntRate: null };
  if (mode !== 'jnt') throw new Error('Invalid SHIPPING_RATE_PROVIDER');
  try {
    return {
      shippingRateMode: 'jnt' as const,
      jntRate: readJntRateConfig(env),
    };
  } catch {
    return { shippingRateMode: 'jnt_unavailable' as const, jntRate: null };
  }
}

function locationKey(parts: (string | null)[]) {
  return JSON.stringify(
    parts.map((part) => part?.trim().replace(/\s+/g, ' ').toUpperCase() ?? ''),
  );
}

export class JntRateProvider implements ShippingRateProvider {
  constructor(
    private readonly config: ReturnType<typeof readJntRateConfig>,
    private readonly fetchTariff = fetch,
    private readonly diagnostic: (reason: JntRateDiagnostic) => void = () => {},
  ) {}

  async rates({
    origin,
    destination,
    weightGrams,
  }: Parameters<ShippingRateProvider['rates']>[0]) {
    const sendSiteCode = this.config.originCodes.get(
      locationKey([origin.province, origin.city]),
    );
    const destAreaCode = this.config.destinationCodes.get(
      locationKey([
        destination.province,
        destination.city,
        destination.district,
        destination.postalCode,
      ]),
    );
    if (!sendSiteCode || !destAreaCode || !destination.district) {
      this.diagnostic(
        sendSiteCode ? 'destination_unmapped' : 'origin_unmapped',
      );
      return [];
    }
    try {
      const rates = await this.requestRates(
        sendSiteCode,
        destAreaCode,
        weightGrams,
      );
      if (!rates.length) this.diagnostic('no_usable_tariff');
      return rates;
    } catch (error) {
      this.diagnostic(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'tariff_timeout'
          : 'tariff_request_failed',
      );
      return [];
    }
  }

  private async requestRates(
    sendSiteCode: string,
    destAreaCode: string,
    weightGrams: bigint,
  ) {
    const data = JSON.stringify({
      weight: `${weightGrams / 1000n}.${String(weightGrams % 1000n).padStart(3, '0')}`,
      sendSiteCode,
      destAreaCode,
      cusName: this.config.customerName,
      productType: 'EZ',
    });
    // PHP md5() returns hexadecimal text by default. J&T base64-encodes that text.
    const sign = Buffer.from(
      createHash('md5')
        .update(data + this.config.key)
        .digest('hex'),
    ).toString('base64');
    const response = await this.fetchTariff(this.config.endpoint, {
      method: 'POST',
      body: new URLSearchParams({ data, sign }),
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error('Tariff request unsuccessful');
    const result = await response.json();
    if (result?.is_success !== 'true' || typeof result.content !== 'string')
      return [];
    const content: unknown = JSON.parse(result.content);
    if (!Array.isArray(content)) return [];
    const rates = new Map<string, ShippingRate>();
    for (const row of content) {
      if (
        typeof row?.name !== 'string' ||
        !/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(row.name) ||
        typeof row.cost !== 'string' ||
        !/^\d{1,19}$/.test(row.cost)
      )
        return [];
      const amountRupiah = BigInt(row.cost);
      if (
        amountRupiah <= 0n ||
        amountRupiah > MAX_RUPIAH ||
        rates.has(row.name)
      )
        return [];
      rates.set(row.name, {
        id: `jnt:${row.name}`,
        quoteSource: 'JNT',
        courierCode: 'JNT',
        courierName: 'J&T Express',
        serviceCode: row.name,
        serviceName: row.name,
        etaText: null,
        amountRupiah,
      });
    }
    return [...rates.values()];
  }
}

type JntRateDiagnostic =
  | 'destination_unmapped'
  | 'origin_unmapped'
  | 'tariff_timeout'
  | 'tariff_request_failed'
  | 'no_usable_tariff';
