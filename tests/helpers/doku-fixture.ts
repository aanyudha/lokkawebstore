import { dokuSignature } from '../../src/modules/payments/doku-provider.js';
import { dokuNotificationPath } from '../../src/modules/payments/config.js';

export const dokuFixture = {
  environment: 'sandbox',
  clientId: 'test-merchant',
  secretKey: 'test-only-key',
  notificationUrl: 'https://example.test' + dokuNotificationPath,
} as const;
export const dokuTime = '2026-11-23T06:00:00Z';

export function signedHeaders(
  body: string,
  eventId: string,
  timestamp = dokuTime,
) {
  const { clientId, secretKey } = dokuFixture;
  return {
    'content-type': 'application/json',
    'client-id': clientId,
    'request-id': eventId,
    'request-timestamp': timestamp,
    signature: dokuSignature(
      secretKey,
      clientId,
      eventId,
      timestamp,
      dokuNotificationPath,
      body,
    ),
  };
}
